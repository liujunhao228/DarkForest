"""Tests for commands/log.py.

Tests cover:
- Non-IN_GAME state rejection
- IN_GAME with empty cache → "请先 .state"
- .log (no args) → default limit (10) — verified by sending 15 logs and
  checking only the last 10 are rendered
- .log 3 → last 3 logs
- .log 100 → clamped to log_max_limit (50)
- .log abc → usage hint
- .log 0 → clamped to 1 (defensive)
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.backend.view_state import (
    LogEntry,
    PlayerView,
    ViewState,
)
from darkforest_bot.commands.log import _parse_log_count, handle_log_request
from darkforest_bot.config import Settings
from darkforest_bot.session.manager import SessionManager
from darkforest_bot.session.states import SessionState

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_settings() -> Settings:
    return Settings()


def _make_log_entry(idx: int, *, turn: int = 1, log_type: str = "info") -> LogEntry:
    return LogEntry(
        id=f"log-{idx}",
        turn=turn,
        phase="actionPhase",
        message=f"消息 {idx}",
        type=log_type,
    )


def _make_view_state(*, num_logs: int = 0) -> ViewState:
    """Build a minimal ViewState with ``num_logs`` log entries."""
    players = [
        PlayerView(
            id="p1",
            name="Alice",
            color="red",
            position=1,
            energy=3,
            handCount=0,
            hand=[],
            faceUpCards=[],
            eliminated=False,
        ),
    ]
    logs = [_make_log_entry(i + 1) for i in range(num_logs)]
    return ViewState(
        phase="playing",
        totalTurn=1,
        playerCount=1,
        players=players,
        currentPlayerIndex=0,
        currentPlayerId="p1",
        localPlayerId="p1",
        turnPhase="actionPhase",
        logs=logs,
        _viewMeta={"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
    )


def _set_in_game(mgr: SessionManager, qq: int = 12345) -> None:
    """Transition a session through to IN_GAME state."""
    # Note: this helper is called inside an acquire() block by the caller.
    mgr.transition(qq, SessionState.MATCHMAKING)
    mgr.transition(qq, SessionState.IN_ROOM)
    mgr.transition(qq, SessionState.IN_GAME)


def _private_calls(bot: AsyncMock) -> list[Any]:
    """Return all send_private_msg call_api invocations on the mock bot."""
    return [c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"]


# ---------------------------------------------------------------------------
# Tests: argument parsing
# ---------------------------------------------------------------------------


class TestParseLogCount:
    def test_empty_returns_default(self) -> None:
        settings = _make_settings()
        assert _parse_log_count("", settings) == settings.log_default_limit

    def test_digit_returns_int(self) -> None:
        settings = _make_settings()
        assert _parse_log_count("3", settings) == 3

    def test_zero_clamped_to_one(self) -> None:
        settings = _make_settings()
        assert _parse_log_count("0", settings) == 1

    def test_over_max_clamped_to_max(self) -> None:
        settings = _make_settings()
        result = _parse_log_count("999", settings)
        assert result == settings.log_max_limit

    def test_exactly_max(self) -> None:
        settings = _make_settings()
        result = _parse_log_count(str(settings.log_max_limit), settings)
        assert result == settings.log_max_limit

    def test_non_digit_returns_usage_string(self) -> None:
        settings = _make_settings()
        result = _parse_log_count("abc", settings)
        assert isinstance(result, str)
        assert "用法" in result

    def test_negative_not_digit_returns_usage(self) -> None:
        # "-5" is not all-digits (the leading "-" fails isdigit()).
        settings = _make_settings()
        result = _parse_log_count("-5", settings)
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# Tests: state validation
# ---------------------------------------------------------------------------


class TestStateValidation:
    async def test_non_in_game_rejected(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        # Pre-set session to MATCHMAKING (not IN_GAME).
        async with mgr.acquire(12345):
            mgr.transition(12345, SessionState.MATCHMAKING)

        await handle_log_request(
            bot=bot,
            user_id=12345,
            raw_args="",
            session_manager=mgr,
            game_session_store=store,
            settings=settings,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        assert "当前不在对局中" in calls[0].kwargs["message"]


class TestCacheMiss:
    async def test_cache_miss_replies_please_state_first(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        async with mgr.acquire(12345):
            _set_in_game(mgr)

        # No cache populated (store.get returns None or empty session).

        await handle_log_request(
            bot=bot,
            user_id=12345,
            raw_args="",
            session_manager=mgr,
            game_session_store=store,
            settings=settings,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        assert "请先 .state" in calls[0].kwargs["message"]


# ---------------------------------------------------------------------------
# Tests: log rendering with cached state
# ---------------------------------------------------------------------------


class TestLogRendering:
    async def test_default_limit_returns_last_10_of_15(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        async with mgr.acquire(12345):
            _set_in_game(mgr)

        # Populate cache with 15 log entries.
        vs = _make_view_state(num_logs=15)
        session = store.get_or_create(12345)
        session.view_state = vs

        await handle_log_request(
            bot=bot,
            user_id=12345,
            raw_args="",  # default limit
            session_manager=mgr,
            game_session_store=store,
            settings=settings,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        msg = calls[0].kwargs["message"]
        # Default limit is 10, so the message should contain 10 lines.
        # Logs are indexed 1..15; the last 10 are 6..15.
        assert "消息 6" in msg
        assert "消息 15" in msg
        assert "消息 5" not in msg  # older than the last 10
        # Count newlines: 10 lines → 9 newlines separating them.
        assert msg.count("\n") == 9

    async def test_explicit_count_3(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        async with mgr.acquire(12345):
            _set_in_game(mgr)

        vs = _make_view_state(num_logs=10)
        session = store.get_or_create(12345)
        session.view_state = vs

        await handle_log_request(
            bot=bot,
            user_id=12345,
            raw_args="3",
            session_manager=mgr,
            game_session_store=store,
            settings=settings,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        msg = calls[0].kwargs["message"]
        # Last 3 of 10 → logs 8, 9, 10.
        assert "消息 8" in msg
        assert "消息 10" in msg
        assert "消息 7" not in msg
        assert msg.count("\n") == 2

    async def test_count_over_max_clamped(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        async with mgr.acquire(12345):
            _set_in_game(mgr)

        # Provide exactly log_max_limit logs so clamping to max renders all.
        vs = _make_view_state(num_logs=settings.log_max_limit)
        session = store.get_or_create(12345)
        session.view_state = vs

        await handle_log_request(
            bot=bot,
            user_id=12345,
            raw_args="999",  # over max → clamped to log_max_limit
            session_manager=mgr,
            game_session_store=store,
            settings=settings,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        msg = calls[0].kwargs["message"]
        # All log_max_limit logs should be rendered.
        assert f"消息 {settings.log_max_limit}" in msg
        assert "消息 1" in msg  # all of them, since count >= num_logs
        # log_max_limit lines → (log_max_limit - 1) newlines.
        assert msg.count("\n") == settings.log_max_limit - 1

    async def test_invalid_arg_replies_usage(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        async with mgr.acquire(12345):
            _set_in_game(mgr)

        vs = _make_view_state(num_logs=3)
        session = store.get_or_create(12345)
        session.view_state = vs

        await handle_log_request(
            bot=bot,
            user_id=12345,
            raw_args="abc",
            session_manager=mgr,
            game_session_store=store,
            settings=settings,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        msg = calls[0].kwargs["message"]
        assert "用法" in msg

    async def test_empty_logs_returns_no_logs_message(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        store = GameSessionStore()
        settings = _make_settings()

        async with mgr.acquire(12345):
            _set_in_game(mgr)

        vs = _make_view_state(num_logs=0)
        session = store.get_or_create(12345)
        session.view_state = vs

        await handle_log_request(
            bot=bot,
            user_id=12345,
            raw_args="5",
            session_manager=mgr,
            game_session_store=store,
            settings=settings,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        msg = calls[0].kwargs["message"]
        assert "暂无日志" in msg
