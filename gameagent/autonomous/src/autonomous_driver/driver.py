"""driver 主循环：wait_for_event 事件循环 + 状态机驱动 + 决策执行。

流程：connect → ensure_connected → join_match_queue → 事件循环：
- wait_for_event 超时（hasEvent=false）→ 心跳检查（get_connection_status）
- 有事件批 → 喂状态机（transition）→ 执行状态机产出的动作
- PLAYING → 快照检查（get_agent_view + get_affordances）→ 需要决策时调
  Decide（规则策略占位）并执行返回的 GameAction
- 终局：get_agent_view.gameOver 权威视图（GameOverView：result/replayId/
  totalTurn，mcpserver 结算投影，Task 3 终局权威化）→ fetch_and_save_replay
  落库 → 退出

批量模式（Task 2）：run_batch(games) 循环调用单局 run_once，局间 reset()
隔离（状态机/重排计数/终局暂存回初始），decider 的 reset / on_game_end
钩子按协议探测调用——单局异常不裂变后续局。

测试钩子：run_once(max_waits=...) 限制 wait 轮数，配合 fake client 的事件脚本
可确定性驱动全流程单测。
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from autonomous_driver.decide import Decide, GameAction
from autonomous_driver.mcp_client import GameMCPClient
from autonomous_driver.state_machine import (
    EVENT_ROOM_ACTIVE_ROOM_FOUND,
    DriverAction,
    GamePhase,
    check_playing,
    initial,
    transition,
)

log = logging.getLogger("autonomous_driver")


@dataclass(frozen=True)
class GameOutcome:
    """单局结果（driver 终局权威化产出）。

    result 来自 get_agent_view.gameOver（GameOverView.result：win/loss/draw），
    是 mcpserver 按 viewerID 投影的权威值，driver 不猜测胜负。
    match_id 复用回放 ID（replayId 或 fetch_and_save_replay 返回的 matchId）；
    异常局无回放时为空串。
    rejections 为局内"问题动作"计数（后端拒绝 success=false + 未知动作 +
    decide 抛异常），是 L2 首局即冒烟的判据之一（设计文档 §4.5）。
    """

    match_id: str = ""
    result: str = ""  # win / loss / draw（权威值；异常局为空）
    replay_id: str = ""
    total_turn: int = 0
    exit_code: int = 0  # 0=正常结束，1=异常（连接失败/被踢/超时放弃）
    rejections: int = 0  # 局内问题动作计数（L2 冒烟判据）
    error: str = ""  # 异常描述（exit_code=1 时填充）


class Driver:
    """对局驾驶器：确定性事件循环 + 可插拔决策大脑。"""

    def __init__(
        self,
        client: GameMCPClient,
        decider: Decide,
        *,
        game_mode: str = "classic",
        preferred_count: int = 2,
        wait_timeout: int = 30,
        max_requeue: int = 5,
        smoke_rejection_threshold: int = 5,
        max_connect_retries: int = 3,
    ) -> None:
        self.client = client
        self.decider = decider
        self.game_mode = game_mode
        self.preferred_count = preferred_count
        self.wait_timeout = wait_timeout
        self.max_requeue = max_requeue
        self.max_connect_retries = max_connect_retries
        self.requeue_count = 0
        self.state = initial()
        # 终局暂存（Task 3 权威化）：单局期间记录，_compose_outcome 组装 GameOutcome
        self._game_over_view: dict[str, Any] | None = None
        self._replay_id = ""
        self._abnormal_end = False
        # L2 冒烟判据（设计文档 §4.5）：局内问题动作计数 + 批量级中止标记
        self._rejections = 0
        self.smoke_rejection_threshold = smoke_rejection_threshold
        self.smoke_aborted = False
        # 批量级中止标记（环境级失败，与 smoke_aborted 并列）：连接/排队失败、
        # 账户池耗尽、重排超限等环境问题重试无意义，run_batch 遇到即中止剩余局。
        self.env_aborted = False

    # --- 批量 / 单局入口 ---

    async def run_batch(
        self,
        games: int,
        *,
        max_waits: int | None = None,
        smoke_first: bool = False,
    ) -> list[GameOutcome]:
        """批量连打 N 局：局间 reset() 隔离，单局异常不裂变后续局。

        ``smoke_first=True``（L2 首局即冒烟，设计文档 §4.5）：批量第一局兼作
        动态冒烟——首局 ``exit_code≠0``（被踢/超时/主循环异常/decide 崩溃）或
        ``rejections ≥ smoke_rejection_threshold`` 即中止剩余局，置
        ``self.smoke_aborted=True`` 并在日志写明原因。坏脚本最多废 1 局而非
        整批 N 局；一局真实对局同时是冒烟与批量数据，不浪费。

        每局前调 decider.reset()，每局后调 decider.on_game_end(match_id, result)
        （按协议探测，未实现则跳过）。返回全部局的 GameOutcome 列表。
        """
        outcomes: list[GameOutcome] = []
        self.smoke_aborted = False  # 批量级标记：run_batch 管理，局间 reset 不清
        self.env_aborted = False  # 环境级失败中止标记（同上，run_batch 管理）
        for i in range(games):
            log.info("批量第 %s/%s 局开始", i + 1, games)
            self.reset()
            self._call_decider_hook("reset")
            outcome = await self.run_once(max_waits=max_waits)
            outcomes.append(outcome)
            if outcome.match_id:
                log.info(
                    "第 %s 局完成: match=%s result=%s turns=%s rejections=%s",
                    i + 1,
                    outcome.match_id,
                    outcome.result,
                    outcome.total_turn,
                    outcome.rejections,
                )
            else:
                log.error(
                    "第 %s 局异常: %s", i + 1, outcome.error or "未知错误（无回放产出）"
                )
            self._call_decider_hook("on_game_end", outcome.match_id, outcome.result)
            if smoke_first and i == 0 and self._smoke_failed(outcome):
                self.smoke_aborted = True
                log.error("冒烟失败（首局）: %s", self._smoke_reason(outcome))
                break
            # 环境级失败（非脚本/局内问题）：账户池耗尽、连接/排队失败、重排超限
            # 等会持续存在，重试剩余局无意义——立即中止整批（首局已由冒烟门
            # 处理，此处覆盖第 2+ 局）。修复背景：双 driver 并行 + 2 账户池时
            # ai2 第 3 局「账户池中没有可用账户」批量中止后 ai1 无人匹配，
            # ai1 第 2/3 局连续 match:error 直到重排超限（见 2026-08-13 日志分析）。
            if self._env_failed(outcome):
                self.env_aborted = True
                log.error(
                    "环境级失败（非脚本问题），中止剩余局: %s",
                    outcome.error or f"exit_code={outcome.exit_code}",
                )
                break
        return outcomes

    def _smoke_failed(self, outcome: GameOutcome) -> bool:
        """L2 冒烟判定：首局异常或问题动作超阈值。"""
        return outcome.exit_code != 0 or outcome.rejections >= self.smoke_rejection_threshold

    def _env_failed(self, outcome: GameOutcome) -> bool:
        """环境级失败判定：连接/排队失败、账户池耗尽、匹配失败、重排超限。

        这类失败与脚本质量无关（修复脚本无意义），且会持续存在（服务不可用/
        账户池空/无人匹配），run_batch 遇之即中止剩余局止损。判定只匹配
        错误文本关键词，不匹配正常终局（exit_code=0）。
        """
        if outcome.exit_code == 0:
            return False
        err = outcome.error or ""
        return any(
            marker in err
            for marker in (
                # MCP 连接重试耗尽后仍失败（_connect_with_retry 已按指数退避
                # 重试 max_connect_retries 次）→ mcpserver 不可用，重试后续局
                # 无意义，中止整批止损。
                "连接失败",
                # ensure_connected / join_queue 失败（MCP 可达但游戏后端不可达
                # / 账户池空）：环境级，中止整批止损。
                "连接/排队失败",
                "账户池",
                "借用账户",
                "占用",  # 指名绑定冲突:「账号 X 已被会话 Y 占用」= 环境级失败,批量中止止损
                "匹配失败",
                "重连/重排超过",
            )
        )

    def _smoke_reason(self, outcome: GameOutcome) -> str:
        """L2 冒烟失败原因（日志用，可读）。"""
        reasons: list[str] = []
        if outcome.exit_code != 0:
            reasons.append(
                f"exit_code={outcome.exit_code}（{outcome.error or '异常结束'}）"
            )
        if outcome.rejections >= self.smoke_rejection_threshold:
            reasons.append(
                f"rejections={outcome.rejections} ≥ 阈值 {self.smoke_rejection_threshold}"
            )
        return "；".join(reasons)

    async def run_once(self, *, max_waits: int | None = None) -> GameOutcome:
        """跑完一场对局（单局语义）。返回 GameOutcome（含权威 result / match_id）。"""
        self.reset()
        error_note = ""
        try:
            await self._connect_with_retry()
        except Exception as e:  # noqa: BLE001
            log.error("MCP 连接失败: %s", e)
            await self._close()
            return self._compose_outcome(1, error_note=f"连接失败: {e}")

        # 连接 + 排队
        try:
            await self.client.ensure_connected()
            self.state = GamePhase.MATCHMAKING
            await self.client.join_match_queue(self.game_mode, self.preferred_count)
            log.info("已加入快速匹配队列 (mode=%s)", self.game_mode)
        except Exception as e:  # noqa: BLE001
            log.error("连接/排队失败: %s", e)
            await self._close()
            return self._compose_outcome(1, error_note=f"连接/排队失败: {e}")

        waits = 0
        exit_code = 0
        try:
            while True:
                if max_waits is not None and waits >= max_waits:
                    log.warning("达到 max_waits=%s，提前退出", max_waits)
                    exit_code = 1
                    break
                waits += 1

                result = await self._wait()
                if result is None:
                    # _wait 内已尝试 _recover：恢复成功（state 非 ERROR）说明是
                    # 瞬态抖动（网络闪断等），继续等待不放弃本局；恢复失败
                    # （重连/重排失败或超上限置 ERROR）才按异常局放弃。
                    if self.state == GamePhase.ERROR:
                        exit_code = 1
                        break
                    continue

                if not result.has_event:
                    await self._heartbeat()
                    continue

                # 事件批 → 状态机
                events = result.typed_events()
                # 重连后发现有进行中对局：主动 rejoin 回对局并请求全量同步
                if any(e.type == EVENT_ROOM_ACTIVE_ROOM_FOUND for e in events):
                    try:
                        await self.client.rejoin_room()
                        log.info("已 rejoin 进行中的对局")
                    except Exception as e:  # noqa: BLE001
                        log.warning("rejoin_room 失败: %s", e)
                trans = transition(self.state, events)
                self.state = trans.state
                log.info(
                    "状态迁移: %s (事件 %s)", self.state.value,
                    ",".join(e.type for e in events),
                )
                await self._run_actions(trans.actions)

                # 按状态推进（顺序 if：_playing_tick 可能修改状态）
                if self.state == GamePhase.PLAYING:
                    await self._playing_tick()
                if self.state == GamePhase.GAME_OVER:
                    log.info("对局结束，驾驶器退出")
                    break
                if self.state == GamePhase.ERROR:
                    if self.requeue_count > self.max_requeue:
                        log.error("重连/重排超过 %s 次上限，放弃本场对局", self.max_requeue)
                        exit_code = 1
                        break
                    await self._recover()
        except Exception as e:  # noqa: BLE001
            log.exception("主循环异常: %s", e)
            await self._close()
            return self._compose_outcome(1, error_note=f"主循环异常: {e}")

        await self._close()
        return self._compose_outcome(exit_code, error_note=error_note)

    async def run(self, *, max_waits: int | None = None) -> int:
        """跑完一场对局（POC 兼容语义）。返回 0=正常结束，1=异常。"""
        outcome = await self.run_once(max_waits=max_waits)
        return outcome.exit_code

    def reset(self) -> None:
        """局间重置（批量隔离）：状态机、重排计数、问题动作计数与终局暂存回初始。

        smoke_aborted 是批量级标记，由 run_batch 管理（局间 reset 不清，防循环
        中途被清掉判据）。
        """
        self.state = initial()
        self.requeue_count = 0
        self._game_over_view = None
        self._replay_id = ""
        self._abnormal_end = False
        self._rejections = 0

    # --- 内部例程 ---

    def _compose_outcome(self, exit_code: int, *, error_note: str = "") -> GameOutcome:
        """组装 GameOutcome：从最近一次 gameOver 权威视图提取 result/match_id。

        异常局（_abnormal_end，inGame=false 且无 gameOver 权威视图）折算
        exit_code=1——被踢/房间解散不算正常终局，批量模式据此局级重试；
        且不取 _replay_id 暂存（可能为上一局 stale 回放），match_id 置空。
        """
        if self._abnormal_end:
            return GameOutcome(
                exit_code=1,
                error=error_note or "对局提前结束（无 gameOver 权威视图，被踢/房间解散）",
            )
        gv = self._game_over_view or {}
        replay_id = str(gv.get("replayId", "") or self._replay_id)
        return GameOutcome(
            match_id=replay_id,
            result=str(gv.get("result", "")),
            replay_id=replay_id,
            total_turn=int(gv.get("totalTurn", 0) or 0),
            exit_code=exit_code,
            rejections=self._rejections,
            error=error_note,
        )

    def _call_decider_hook(self, name: str, *args: Any) -> None:
        """按协议探测调用 decider 可选钩子（reset / on_game_end），异常不扩散。"""
        hook = getattr(self.decider, name, None)
        if hook is None:
            return
        try:
            hook(*args)
        except Exception as e:  # noqa: BLE001
            log.warning("decider.%s 回调异常: %s", name, e)

    async def _wait(self) -> Any:
        """阻塞等待事件；wait 异常时尝试恢复，返回 None（由调用方按 state 决定放弃/继续）。"""
        try:
            return await self.client.wait_for_event(self.wait_timeout)
        except Exception as e:  # noqa: BLE001
            log.warning("wait_for_event 异常（尝试重连恢复）: %s", e)
            self.state = GamePhase.ERROR
            await self._recover()
            return None

    async def _heartbeat(self) -> None:
        """wait 超时分支：检查 WS 连接，异常则重连。"""
        try:
            status = await self.client.get_connection_status()
        except Exception as e:  # noqa: BLE001
            log.warning("心跳检查失败: %s", e)
            return
        if status.get("wsState") != "connected":
            log.warning("心跳检测到连接异常: %s", status.get("wsState"))
            await self._recover()

    async def _recover(self) -> None:
        """断线重连（两级）：先恢复 MCP 传输层，再同步游戏层。

        第一级：reconnect_mcp() 强制重建 MCP StreamableHTTP 传输层（死 session
        无法复用，connect() 幂等短路不会重建）；新 session 对应的 mcpserver
        GameSession 是全新的，需重新 ensure_connected。
        第二级：ensure_connected（同步游戏 WS）+ get_connection_status →
        有进行中对局则 rejoin_room，否则重新排队。

        每次进入 recover 递增重排计数；超过 max_requeue 时置 ERROR 由主循环放弃。
        """
        self.requeue_count += 1
        if self.requeue_count > self.max_requeue:
            log.error("重连/重排超过 %s 次上限", self.max_requeue)
            self.state = GamePhase.ERROR
            return
        try:
            # 第一级：重建 MCP 传输层（透明，若 client 未暴露则跳过）
            reconnect_mcp = getattr(self.client, "reconnect_mcp", None)
            if reconnect_mcp is not None:
                await reconnect_mcp()
            # 第二级：同步游戏 WS（新 session 需重新 ensure_connected）
            await self.client.ensure_connected()
            status = await self.client.get_connection_status()
        except Exception as e:  # noqa: BLE001
            log.error("重连失败: %s", e)
            self.state = GamePhase.ERROR
            return
        room_id = status.get("roomId") or ""
        if room_id:
            log.info("检测到进行中对局 roomId=%s，rejoin", room_id)
            try:
                await self.client.rejoin_room(room_id)
                self.state = GamePhase.IN_ROOM
            except Exception as e:  # noqa: BLE001
                log.error("rejoin_room 失败: %s", e)
                self.state = GamePhase.ERROR
        else:
            log.info("无进行中对局，重新排队")
            try:
                await self.client.join_match_queue(self.game_mode, self.preferred_count)
                self.state = GamePhase.MATCHMAKING
            except Exception as e:  # noqa: BLE001
                log.error("重新排队失败: %s", e)
                self.state = GamePhase.ERROR

    async def _playing_tick(self) -> None:
        """PLAYING 状态快照检查：终局权威检测 + 决策。

        Task 3 终局权威化：get_agent_view.gameOver（GameOverView）是唯一权威
        终局信号——result/replayId/totalTurn 由 mcpserver 结算投影，driver 不
        猜测胜负。inGame=false 且无 gameOver 视为异常局（被踢/房间解散），
        标记 _abnormal_end 由 _compose_outcome 折算 exit_code=1。
        """
        view = await self.client.get_agent_view()
        game_over = view.get("gameOver")
        if game_over is not None:
            # 权威终局视图：mcpserver 已在结算时投影 result/replayId/totalTurn
            self._game_over_view = game_over
            log.info(
                "终局权威视图: result=%s replayId=%s totalTurn=%s",
                game_over.get("result", ""),
                game_over.get("replayId", ""),
                game_over.get("totalTurn", 0),
            )
            trans = check_playing(game_over=game_over)
            self.state = trans.state
            await self._run_actions(trans.actions)
            return
        if not view.get("inGame", False):
            # 非终局的 inGame=false：先确认连接，已连接则视为异常局收尾
            status = await self.client.get_connection_status()
            if status.get("wsState") != "connected":
                await self._recover()
                return
            self._abnormal_end = True
            log.warning("对局提前结束（无 gameOver 权威视图），按异常局收尾")
            trans = check_playing(game_over={})
            self.state = trans.state
            await self._run_actions(trans.actions)
            return

        # 轮到我 / 有强制动作 → 决策
        aff_out = await self.client.get_affordances()
        aff: dict[str, Any] = {}
        if aff_out.get("inGame"):
            aff = aff_out.get("affordance") or {}
        needs_decide = bool(
            aff.get("pendingAction") or aff.get("broadcastAction") or aff.get("legalActions")
        )
        if not needs_decide:
            log.info("非本人回合，继续等待 (turnPhase=%s)", _cursor_turn_phase(view))
            return
        action = self._decide(view, aff)
        log.info("决策: %s %s", action.name, action.args)
        await self._exec(action)

    def _decide(self, view: dict[str, Any], affordance: dict[str, Any]) -> GameAction:
        """调 decider.decide；异常计入 rejections 后重新抛出（保持主循环中止语义）。

        L2 冒烟判据之一（设计文档 §4.5）：decide 抛异常既是"问题动作"（计入
        局内 rejections），也走主循环 except → exit_code=1，双通道都指向冒烟失败。
        """
        try:
            return self.decider.decide(view, affordance)
        except Exception:  # noqa: BLE001
            self._rejections += 1
            raise

    async def _run_actions(self, actions: list[DriverAction]) -> None:
        """执行状态机产出的 DriverAction 列表。"""
        for act in actions:
            if act.name == "decide":
                view = await self.client.get_agent_view()
                aff_out = await self.client.get_affordances()
                aff = (aff_out.get("affordance") or {}) if aff_out.get("inGame") else {}
                action = self._decide(view, aff)
                log.info("决策: %s %s", action.name, action.args)
                await self._exec(action)
            elif act.name == "fetch_replay":
                try:
                    out = await self.client.fetch_and_save_replay()
                except Exception as e:  # noqa: BLE001
                    log.error("回放落库失败: %s", e)
                    continue
                replay_id = out.get("replayId") or out.get("matchId") or ""
                self._replay_id = str(replay_id)
                log.info("回放已落库: %s", replay_id)
            elif act.name == "log":
                log.warning("%s", act.args.get("msg", ""))
            elif act.name == "join_queue":
                await self.client.join_match_queue(self.game_mode, self.preferred_count)
            elif act.name == "connect":
                await self.client.ensure_connected()
            else:
                log.warning("未知 DriverAction: %s", act.name)

    async def _exec(self, action: GameAction) -> None:
        """把 GameAction 映射为 GameMCPClient 方法调用。

        动作返回 success=false 时记 warning（后端拒绝，如 pending 未处理/阶段不匹配），
        不抛异常——驾驶器继续走事件循环，避免单次失败卡死整个对局。
        未知动作、后端拒绝与执行异常（handler 抛错，如缺参 TypeError）都计入
        局内 rejections（L2 冒烟判据），供批量门止损。
        """
        handler = getattr(self.client, action.name, None)
        if handler is None:
            log.error("未知动作 %s，跳过", action.name)
            self._rejections += 1
            return
        try:
            out = await handler(**action.args)
        except Exception as e:  # noqa: BLE001
            log.error("执行动作 %s 失败: %s", action.name, e)
            self._rejections += 1
            return
        if isinstance(out, dict) and out.get("success") is False:
            log.warning(
                "动作 %s 被后端拒绝: %s (code=%s)",
                action.name,
                out.get("error", ""),
                out.get("errorCode", ""),
            )
            self._rejections += 1

    async def _connect_with_retry(self) -> None:
        """MCP 首连接重试：指数退避重试有限次，区分服务未起与真连不上。

        瞬态（mcpserver 刚启动 / 网络抖动）通常一次即通；重试耗尽仍失败说明
        服务不可用，上抛后由 run_once 按异常局处理（_env_failed 据此中止整批）。
        """
        last_err: BaseException | None = None
        for attempt in range(1, self.max_connect_retries + 1):
            try:
                await self.client.connect()
                return
            except Exception as e:  # noqa: BLE001
                last_err = e
                if attempt < self.max_connect_retries:
                    delay = min(0.5 * (2 ** (attempt - 1)), 5.0)
                    log.warning(
                        "MCP 连接失败（第 %s/%s 次），%.1fs 后重试: %s",
                        attempt,
                        self.max_connect_retries,
                        delay,
                        e,
                    )
                    await asyncio.sleep(delay)
        raise Exception(
            f"连接失败（重试 {self.max_connect_retries} 次）: {last_err}"
        ) from last_err

    async def _close(self) -> None:
        """关闭 MCP 连接（超时保护，确保不阻塞批量/进程退出）。

        mcp SDK 的 StreamableHTTP 退出（__aexit__）在 SSE 断流/服务异常时可能
        阻塞数十秒（实测 ai1 driver 14:48:55 重排超限后 _close 卡到 14:49:25，
        期间 ai1 账户持续占用，导致 ai2 的 v2 批量连续冒烟失败）。这里用
        asyncio.wait_for 兜底：超时强制跳过，账户归还由进程退出（TCP 断开 →
        mcpserver 释放 GameSession）兜底。
        """
        try:
            await asyncio.wait_for(self.client.close(), timeout=10)
        except TimeoutError:
            log.warning("关闭 MCP 连接超时（10s），强制跳过（账户由进程退出释放）")
        except Exception:  # noqa: BLE001  断开即目的，异常忽略（幂等容错）
            pass


def _cursor_turn_phase(view: dict[str, Any]) -> str:
    agent = view.get("agentView") or {}
    cursor = agent.get("cursor") or {}
    return str(cursor.get("turnPhase", ""))
