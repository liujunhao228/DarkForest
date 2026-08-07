"""Tests for backend/game_session.py — per-QQ session start/stop lifecycle.

full_sync / delta_sync 的 turn push 策略测试已迁至 test_game_session_turn_push.py；
broadcast / pending / strike push 另有各自文件。本文件只保留 start / stop /
game error / stop_all 生命周期类。
"""

from __future__ import annotations

import pytest

from darkforest_bot.backend.game_session import (
    GameSession,
    GameSessionStore,
)

from ._state_helpers import (
    FakeOnGameOver,
    FakePushCallback,
    FakeWS,
    _fire_full_sync,
    _fire_game_error,
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


class TestStartAndStop:
    async def test_start_creates_session_with_three_subscriptions(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        sess = await _start_session(store, ws, push_cb, over_cb)
        assert isinstance(sess, GameSession)
        assert sess.view_state is None
        assert sess.last_event_keys == {}
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
        assert sess.last_event_keys == {}

    async def test_stop_on_nonexistent_session_is_noop(
        self, store: GameSessionStore,
    ) -> None:
        # Should not raise.
        await store.stop(99999)


class TestGameErrorHandling:
    async def test_game_error_handler_does_not_crash(
        self, store: GameSessionStore, ws: FakeWS, push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        await _start_session(store, ws, push_cb, over_cb)
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
