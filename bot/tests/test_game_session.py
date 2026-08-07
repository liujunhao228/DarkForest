"""Tests for backend/game_session.py — per-QQ game session cache + subscriptions."""

from __future__ import annotations

from typing import Any

import pytest

from darkforest_bot.backend.game_session import (
    GameSession,
    GameSessionStore,
)
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.backend.view_state import (
    PlayerView,
    ViewState,
)

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeWS:
    """Fake WSClient — records subscribe calls + send() invocations.

    Stores handlers per event so tests can manually invoke them with a
    payload dict (simulating an inbound message).
    """

    def __init__(self) -> None:
        self.connected: bool = True
        self.player_id: str | None = None
        self.send_calls: list[tuple[ClientEvent, dict[str, Any] | None, str]] = []
        self._handlers: dict[ServerEvent, list[Any]] = {}

    def subscribe(
        self, event: ServerEvent, handler: Any
    ) -> Any:
        """Record the handler. Returns an unsubscribe callable."""
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
        """Return registered handlers for an event (for manual invocation)."""
        return list(self._handlers.get(event, []))

    @property
    def unsub_count(self) -> int:
        """Total handlers still registered across all events."""
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
# Fixtures
# ---------------------------------------------------------------------------


def _make_player(pid: str, *, energy: int = 5, position: int = 1) -> PlayerView:
    return PlayerView(
        id=pid,
        name=f"Player{pid}",
        color="red",
        position=position,
        energy=energy,
        handCount=0,
        hand=[],
        faceUpCards=[],
        eliminated=False,
    )


