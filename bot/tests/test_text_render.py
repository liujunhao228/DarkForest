"""Tests for render/text.py — text summary and log formatters."""

from __future__ import annotations

from darkforest_bot.backend.view_state import (
    Card,
    FlyingStrikeView,
    LogEntry,
    PlayerView,
    ViewMeta,
    ViewState,
)
from darkforest_bot.render.text import (
    render_flying_strikes,
    render_logs,
    render_opponents_face_up,
    render_text_summary,
)


def _make_card(
    uid: str,
    name: str,
    card_type: str,
    energy: int,
    def_id: str | None = None,
    subtype: str | None = None,
) -> Card:
    return Card(
        uid=uid,
        defId=def_id or f"def:{uid}",
        name=name,
        type=card_type,
        energy=energy,
        description="",
        image="",
        subtype=subtype,
    )


def _make_log(log_id: str, turn: int, msg: str, log_type: str) -> LogEntry:
    return LogEntry(
        id=log_id,
        turn=turn,
        phase="actionPhase",
        message=msg,
        type=log_type,
    )


def _make_strike(
    uid: str,
    name: str,
    level: int,
    owner_id: str,
    position: int,
    target: int,
    *,
    arrived: bool = False,
) -> FlyingStrikeView:
    return FlyingStrikeView(
        uid=uid,
        defId=f"def:{uid}",
        ownerId=owner_id,
        position=position,
        targetSystem=target,
        level=level,
        speed=1,
        remainingMoves=0,
        strikeName=name,
        arrived=arrived,
        delayed=False,
    )


def _make_state(
    *,
    p1_hand: list[Card],
    p1_energy: int,
    total_turn: int,
    logs: list[LogEntry],
    current_player_id: str = "p1",
    p2_hand: list[Card] | None = None,
    p2_face_up: list[Card] | None = None,
    p1_face_up: list[Card] | None = None,
    p2_eliminated: bool = False,
    p2_position: int = -1,
    flying_strikes: list[FlyingStrikeView] | None = None,
    local_player_id: str = "p1",
) -> ViewState:
    p1 = PlayerView(
        id="p1",
        name="Alice",
        color="red",
        position=1,
        energy=p1_energy,
        handCount=len(p1_hand),
        hand=p1_hand,
        faceUpCards=p1_face_up or [],
        eliminated=False,
    )
    p2 = PlayerView(
        id="p2",
        name="Bob",
        color="blue",
        position=p2_position,  # hidden
        energy=2,
        handCount=len(p2_hand or []),
        hand=p2_hand or [],
        faceUpCards=p2_face_up or [],
        eliminated=p2_eliminated,
    )
    return ViewState(
        phase="playing",
        totalTurn=total_turn,
        playerCount=2,
        players=[p1, p2],
        currentPlayerIndex=0,
        currentPlayerId=current_player_id,
        localPlayerId=local_player_id,
        turnPhase="actionPhase",
        logs=logs,
        flyingStrikes=flying_strikes or [],
        view_meta=ViewMeta(role="PLAYER", viewer_id=local_player_id, timestamp=1),
    )


