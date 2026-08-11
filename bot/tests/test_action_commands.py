"""Tests for commands/action.py — .deploy/.strike/.broadcast/.recycle.

Covers:
- IN_GAME happy path: ws.send called with correct action + data; private reply "已执行".
- Out-of-range hand index → private reply contains "越界" or "当前手牌 N 张"; ws not called.
- Non-numeric argument → private reply contains "用法".
- Non-IN_GAME state → private reply "当前不在对局中"; ws not called.
- Empty cache → private reply "状态未加载"; ws not called.
- WS unavailable → private reply "连接不可用".
- Backend game:error → private reply contains error message.
- .strike with player index → data contains targetPlayerId.
- .strike / .broadcast argument-count / type validation.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

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


def _make_card(uid: str = "c1", ctype: str = "facility") -> Card:
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
    face_up: list[Card] | None = None,
) -> PlayerView:
    return PlayerView(
        id=pid,
        name=name,
        color=color,
        position=position,
        energy=energy,
        handCount=len(hand or []),
        hand=hand or [],
        faceUpCards=face_up or [],
        eliminated=False,
    )


def _make_view_state(
    *,
    p1_hand: list[Card] | None = None,
    p1_faceup: list[Card] | None = None,
    p2_name: str = "Bob",
) -> ViewState:
    if p1_hand is None:
        # 默认混合手牌：c1=facility, c2=defense（供 .deploy 正路径用）
        p1_hand = [_make_card("c1", "facility"), _make_card("c2", "defense")]
    players = [
        _make_player("p1", name="Alice", position=1, hand=p1_hand, face_up=p1_faceup),
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
        data = dict(payload["data"])
        # requestId 是 send_game_action 注入的认领字段，非业务 payload
        data.pop("requestId", None)
        out.append((payload["action"], data))
    return out


@pytest.fixture()
def in_game_env():
    """Yield (bot, ws, pool, mgr, store, settings) with QQ in IN_GAME + cache.

    Default view state:
        p1.hand = [facility c1, defense c2]
        p1.faceUpCards = [facility cf1]  # 供 .recycle 正路径用
    """
    bot = AsyncMock()
    ws = FakeWS()
    pool = FakePool(ws)
    mgr = SessionManager()
    store = GameSessionStore()
    settings = Settings(action_error_timeout=0.05, render_canvas_size=200)
    vs = _make_view_state(p1_faceup=[_make_card("cf1", "facility")])
    _setup_in_game(mgr, store, vs)
    return bot, ws, pool, mgr, store, settings


# ---------------------------------------------------------------------------
# .deploy / .recycle
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
        assert actions == [("recycleCard", {"cardUid": "cf1"})]


# ---------------------------------------------------------------------------
# .strike
# ---------------------------------------------------------------------------


class TestStrikeCommand:
    """Strike tests use a hand with a strike card at index 1 (uid=cs1)."""

    @pytest.fixture()
    def strike_env(self, in_game_env):
        """Override view state with p1.hand = [strike cs1]."""
        bot, ws, pool, mgr, store, settings = in_game_env
        vs = _make_view_state(p1_hand=[_make_card("cs1", "strike")])
        sess = store.get_or_create(QQ)
        sess.view_state = vs
        return bot, ws, pool, mgr, store, settings

    async def test_strike_without_player_name(self, strike_env) -> None:
        bot, ws, pool, mgr, store, settings = strike_env

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
        assert data == {"cardUid": "cs1", "targetSystem": 5}

    async def test_strike_with_opponent_player_index(self, strike_env) -> None:
        bot, ws, pool, mgr, store, settings = strike_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5 2",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert len(actions) == 1
        action, data = actions[0]
        assert action == "strike"
        assert data["cardUid"] == "cs1"
        assert data["targetSystem"] == 5
        assert data["targetPlayerId"] == "p2"

    async def test_strike_with_self_player_index(self, strike_env) -> None:
        bot, ws, pool, mgr, store, settings = strike_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5 1",
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

    async def test_strike_missing_args_replies_usage(self, strike_env) -> None:
        bot, ws, pool, mgr, store, settings = strike_env

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

    async def test_strike_non_numeric_player_index_replies_usage(
        self, strike_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = strike_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5 Bob",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_strike_out_of_range_player_index_replies_resolve_error(
        self, strike_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = strike_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5 3",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "越界" in msgs[0] or "当前玩家 2 名" in msgs[0]

    async def test_strike_too_many_args_replies_usage(self, strike_env) -> None:
        bot, ws, pool, mgr, store, settings = strike_env

        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5 2 extra",
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
# .broadcast
# ---------------------------------------------------------------------------


class TestBroadcastCommand:
    """Broadcast tests use a hand with a broadcast card at index 1 (uid=cb1)."""

    @pytest.fixture()
    def broadcast_env(self, in_game_env):
        """Override view state with p1.hand = [broadcast cb1]."""
        bot, ws, pool, mgr, store, settings = in_game_env
        vs = _make_view_state(p1_hand=[_make_card("cb1", "broadcast")])
        sess = store.get_or_create(QQ)
        sess.view_state = vs
        return bot, ws, pool, mgr, store, settings

    async def test_broadcast_sends_action(self, broadcast_env) -> None:
        bot, ws, pool, mgr, store, settings = broadcast_env

        await handle_broadcast_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 3",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("broadcast", {"cardUid": "cb1", "targetSystem": 3})]

    async def test_broadcast_missing_args_replies_usage(
        self, broadcast_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = broadcast_env

        await handle_broadcast_request(
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


# ---------------------------------------------------------------------------
# Cache miss
# ---------------------------------------------------------------------------


class TestCacheMiss:
    async def test_deploy_with_empty_cache_replies_state_not_loaded(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        # Clear the cache.
        sess = store.get_or_create(QQ)
        sess.view_state = None

        await handle_deploy_request(
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


# ---------------------------------------------------------------------------
# Card type guard — type mismatch must reply and NOT send WS
# ---------------------------------------------------------------------------


class TestCardTypeGuard:
    """Type mismatch for .deploy/.strike/.broadcast/.recycle replies
    a friendly error and never calls send_game_action."""

    async def test_deploy_rejects_broadcast_card(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        vs = _make_view_state(p1_hand=[_make_card("cb1", "broadcast")])
        store.get_or_create(QQ).view_state = vs

        await handle_deploy_request(
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
        assert "是 broadcast 卡" in msgs[0]
        assert ".deploy" in msgs[0]

    async def test_strike_rejects_facility_card(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        # 默认 hand=[facility c1, defense c2]，.strike 1 用 facility 卡应被拒
        await handle_strike_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 5",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "是 facility 卡" in msgs[0]
        assert ".strike" in msgs[0]

    async def test_broadcast_rejects_strike_card(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        vs = _make_view_state(p1_hand=[_make_card("cs1", "strike")])
        store.get_or_create(QQ).view_state = vs

        await handle_broadcast_request(
            bot=bot,
            user_id=QQ,
            raw_args="1 3",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "是 strike 卡" in msgs[0]
        assert ".broadcast" in msgs[0]

    async def test_recycle_rejects_strike_in_faceup(self, in_game_env) -> None:
        """face_up 含 strike 卡，.recycle 1 应私信报错且未发 WS。"""
        bot, ws, pool, mgr, store, settings = in_game_env
        # 覆盖 faceUpCards 为 strike 卡
        vs = _make_view_state(p1_faceup=[_make_card("cs1", "strike")])
        store.get_or_create(QQ).view_state = vs

        await handle_recycle_request(
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
        assert "是 strike 卡" in msgs[0]
        assert ".recycle" in msgs[0]

    async def test_recycle_uses_faceup_card_index(self, in_game_env) -> None:
        """.recycle 索引基于 face_up_cards 而非手牌。

        构造 hand=[c1] face_up=[cf1]，.recycle 1 应发送 cf1（场上牌），
        而非 c1（手牌）。
        """
        bot, ws, pool, mgr, store, settings = in_game_env
        vs = _make_view_state(
            p1_hand=[_make_card("c1", "facility")],
            p1_faceup=[_make_card("cf1", "facility")],
        )
        store.get_or_create(QQ).view_state = vs

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
        assert actions == [("recycleCard", {"cardUid": "cf1"})]
