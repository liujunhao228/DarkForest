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

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class GameAction:
    """Decide 输出：驾驶器可执行动作。name 映射到 GameMCPClient 方法。"""

    name: str
    args: dict[str, Any] = field(default_factory=dict)


class Decide(Protocol):
    """决策大脑协议：view_state + affordance → 一个可执行动作。"""

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
