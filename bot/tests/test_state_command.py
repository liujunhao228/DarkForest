"""Tests for commands/state.py.

Tests cover:
- Non-IN_GAME state rejection (private reply with state error)
- IN_GAME with cached ViewState → bot.call_api send_private_msg with image
- IN_GAME with empty cache + WS available → ws.send(GAME_REQUEST_SYNC) →
  wait for fullSync → render and send
- IN_GAME with empty cache + WS unavailable → private reply "超时或连接不可用"
- IN_GAME with empty cache + WS available but fullSync times out →
  private reply "超时或连接不可用"
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.backend.view_state import (
    Card,
    PlayerView,
    ViewState,
)
from darkforest_bot.commands.state import handle_state_request
from darkforest_bot.config import Settings
from darkforest_bot.session.manager import SessionManager
from darkforest_bot.session.states import SessionState

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
    def sent_event_types(self) -> list[str]:
        return [e.value for e, _, _ in self.send_calls]


class FakePool:
    """Mock WSConnectionPool that returns a FakeWS (or None when disconnected)."""

    def __init__(self, ws: FakeWS | None) -> None:
        self._ws = ws

    def get(self, qq: int) -> FakeWS | None:  # noqa: ARG002 - qq unused
        if self._ws is None:
            return None
        return self._ws if self._ws.connected else None


def _make_settings(*, state_request_timeout: float = 10.0) -> Settings:
    """Settings with a tiny canvas to keep rendering fast in tests."""
    s = Settings()
    # Override render settings for test speed (small canvas).
    s = s.model_copy(
        update={
            "render_canvas_size": 200,
            "state_request_timeout": state_request_timeout,
        }
    )
    return s


def _make_card(uid: str = "c1", name: str = "TestCard", ctype: str = "strike") -> Card:
    return Card(
        uid=uid,
        defId="def_" + uid,
        name=name,
        type=ctype,
        energy=2,
        description="",
        image="",
    )


def _make_player(
    pid: str = "p1",
    *,
    name: str = "Alice",
    color: str = "red",
    position: int = 1,
    energy: int = 3,
    hand: list[Card] | None = None,
) -> PlayerView:
    return PlayerView(
        id=pid,
        name=name,
        color=color,
        position=position,
        energy=energy,
        handCount=len(hand or []),
        hand=hand or [],
        faceUpCards=[],
        eliminated=False,
    )


def _make_view_state(
    *,
    total_turn: int = 3,
    current_player_id: str = "p1",
    local_player_id: str = "p1",
    players: list[PlayerView] | None = None,
    winner: str | None = None,
) -> ViewState:
    if players is None:
        players = [
            _make_player("p1", name="Alice", position=1, hand=[_make_card()]),
            _make_player("p2", name="Bob", color="blue", position=-1),
        ]
    return ViewState(
        phase="playing",
        totalTurn=total_turn,
        playerCount=len(players),
        players=players,
        currentPlayerIndex=0,
        currentPlayerId=current_player_id,
        localPlayerId=local_player_id,
        turnPhase="actionPhase",
        _viewMeta={"role": "PLAYER", "viewerId": local_player_id, "timestamp": 1},
        winner=winner,
    )


def _make_state_dict_from_vs(vs: ViewState) -> dict[str, Any]:
    """Dump a ViewState to a backend-shaped dict (by alias) for fullSync payload."""
    return vs.model_dump(by_alias=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _wait_for_condition(
    condition: Any, timeout: float = 2.0, interval: float = 0.01
) -> None:
    """Wait until condition() returns True, or raise TimeoutError."""
    elapsed = 0.0
    while elapsed < timeout:
        if condition():
            return
        await asyncio.sleep(interval)
        elapsed += interval
    raise TimeoutError(f"Condition not met within {timeout}s")


def _private_calls(bot: AsyncMock) -> list[Any]:
    """Return all send_private_msg call_api invocations on the mock bot."""
    return [c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStateValidation:
    async def test_non_in_game_rejected(self) -> None:
        bot = AsyncMock()
        ws = FakeWS()
        pool = FakePool(ws)
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        # Pre-set session to MATCHMAKING (not IN_GAME).
        async with mgr.acquire(12345):
            mgr.transition(12345, SessionState.MATCHMAKING)

        await handle_state_request(
            bot=bot,
            user_id=12345,
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        # Should reply with state error.
        calls = _private_calls(bot)
        assert len(calls) == 1
        assert "当前不在对局中" in calls[0].kwargs["message"]
        # Should NOT send game:requestSync.
        assert "game:requestSync" not in ws.sent_event_types


class TestStateWithCachedView:
    async def test_cached_state_renders_and_sends_image(self) -> None:
        bot = AsyncMock()
        ws = FakeWS()
        pool = FakePool(ws)
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        # Set session to IN_GAME.
        async with mgr.acquire(12345):
            mgr.transition(12345, SessionState.MATCHMAKING)
            mgr.transition(12345, SessionState.IN_ROOM)
            mgr.transition(12345, SessionState.IN_GAME)

        # Pre-populate the cache with a ViewState.
        vs = _make_view_state(total_turn=5, current_player_id="p1")
        session = store.get_or_create(12345)
        session.view_state = vs

        await handle_state_request(
            bot=bot,
            user_id=12345,
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        # bot.call_api should have been called with send_private_msg.
        calls = _private_calls(bot)
        assert len(calls) == 1
        assert calls[0].kwargs["user_id"] == 12345
        # The message should be a nonebot Message containing an image segment
        # and text. We just check that the message has at least one segment
        # of type "image" by stringifying it.
        msg = calls[0].kwargs["message"]
        msg_str = str(msg)
        assert "image" in msg_str or "base64" in msg_str
        # Should NOT have requested sync (cache hit).
        assert "game:requestSync" not in ws.sent_event_types


class TestStateCacheMissWithWS:
    async def test_cache_miss_requests_sync_and_renders_on_full_sync(self) -> None:
        bot = AsyncMock()
        ws = FakeWS()
        pool = FakePool(ws)
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        # Set session to IN_GAME.
        async with mgr.acquire(12345):
            mgr.transition(12345, SessionState.MATCHMAKING)
            mgr.transition(12345, SessionState.IN_ROOM)
            mgr.transition(12345, SessionState.IN_GAME)

        # Cache is empty (no view_state set).

        # Run handle_state_request as a task so we can fire the fullSync
        # handler after the request is sent.
        task = asyncio.create_task(
            handle_state_request(
                bot=bot,
                user_id=12345,
                session_manager=mgr,
                game_session_store=store,
                pool=pool,
                settings=settings,
            )
        )

        # Wait for game:requestSync to be sent.
        await _wait_for_condition(
            lambda: "game:requestSync" in ws.sent_event_types
        )
        assert "game:requestSync" in ws.sent_event_types

        # Fire the fullSync handler subscribed by _fetch_state_via_ws.
        vs = _make_view_state(total_turn=7, current_player_id="p1")
        state_dict = _make_state_dict_from_vs(vs)
        full_sync_payload = {"state": state_dict, "version": 1}

        # _fetch_state_via_ws subscribes its own handler — invoke all
        # registered GAME_FULL_SYNC handlers.
        for h in ws.handlers_for(ServerEvent.GAME_FULL_SYNC):
            await h(full_sync_payload)

        # Wait for task to complete.
        await asyncio.wait_for(task, timeout=5.0)

        # bot.call_api should have been called with send_private_msg.
        calls = _private_calls(bot)
        assert len(calls) == 1
        assert calls[0].kwargs["user_id"] == 12345
        msg_str = str(calls[0].kwargs["message"])
        assert "image" in msg_str or "base64" in msg_str

    async def test_cache_miss_fullsync_timeout_replies_error(self) -> None:
        bot = AsyncMock()
        ws = FakeWS()
        pool = FakePool(ws)
        mgr = SessionManager()
        store = GameSessionStore()
        # Very short timeout so the test fails fast.
        settings = _make_settings(state_request_timeout=0.05)

        async with mgr.acquire(12345):
            mgr.transition(12345, SessionState.MATCHMAKING)
            mgr.transition(12345, SessionState.IN_ROOM)
            mgr.transition(12345, SessionState.IN_GAME)

        await handle_state_request(
            bot=bot,
            user_id=12345,
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        # game:requestSync should have been sent.
        assert "game:requestSync" in ws.sent_event_types

        # Should reply with timeout / connection error message.
        calls = _private_calls(bot)
        assert len(calls) == 1
        assert "超时" in calls[0].kwargs["message"] or "连接不可用" in calls[0].kwargs["message"]


class TestStateCacheMissNoWS:
    async def test_cache_miss_no_ws_replies_error(self) -> None:
        bot = AsyncMock()
        # No WS in the pool → pool.get returns None.
        pool = FakePool(None)
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        async with mgr.acquire(12345):
            mgr.transition(12345, SessionState.MATCHMAKING)
            mgr.transition(12345, SessionState.IN_ROOM)
            mgr.transition(12345, SessionState.IN_GAME)

        await handle_state_request(
            bot=bot,
            user_id=12345,
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        # Should reply with timeout / connection error message.
        calls = _private_calls(bot)
        assert len(calls) == 1
        assert "超时" in calls[0].kwargs["message"] or "连接不可用" in calls[0].kwargs["message"]


class TestStateWSDisconnected:
    async def test_cache_miss_disconnected_ws_replies_error(self) -> None:
        bot = AsyncMock()
        ws = FakeWS()
        ws.connected = False  # simulate disconnected WS
        pool = FakePool(ws)
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        async with mgr.acquire(12345):
            mgr.transition(12345, SessionState.MATCHMAKING)
            mgr.transition(12345, SessionState.IN_ROOM)
            mgr.transition(12345, SessionState.IN_GAME)

        await handle_state_request(
            bot=bot,
            user_id=12345,
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        # Should reply with timeout / connection error message.
        calls = _private_calls(bot)
        assert len(calls) == 1
        assert "超时" in calls[0].kwargs["message"] or "连接不可用" in calls[0].kwargs["message"]
        # Should NOT have sent game:requestSync (WS not connected).
        assert "game:requestSync" not in ws.sent_event_types