class TestRenderTextSummary:
    def test_summary_contains_expected_lines(self) -> None:
        state = _make_state(
            p1_hand=[
                _make_card("c1", "广播卡A", "broadcast", 3, subtype="cooperation"),
                _make_card("c2", "打击卡B", "strike", 2),
                _make_card("c3", "防御卡C", "defense", 1),
                _make_card("c4", "广播卡D", "broadcast", 1, subtype="disguise"),
            ],
            p1_energy=3,
            total_turn=5,
            logs=[],
        )
        text = render_text_summary(state, "p1")

        # Line-by-line assertions
        assert "回合 5" in text
        assert "阶段: actionPhase" in text
        assert "你的能量: 3" in text
        assert "当前轮到: Alice" in text
        assert "你的手牌:" in text
        assert "1. [广播·合作] 广播卡A (费用 3)" in text
        assert "2. [打击] 打击卡B (费用 2)" in text
        assert "3. [防御] 防御卡C (费用 1)" in text
        assert "4. [广播·伪装] 广播卡D (费用 1)" in text

    def test_summary_local_player_not_in_players_shows_unknown_energy(self) -> None:
        state = _make_state(
            p1_hand=[_make_card("c1", "X", "strike", 1)],
            p1_energy=3,
            total_turn=1,
            logs=[],
        )
        text = render_text_summary(state, "nonexistent_player")
        assert "你的能量: 未知" in text
        # When local player is not found, hand section shows "（空）"
        assert "（空）" in text

    def test_summary_empty_hand_shows_empty_placeholder(self) -> None:
        # p2's hand is empty in the fixture; render from p2's perspective.
        state = _make_state(
            p1_hand=[_make_card("c1", "X", "strike", 1)],
            p1_energy=3,
            total_turn=1,
            logs=[],
        )
        # Render from p2's perspective — p2 has empty hand in the fixture.
        text = render_text_summary(state, "p2")
        assert "你的手牌:" in text
        assert "（空）" in text

    def test_summary_current_player_unknown_shows_unknown(self) -> None:
        state = _make_state(
            p1_hand=[],
            p1_energy=0,
            total_turn=1,
            logs=[],
            current_player_id="ghost",
        )
        text = render_text_summary(state, "p1")
        assert "当前轮到: 未知" in text

    def test_summary_unknown_card_type_passes_through(self) -> None:
        state = _make_state(
            p1_hand=[_make_card("c1", "新卡", "futuretype", 5)],
            p1_energy=1,
            total_turn=1,
            logs=[],
        )
        text = render_text_summary(state, "p1")
        assert "[futuretype] 新卡" in text


class TestRenderLogs:
    def test_render_last_n_logs(self) -> None:
        logs = [
            _make_log("l1", 1, "第一条", "info"),
            _make_log("l2", 2, "第二条", "action"),
            _make_log("l3", 3, "第三条", "combat"),
        ]
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=3, logs=logs,
        )
        text = render_logs(state, limit=2)
        # Should only contain last 2 entries
        assert "第一条" not in text
        assert "第二条" in text
        assert "第三条" in text
        # Each line should contain "[回合"
        assert text.count("[回合") == 2

    def test_render_more_than_available_returns_all(self) -> None:
        logs = [
            _make_log("l1", 1, "A", "info"),
            _make_log("l2", 2, "B", "action"),
            _make_log("l3", 3, "C", "combat"),
        ]
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=3, logs=logs,
        )
        text = render_logs(state, limit=10)
        # Only 3 logs exist; should return 3 lines
        assert text.count("\n") == 2  # 3 lines → 2 newlines
        assert "A" in text
        assert "B" in text
        assert "C" in text

    def test_render_empty_logs_returns_placeholder(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
        )
        text = render_logs(state, limit=10)
        assert text == "（暂无日志）"

    def test_render_log_type_labels_translated(self) -> None:
        logs = [
            _make_log("l1", 1, "msg1", "info"),
            _make_log("l2", 2, "msg2", "action"),
            _make_log("l3", 3, "msg3", "combat"),
            _make_log("l4", 4, "msg4", "system"),
            _make_log("l5", 5, "msg5", "broadcast"),
        ]
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=5, logs=logs,
        )
        text = render_logs(state, limit=10)
        assert "[信息]" in text
        assert "[行动]" in text
        assert "[战斗]" in text
        assert "[系统]" in text
        assert "[广播]" in text

    def test_render_unknown_log_type_passes_through(self) -> None:
        logs = [_make_log("l1", 1, "weird", "futuretype")]
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=logs,
        )
        text = render_logs(state, limit=10)
        assert "[futuretype]" in text


