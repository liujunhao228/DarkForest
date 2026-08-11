"""Tests for commands/end.py — .end [priv] [手牌序号...]."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.game_action import ActionError
from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.backend.protocol import ClientEvent
from darkforest_bot.backend.view_state import Card, PlayerView, ViewState
from darkforest_bot.commands.end import handle_end_request
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


def _make_card(uid: str) -> Card:
    return Card(
        uid=uid,
        defId="def_" + uid,
        name="卡_" + uid,
        type="broadcast",
        energy=2,
        description="",
        image="",
    )


def _make_view_state() -> ViewState:
    players = [
        PlayerView(
            id="p1",
            name="Alice",
            color="red",
            position=1,
            energy=3,
            handCount=3,
            hand=[_make_card("c1"), _make_card("c2"), _make_card("c3")],
            faceUpCards=[],
            eliminated=False,
        ),
        PlayerView(
            id="p2",
            name="Bob",
            color="blue",
            position=-1,
            energy=2,
            handCount=0,
            hand=[],
            faceUpCards=[],
            eliminated=False,
        ),
    ]
    return ViewState(
        phase="playing",
        totalTurn=3,
        playerCount=2,
        players=players,
        currentPlayerIndex=0,
        currentPlayerId="p1",
        localPlayerId="p1",
        turnPhase="actionPhase",
        _viewMeta={"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
    )


def _setup_in_game(mgr: SessionManager, store: GameSessionStore) -> None:
    session = mgr.get_or_create(QQ)
    session.state = SessionState.MATCHMAKING
    session.state = SessionState.IN_ROOM
    session.state = SessionState.IN_GAME
    sess = store.get_or_create(QQ)
    sess.view_state = _make_view_state()


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
        data = dict(payload["data"])
        # requestId 是 send_game_action 注入的认领字段，非业务 payload
        data.pop("requestId", None)
        out.append((payload["action"], data))
    return out


@pytest.fixture()
def in_game_env():
    bot = AsyncMock()
    ws = FakeWS()
    pool = FakePool(ws)
    mgr = SessionManager()
    store = GameSessionStore()
    settings = Settings(action_error_timeout=0.05, render_canvas_size=200)
    _setup_in_game(mgr, store)
    return bot, ws, pool, mgr, store, settings


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestEndCommand:
    async def test_end_no_args(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            ("endTurn", {"discardCards": [], "publicDiscard": True})
        ]
        assert _private_messages(bot) == ["已执行"]

    async def test_end_with_card_indices(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="1 3",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            (
                "endTurn",
                {"discardCards": ["c1", "c3"], "publicDiscard": True},
            )
        ]

    async def test_end_priv_with_card_indices(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="priv 1 3",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            (
                "endTurn",
                {"discardCards": ["c1", "c3"], "publicDiscard": False},
            )
        ]

    async def test_end_priv_no_cards(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="priv",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [
            ("endTurn", {"discardCards": [], "publicDiscard": False})
        ]

    async def test_end_out_of_range_index_replies_error_no_send(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="5",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "越界" in msgs[0] or "当前手牌 3 张" in msgs[0]

    async def test_end_non_numeric_arg_replies_usage(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="abc",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_end_mixed_numeric_and_non_numeric_replies_usage(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="1 abc",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_end_when_not_in_game_replies_state_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        async def _reset() -> None:
            async with mgr.acquire(QQ):
                mgr.clear(QQ)

        await _reset()

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前不在对局中" in msgs[0]

    async def test_end_action_error_replies_failure_message(
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
            return ActionError(code="INVALID", message="无法结束回合")

        import darkforest_bot.commands.end as end_mod

        monkeypatch.setattr(end_mod, "send_game_action", fake_send_game_action)

        await handle_end_request(
            bot=bot, user_id=QQ, raw_args="",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "无法结束回合" in msgs[0]
