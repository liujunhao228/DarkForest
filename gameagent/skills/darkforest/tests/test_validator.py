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


# --- 同名多选项（关键修复：广播卡各自一个 ActionOption） ---


def _broadcast_option(card_uid: str, systems: list[str], energy: int = 1) -> dict:
    return {
        "action": "broadcast",
        "description": f"广播：{card_uid}",
        "cost": {"energy": energy},
        "legalTargets": [
            {"type": "cardUid", "value": card_uid},
            *({"type": "systemId", "value": s} for s in systems),
        ],
        "expectedEffect": "发起广播",
    }


def test_same_name_multi_option_second_card_valid() -> None:
    # 两张广播卡各一个 option：修复前只校验第一个 option，第二张卡被误判非法
    aff = _affordances(
        [
            _broadcast_option("broadcast_ultra_a", ["1", "2", "3"]),
            _broadcast_option("broadcast_star_b", ["4", "5", "6"], energy=0),
        ]
    )
    ok, reason = validate_action(
        "broadcast",
        {"card_uid": "broadcast_star_b", "target_system": 5, "current_energy": 3},
        aff,
    )
    assert ok is True, reason


def test_same_name_multi_option_first_card_still_valid() -> None:
    aff = _affordances(
        [
            _broadcast_option("broadcast_ultra_a", ["1", "2", "3"]),
            _broadcast_option("broadcast_star_b", ["4", "5", "6"]),
        ]
    )
    ok, reason = validate_action(
        "broadcast",
        {"card_uid": "broadcast_ultra_a", "target_system": 2, "current_energy": 3},
        aff,
    )
    assert ok is True, reason


def test_same_name_multi_option_card_target_mismatch() -> None:
    # 第二张卡的目标系统不合法：应匹配第二张卡的 option 并拒绝
    aff = _affordances(
        [
            _broadcast_option("broadcast_ultra_a", ["1", "2", "3"]),
            _broadcast_option("broadcast_star_b", ["4", "5", "6"]),
        ]
    )
    ok, reason = validate_action(
        "broadcast",
        {"card_uid": "broadcast_star_b", "target_system": 9, "current_energy": 3},
        aff,
    )
    assert ok is False
    assert "target_system" in reason


def test_same_name_multi_option_cost_taken_from_matched_option() -> None:
    # 第二张卡 0 费：cost 应取自匹配到的 option，而不是第一个 option 的 1 费
    aff = _affordances(
        [
            _broadcast_option("broadcast_ultra_a", ["1", "2", "3"], energy=1),
            _broadcast_option("broadcast_star_b", ["4", "5", "6"], energy=0),
        ]
    )
    ok, reason = validate_action(
        "broadcast",
        {"card_uid": "broadcast_star_b", "target_system": 5, "current_energy": 0},
        aff,
    )
    assert ok is True, reason


def test_unknown_card_rejected() -> None:
    # card_uid 不匹配任何 option（手牌中不存在该卡）→ 拒绝，避免打出不存在的卡
    aff = _affordances(
        [
            _broadcast_option("broadcast_ultra_a", ["1", "2", "3"]),
            _broadcast_option("broadcast_star_b", ["4", "5", "6"]),
        ]
    )
    ok, reason = validate_action(
        "broadcast",
        {"card_uid": "broadcast_ghost_c", "target_system": 2, "current_energy": 3},
        aff,
    )
    assert ok is False
    assert "card_uid" in reason


def test_same_name_without_card_uid_any_option_valid() -> None:
    # 未传 card_uid（如 end_turn / cancel_broadcast 类无卡动作）：
    # 任一同名 option 校验通过即合法，不因第一个 option 的 targets 过严而误判
    aff = _affordances(
        [
            _broadcast_option("broadcast_ultra_a", ["1", "2", "3"]),
            _broadcast_option("broadcast_star_b", ["4", "5", "6"]),
        ]
    )
    ok, reason = validate_action(
        "broadcast",
        {"target_system": 2, "current_energy": 3},
        aff,
    )
    assert ok is True, reason


# --- 参数键名校验（camelCase 误用） ---


def test_camelcase_args_rejected() -> None:
    # LLM 误用 MCP 工具层的 camelCase 参数名（cardUid / targetSystemId）：
    # 静默忽略会令校验形同虚设（E2E 中 validate 通过但真实调用 TypeError）。
    # 修复：显式拒绝并提示 snake_case。
    aff = _affordances([_strike_option()])
    ok, reason = validate_action(
        "strike", {"cardUid": "h1", "targetSystemId": 5, "current_energy": 10}, aff
    )
    assert ok is False
    assert "snake_case" in reason
    assert "cardUid" in reason


def test_snake_case_args_accepted() -> None:
    aff = _affordances([_strike_option()])
    ok, reason = validate_action(
        "strike", {"card_uid": "h1", "target_system": 5, "current_energy": 10}, aff
    )
    assert ok is True, reason
