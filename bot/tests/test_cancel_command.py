"""Tests for commands/cancel.py.

Tests cover:
- MATCHMAKING state: successful cancel (sends match:cancelQueue, receives
  match:queueCancelled, transitions to IDLE, replies "已取消匹配")
- IDLE / IN_ROOM / IN_GAME states: friendly rejection reply
- WS not connected: replies "连接已断开" and clears session
- match:queueCancelled timeout: replies "取消失败"
- Private message context: replies via send_private_msg
- Group message context: replies via send_group_msg
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.commands.cancel import handle_cancel_request
from darkforest_bot.session.manager import SessionManager
from darkforest_bot.session.states import SessionState

# ---------------------------------------------------------------------------
# Mock objects
# ---------------------------------------------------------------------------


class MockWSClient:
    """Mock WSClient that captures handlers and records sent messages."""

    def __init__(self, *, connected: bool = True) -> None:
        self.connected = connected
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

    def __init__(self, ws: MockWSClient | None) -> None:
        self._ws = ws

    async def get_or_connect(self, qq: int, name: str) -> MockWSClient:
        if self._ws is None:
            raise ConnectionError("no ws")
        return self._ws

    def get(self, qq: int) -> MockWSClient | None:
        if self._ws is None or not self._ws.connected:
            return None
        return self._ws


def _set_state(mgr: SessionManager, qq: int, state: SessionState) -> None:
    """Helper: set session state directly for test setup.

    Bypasses the lock and transition validation — safe in single-threaded
    test setup where we need to force a specific starting state. The lock
    is only created lazily on first acquire(), so it binds to the test's
    event loop correctly.
    """
    session = mgr.get_or_create(qq)
    session.state = state


# ---------------------------------------------------------------------------
# Tests: state validation
# ---------------------------------------------------------------------------


class TestStateValidation:
    async def test_idle_state_rejected(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        # Session is IDLE by default (no setup needed).

        await handle_cancel_request(
            bot=bot,
            user_id=12345,
            is_group=True,
            group_id=10001,
            pool=pool,
            session_manager=mgr,
        )

        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert len(group_calls) == 1
        assert "当前不在匹配队列中" in group_calls[0].kwargs["message"]
        assert "idle" in group_calls[0].kwargs["message"]
        assert "match:cancelQueue" not in ws.get_sent_types()

    async def test_in_room_state_rejected(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        _set_state(mgr, 12345, SessionState.IN_ROOM)

        await handle_cancel_request(
            bot=bot,
            user_id=12345,
            is_group=True,
            group_id=10001,
            pool=pool,
            session_manager=mgr,
        )

        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert len(group_calls) == 1
        assert "当前不在匹配队列中" in group_calls[0].kwargs["message"]
        assert "in-room" in group_calls[0].kwargs["message"]
        assert "match:cancelQueue" not in ws.get_sent_types()

    async def test_in_game_state_rejected(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        _set_state(mgr, 12345, SessionState.IN_GAME)

        await handle_cancel_request(
            bot=bot,
            user_id=12345,
            is_group=True,
            group_id=10001,
            pool=pool,
            session_manager=mgr,
        )

        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert len(group_calls) == 1
        assert "当前不在匹配队列中" in group_calls[0].kwargs["message"]
        assert "in-game" in group_calls[0].kwargs["message"]
        assert "match:cancelQueue" not in ws.get_sent_types()


# ---------------------------------------------------------------------------
# Tests: WS connection issues
# ---------------------------------------------------------------------------


class TestWSConnection:
    async def test_ws_not_connected_clears_session(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient(connected=False)
        pool = MockPool(ws)
        mgr = SessionManager()
        _set_state(mgr, 12345, SessionState.MATCHMAKING)

        await handle_cancel_request(
            bot=bot,
            user_id=12345,
            is_group=True,
            group_id=10001,
            pool=pool,
            session_manager=mgr,
        )

        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert any("连接已断开" in c.kwargs["message"] for c in group_calls)
        # Session should be cleared (reset to IDLE, fields cleared).
        session = mgr.get(12345)
        assert session is not None
        assert session.state is SessionState.IDLE
        assert "match:cancelQueue" not in ws.get_sent_types()

    async def test_ws_none_clears_session(self) -> None:
        bot = AsyncMock()
        pool = MockPool(None)
        mgr = SessionManager()
        _set_state(mgr, 12345, SessionState.MATCHMAKING)

        await handle_cancel_request(
            bot=bot,
            user_id=12345,
            is_group=True,
            group_id=10001,
            pool=pool,
            session_manager=mgr,
        )

        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert any("连接已断开" in c.kwargs["message"] for c in group_calls)
        session = mgr.get(12345)
        assert session is not None
        assert session.state is SessionState.IDLE


# ---------------------------------------------------------------------------
# Tests: successful cancel flow
# ---------------------------------------------------------------------------


class TestSuccessfulCancel:
    async def test_successful_cancel_group_context(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        _set_state(mgr, 12345, SessionState.MATCHMAKING)

        # Run the handler as a task so we can dispatch the backend response.
        task = asyncio.create_task(
            handle_cancel_request(
                bot=bot,
                user_id=12345,
                is_group=True,
                group_id=10001,
                pool=pool,
                session_manager=mgr,
            )
        )

        # Wait for match:cancelQueue to be sent.
        await _wait_for_condition(lambda: "match:cancelQueue" in ws.get_sent_types())
        assert "match:cancelQueue" in ws.get_sent_types()

        # Backend confirms cancellation.
        await ws.dispatch(ServerEvent.MATCH_QUEUE_CANCELLED, {})
        await asyncio.wait_for(task, timeout=5.0)

        # Verify state transitioned to IDLE.
        session = mgr.get(12345)
        assert session is not None
        assert session.state is SessionState.IDLE

        # Verify group reply.
        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert any("已取消匹配" in c.kwargs["message"] for c in group_calls)

    async def test_successful_cancel_private_context(self) -> None:
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        _set_state(mgr, 12345, SessionState.MATCHMAKING)

        task = asyncio.create_task(
            handle_cancel_request(
                bot=bot,
                user_id=12345,
                is_group=False,
                group_id=0,
                pool=pool,
                session_manager=mgr,
            )
        )

        await _wait_for_condition(lambda: "match:cancelQueue" in ws.get_sent_types())

        await ws.dispatch(ServerEvent.MATCH_QUEUE_CANCELLED, {})
        await asyncio.wait_for(task, timeout=5.0)

        # Verify private reply (not group).
        private_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"]
        group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
        assert any("已取消匹配" in c.kwargs["message"] for c in private_calls)
        assert len(group_calls) == 0

        session = mgr.get(12345)
        assert session is not None
        assert session.state is SessionState.IDLE

    async def test_unsubscribe_after_cancel(self) -> None:
        """The queueCancelled handler is unsubscribed after cancel completes."""
        bot = AsyncMock()
        ws = MockWSClient()
        pool = MockPool(ws)
        mgr = SessionManager()
        _set_state(mgr, 12345, SessionState.MATCHMAKING)

        task = asyncio.create_task(
            handle_cancel_request(
                bot=bot,
                user_id=12345,
                is_group=True,
                group_id=10001,
                pool=pool,
                session_manager=mgr,
            )
        )

        await _wait_for_condition(lambda: "match:cancelQueue" in ws.get_sent_types())
        await ws.dispatch(ServerEvent.MATCH_QUEUE_CANCELLED, {})
        await asyncio.wait_for(task, timeout=5.0)

        # No handlers should remain subscribed.
        assert len(ws._handlers.get(ServerEvent.MATCH_QUEUE_CANCELLED, [])) == 0


# ---------------------------------------------------------------------------
# Tests: timeout
# ---------------------------------------------------------------------------


class TestCancelTimeout:
    async def test_timeout_replies_failure(self) -> None:
        from darkforest_bot.commands import cancel as cancel_mod

        original = cancel_mod.CANCEL_TIMEOUT
        cancel_mod.CANCEL_TIMEOUT = 0.1

        try:
            bot = AsyncMock()
            ws = MockWSClient()
            pool = MockPool(ws)
            mgr = SessionManager()
            _set_state(mgr, 12345, SessionState.MATCHMAKING)

            await handle_cancel_request(
                bot=bot,
                user_id=12345,
                is_group=True,
                group_id=10001,
                pool=pool,
                session_manager=mgr,
            )

            # Should NOT have received queueCancelled; verify failure reply.
            group_calls = [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]
            assert any("取消失败" in c.kwargs["message"] for c in group_calls)

            # match:cancelQueue was still sent.
            assert "match:cancelQueue" in ws.get_sent_types()

            # State should remain MATCHMAKING (cancel didn't confirm).
            session = mgr.get(12345)
            assert session is not None
            assert session.state is SessionState.MATCHMAKING
        finally:
            cancel_mod.CANCEL_TIMEOUT = original


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
