"""Tests for commands/broadcast.py — .agree / .refuse / .select / .bcancel."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.backend.protocol import ClientEvent
from darkforest_bot.backend.view_state import (
    BroadcastResponseView,
    BroadcastStateView,
    Card,
    PlayerView,
    ViewState,
)
from darkforest_bot.commands.broadcast import (
    handle_agree_request,
    handle_bcancel_request,
    handle_refuse_request,
    handle_select_request,
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


def _make_card(uid: str = "c1") -> Card:
    return Card(
        uid=uid,
        defId="def_" + uid,
        name="卡_" + uid,
        type="broadcast",
        energy=2,
        description="",
        image="",
    )


def _make_player(pid: str, name: str, hand: list[Card] | None = None) -> PlayerView:
    return PlayerView(
        id=pid,
        name=name,
        color="red" if pid == "p1" else "blue",
        position=1 if pid == "p1" else -1,
        energy=3,
        handCount=len(hand or []),
        hand=hand or [],
        faceUpCards=[],
        eliminated=False,
    )


def _make_broadcast(
    *,
    broadcaster_id: str = "p2",
    responder_id: str = "p1",
    responder_name: str = "Alice",
    must_respond: bool = True,
    responded: bool = False,
) -> BroadcastStateView:
    return BroadcastStateView(
        broadcasterId=broadcaster_id,
        cardUid="bc",
        targetSystem=1,
        range=1,
        responses=[
            BroadcastResponseView(
                playerId=responder_id,
                playerName=responder_name,
                canRespond=True,
                mustRespond=must_respond,
                responded=responded,
                agreed=False,
            )
        ],
        phase="waiting",
    )


def _make_view_state(
    *,
    broadcast: BroadcastStateView | None = None,
) -> ViewState:
    players = [
        _make_player("p1", "Alice", hand=[_make_card("c1"), _make_card("c2")]),
        _make_player("p2", "Bob", hand=[]),
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
        broadcast=broadcast,
    )


def _setup_in_game(
    mgr: SessionManager, store: GameSessionStore, vs: ViewState
) -> None:
    import asyncio

    async def _setup() -> None:
        async with mgr.acquire(QQ):
            mgr.transition(QQ, SessionState.MATCHMAKING)
            mgr.transition(QQ, SessionState.IN_ROOM)
            mgr.transition(QQ, SessionState.IN_GAME)
        sess = store.get_or_create(QQ)
        sess.view_state = vs

    asyncio.run(_setup())


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
def in_game_env():
    """Yield (bot, ws, pool, mgr, store, settings) with QQ in IN_GAME + cache."""
    bot = AsyncMock()
    ws = FakeWS()
    pool = FakePool(ws)
    mgr = SessionManager()
    store = GameSessionStore()
    settings = Settings(action_error_timeout=0.05, render_canvas_size=200)
    vs = _make_view_state(broadcast=_make_broadcast())
    _setup_in_game(mgr, store, vs)
    return bot, ws, pool, mgr, store, settings


# ---------------------------------------------------------------------------
# .agree
# ---------------------------------------------------------------------------


class TestAgreeCommand:
    async def test_agree_sends_respond_broadcast_agreed_true_with_card_uid(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_agree_request(
            bot=bot,
            user_id=QQ,
            raw_args="1",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            ("respondBroadcast", {"agreed": True, "cardUid": "c1"})
        ]
        assert _private_messages(bot) == ["已执行"]

    async def test_agree_without_args_replies_usage(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_agree_request(
            bot=bot,
            user_id=QQ,
            raw_args="",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_agree_with_non_broadcast_card_replies_type_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        # 本地玩家手牌换成非广播牌，验证类型校验。
        strike_card = Card(
            uid="c1",
            defId="def_c1",
            name="卡_c1",
            type="strike",
            energy=2,
            description="",
            image="",
        )
        local = _make_player("p1", "Alice", hand=[strike_card])
        base = _make_view_state(broadcast=_make_broadcast())
        vs = base.model_copy(update={"players": [local, base.players[1]]})
        store.get_or_create(QQ).view_state = vs

        await handle_agree_request(
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
        assert "不能用于 .agree" in msgs[0]


# ---------------------------------------------------------------------------
# .refuse
# ---------------------------------------------------------------------------


class TestRefuseCommand:
    async def test_refuse_without_card(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_refuse_request(
            bot=bot,
            user_id=QQ,
            raw_args="",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("respondBroadcast", {"agreed": False})]


# ---------------------------------------------------------------------------
# .select
# ---------------------------------------------------------------------------


class TestSelectCommand:
    async def test_select_with_responder_name(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_select_request(
            bot=bot,
            user_id=QQ,
            raw_args="Alice",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            ("selectBroadcastResponder", {"responderId": "p1"})
        ]

    async def test_select_with_no_args_replies_usage(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_select_request(
            bot=bot,
            user_id=QQ,
            raw_args="",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_select_with_unknown_name_replies_resolve_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_select_request(
            bot=bot,
            user_id=QQ,
            raw_args="Charlie",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "未找到响应者" in msgs[0]


# ---------------------------------------------------------------------------
# .bcancel
# ---------------------------------------------------------------------------


class TestBcancelCommand:
    async def test_bcancel_sends_cancel_broadcast(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_bcancel_request(
            bot=bot,
            user_id=QQ,
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("cancelBroadcast", {})]


# ---------------------------------------------------------------------------
# State / cache validation
# ---------------------------------------------------------------------------


class TestStateValidation:
    async def test_not_in_game_replies_state_error(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        # Force out of IN_GAME.
        async def _reset() -> None:
            async with mgr.acquire(QQ):
                mgr.clear(QQ)

        await _reset()

        await handle_agree_request(
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
        assert "不在" in msgs[0]

    async def test_select_with_no_broadcast_replies_resolve_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        # Replace vs with one that has no broadcast.
        vs_no_bc = _make_view_state(broadcast=None)
        store.get_or_create(QQ).view_state = vs_no_bc

        await handle_select_request(
            bot=bot,
            user_id=QQ,
            raw_args="Alice",
            session_manager=mgr,
            game_session_store=store,
            pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "无广播" in msgs[0]
