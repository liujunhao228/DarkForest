"""决策大脑：Decide 协议 + 默认规则策略（占位实现）。

Decide 协议是驾驶器与决策大脑的契约边界（设计文档 Surface）：
``decide(view_state, affordance) -> GameAction``。后续接入 prime-agent 时
实现同一协议即可无缝替换 RuleDecider。

规则策略目标：**合法且不卡死**（非最优）。优先级：
1. pendingAction（强制挂起动作，打击选择/移动/宣布/落空处理）——LegalOptions
   与 resolve_strike_action 的 option 对齐，可直接传入
2. broadcastAction（广播待处理：agreeOrRefuse / selectResponder / cancel）
3. 自由动作集按优先级（broadcast > strike > deploy_card > play_card >
   recycle_card > end_turn 兜底），cost 超过自身能量则跳过
"""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any, Protocol


class ScriptLoadError(RuntimeError):
    """脚本加载/校验失败（路径不存在、导入失败、缺 ScriptDecider 等）。"""


@dataclass(frozen=True)
class GameAction:
    """Decide 输出：驾驶器可执行动作。name 映射到 GameMCPClient 方法。"""

    name: str
    args: dict[str, Any] = field(default_factory=dict)


class Decide(Protocol):
    """决策大脑协议：view_state + affordance → 一个可执行动作。

    可选钩子（driver 批量模式按 getattr 探测调用，非强制）：
    - reset()                   局前重置 self.state（脚本协议；规则策略无状态可不实现）
    - on_game_end(match_id, result)  局终钩子（记录/学习，供复盘迭代）
    """

    def decide(self, view: dict[str, Any], affordance: dict[str, Any]) -> GameAction: ...


# 自由动作优先级（broadcast 最激进 → end_turn 兜底）
FREE_ACTION_PRIORITY: tuple[str, ...] = (
    "broadcast",
    "strike",
    "deploy_card",
    "play_card",
    "recycle_card",
    "end_turn",
)

# pendingAction 的保守选项（无需目标、不会卡死）
SKIP_OPTIONS: frozenset[str] = frozenset(
    {"skip_select", "skip_move", "skip_announce", "skip_missed", "discard_missed"}
)


def _first_target(targets: list[dict[str, Any]], ttype: str) -> str | None:
    """从 legalTargets 取第一个指定类型的 Target.value（判别式见 semantic.Target）。"""
    for t in targets:
        if t.get("type") == ttype and t.get("value"):
            return str(t["value"])
    return None


def _my_energy(view: dict[str, Any]) -> int:
    """从 get_agent_view 提取自身能量（agentView.self.energy，缺失视为 0）。"""
    agent = view.get("agentView") or {}
    self_snap = agent.get("self") or {}
    energy = self_snap.get("energy")
    if isinstance(energy, int):
        return energy
    return 0


