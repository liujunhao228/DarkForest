"""Tests for commands/action.py — .play/.deploy/.strike/.broadcast/.recycle.

Covers:
- IN_GAME happy path: ws.send called with correct action + data; private reply "已执行".
- Out-of-range hand index → private reply contains "越界" or "当前手牌 N 张"; ws not called.
- Non-numeric argument → private reply contains "用法".
- Non-IN_GAME state → private reply "当前不在对局中"; ws not called.
- Empty cache → private reply "状态未加载"; ws not called.
- WS unavailable → private reply "连接不可用".
- Backend game:error → private reply contains error message.
- .strike with player name → data contains targetPlayerId.
- .strike / .broadcast argument-count / type validation.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.game_action import ActionError
from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.backend.protocol import ClientEvent
from darkforest_bot.backend.view_state import (
    Card,
    PlayerView,
    ViewState,
)
from darkforest_bot.commands.action import (
    handle_broadcast_request,
    handle_deploy_request,
    handle_play_request,
    handle_recycle_request,
    handle_strike_request,
)
from darkforest_bot.config import Settings
from darkforest_bot.session.manager import SessionManager
from darkforest_bot.session.states import SessionState

QQ = 12345


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeWS:
    """Fake WSClient — records subscribe + send invocations."""

    def __init__(self) -> None:
        self.connected: bool = True
        self.player_id: str | None = None
        self.send_calls: list[tuple[ClientEvent, dict[str, Any] | None, str]] = []
        self._handlers: dict[Any, list[Any]] = {}

    def subscribe(self, event: Any, handler: Any) -> Any:
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


class FakePool:
    """Mock WSConnectionPool.get()."""

    def __init__(self, ws: FakeWS | None) -> None:
        self._ws = ws

    def get(self, qq: int) -> FakeWS | None:  # noqa: ARG002 - qq unused
        if self._ws is None:
            return None
        return self._ws if self._ws.connected else None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_card(uid: str = "c1", ctype: str = "broadcast") -> Card:
    return Card(
        uid=uid,
        defId="def_" + uid,
        name="卡_" + uid,
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
    p1_hand: list[Card] | None = None,
    p2_name: str = "Bob",
) -> ViewState:
    if p1_hand is None:
        p1_hand = [_make_card("c1"), _make_card("c2")]
    players = [
        _make_player("p1", name="Alice", position=1, hand=p1_hand),
        _make_player("p2", name=p2_name, color="blue", position=-1, hand=[]),
    ]
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
    )


def _setup_in_game(
    mgr: SessionManager, store: GameSessionStore, vs: ViewState
) -> None:
    """Transition QQ to IN_GAME and pre-populate the cache with vs."""

    async def _setup() -> None:
        async with mgr.acquire(QQ):
            mgr.transition(QQ, SessionState.MATCHMAKING)
            mgr.transition(QQ, SessionState.IN_ROOM)
            mgr.transition(QQ, SessionState.IN_GAME)
        sess = store.get_or_create(QQ)
        sess.view_state = vs

    import asyncio

    asyncio.run(_setup())


def _private_calls(bot: AsyncMock) -> list[Any]:
    return [c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"]


def _private_messages(bot: AsyncMock) -> list[Any]:
    return [c.kwargs["message"] for c in _private_calls(bot)]


def _game_action_calls(ws: FakeWS) -> list[tuple[str, dict[str, Any]]]:
    """Return [(action, data), ...] for every GAME_ACTION sent."""
    out = []
    for event, payload, _ in ws.send_calls:
        if event != ClientEvent.GAME_ACTION:
            continue
        assert payload is not None
        out.append((payload["action"], payload["data"]))
    return out


@pytest.fixture()
def in_game_env():
    """Yield (bot, ws, pool, mgr, store, settings) with QQ in IN_GAME + cache."""
    bot = AsyncMock()
    ws = FakeWS()
    pool = FakePool(ws)
    mgr = SessionManager()
    store = GameSessionStore()
    settings = Settings(action_error_timeout=0.05, render_canvas_size=200)
    vs = _make_view_state()
    _setup_in_game(mgr, store, vs)
    return bot, ws, pool, mgr, store, settings


# ---------------------------------------------------------------------------
# .play
# ---------------------------------------------------------------------------


class TestPlayCommand:
    async def test_play_happy_path_sends_action_and_replies(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_play_request(
            bot=bot,
            user_id=QQ,
            raw_args="1",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("playCard", {"cardUid": "c1"})]
        msgs = _private_messages(bot)
        assert msgs == ["已执行"]

    async def test_play_out_of_range_replies_error_no_send(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_play_request(
            bot=bot,
            user_id=QQ,
            raw_args="3",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "越界" in msgs[0] or "当前手牌 2 张" in msgs[0]

    async def test_play_non_numeric_arg_replies_usage(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_play_request(
            bot=bot,
            user_id=QQ,
            raw_args="abc",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_play_when_not_in_game_replies_state_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        # Force session out of IN_GAME.

        async def _reset() -> None:
            async with mgr.acquire(QQ):
                mgr.clear(QQ)

        await _reset()

        await handle_play_request(
            bot=bot,
            user_id=QQ,
            raw_args="1",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前不在对局中" in msgs[0]

    async def test_play_action_error_replies_failure_message(
        self, in_game_env, monkeypatch
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        async def fake_send_game_action(
            ws_arg: Any,  # noqa: ARG001 - unused
            action: str,
            data: dict[str, Any],  # noqa: ARG001 - unused
            *,
            timeout: float = 2.0,  # noqa: ARG001 - unused
        ) -> ActionError:
            return ActionError(code="INVALID", message="能量不足")

        import darkforest_bot.commands.action as action_mod

        monkeypatch.setattr(action_mod, "send_game_action", fake_send_game_action)

        await handle_play_request(
            bot=bot,
            user_id=QQ,
            raw_args="1",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        # ws.send was NOT called because we monkeypatched send_game_action.
        # But the reply should mention the error.
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "能量不足" in msgs[0]

    async def test_play_no_ws_replies_connection_error(self, in_game_env) -> None:
        bot, _ws, _pool, mgr, store, settings = in_game_env
        # Pool returns None → ws unavailable.
        pool = FakePool(None)

        await handle_play_request(
            bot=bot,
            user_id=QQ,
            raw_args="1",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "连接不可用" in msgs[0]


# ---------------------------------------------------------------------------
# .deploy / .recycle share the .play path
# ---------------------------------------------------------------------------


class TestDeployRecycle:
    async def test_deploy_sends_deploy_card_action(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_deploy_request(
            bot=bot,
            user_id=QQ,
            raw_args="2",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("deployCard", {"cardUid": "c2"})]

    async def test_recycle_sends_recycle_card_action(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_recycle_request(
            bot=bot,
            user_id=QQ,
            raw_args="1",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("recycleCard", {"cardUid": "c1"})]


# ---------------------------------------------------------------------------
# .strike
# ---------------------------------------------------------------------------


class TestStrikeCommand:
    async def test_strike_without_player_name(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert len(actions) == 1
        action, data = actions[0]
        assert action == "strike"
        assert data == {"cardUid": "c1", "targetSystem": 5}

    async def test_strike_with_opponent_player_name(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5 Bob",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert len(actions) == 1
        action, data = actions[0]
        assert action == "strike"
        assert data["cardUid"] == "c1"
        assert data["targetSystem"] == 5
        assert data["targetPlayerId"] == "p2"

    async def test_strike_with_self_player_name(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5 Alice",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert len(actions) == 1
        action, data = actions[0]
        assert action == "strike"
        assert data["targetPlayerId"] == "p1"

    async def test_strike_missing_args_replies_usage(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_strike_unknown_player_replies_resolve_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5 Charlie",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "未找到" in msgs[0] or "Charlie" in msgs[0]


# ---------------------------------------------------------------------------
# .broadcast
# ---------------------------------------------------------------------------


class TestBroadcastCommand:
    async def test_broadcast_sends_action(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_broadcast_request(
            bot=bot,
            user_id=QQ,
            raw_args="2 3",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("broadcast", {"cardUid": "c2", "targetSystem": 3})]

    async def test_broadcast_missing_args_replies_usage(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_broadcast_request(
            bot=bot,
            user_id=QQ,
            raw_args="2",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]


# ---------------------------------------------------------------------------
# Cache miss
# ---------------------------------------------------------------------------


class TestCacheMiss:
    async def test_play_with_empty_cache_replies_state_not_loaded(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        # Clear the cache.
        sess = store.get_or_create(QQ)
        sess.view_state = None

        await handle_play_request(
            bot=bot,
            user_id=QQ,
            raw_args="1",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "状态未加载" in msgs[0]
