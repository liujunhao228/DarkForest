"""Tests for backend/game_session.py — PendingAction push policy (P4).

Covers:
- First fullSync with no pending → push fires once (turn_key change).
- deltaSync adding pending_action → push fires (push_key change "" → "pending:...").
- Same-pending deltaSync → no push (push_key unchanged).
- deltaSync clearing pending_action → push fires (push_key change "pending:..." → "").
- Other player's turn (current != local): pending changes do NOT push.
- winner triggers push + on_game_over + session cleanup.
"""

from __future__ import annotations

import pytest

from darkforest_bot.backend.event_classifier import EventCategory
from darkforest_bot.backend.game_session import (
    GameSessionStore,
)
from darkforest_bot.notifications.notify_config import NotifyConfig

from ._state_helpers import (
    FakeOnGameOver,
    FakePushCallback,
    FakeWS,
    _fire_delta_sync,
    _fire_full_sync,
    _pending_dict,
    _start_session,
)
from ._state_helpers import (
    make_state_dict as _make_state_dict,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPendingPushPolicy:
    async def test_first_fullsync_no_pending_pushes_once(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """First fullSync with no pending → push fires once (turn_key change)."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws, _make_state_dict(total_turn=1, current_player_id="p1")
        )

        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.PENDING_ACTION] == "none"
        assert sess.last_event_keys[EventCategory.TURN_CHANGE] == "1:p1"

    async def test_delta_adding_pending_triggers_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync setting pending_action → push fires (push_key change)."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws, _make_state_dict(total_turn=1, current_player_id="p1")
        )
        push_cb.calls.clear()
        assert sess.last_event_keys[EventCategory.PENDING_ACTION] == "none"

        # Set pending_action via delta (current=p1, local=p1 → own turn).
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "pendingAction",
                    "value": _pending_dict("strikeMove", strike_uid="s1"),
                    "type": "set",
                }
            ],
        )

        assert len(push_cb.calls) == 1
        assert (
            sess.last_event_keys[EventCategory.PENDING_ACTION]
            == "pending:strikeMove:s1::0"
        )

    async def test_same_pending_delta_does_not_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync that doesn't change pending → no push (push_key unchanged)."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws, _make_state_dict(total_turn=1, current_player_id="p1")
        )
        # Set pending via delta to populate push_key.
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "pendingAction",
                    "value": _pending_dict("strikeMove", strike_uid="s1"),
                    "type": "set",
                }
            ],
        )
        push_cb.calls.clear()
        assert (
            sess.last_event_keys[EventCategory.PENDING_ACTION]
            == "pending:strikeMove:s1::0"
        )

        # Change energy (does not change turn_key or push_key).
        await _fire_delta_sync(
            ws,
            [{"path": "players[0].energy", "value": 99, "type": "set"}],
        )

        assert push_cb.calls == []
        assert (
            sess.last_event_keys[EventCategory.PENDING_ACTION]
            == "pending:strikeMove:s1::0"
        )

    async def test_delta_clearing_pending_triggers_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync clearing pending_action → push fires (push_key → "")."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws, _make_state_dict(total_turn=1, current_player_id="p1")
        )
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "pendingAction",
                    "value": _pending_dict("strikeMove", strike_uid="s1"),
                    "type": "set",
                }
            ],
        )
        push_cb.calls.clear()
        assert (
            sess.last_event_keys[EventCategory.PENDING_ACTION]
            == "pending:strikeMove:s1::0"
        )

        # Clear pending via delta (value=None pops the key).
        await _fire_delta_sync(
            ws,
            [{"path": "pendingAction", "value": None, "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.PENDING_ACTION] == "none"

    async def test_other_player_pending_does_not_push_to_local(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """Pending on another player's turn does not push to local player."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        # current=p2, local=p1 — pending belongs to p2's turn.
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p2",
                local_player_id="p1",
                pending=_pending_dict("strikeMove", strike_uid="s1"),
            ),
        )
        # First push fires (turn_key change "" → "1:p2").
        assert len(push_cb.calls) == 1
        # Full sync forces all categories; pending belongs to p2 so it records "none"-ish real key.
        assert (
            sess.last_event_keys[EventCategory.PENDING_ACTION]
            == "pending:strikeMove:s1::0"
        )
        push_cb.calls.clear()

        # Change p2's pending via delta — still current=p2, so PENDING_ACTION not triggered locally.
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "pendingAction",
                    "value": _pending_dict("strikeMove", strike_uid="s2"),
                    "type": "set",
                }
            ],
        )

        # No push: turn_key unchanged, push_key unchanged.
        assert push_cb.calls == []
        assert (
            sess.last_event_keys[EventCategory.PENDING_ACTION]
            == "pending:strikeMove:s1::0"
        )

    async def test_pending_not_closeable(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """所有开关关闭时，pending_action 仍必推（硬推类别不可关闭）。"""
        await _start_session(
            store,
            ws,
            push_cb,
            over_cb,
            notify_config_provider=lambda qq_arg: NotifyConfig(
                broadcast=False, strike=False, other=False
            ),
        )
        await _fire_full_sync(
            ws, _make_state_dict(total_turn=1, current_player_id="p1")
        )
        push_cb.calls.clear()

        # 轮到自己，pending_action 变化 → 必推。
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "pendingAction",
                    "value": _pending_dict("strikeMove", strike_uid="s1"),
                    "type": "set",
                }
            ],
        )

        assert len(push_cb.calls) == 1

    async def test_winner_triggers_push_and_game_over(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """winner set → push fires + on_game_over fires + session cleaned."""
        await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws, _make_state_dict(total_turn=1, current_player_id="p1")
        )
        push_cb.calls.clear()

        # Set winner via delta.
        await _fire_delta_sync(
            ws,
            [{"path": "winner", "value": "p1", "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert over_cb.calls == [12345]
        assert store.get(12345) is None
        assert ws.unsub_count == 0