class RuleDecider:
    """默认规则策略（占位）：确定性、保守、永不卡死。"""

    def reset(self) -> None:
        """局前重置（脚本协议钩子）：规则策略无跨局状态，空实现供子类覆写。"""

    def on_game_end(self, match_id: str, result: str) -> None:
        """局终钩子（脚本协议）：规则策略不记录对局，空实现供子类覆写。"""

    def decide(self, view: dict[str, Any], affordance: dict[str, Any]) -> GameAction:
        pending = affordance.get("pendingAction")
        if pending:
            return self._resolve_pending(pending)
        broadcast = affordance.get("broadcastAction")
        if broadcast:
            return self._resolve_broadcast(broadcast)
        legal = affordance.get("legalActions") or []
        return self._pick_free(legal, view)

    # --- 强制挂起动作 ---

    def _resolve_pending(self, pending: dict[str, Any]) -> GameAction:
        options = [str(o) for o in (pending.get("legalOptions") or [])]
        targets = pending.get("legalTargets") or []
        # 1) 保守选项优先：skip / discard 类无需目标
        for opt in options:
            if opt in SKIP_OPTIONS:
                return GameAction("resolve_strike_action", {"option": opt})
        # 2) 其余选项：move/retarget/retarget_missed 需要 strikeUid + targetSystem；
        #    select/skip_missed/discard_missed 需要 strikeUid
        if options:
            opt = options[0]
            args: dict[str, Any] = {"option": opt}
            strike_uid = _first_target(targets, "strikeUid")
            system = _first_target(targets, "systemId")
            if strike_uid:
                args["strike_uid"] = strike_uid
            if system:
                args["target_system"] = int(system)
            return GameAction("resolve_strike_action", args)
        # 3) 无 options：从 targets 推导（理论不应出现，兜底结束回合防卡死）
        return GameAction("end_turn")

    def _resolve_broadcast(self, broadcast: dict[str, Any]) -> GameAction:
        btype = str(broadcast.get("type", ""))
        targets = broadcast.get("legalTargets") or []
        if btype == "agreeOrRefuse":
            card = _first_target(targets, "cardUid")
            if card:
                return GameAction("respond_broadcast", {"agreed": True, "card_uid": card})
            # 无可用广播牌：伪装拒绝（agreed=false 不需要 cardUid）
            return GameAction("respond_broadcast", {"agreed": False})
        if btype == "selectResponder":
            pid = _first_target(targets, "playerId")
            if pid:
                return GameAction("select_broadcast_responder", {"responder_player_id": pid})
        if btype == "cancel":
            return GameAction("cancel_broadcast")
        # 未知类型：兜底结束回合（不应发生）
        return GameAction("end_turn")

    # --- 自由动作集 ---

    def _pick_free(self, legal: list[dict[str, Any]], view: dict[str, Any]) -> GameAction:
        energy = _my_energy(view)
        for name in FREE_ACTION_PRIORITY:
            for opt in legal:
                if opt.get("action") != name:
                    continue
                cost = (opt.get("cost") or {}).get("energy", 0)
                if isinstance(cost, int) and cost > energy:
                    continue
                return self._build_free(name, opt)
        # 兜底：end_turn 永远可用（若连 end_turn 都缺失，仍返回它防卡死）
        return GameAction("end_turn")

    def _build_free(self, name: str, opt: dict[str, Any]) -> GameAction:
        if name == "end_turn":
            return GameAction("end_turn")
        targets = opt.get("legalTargets") or []
        card = _first_target(targets, "cardUid")
        system = _first_target(targets, "systemId")
        if name in ("play_card", "deploy_card"):
            # MCP play_card/deploy_card 仅接受 cardUid（目标星系由后端/卡牌决定）
            args: dict[str, Any] = {}
            if card:
                args["card_uid"] = card
            return GameAction(name, args)
        if name in ("strike", "broadcast"):
            args = {}
            if card:
                args["card_uid"] = card
            if system:
                args["target_system"] = int(system)
            return GameAction(name, args)
        if name == "recycle_card":
            args = {}
            if card:
                args["card_uid"] = card
            return GameAction("recycle_card", args)
        # 未知动作：结束回合防卡死
        return GameAction("end_turn")


def load_script_decider(script_path: str) -> Decide:
    """从脚本文件加载并实例化 ``ScriptDecider``（脚本协议入口）。

    脚本是 ``rules/<name>/v<N>.py``：定义 ``ScriptDecider`` 类（实现
    ``decide``，可选 ``reset`` / ``on_game_end`` 钩子）。经 importlib 以
    文件路径加载（不要求脚本在 sys.path），加载/校验失败抛
    ``ScriptLoadError``（reason 可读，供校验门与 CLI 统一处理）。

    mypy 注记：脚本由 LLM 生成，不参与本包类型检查；此处返回 ``Decide``
    协议类型，运行期行为以脚本为准。
    """
    path = Path(script_path).resolve()
    if not path.is_file():
        raise ScriptLoadError(f"脚本文件不存在: {path}")

    # 模块名带父目录名（script_name）：不同脚本目录的同名版本文件
    # （s1/v1.py、s2/v1.py）若都用 f"_df_script_{stem}" 会复用同名模块、
    # 靠 sys.modules 覆盖——无实际串扰但脆弱（脚本间互相 import 时可能
    # 拿到旧模块），加目录名前缀彻底隔离。
    module_name = f"_df_script_{path.parent.name}_{path.stem}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ScriptLoadError(f"无法创建脚本模块: {path}")
    module: ModuleType = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as exc:  # noqa: BLE001  脚本任意异常都要转为可读错误
        raise ScriptLoadError(f"脚本导入失败: {exc}") from exc

    decider_cls = getattr(module, "ScriptDecider", None)
    if decider_cls is None:
        raise ScriptLoadError(f"脚本未定义 ScriptDecider 类: {path}")
    if not callable(getattr(decider_cls, "decide", None)):
        raise ScriptLoadError(f"ScriptDecider 未实现 decide(): {path}")

    try:
        decider: Any = decider_cls()  # 脚本类构造签名未知，按 Any 实例化
    except Exception as exc:  # noqa: BLE001
        raise ScriptLoadError(f"ScriptDecider 实例化失败: {exc}") from exc
    return decider  # type: ignore[no-any-return]
