"""validate_action 单测：纯逻辑校验，覆盖合法/非法动作路径。

Affordance 结构对齐 mcpserver 的 legalActions / legalTargets / cost 语义。
"""

from __future__ import annotations

from darkforest.validator import validate_action


def _affordances(legal_actions: list[dict], pending: dict | None = None) -> dict:
    return {"inGame": True, "affordance": {"legalActions": legal_actions, "pendingAction": pending}}


def _strike_option() -> dict:
    return {
        "action": "strike",
        "description": "发射打击卡牌",
        "cost": {"energy": 2, "cardsDiscarded": 0},
        "legalTargets": [
            {"type": "cardUid", "value": "h1"},
            {"type": "systemId", "value": "5"},
        ],
        "precondition": "手牌中有打击卡",
        "expectedEffect": "对目标星系生成飞行打击",
    }


# --- 合法路径 ---


def test_valid_action_in_legal_actions() -> None:
    aff = _affordances([_strike_option()])
    ok, reason = validate_action(
        "strike", {"card_uid": "h1", "target_system": 5, "current_energy": 10}, aff
    )
    assert ok is True
    assert reason == ""


def test_valid_action_without_energy_check() -> None:
    # 未传 current_energy 时跳过能量检查
    aff = _affordances([_strike_option()])
    ok, _ = validate_action("strike", {"card_uid": "h1", "target_system": 5}, aff)
    assert ok is True


# --- 非法路径 ---


def test_action_not_in_legal_actions() -> None:
    aff = _affordances([_strike_option()])
    ok, reason = validate_action("play_card", {}, aff)
    assert ok is False
    assert "不在 legalActions" in reason


def test_target_not_in_legal_targets() -> None:
    aff = _affordances([_strike_option()])
    ok, reason = validate_action(
        "strike", {"card_uid": "h999", "target_system": 5, "current_energy": 10}, aff
    )
    assert ok is False
    assert "card_uid" in reason


def test_system_not_in_legal_targets() -> None:
    aff = _affordances([_strike_option()])
    ok, reason = validate_action(
        "strike", {"card_uid": "h1", "target_system": 99, "current_energy": 10}, aff
    )
    assert ok is False
    assert "target_system" in reason


def test_not_enough_energy() -> None:
    aff = _affordances([_strike_option()])
    # strike 成本 2，当前能量 1 不够
    ok, reason = validate_action(
        "strike", {"card_uid": "h1", "target_system": 5, "current_energy": 1}, aff
    )
    assert ok is False
    assert "能量" in reason


def test_exactly_enough_energy() -> None:
    aff = _affordances([_strike_option()])
    ok, _ = validate_action(
        "strike", {"card_uid": "h1", "target_system": 5, "current_energy": 2}, aff
    )
    assert ok is True


# --- 挂起动作 ---


def test_pending_action_blocks_other_actions() -> None:
    pending = {
        "type": "strike:retarget",
        "description": "选择打击重定向目标",
        "legalTargets": [{"type": "systemId", "value": "7"}],
    }
    aff = _affordances([_strike_option()], pending=pending)
    ok, reason = validate_action("strike", {"card_uid": "h1", "target_system": 5}, aff)
    assert ok is False
    assert "挂起动作" in reason


# --- 边界容错 ---


def test_not_in_game() -> None:
    ok, reason = validate_action("strike", {}, {"inGame": False})
    assert ok is False
    assert "不在游戏中" in reason


def test_empty_affordances() -> None:
    ok, reason = validate_action("strike", {}, {})
    assert ok is False
    assert "不在游戏中" in reason
