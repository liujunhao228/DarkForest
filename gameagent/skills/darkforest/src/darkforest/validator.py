"""DarkForest 规则校验器：动作合法性纯逻辑校验，无 IO。

动作合法性一律以 ``get_affordances`` 返回的 Affordance 为准（后端权威），
本模块只做形状/成员检查，不在 Python 侧硬编码游戏规则。

Affordance JSON 结构（对齐 mcpserver internal/semantic/affordance_explorer.go）::

    {
      "broadcastAction": {...} | null,   # 广播待处理动作
      "pendingAction": {...} | null,     # 强制挂起动作（非空时 LegalActions 为空）
      "legalActions": [
        {
          "action": "play_card",
          "cost": {"energy": 1, "cardsDiscarded": 0},
          "legalTargets": [{"type": "cardUid", "value": "h1"}, ...],
          "precondition": "...",
          "expectedEffect": "...",
          "riskNote": "..."
        }, ...
      ]
    }

Target.type 取值: cardUid / systemId / playerId / strikeUid / option，
``value`` 统一为字符串（systemId 也转为 string）。
"""

from __future__ import annotations

from typing import Any

__all__ = ["validate_action"]

# 动作参数（Python snake_case）→ Target.type 的映射。
# systemId 的 value 后端已转为 string，故比较前统一 str()。
_TARGET_TYPE_BY_ARG: dict[str, str] = {
    "card_uid": "cardUid",
    "target_system": "systemId",
    "target_player_id": "playerId",
}


def _find_action_options(affordances: dict[str, Any]) -> list[dict[str, Any]]:
    """从 get_affordances 返回中提取 legalActions 列表（容错缺失字段）。"""
    if not isinstance(affordances, dict):
        return []
    aff = affordances.get("affordance")
    if not isinstance(aff, dict):
        return []
    actions = aff.get("legalActions")
    if not isinstance(actions, list):
        return []
    return [a for a in actions if isinstance(a, dict)]


def _check_action_in_legal(
    action_name: str, affordances: dict[str, Any]
) -> tuple[bool, str]:
    """检查动作名是否在 legalActions 中。"""
    for opt in _find_action_options(affordances):
        if opt.get("action") == action_name:
            return True, ""
    return False, f"动作 {action_name} 不在 legalActions 中"


def _check_targets(
    action_name: str, action_args: dict[str, Any], option: dict[str, Any]
) -> tuple[bool, str]:
    """检查动作参数是否都在对应 legalTargets 中。

    仅校验 action_args 实际提供的键；未提供键不做约束。允许参数值用
    str/int 相等比较（systemId 后端已转字符串）。
    """
    legal_targets = option.get("legalTargets")
    if not isinstance(legal_targets, list):
        return True, ""
    targets_by_type: dict[str, set[str]] = {}
    for t in legal_targets:
        if not isinstance(t, dict):
            continue
        ttype = t.get("type")
        if isinstance(ttype, str):
            targets_by_type.setdefault(ttype, set()).add(str(t.get("value")))

    for arg_name, ttype in _TARGET_TYPE_BY_ARG.items():
        value = action_args.get(arg_name)
        if value is None:
            continue
        allowed = targets_by_type.get(ttype, set())
        # 无该类型合法目标：参数约束无效（如 strike 不指定 target_player_id 时）
        if not allowed:
            continue
        if str(value) not in allowed:
            return (
                False,
                f"动作 {action_name} 参数 {arg_name}={value} 不在合法目标 "
                f"{sorted(allowed)} 中",
            )
    return True, ""


def _check_cost(
    action_name: str, action_args: dict[str, Any], option: dict[str, Any]
) -> tuple[bool, str]:
    """检查动作成本不超当前能量。

    当前能量由调用方传入 ``action_args["current_energy"]``（get_agent_view
    的 self.energy）；未提供时跳过能量检查（校验器无 IO，不能自行查询）。
    负数 energy 表示返还，不需能量。
    """
    current = action_args.get("current_energy")
    if current is None:
        return True, ""
    cost = option.get("cost")
    if not isinstance(cost, dict):
        return True, ""
    energy = cost.get("energy", 0)
    if not isinstance(energy, int) or energy <= 0:
        return True, ""
    try:
        have = int(current)
    except (TypeError, ValueError):
        return True, ""
    if have < energy:
        return (
            False,
            f"动作 {action_name} 需要 {energy} 能量，当前仅有 {have}",
        )
    return True, ""


def validate_action(
    action_name: str,
    action_args: dict[str, Any],
    affordances: dict[str, Any],
) -> tuple[bool, str]:
    """校验动作是否合法（纯逻辑，无 IO）。

    :param action_name: 动作名（如 ``play_card`` / ``strike`` / ``end_turn``）
    :param action_args: 动作参数字典（snake_case 键；``current_energy`` 可选，
        传则校验能量上限）
    :param affordances: ``get_affordances()`` 的完整返回（``{inGame, affordance}``）
    :return: ``(是否合法, 拒绝原因)``；合法时原因为空串
    """
    if not isinstance(affordances, dict) or not affordances.get("inGame"):
        return False, "不在游戏中，无可用动作"

    # 强制挂起动作非空时，自由动作集为空，先处理挂起动作
    aff = affordances.get("affordance")
    if isinstance(aff, dict):
        pending = aff.get("pendingAction")
        if isinstance(pending, dict) and pending:
            if pending.get("type") != action_name:
                return False, (
                    f"存在强制挂起动作 {pending.get('type')}，必须先处理"
                )
            return _check_targets(action_name, action_args, pending)

    ok, reason = _check_action_in_legal(action_name, affordances)
    if not ok:
        return ok, reason

    option = next(
        (
            o
            for o in _find_action_options(affordances)
            if o.get("action") == action_name
        ),
        {},
    )

    ok, reason = _check_targets(action_name, action_args, option)
    if not ok:
        return ok, reason

    ok, reason = _check_cost(action_name, action_args, option)
    if not ok:
        return ok, reason

    return True, ""