def _make_state_dict(
    *,
    total_turn: int = 1,
    current_player_id: str = "p1",
    players: list[dict[str, Any]] | None = None,
    winner: str | None = None,
    destroyed_stars: list[int] | None = None,
) -> dict[str, Any]:
    if players is None:
        players = [
            {"id": "p1", "name": "Playerp1", "color": "red", "position": 1,
             "energy": 5, "handCount": 0, "hand": [], "faceUpCards": [],
             "eliminated": False},
            {"id": "p2", "name": "Playerp2", "color": "blue", "position": -1,
             "energy": 4, "handCount": 0, "hand": [], "faceUpCards": [],
             "eliminated": False},
        ]
    return {
        "phase": "playing",
        "totalTurn": total_turn,
        "playerCount": len(players),
        "players": players,
        "currentPlayerIndex": 0,
        "currentPlayerId": current_player_id,
        "localPlayerId": "p1",
        "turnPhase": "actionPhase",
        "flyingStrikes": [],
        "logs": [],
        "destroyedStars": destroyed_stars or [],
        "starEffects": [],
        "winner": winner,
        "isProcessing": False,
        "_viewMeta": {"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
    }


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


async def _start_session(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
    qq: int = 12345,
) -> GameSession:
    """Helper: start a session and return the GameSession object."""
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
    """Helper: invoke the registered fullSync handler with a payload."""
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
    """Helper: invoke the registered deltaSync handler with a payload."""
    handlers = ws.handlers_for(ServerEvent.GAME_DELTA_SYNC)
    assert handlers, "no deltaSync handler registered"
    payload = {"changes": changes, "version": version}
    for h in handlers:
        await h(payload)


async def _fire_game_error(ws: FakeWS, payload: dict[str, Any]) -> None:
    """Helper: invoke the registered game:error handler with a payload."""
    handlers = ws.handlers_for(ServerEvent.GAME_ERROR)
    assert handlers, "no game:error handler registered"
    for h in handlers:
        await h(payload)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStartAndStop:
    async def test_start_creates_session_with_three_subscriptions(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        assert isinstance(sess, GameSession)
        assert sess.view_state is None
        assert sess.last_turn_key == ""
        assert len(sess.unsubs) == 3  # fullSync + deltaSync + game:error
        assert ws.unsub_count == 3

    async def test_stop_clears_subscriptions_and_cache(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        # Prime the cache with a fullSync so we can verify stop() clears it.
        await _fire_full_sync(ws, _make_state_dict())
        assert sess.view_state is not None

        await store.stop(12345)

        assert store.get(12345) is None
        assert ws.unsub_count == 0
        assert sess.unsubs == []
        assert sess.view_state is None
        assert sess.last_turn_key == ""

    async def test_stop_on_nonexistent_session_is_noop(
        self, store: GameSessionStore,
    ) -> None:
        # Should not raise.
        await store.stop(99999)


class TestFullSyncHandling:
    async def test_full_sync_replaces_cache_and_pushes(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        state = _make_state_dict(total_turn=3, current_player_id="p1")
        await _fire_full_sync(ws, state)

        # Cache should be populated with the parsed ViewState.
        assert sess.view_state is not None
        assert sess.view_state.total_turn == 3
        assert sess.view_state.current_player_id == "p1"

        # First fullSync: turn_key goes from "" to "3:p1" → should push.
        assert len(push_cb.calls) == 1
        pushed_qq, pushed_vs = push_cb.calls[0]
        assert pushed_qq == 12345
        assert pushed_vs.total_turn == 3

        # on_game_over should NOT fire (winner is None).
        assert over_cb.calls == []

    async def test_full_sync_with_missing_state_key_is_ignored(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        handlers = ws.handlers_for(ServerEvent.GAME_FULL_SYNC)
        # Payload without 'state' key — should be logged and ignored.
        await handlers[0]({"version": 1})

        assert sess.view_state is None
        assert push_cb.calls == []


class TestDeltaSyncHandling:
    async def test_delta_sync_applies_changes_and_pushes_on_turn_change(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        # Prime cache: total_turn=1, current_player_id="p1" → turn_key "1:p1"
        await _fire_full_sync(ws, _make_state_dict(total_turn=1, current_player_id="p1"))
        assert sess.last_turn_key == "1:p1"
        push_cb.calls.clear()

        # Apply delta that changes totalTurn from 1 → 2 (turn change).
        await _fire_delta_sync(
            ws,
            [{"path": "totalTurn", "value": 2, "type": "set"}],
        )

        assert sess.view_state is not None
        assert sess.view_state.total_turn == 2
        assert sess.last_turn_key == "2:p1"
        assert len(push_cb.calls) == 1
        assert push_cb.calls[0][1].total_turn == 2

    async def test_delta_sync_same_turn_does_not_push(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """A delta that doesn't change turn_key should NOT trigger a push."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(ws, _make_state_dict(total_turn=1, current_player_id="p1"))
        push_cb.calls.clear()
        assert sess.last_turn_key == "1:p1"

        # Change energy (does not change turn_key).
        await _fire_delta_sync(
            ws,
            [{"path": "players[0].energy", "value": 99, "type": "set"}],
        )

        # Cache updated, but no push fired.
        assert sess.view_state is not None
        assert sess.view_state.players[0].energy == 99
        assert push_cb.calls == []

    async def test_delta_sync_without_full_sync_requests_full_sync(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        # No fullSync first — cache is None.
        await _fire_delta_sync(
            ws,
            [{"path": "totalTurn", "value": 5, "type": "set"}],
        )

        # Should have sent GAME_REQUEST_SYNC and not updated cache.
        assert any(
            c[0] == ClientEvent.GAME_REQUEST_SYNC for c in ws.send_calls
        )
        assert sess.view_state is None
        assert push_cb.calls == []

    async def test_delta_sync_invalid_path_requests_full_sync(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(ws, _make_state_dict(total_turn=1, current_player_id="p1"))
        push_cb.calls.clear()
        ws.send_calls.clear()
        original_total_turn = sess.view_state.total_turn if sess.view_state else None

        # Invalid path: missing intermediate key.
        await _fire_delta_sync(
            ws,
            [{"path": "nonexistent.path", "value": 1, "type": "set"}],
        )

        # Should have requested fullSync; cache unchanged.
        assert any(
            c[0] == ClientEvent.GAME_REQUEST_SYNC for c in ws.send_calls
        )
        assert sess.view_state is not None
        assert sess.view_state.total_turn == original_total_turn
        assert push_cb.calls == []


class TestGameOverHandling:
    async def test_winner_triggers_push_and_on_game_over(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        # Fire fullSync with winner="p1" — should push + fire on_game_over +
        # clear the session (stop is called).
        state = _make_state_dict(
            total_turn=10, current_player_id="p1", winner="p1",
        )
        await _fire_full_sync(ws, state)

        # push_callback should have fired (turn_key change + winner set).
        assert len(push_cb.calls) >= 1
        assert push_cb.calls[-1][1].winner == "p1"

        # on_game_over should have fired with qq.
        assert over_cb.calls == [12345]

        # Session should be stopped (cleared from store).
        assert store.get(12345) is None
        assert sess.view_state is None
        # Subscriptions should be cleared from ws.
        assert ws.unsub_count == 0


class TestGameErrorHandling:
    async def test_game_error_handler_does_not_crash(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        await _start_session(store, ws, push_cb, over_cb)
        # Should not raise.
        await _fire_game_error(ws, {"code": "TEST_ERROR", "message": "test"})


class TestStopAll:
    async def test_stop_all_clears_every_session(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        await _start_session(store, ws, push_cb, over_cb, qq=111)
        await _start_session(store, ws, push_cb, over_cb, qq=222)
        await _start_session(store, ws, push_cb, over_cb, qq=333)
        assert len(store._sessions) == 3  # noqa: SLF001 — test-only access

        await store.stop_all()

        assert store._sessions == {}  # noqa: SLF001 — test-only access
        assert ws.unsub_count == 0
