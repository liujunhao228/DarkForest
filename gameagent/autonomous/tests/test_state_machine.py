"""状态机单测：事件批驱动的迁移表 + PLAYING 快照检查。"""

from __future__ import annotations

from autonomous_driver.mcp_client import GameEvent
from autonomous_driver.state_machine import (
    EVENT_MATCH_FOUND,
    EVENT_ROOM_ACTIVE_ROOM_FOUND,
    EVENT_ROOM_GAME_STARTED,
    GamePhase,
    check_playing,
    initial,
    transition,
)


def _evt(t: str) -> GameEvent:
    return GameEvent(type=t, timestamp=0)


def test_initial_is_idle() -> None:
    assert initial() == GamePhase.IDLE


def test_match_found_moves_to_room() -> None:
    result = transition(GamePhase.MATCHMAKING, [_evt(EVENT_MATCH_FOUND)])
    assert result.state == GamePhase.IN_ROOM
    assert result.actions == []


def test_game_started_moves_to_playing() -> None:
    result = transition(GamePhase.IN_ROOM, [_evt(EVENT_ROOM_GAME_STARTED)])
    assert result.state == GamePhase.PLAYING


def test_match_error_moves_to_error_with_log() -> None:
    result = transition(GamePhase.MATCHMAKING, [_evt("match:error")])
    assert result.state == GamePhase.ERROR
    assert len(result.actions) == 1
    assert result.actions[0].name == "log"


def test_queue_cancelled_moves_to_error() -> None:
    result = transition(GamePhase.MATCHMAKING, [_evt("match:queueCancelled")])
    assert result.state == GamePhase.ERROR


def test_active_room_found_any_state_to_room() -> None:
    # 重连后发现有进行中对局：无论当前状态（含 ERROR）都回 IN_ROOM
    for state in (
        GamePhase.ERROR,
        GamePhase.MATCHMAKING,
        GamePhase.PLAYING,
        GamePhase.IDLE,
    ):
        result = transition(state, [_evt(EVENT_ROOM_ACTIVE_ROOM_FOUND)])
        assert result.state == GamePhase.IN_ROOM, f"state={state}"


def test_unrelated_events_keep_state() -> None:
    result = transition(
        GamePhase.PLAYING,
        [_evt("game:fullSync"), _evt("room:playerJoined"), _evt("reconnect")],
    )
    assert result.state == GamePhase.PLAYING
    assert result.actions == []


def test_match_found_in_wrong_state_keeps_state() -> None:
    # 非 MATCHMAKING 状态收到 match:found 不迁移（防误迁）
    result = transition(GamePhase.PLAYING, [_evt(EVENT_MATCH_FOUND)])
    assert result.state == GamePhase.PLAYING


def test_event_order_first_match_wins() -> None:
    # 事件批含多个触发事件，取第一个触发迁移的（match:found 在 gameStarted 前）
    result = transition(
        GamePhase.MATCHMAKING,
        [_evt(EVENT_MATCH_FOUND), _evt(EVENT_ROOM_GAME_STARTED)],
    )
    assert result.state == GamePhase.IN_ROOM


def test_check_playing_game_over_fetches_replay() -> None:
    result = check_playing(phase="gameOver")
    assert result.state == GamePhase.GAME_OVER
    assert [a.name for a in result.actions] == ["fetch_replay"]


def test_check_playing_game_over_view_fetches_replay() -> None:
    """Task 3 终局权威化：gameOver 权威视图（GameOverView）优先于 phase 信号。"""
    result = check_playing(game_over={"result": "win", "replayId": "r-1", "totalTurn": 12})
    assert result.state == GamePhase.GAME_OVER
    assert [a.name for a in result.actions] == ["fetch_replay"]


def test_check_playing_game_over_view_wins_over_phase() -> None:
    """权威视图与 phase 并存时以 gameOver 为准（迁移结果一致，验证不冲突）。"""
    result = check_playing(phase="playing", game_over={"result": "draw"})
    assert result.state == GamePhase.GAME_OVER
    assert [a.name for a in result.actions] == ["fetch_replay"]


def test_check_playing_my_turn_decides() -> None:
    result = check_playing(phase="playing", is_my_turn=True)
    assert result.state == GamePhase.PLAYING
    assert [a.name for a in result.actions] == ["decide"]


def test_check_playing_pending_decides() -> None:
    result = check_playing(phase="playing", has_pending=True)
    assert result.state == GamePhase.PLAYING
    assert [a.name for a in result.actions] == ["decide"]


def test_check_playing_waiting_no_action() -> None:
    result = check_playing(phase="playing")
    assert result.state == GamePhase.PLAYING
    assert result.actions == []
