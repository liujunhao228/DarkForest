"""Tests for commands/jump.py — .jump <星系> [携带能量] [消息]."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.backend.protocol import ClientEvent
from darkforest_bot.backend.view_state import Card, PlayerView, ViewState
from darkforest_bot.commands.jump import handle_jump_request
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


def _make_view_state() -> ViewState:
    players = [
        PlayerView(
            id="p1",
            name="Alice",
            color="red",
            position=1,
            energy=3,
            handCount=1,
            hand=[
                Card(
                    uid="c1",
                    defId="d1",
                    name="卡1",
                    type="broadcast",
                    energy=2,
                    description="",
                    image="",
                )
            ],
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


class TestJumpCommand:
    async def test_jump_target_only(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_jump_request(
            bot=bot, user_id=QQ, raw_args="5",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert len(actions) == 1
        action, data = actions[0]
        assert action == "lightspeedShip"
        assert data == {
            "targetSystem": 5,
            "carryEnergy": 0,
            "message": "",
            "leaveBehind": False,
            "broadcastOnInherit": None,
        }
        assert _private_messages(bot) == ["已执行"]

    async def test_jump_with_carry_energy(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_jump_request(
            bot=bot, user_id=QQ, raw_args="5 3",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert len(actions) == 1
        _, data = actions[0]
        assert data["carryEnergy"] == 3
        assert data["message"] == ""

    async def test_jump_with_carry_energy_and_message(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_jump_request(
            bot=bot, user_id=QQ, raw_args="5 3 hello world",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert len(actions) == 1
        _, data = actions[0]
        assert data["carryEnergy"] == 3
        assert data["message"] == "hello world"

    async def test_jump_non_numeric_carry_picks_up_as_message(
        self, in_game_env
    ) -> None:
        """tokens[1] is non-numeric → carryEnergy stays 0, message picks up
        all tokens[1:] (including tokens[1] itself)."""
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_jump_request(
            bot=bot, user_id=QQ, raw_args="5 hello",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        actions = _game_action_calls(ws)
        assert len(actions) == 1
        _, data = actions[0]
        assert data["targetSystem"] == 5
        assert data["carryEnergy"] == 0
        assert data["message"] == "hello"

    async def test_jump_no_args_replies_usage(self, in_game_env) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_jump_request(
            bot=bot, user_id=QQ, raw_args="",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_jump_non_numeric_target_replies_usage(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_jump_request(
            bot=bot, user_id=QQ, raw_args="abc",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "用法" in msgs[0]

    async def test_jump_when_not_in_game_replies_state_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env
        async def _reset() -> None:
            async with mgr.acquire(QQ):
                mgr.clear(QQ)

        await _reset()

        await handle_jump_request(
            bot=bot, user_id=QQ, raw_args="5",
            session_manager=mgr, game_session_store=store, pool=pool,
            settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前不在对局中" in msgs[0]
