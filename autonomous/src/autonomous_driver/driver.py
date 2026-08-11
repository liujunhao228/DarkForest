"""driver 主循环：wait_for_event 事件循环 + 状态机驱动 + 决策执行。

流程：connect → ensure_connected → join_match_queue → 事件循环：
- wait_for_event 超时（hasEvent=false）→ 心跳检查（get_connection_status）
- 有事件批 → 喂状态机（transition）→ 执行状态机产出的动作
- PLAYING → 快照检查（get_agent_view + get_affordances）→ 需要决策时调
  Decide（规则策略占位）并执行返回的 GameAction
- GAME_OVER → fetch_and_save_replay 落库 → 退出

测试钩子：run(max_waits=...) 限制 wait 轮数，配合 fake client 的事件脚本
可确定性驱动全流程单测。
"""

from __future__ import annotations

import logging
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
    ) -> None:
        self.client = client
        self.decider = decider
        self.game_mode = game_mode
        self.preferred_count = preferred_count
        self.wait_timeout = wait_timeout
        self.max_requeue = max_requeue
        self.requeue_count = 0
        self.state = initial()

    # --- 主循环 ---

    async def run(self, *, max_waits: int | None = None) -> int:
        """跑完一场对局（--once 语义）。返回 0=正常结束，1=异常。"""
        try:
            await self.client.connect()
        except Exception as e:  # noqa: BLE001
            log.error("MCP 连接失败: %s", e)
            await self._close()
            return 1

        # 连接 + 排队
        try:
            await self.client.ensure_connected()
            self.state = GamePhase.MATCHMAKING
            await self.client.join_match_queue(self.game_mode, self.preferred_count)
            log.info("已加入快速匹配队列 (mode=%s)", self.game_mode)
        except Exception as e:  # noqa: BLE001
            log.error("连接/排队失败: %s", e)
            await self._close()
            return 1

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
                    exit_code = 1
                    break  # 会话关闭且恢复失败

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
            return 1

        await self._close()
        return exit_code

    # --- 内部例程 ---

    async def _wait(self) -> Any:
        """阻塞等待事件；会话关闭时返回 None。"""
        try:
            return await self.client.wait_for_event(self.wait_timeout)
        except Exception as e:  # noqa: BLE001
            log.warning("wait_for_event 异常（视为会话关闭）: %s", e)
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
        """断线重连：ensure_connected → 有进行中对局则 rejoin_room，否则重新排队。

        每次进入 recover 递增重排计数；超过 max_requeue 时置 ERROR 由主循环放弃。
        """
        self.requeue_count += 1
        if self.requeue_count > self.max_requeue:
            log.error("重连/重排超过 %s 次上限", self.max_requeue)
            self.state = GamePhase.ERROR
            return
        try:
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
        """PLAYING 状态快照检查：终局检测 + 决策。"""
        view = await self.client.get_agent_view()
        if not view.get("inGame", False):
            # phase 离开 playing：先确认连接，已连接则视为终局
            status = await self.client.get_connection_status()
            if status.get("wsState") != "connected":
                await self._recover()
                return
            trans = check_playing(phase="gameOver")
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
        action = self.decider.decide(view, aff)
        log.info("决策: %s %s", action.name, action.args)
        await self._exec(action)

    async def _run_actions(self, actions: list[DriverAction]) -> None:
        """执行状态机产出的 DriverAction 列表。"""
        for act in actions:
            if act.name == "decide":
                view = await self.client.get_agent_view()
                aff_out = await self.client.get_affordances()
                aff = (aff_out.get("affordance") or {}) if aff_out.get("inGame") else {}
                action = self.decider.decide(view, aff)
                log.info("决策: %s %s", action.name, action.args)
                await self._exec(action)
            elif act.name == "fetch_replay":
                out = await self.client.fetch_and_save_replay()
                replay_id = out.get("replayId") or out.get("matchId") or ""
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
        """
        handler = getattr(self.client, action.name, None)
        if handler is None:
            log.error("未知动作 %s，跳过", action.name)
            return
        try:
            out = await handler(**action.args)
        except Exception as e:  # noqa: BLE001
            log.error("执行动作 %s 失败: %s", action.name, e)
            return
        if isinstance(out, dict) and out.get("success") is False:
            log.warning(
                "动作 %s 被后端拒绝: %s (code=%s)",
                action.name,
                out.get("error", ""),
                out.get("errorCode", ""),
            )

    async def _close(self) -> None:
        try:
            await self.client.close()
        except Exception:  # noqa: BLE001
            pass


def _cursor_turn_phase(view: dict[str, Any]) -> str:
    agent = view.get("agentView") or {}
    cursor = agent.get("cursor") or {}
    return str(cursor.get("turnPhase", ""))