class TestRenderOpponentsFaceUp:
    def test_renders_grouped_face_up_cards_with_type_label(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
            p2_face_up=[
                _make_card("a", "离子炮", "strike", 2, def_id="strike1"),
                _make_card("b", "光盾", "defense", 1, def_id="def1"),
                _make_card("c", "离子炮", "strike", 2, def_id="strike1"),
            ],
        )
        text = render_opponents_face_up(state, "p1")
        assert "Bob 的门牌：" in text
        assert "[打击] 离子炮 ×2" in text
        assert "[防御] 光盾 ×1" in text

    def test_hidden_position_opponent_still_shown(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
            p2_face_up=[_make_card("a", "侦察", "broadcast", 1)],
            p2_position=-1,
        )
        text = render_opponents_face_up(state, "p1")
        assert "Bob 的门牌：" in text
        assert "[广播] 侦察 ×1" in text

    def test_eliminated_opponent_excluded(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
            p2_face_up=[_make_card("c", "侦察", "broadcast", 1)],
            p2_eliminated=True,
        )
        text = render_opponents_face_up(state, "p1")
        assert "Bob 的门牌：" not in text

    def test_opponent_with_no_face_up_excluded(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[], p2_face_up=[],
        )
        text = render_opponents_face_up(state, "p1")
        assert text == ""

    def test_perspective_swaps_opponent(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
            p2_face_up=[_make_card("c", "侦察", "broadcast", 1)],
            p1_face_up=[_make_card("d", "质子盾", "defense", 1)],
        )
        text = render_opponents_face_up(state, "p2")
        assert "Alice 的门牌：" in text
        assert "[防御] 质子盾 ×1" in text


class TestRenderFlyingStrikes:
    def test_renders_strike_text_format(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
            flying_strikes=[
                _make_strike("s1", "聚变炮", 3, "p2", 2, 5),
            ],
        )
        text = render_flying_strikes(state)
        assert "飞行中的打击：" in text
        assert "聚变炮 (Lv.3)" in text
        assert "发射者: Bob" in text
        assert "位置: 2 → 目标: 5" in text

    def test_own_strike_marks_you(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
            flying_strikes=[
                _make_strike("s1", "聚变炮", 1, "p1", 1, 8),
            ],
        )
        text = render_flying_strikes(state)
        assert "发射者: Alice (你)" in text

    def test_arrived_strike_shows_standby(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
            flying_strikes=[
                _make_strike("s1", "聚变炮", 2, "p2", 7, 7, arrived=True),
            ],
        )
        text = render_flying_strikes(state)
        assert "聚变炮 (Lv.2) · 待生效" in text

    def test_empty_strikes_returns_empty(self) -> None:
        state = _make_state(p1_hand=[], p1_energy=0, total_turn=1, logs=[])
        assert render_flying_strikes(state) == ""

    def test_multiple_strikes_separated_by_blank_line(self) -> None:
        state = _make_state(
            p1_hand=[], p1_energy=0, total_turn=1, logs=[],
            flying_strikes=[
                _make_strike("s1", "聚变炮", 1, "p1", 1, 8),
                _make_strike("s2", "曲率弹", 2, "p2", 3, 4),
            ],
        )
        text = render_flying_strikes(state)
        assert "聚变炮 (Lv.1)" in text
        assert "曲率弹 (Lv.2)" in text
        assert "发射者: Alice (你)" in text
        # Strikes separated by a blank line → "待生效"-absent header immediately
        # followed by the second strike name across a blank line.
        assert "\n\n曲率弹" in text


class TestRenderSummaryWithOpponentsAndStrikes:
    def test_summary_appends_opponent_and_strike_sections(self) -> None:
        state = _make_state(
            p1_hand=[_make_card("c1", "侦察", "broadcast", 1)],
            p1_energy=3,
            total_turn=5,
            logs=[],
            p2_face_up=[_make_card("a", "离子炮", "strike", 2)],
            flying_strikes=[_make_strike("s1", "聚变炮", 2, "p2", 2, 7)],
        )
        text = render_text_summary(state, "p1")
        assert "你的手牌:" in text
        assert "Bob 的门牌：" in text
        assert "[打击] 离子炮 ×1" in text
        assert "飞行中的打击：" in text
        assert "聚变炮 (Lv.2)" in text

    def test_summary_without_opponents_strikes_stays_as_before(self) -> None:
        state = _make_state(
            p1_hand=[_make_card("c1", "鼠标", "broadcast", 1)],
            p1_energy=3,
            total_turn=5,
            logs=[],
        )
        text = render_text_summary(state, "p1")
        assert "你的手牌:" in text
        assert "Bob 的门牌：" not in text
        assert "飞行中的打击：" not in text
        assert text.endswith("费用 1)")
