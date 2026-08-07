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

from typing import Any

import pytest

from darkforest_bot.backend.game_session import (
    GameSession,
    GameSessionStore,
)
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.backend.view_state import ViewState

# ---------------------------------------------------------------------------
# Fakes (mirrors test_game_session.py)
# ---------------------------------------------------------------------------


class FakeWS:
    """Fake WSClient — records subscribe calls + send() invocations."""

    def __init__(self) -> None:
        self.connected: bool = True
        self.player_id: str | None = None
        self.send_calls: list[tuple[ClientEvent, dict[str, Any] | None, str]] = []
        self._handlers: dict[ServerEvent, list[Any]] = {}

    def subscribe(self, event: ServerEvent, handler: Any) -> Any:
        self._handlers.setdefault(event, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._handlers.get(event)
            if handlers is None:
                return
            try:
                handlers.remove(handler)
            except ValueError:
                pass
            if not handlers:
                self._handlers.pop(event, None)

        return unsubscribe

    async def send(
        self,
        event: ClientEvent,
        payload: dict[str, Any] | None = None,
        room_id: str = "",
    ) -> None:
        if not self.connected:
            raise RuntimeError("FakeWS not connected")
        self.send_calls.append((event, payload, room_id))

    def handlers_for(self, event: ServerEvent) -> list[Any]:
        return list(self._handlers.get(event, []))

    @property
    def unsub_count(self) -> int:
        return sum(len(hs) for hs in self._handlers.values())


class FakePushCallback:
    """Records (qq, view_state) invocations for assertion."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, ViewState]] = []

    async def __call__(self, qq: int, vs: ViewState) -> None:
        self.calls.append((qq, vs))


class FakeOnGameOver:
    """Records qq invocations for assertion."""

    def __init__(self) -> None:
        self.calls: list[int] = []

    async def __call__(self, qq: int) -> None:
        self.calls.append(qq)


# ---------------------------------------------------------------------------
# State-dict helpers
# ---------------------------------------------------------------------------


def _player_dict(pid: str, name: str, energy: int = 5) -> dict[str, Any]:
    return {
        "id": pid,
        "name": name,
        "color": "red",
        "position": 1,
        "energy": energy,
        "handCount": 0,
        "hand": [],
        "faceUpCards": [],
        "eliminated": False,
    }


def _make_state_dict(
    *,
    total_turn: int = 1,
    current_player_id: str = "p1",
    local_player_id: str = "p1",
    pending: dict[str, Any] | None = None,
    winner: str | None = None,
) -> dict[str, Any]:
    """Build a minimal ViewState dict for pending-push tests."""
    players = [
        _player_dict("p1", "Alice"),
        _player_dict("p2", "Bob"),
    ]
    payload: dict[str, Any] = {
        "phase": "playing",
        "totalTurn": total_turn,
        "playerCount": 2,
        "players": players,
        "currentPlayerIndex": 0,
        "currentPlayerId": current_player_id,
        "localPlayerId": local_player_id,
        "flyingStrikes": [],
        "turnPhase": "actionPhase",
        "logs": [],
        "destroyedStars": [],
        "starEffects": [],
        "winner": winner,
        "isProcessing": False,
        "_viewMeta": {"role": "PLAYER", "viewerId": local_player_id, "timestamp": 1},
    }
    if pending is not None:
        payload["pendingAction"] = pending
    return payload


def _pending_dict(
    ptype: str,
    *,
    strike_uid: str = "",
    target_system: int = 0,
) -> dict[str, Any]:
    """Build a minimal PendingAction dict."""
    payload: dict[str, Any] = {"type": ptype}
    if strike_uid:
        payload["strikeUid"] = strike_uid
    if target_system:
        payload["targetSystem"] = target_system
    return payload


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


async def _start_session(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
    qq: int = 12345,
) -> GameSession:
    await store.start(
        qq=qq,
        ws=ws,  # type: ignore[arg-type]  # FakeWS quacks like WSClient
        push_callback=push_cb,
        on_game_over=over_cb,
        font_path="/fake/font.ttf",
        canvas_size=400,
    )
    sess = store.get(qq)
    assert sess is not None
    return sess


async def _fire_full_sync(
    ws: FakeWS,
    state_dict: dict[str, Any],
    *,
    version: int = 1,
) -> None:
    handlers = ws.handlers_for(ServerEvent.GAME_FULL_SYNC)
    assert handlers, "no fullSync handler registered"
    payload = {"state": state_dict, "version": version}
    for h in handlers:
        await h(payload)


async def _fire_delta_sync(
    ws: FakeWS,
    changes: list[dict[str, Any]],
    *,
    version: int = 2,
) -> None:
    handlers = ws.handlers_for(ServerEvent.GAME_DELTA_SYNC)
    assert handlers, "no deltaSync handler registered"
    payload = {"changes": changes, "version": version}
    for h in handlers:
        await h(payload)


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
        assert sess.last_push_key == ""
        assert sess.last_turn_key == "1:p1"

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
        assert sess.last_push_key == ""

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
        assert sess.last_push_key == "pending:strikeMove:s1::0"

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
        assert sess.last_push_key == "pending:strikeMove:s1::0"

        # Change energy (does not change turn_key or push_key).
        await _fire_delta_sync(
            ws,
            [{"path": "players[0].energy", "value": 99, "type": "set"}],
        )

        assert push_cb.calls == []
        assert sess.last_push_key == "pending:strikeMove:s1::0"

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
        assert sess.last_push_key == "pending:strikeMove:s1::0"

        # Clear pending via delta (value=None pops the key).
        await _fire_delta_sync(
            ws,
            [{"path": "pendingAction", "value": None, "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_push_key == ""

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
        # push_key is "" because current != local.
        assert sess.last_push_key == ""
        push_cb.calls.clear()

        # Change p2's pending via delta — still current=p2, so push_key="".
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

        # No push: turn_key unchanged, push_key unchanged ("").
        assert push_cb.calls == []
        assert sess.last_push_key == ""

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
