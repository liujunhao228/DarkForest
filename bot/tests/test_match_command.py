"""Tests for commands/match.py.

Tests cover:
- Arg parsing (all branches: default, count only, mode only, both, invalid)
- Non-IDLE state rejection
- Full match flow: IDLE → MATCHMAKING → IN_ROOM → IN_GAME
- login_success fills player_id
- match_found triggers notify + transition
- room_joined triggers room:ready send
- game_started triggers IN_GAME transition
- match:error triggers error reply + IDLE reset
- Match timeout
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.commands.match import handle_match_request, parse_match_args
from darkforest_bot.config import Settings
from darkforest_bot.notifications.match_found import reset_announced
from darkforest_bot.session.manager import SessionManager
from darkforest_bot.session.states import SessionState

# ---------------------------------------------------------------------------
# Mock objects
# ---------------------------------------------------------------------------


class MockWSClient:
    """Mock WSClient that captures handlers and records sent messages."""

    def __init__(self) -> None:
        self.connected: bool = True
        self.sent: list[dict[str, Any]] = []
        self._handlers: dict[ServerEvent, list[Any]] = {}

    async def send(
        self,
        event: ClientEvent,
        payload: dict[str, Any] | None = None,
        room_id: str = "",
    ) -> None:
        self.sent.append({"type": event.value, "payload": payload, "roomId": room_id or None})

    def subscribe(self, event: ServerEvent, handler: Any) -> Any:
        self._handlers.setdefault(event, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._handlers.get(event)
            if handlers:
                try:
                    handlers.remove(handler)
                except ValueError:
                    pass

        return unsubscribe

    async def dispatch(self, event: ServerEvent, payload: dict[str, Any]) -> None:
        """Simulate a server-pushed event by calling subscribed handlers."""
        for handler in list(self._handlers.get(event, [])):
            await handler(payload)

    def get_sent_types(self) -> list[str]:
        return [m["type"] for m in self.sent]


class MockPool:
    """Mock WSConnectionPool that returns a MockWSClient."""

    def __init__(self, ws: MockWSClient) -> None:
        self._ws = ws

    async def get_or_connect(self, qq: int, name: str) -> MockWSClient:
        return self._ws

    def get(self, qq: int) -> MockWSClient | None:
        return self._ws if self._ws.connected else None


def _make_settings() -> Settings:
    """Create test settings with defaults."""
    return Settings()


def _make_login_payload(player_id: str = "p1", name: str = "Alice") -> dict[str, Any]:
    return {
        "id": player_id,
        "userId": "12345",
        "displayName": name,
        "role": "player",
        "ready": False,
        "connected": True,
    }


def _make_match_found_payload(room_id: str = "r1", room_code: str = "CODE1") -> dict[str, Any]:
    return {
        "roomId": room_id,
        "roomCode": room_code,
        "hostId": "p1",
        "players": [
            {
                "playerId": "p1",
                "displayName": "Alice",
                "isHost": True,
                "playerNumber": 1,
                "position": 0,
            }
        ],
        "isHost": True,
    }


def _make_room_joined_payload(room_id: str = "r1") -> dict[str, Any]:
    return {
        "roomId": room_id,
        "roomCode": "CODE1",
        "isHost": True,
        "players": [
            {
                "playerId": "p1",
                "displayName": "Alice",
                "isHost": True,
                "playerNumber": 1,
                "position": 0,
                "ready": True,
                "connected": True,
            }
        ],
    }


# ---------------------------------------------------------------------------
# Tests: arg parsing
# ---------------------------------------------------------------------------


class TestParseMatchArgs:
    def test_default(self) -> None:
        result = parse_match_args("", 4, "classic", 3, 5)
        assert result == (4, "classic")

    def test_count_only(self) -> None:
        result = parse_match_args("3", 4, "classic", 3, 5)
        assert result == (3, "classic")

    def test_count_and_mode(self) -> None:
        result = parse_match_args("4 civilization_relics", 4, "classic", 3, 5)
        assert result == (4, "civilization_relics")

    def test_mode_only(self) -> None:
        result = parse_match_args("classic", 4, "classic", 3, 5)
        assert result == (4, "classic")

    def test_mode_only_civilization(self) -> None:
        result = parse_match_args("civilization_relics", 4, "classic", 3, 5)
        assert result == (4, "civilization_relics")

    def test_count_too_small(self) -> None:
        result = parse_match_args("0", 4, "classic", 3, 5)
        assert isinstance(result, str)
        assert "3-5" in result

    def test_count_too_large(self) -> None:
        result = parse_match_args("9", 4, "classic", 3, 5)
        assert isinstance(result, str)
        assert "3-5" in result

    def test_invalid_token(self) -> None:
        result = parse_match_args("abc", 4, "classic", 3, 5)
        assert isinstance(result, str)
        assert "参数无效" in result

    def test_invalid_mode(self) -> None:
        result = parse_match_args("4 foo", 4, "classic", 3, 5)
        assert isinstance(result, str)
        assert "参数无效" in result

    def test_duplicate_count(self) -> None:
        result = parse_match_args("3 4", 4, "classic", 3, 5)
        assert isinstance(result, str)
        assert "参数无效" in result

    def test_duplicate_mode(self) -> None:
        result = parse_match_args("classic classic", 4, "classic", 3, 5)
        assert isinstance(result, str)
        assert "参数无效" in result


# ---------------------------------------------------------------------------
# Tests: state validation
# ---------------------------------------------------------------------------


class TestStateValidation:
    async def test_non_idle_rejected(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        settings = _make_settings()

        # Pre-set session to MATCHMAKING.
        async with mgr.acquire(12345):
            mgr.transition(12345, SessionState.MATCHMAKING)

        await handle_match_request(
            bot=bot,
            group_id=10001,
            user_id=12345,
            sender_name="Alice",
            raw_args="",
            pool=pool,
            session_manager=mgr,
            settings=settings,
        )

        # Should reply with state error.
        calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert len(calls) == 1
        assert "matchmaking" in calls[0].kwargs["message"]
        # Should NOT send match:joinQueue.
        assert "match:joinQueue" not in ws.get_sent_types()

    async def test_invalid_args_rejected(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        settings = _make_settings()

        await handle_match_request(
            bot=bot,
            group_id=10001,
            user_id=12345,
            sender_name="Alice",
            raw_args="abc",
            pool=pool,
            session_manager=mgr,
            settings=settings,
        )

        calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert len(calls) == 1
        assert "参数无效" in calls[0].kwargs["message"]
        assert "match:joinQueue" not in ws.get_sent_types()


# ---------------------------------------------------------------------------
# Tests: full match flow
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_announced_rooms() -> None:
    """Clear notification dedup state before each test."""
    reset_announced()


class TestFullMatchFlow:
    async def test_full_flow_idle_to_in_game(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        settings = _make_settings()

        # Start the match handler as a task.
        task = asyncio.create_task(
            handle_match_request(
                bot=bot,
                group_id=10001,
                user_id=12345,
                sender_name="Alice",
                raw_args="4 classic",
                pool=pool,
                session_manager=mgr,
                settings=settings,
            )
        )

        # Wait for match:joinQueue to be sent.
        await _wait_for_condition(lambda: "match:joinQueue" in ws.get_sent_types())
        assert "match:joinQueue" in ws.get_sent_types()
        join_msg = next(m for m in ws.sent if m["type"] == "match:joinQueue")
        assert join_msg["payload"] == {"preferredCount": 4, "gameMode": "classic"}

        # Verify "匹配中..." was replied.
        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert any("匹配中" in c.kwargs["message"] for c in group_calls)

        # Verify state is MATCHMAKING.
        assert mgr.get(12345).state is SessionState.MATCHMAKING  # type: ignore[union-attr]

        # Dispatch login_success.
        await ws.dispatch(ServerEvent.PLAYER_LOGIN_SUCCESS, _make_login_payload())
        await asyncio.sleep(0.05)

        # Verify player_id was set.
        session = mgr.get(12345)
        assert session is not None  # type: ignore[union-attr]
        assert session.player_id == "p1"  # type: ignore[union-attr]

        # Dispatch match:found.
        await ws.dispatch(ServerEvent.MATCH_FOUND, _make_match_found_payload())
        await asyncio.sleep(0.05)

        # Verify transition to IN_ROOM.
        assert mgr.get(12345).state is SessionState.IN_ROOM  # type: ignore[union-attr]

        # Verify notify_match_found was called (group + private messages).
        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        private_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"]
        assert any("匹配成功" in c.kwargs["message"] for c in group_calls)
        assert any("CODE1" in c.kwargs["message"] for c in private_calls)

        # Dispatch room:joined.
        await ws.dispatch(ServerEvent.ROOM_JOINED, _make_room_joined_payload())
        await asyncio.sleep(0.05)

        # Verify room:ready was sent.
        assert "room:ready" in ws.get_sent_types()

        # Dispatch game:started.
        await ws.dispatch(ServerEvent.ROOM_GAME_STARTED, {})
        await asyncio.sleep(0.05)

        # Verify transition to IN_GAME.
        assert mgr.get(12345).state is SessionState.IN_GAME  # type: ignore[union-attr]

        # Wait for task to complete.
        await asyncio.wait_for(task, timeout=5.0)

        # Verify private "对局已开始" was sent.
        private_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"]
        assert any("对局已开始" in c.kwargs["message"] for c in private_calls)

    async def test_match_error_resets_to_idle(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        settings = _make_settings()

        task = asyncio.create_task(
            handle_match_request(
                bot=bot,
                group_id=10001,
                user_id=12345,
                sender_name="Alice",
                raw_args="",
                pool=pool,
                session_manager=mgr,
                settings=settings,
            )
        )

        await _wait_for_condition(lambda: "match:joinQueue" in ws.get_sent_types())

        # Dispatch login_success.
        await ws.dispatch(ServerEvent.PLAYER_LOGIN_SUCCESS, _make_login_payload())
        await asyncio.sleep(0.05)

        # Dispatch match:error instead of match:found.
        await ws.dispatch(
            ServerEvent.MATCH_ERROR,
            {"code": "QUEUE_FULL", "message": "队列已满"},
        )
        await asyncio.sleep(0.05)

        # Wait for task to complete.
        await asyncio.wait_for(task, timeout=5.0)

        # Verify error reply.
        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert any("匹配失败" in c.kwargs["message"] for c in group_calls)
        assert any("队列已满" in c.kwargs["message"] for c in group_calls)

        # Verify state reset to IDLE.
        assert mgr.get(12345).state is SessionState.IDLE  # type: ignore[union-attr]

    async def test_login_success_timeout_is_non_fatal(self) -> None:
        """If login_success doesn't arrive, the match flow continues."""
        from darkforest_bot.commands import match as match_mod

        # Patch login timeout to be very short.
        original = match_mod.LOGIN_TIMEOUT
        match_mod.LOGIN_TIMEOUT = 0.05

        try:
            bot = AsyncMock()
            ws = MockWSClient()
            pool = MockPool(ws)
            mgr = SessionManager()
            settings = _make_settings()

            task = asyncio.create_task(
                handle_match_request(
                    bot=bot,
                    group_id=10001,
                    user_id=12345,
                    sender_name="Alice",
                    raw_args="",
                    pool=pool,
                    session_manager=mgr,
                    settings=settings,
                )
            )

            await _wait_for_condition(lambda: "match:joinQueue" in ws.get_sent_types())
            # Don't dispatch login_success — let it timeout.

            # Wait for login timeout to pass, then dispatch match_found.
            await asyncio.sleep(0.1)
            await ws.dispatch(ServerEvent.MATCH_FOUND, _make_match_found_payload())
            await asyncio.sleep(0.05)

            # Verify transition to IN_ROOM (flow continued despite login timeout).
            assert mgr.get(12345).state is SessionState.IN_ROOM  # type: ignore[union-attr]

            # Cleanup: dispatch room_joined + game_started to let task finish.
            await ws.dispatch(ServerEvent.ROOM_JOINED, _make_room_joined_payload())
            await asyncio.sleep(0.05)
            await ws.dispatch(ServerEvent.ROOM_GAME_STARTED, {})
            await asyncio.wait_for(task, timeout=5.0)
        finally:
            match_mod.LOGIN_TIMEOUT = original


# ---------------------------------------------------------------------------
# Tests: ws connect failure
# ---------------------------------------------------------------------------


class TestWSConnectFailure:
    async def test_connect_failure_resets_to_idle(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        settings = _make_settings()

        # Pool that raises on get_or_connect.
        class FailingPool:
            async def get_or_connect(self, qq: int, name: str) -> Any:
                raise ConnectionError("backend unreachable")

        await handle_match_request(
            bot=bot,
            group_id=10001,
            user_id=12345,
            sender_name="Alice",
            raw_args="",
            pool=FailingPool(),  # type: ignore[arg-type]
            session_manager=mgr,
            settings=settings,
        )

        # Verify error reply.
        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert any("连接后端失败" in c.kwargs["message"] for c in group_calls)

        # Verify state reset to IDLE.
        assert mgr.get(12345).state is SessionState.IDLE  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _wait_for_condition(condition: Any, timeout: float = 2.0, interval: float = 0.01) -> None:
    """Wait until condition() returns True, or raise TimeoutError."""
    elapsed = 0.0
    while elapsed < timeout:
        if condition():
            return
        await asyncio.sleep(interval)
        elapsed += interval
    raise TimeoutError(f"Condition not met within {timeout}s")
