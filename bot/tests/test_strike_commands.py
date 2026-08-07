"""Tests for commands/strike.py — .move / .pick / .announce / .retarget / .discard / .skip."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.backend.protocol import ClientEvent
from darkforest_bot.backend.view_state import (
    FlyingStrikeView,
    PendingAction,
    PlayerView,
    ViewState,
)
from darkforest_bot.commands.strike import (
    handle_announce_request,
    handle_discard_request,
    handle_move_request,
    handle_pick_request,
    handle_retarget_request,
    handle_skip_request,
)
from darkforest_bot.config import Settings
from darkforest_bot.session.manager import SessionManager
from darkforest_bot.session.states import SessionState

QQ = 12345


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeWS:
    def __init__(self) -> None:
        self.connected: bool = True
        self.player_id: str | None = None
        self.send_calls: list[tuple[ClientEvent, dict[str, Any] | None, str]] = []

    def subscribe(self, event: Any, handler: Any) -> Any:
        def unsubscribe() -> None:
            return None

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


class FakePool:
    def __init__(self, ws: FakeWS | None) -> None:
        self._ws = ws

    def get(self, qq: int) -> FakeWS | None:  # noqa: ARG002 - qq unused
        if self._ws is None:
            return None
        return self._ws if self._ws.connected else None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_strike(uid: str = "s1", owner_id: str = "p1") -> FlyingStrikeView:
    return FlyingStrikeView(
        uid=uid,
        defId="def_" + uid,
        ownerId=owner_id,
        position=1,
        targetSystem=2,
        level=1,
        speed=1,
        remainingMoves=1,
        strikeName="strike_x",
        arrived=False,
        delayed=False,
    )


def _make_player(pid: str, name: str) -> PlayerView:
    return PlayerView(
        id=pid,
        name=name,
        color="red" if pid == "p1" else "blue",
        position=1 if pid == "p1" else -1,
        energy=3,
        handCount=0,
        hand=[],
        faceUpCards=[],
        eliminated=False,
    )


def _make_view_state(
    *,
    pending: PendingAction | None = None,
    flying_strikes: list[FlyingStrikeView] | None = None,
) -> ViewState:
    players = [_make_player("p1", "Alice"), _make_player("p2", "Bob")]
    if flying_strikes is None:
        flying_strikes = [_make_strike("s1", "p1")]
    return ViewState(
        phase="playing",
        totalTurn=3,
        playerCount=len(players),
        players=players,
        currentPlayerIndex=0,
        currentPlayerId="p1",
        localPlayerId="p1",
        turnPhase="actionPhase",
        _viewMeta={"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
        pendingAction=pending,
        flyingStrikes=flying_strikes,
    )


def _setup_in_game(
    mgr: SessionManager, store: GameSessionStore, vs: ViewState
) -> None:
    """Synchronous setup: bypass the asyncio.Lock (tests are single-threaded
    per-test; SessionManager.transition only expects the caller to hold the
    lock, it does not acquire it internally)."""
    session = mgr.get_or_create(QQ)
    # Drive through the legal transition chain IDLE → MATCHMAKING → IN_ROOM → IN_GAME.
    session.state = SessionState.MATCHMAKING
    session.state = SessionState.IN_ROOM
    session.state = SessionState.IN_GAME
    sess = store.get_or_create(QQ)
    sess.view_state = vs


def _private_messages(bot: AsyncMock) -> list[Any]:
    calls = [
        c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"
    ]
    return [c.kwargs["message"] for c in calls]


def _game_action_calls(ws: FakeWS) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for event, payload, _ in ws.send_calls:
        if event != ClientEvent.GAME_ACTION:
            continue
        assert payload is not None
        out.append((payload["action"], payload["data"]))
    return out


@pytest.fixture()
def env_with_pending():
    """Parameterized fixture factory: returns a callable that builds an env
    with a given PendingAction."""

    def _build(
        pending: PendingAction | None,
        flying_strikes: list[FlyingStrikeView] | None = None,
    ) -> tuple[AsyncMock, FakeWS, FakePool, SessionManager, GameSessionStore, Settings]:
        bot = AsyncMock()
        ws = FakeWS()
        pool = FakePool(ws)
        mgr = SessionManager()
        store = GameSessionStore()
        settings = Settings(action_error_timeout=0.05, render_canvas_size=200)
        vs = _make_view_state(pending=pending, flying_strikes=flying_strikes)
        _setup_in_game(mgr, store, vs)
        return bot, ws, pool, mgr, store, settings

    return _build


# ---------------------------------------------------------------------------
# .move
# ---------------------------------------------------------------------------


class TestMoveCommand:
    async def test_move_in_strike_move_phase(self, env_with_pending) -> None:
        pa = PendingAction(type="strikeMove", strikeUid="s1")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_move_request(
            bot=bot, user_id=QQ, raw_args="1 5",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            ("moveStrike", {"strikeUid": "s1", "targetSystem": 5})
        ]

    async def test_move_missing_args_replies_usage(self, env_with_pending) -> None:
        pa = PendingAction(type="strikeMove")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_move_request(
            bot=bot, user_id=QQ, raw_args="1",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_move_strike_index_out_of_range(
        self, env_with_pending
    ) -> None:
        pa = PendingAction(type="strikeMove")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_move_request(
            bot=bot, user_id=QQ, raw_args="2 5",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "越界" in msgs[0]


# ---------------------------------------------------------------------------
# .pick
# ---------------------------------------------------------------------------


class TestPickCommand:
    async def test_pick_in_strike_select_phase(self, env_with_pending) -> None:
        pa = PendingAction(type="strikeSelect", strikeUids=["s1", "s2"])
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_pick_request(
            bot=bot, user_id=QQ, raw_args="1",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("selectStrike", {"strikeUid": "s1"})]

    async def test_pick_index_out_of_range_replies_count(
        self, env_with_pending
    ) -> None:
        pa = PendingAction(type="strikeSelect", strikeUids=["s1", "s2"])
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_pick_request(
            bot=bot, user_id=QQ, raw_args="3",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "待处理 2 个" in msgs[0]


# ---------------------------------------------------------------------------
# .announce
# ---------------------------------------------------------------------------


class TestAnnounceCommand:
    async def test_announce_in_announce_phase(self, env_with_pending) -> None:
        pa = PendingAction(type="announceStrike", strikeUid="s1", targetSystem=5)
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_announce_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("announceStrike", {})]


# ---------------------------------------------------------------------------
# .retarget
# ---------------------------------------------------------------------------


class TestRetargetCommand:
    async def test_retarget_in_strike_move_phase(self, env_with_pending) -> None:
        pa = PendingAction(type="strikeMove", strikeUid="s1")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_retarget_request(
            bot=bot, user_id=QQ, raw_args="1 3",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            ("retargetStrike", {"strikeUid": "s1", "targetSystem": 3})
        ]

    async def test_retarget_in_strike_missed_free_phase(
        self, env_with_pending
    ) -> None:
        pa = PendingAction(type="strikeMissedFree", strikeUid="s1")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_retarget_request(
            bot=bot, user_id=QQ, raw_args="1 3",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            ("retargetMissedStrike", {"strikeUid": "s1", "targetSystem": 3})
        ]


# ---------------------------------------------------------------------------
# .discard
# ---------------------------------------------------------------------------


class TestDiscardCommand:
    async def test_discard_in_strike_missed_free_phase(
        self, env_with_pending
    ) -> None:
        pa = PendingAction(type="strikeMissedFree", strikeUid="s1")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_discard_request(
            bot=bot, user_id=QQ, raw_args="1",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("discardMissedStrike", {"strikeUid": "s1"})]


# ---------------------------------------------------------------------------
# .skip (context-sensitive dispatch)
# ---------------------------------------------------------------------------


class TestSkipCommand:
    async def test_skip_in_strike_select(self, env_with_pending) -> None:
        pa = PendingAction(type="strikeSelect", strikeUids=["s1", "s2"])
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_skip_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("skipStrikeSelect", {})]

    async def test_skip_in_strike_move(self, env_with_pending) -> None:
        pa = PendingAction(type="strikeMove", strikeUid="s1")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_skip_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("skipStrikeMove", {})]

    async def test_skip_in_announce_strike(self, env_with_pending) -> None:
        pa = PendingAction(type="announceStrike", strikeUid="s1")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_skip_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("skipAnnounceStrike", {})]

    async def test_skip_in_strike_missed_free_carries_strike_uid(
        self, env_with_pending
    ) -> None:
        pa = PendingAction(type="strikeMissedFree", strikeUid="s1")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_skip_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("skipMissedStrike", {"strikeUid": "s1"})]


# ---------------------------------------------------------------------------
# PendingAction validation
# ---------------------------------------------------------------------------


class TestPendingValidation:
    async def test_skip_with_no_pending_replies_no_action(
        self, env_with_pending
    ) -> None:
        bot, ws, pool, mgr, store, settings = env_with_pending(None)

        await handle_skip_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前无需操作" in msgs[0]

    async def test_announce_in_wrong_phase_replies_type_mismatch(
        self, env_with_pending
    ) -> None:
        # strikeSelect pending → .announce should be rejected.
        pa = PendingAction(type="strikeSelect", strikeUids=["s1"])
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_announce_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前不可此操作" in msgs[0]

    async def test_discard_in_strike_move_phase_replies_type_mismatch(
        self, env_with_pending
    ) -> None:
        pa = PendingAction(type="strikeMove", strikeUid="s1")
        bot, ws, pool, mgr, store, settings = env_with_pending(pa)

        await handle_discard_request(
            bot=bot, user_id=QQ, raw_args="1",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前不可此操作" in msgs[0]
