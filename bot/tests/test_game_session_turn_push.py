"""Tests for backend/game_session.py — 新推送策略（事件类别 + 分类开关）。

覆盖 turn_change / game_over 硬推类别，以及 NotifyConfig 开关对可关闭类别的
影响。RED 阶段：引用尚不存在的 ``GameSession.last_event_keys`` /
``EventCategory`` / ``notify_config_provider``。
"""

from __future__ import annotations

import pytest

from darkforest_bot.backend.event_classifier import EventCategory
from darkforest_bot.backend.game_session import (
    GameSessionStore,
)
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.notifications.notify_config import NotifyConfig

from ._state_helpers import (
    FakeOnGameOver,
    FakePushCallback,
    FakeWS,
    _fire_delta_sync,
    _fire_full_sync,
    _start_session,
    make_state_dict,
)

ALL_OFF = lambda qq: NotifyConfig(broadcast=False, strike=False, other=False)  # noqa: E731


@pytest.fixture
def store() -> GameSessionStore:
    return GameSessionStore()


@pytest.fixture
def ws() -> FakeWS:
    return FakeWS()


@pytest.fixture
def push_cb() -> FakePushCallback:
    return FakePushCallback()


@pytest.fixture
def over_cb() -> FakeOnGameOver:
    return FakeOnGameOver()


async def test_first_fullsync_pushes_and_records_turn_change_key(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    sess = await _start_session(store, ws, push_cb, over_cb)
    await _fire_full_sync(ws, make_state_dict(total_turn=1, current_player_id="p1"))

    assert len(push_cb.calls) == 1
    assert sess.last_event_keys[EventCategory.TURN_CHANGE] == "1:p1"


async def test_delta_turn_change_pushes_and_updates_key(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    sess = await _start_session(store, ws, push_cb, over_cb)
    await _fire_full_sync(ws, make_state_dict(total_turn=1, current_player_id="p1"))
    push_cb.calls.clear()

    await _fire_delta_sync(
        ws,
        [{"path": "totalTurn", "value": 2, "type": "set"}],
    )

    assert len(push_cb.calls) == 1
    assert sess.last_event_keys[EventCategory.TURN_CHANGE] == "2:p1"


async def test_delta_same_turn_no_push(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    await _start_session(store, ws, push_cb, over_cb)
    await _fire_full_sync(ws, make_state_dict(total_turn=1, current_player_id="p1"))
    push_cb.calls.clear()

    await _fire_delta_sync(
        ws,
        [{"path": "players[0].energy", "value": 99, "type": "set"}],
    )

    assert push_cb.calls == []


async def test_winner_pushes_and_cleans_session(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    sess = await _start_session(store, ws, push_cb, over_cb)
    await _fire_full_sync(ws, make_state_dict(total_turn=1, current_player_id="p1"))
    push_cb.calls.clear()

    await _fire_delta_sync(
        ws,
        [{"path": "winner", "value": "p1", "type": "set"}],
    )

    assert len(push_cb.calls) == 1
    assert over_cb.calls == [12345]
    assert store.get(12345) is None
    assert sess.last_event_keys == {}


async def test_turn_change_pushes_even_when_all_switches_off(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    await _start_session(
        store, ws, push_cb, over_cb, notify_config_provider=ALL_OFF
    )
    await _fire_full_sync(ws, make_state_dict(total_turn=1, current_player_id="p1"))
    push_cb.calls.clear()

    await _fire_delta_sync(
        ws,
        [{"path": "totalTurn", "value": 2, "type": "set"}],
    )

    assert len(push_cb.calls) == 1


async def test_other_category_not_pushed_when_other_off(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    await _start_session(
        store, ws, push_cb, over_cb, notify_config_provider=ALL_OFF
    )
    await _fire_full_sync(ws, make_state_dict(total_turn=1, current_player_id="p1"))
    push_cb.calls.clear()

    # 仅 OTHER 类别变化（能量变化），cfg.other=False → 不推送。
    await _fire_delta_sync(
        ws,
        [{"path": "players[0].energy", "value": 99, "type": "set"}],
    )

    assert push_cb.calls == []


async def test_full_sync_with_missing_state_key_is_ignored(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    sess = await _start_session(store, ws, push_cb, over_cb)
    handlers = ws.handlers_for(ServerEvent.GAME_FULL_SYNC)
    await handlers[0]({"version": 1})

    assert sess.view_state is None
    assert push_cb.calls == []


async def test_delta_sync_without_full_sync_requests_full_sync(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    sess = await _start_session(store, ws, push_cb, over_cb)
    await _fire_delta_sync(
        ws,
        [{"path": "totalTurn", "value": 5, "type": "set"}],
    )

    assert any(
        c[0] == ClientEvent.GAME_REQUEST_SYNC for c in ws.send_calls
    )
    assert sess.view_state is None
    assert push_cb.calls == []


async def test_delta_sync_invalid_path_requests_full_sync(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
) -> None:
    sess = await _start_session(store, ws, push_cb, over_cb)
    await _fire_full_sync(ws, make_state_dict(total_turn=1, current_player_id="p1"))
    push_cb.calls.clear()
    ws.send_calls.clear()
    original_total_turn = sess.view_state.total_turn if sess.view_state else None

    await _fire_delta_sync(
        ws,
        [{"path": "nonexistent.path", "value": 1, "type": "set"}],
    )

    assert any(
        c[0] == ClientEvent.GAME_REQUEST_SYNC for c in ws.send_calls
    )
    assert sess.view_state is not None
    assert sess.view_state.total_turn == original_total_turn
    assert push_cb.calls == []
