"""Tests for commands/exit.py — .exit 弃权并离开房间。"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.game_action import ActionError
from darkforest_bot.backend.protocol import ClientEvent
from darkforest_bot.commands.exit import handle_exit_request
from darkforest_bot.config import Settings
from darkforest_bot.session.manager import SessionManager
from darkforest_bot.session.states import SessionState
from darkforest_bot.state import get_game_session_store

from ._state_helpers import (
    FakePushCallback,
    FakeWS,
    _fire_full_sync,
    _player_dict,
    _start_session,
    make_state_dict,
)

QQ = 12345
ROOM_ID = "room-1"


class FakePool:
    def __init__(self, ws: FakeWS | None) -> None:
        self._ws = ws

    def get(self, qq: int) -> FakeWS | None:  # noqa: ARG002 - qq unused
        if self._ws is None:
            return None
        return self._ws if self._ws.connected else None


def _setup_in_game(mgr: SessionManager) -> None:
    """通过合法的状态转换路径进入 IN_GAME，并记录 room_id。"""
    session = mgr.get_or_create(QQ)
    session.state = SessionState.MATCHMAKING
    session.state = SessionState.IN_ROOM
    session.room_id = ROOM_ID
    session.state = SessionState.IN_GAME


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


def _room_leave_calls(ws: FakeWS) -> list[str | None]:
    return [
        room_id for event, _payload, room_id in ws.send_calls
        if event == ClientEvent.ROOM_LEAVE
    ]


@pytest.fixture()
def in_game_env():
    bot = AsyncMock()
    ws = FakeWS()
    pool = FakePool(ws)
    mgr = SessionManager()
    settings = Settings(action_error_timeout=0.05, render_canvas_size=200)
    _setup_in_game(mgr)
    store = get_game_session_store()
    return bot, ws, pool, mgr, store, settings


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestExitCommand:
    async def test_exit_in_game_forfeits_and_leaves_room(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        await handle_exit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store,
            pool=pool, settings=settings,
        )

        assert _game_action_calls(ws) == [("forfeit", {})]
        assert _room_leave_calls(ws) == [ROOM_ID]
        assert ws.connected  # 离开房间后保留 WS 连接

        async with mgr.acquire(QQ):
            session = mgr.get_or_create(QQ)
            assert session.state == SessionState.IDLE
            assert session.room_id is None

        assert _private_messages(bot) == ["已弃权并离开房间"]

    async def test_exit_when_not_in_game_replies_state_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        async with mgr.acquire(QQ):
            mgr.clear(QQ)

        await handle_exit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store,
            pool=pool, settings=settings,
        )

        assert _game_action_calls(ws) == []
        assert _room_leave_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前不在对局中" in msgs[0]

    async def test_exit_with_no_ws_replies_unavailable(self, in_game_env) -> None:
        bot, _ws, _pool, mgr, store, settings = in_game_env
        pool = FakePool(None)  # 无 WS 连接

        await handle_exit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store,
            pool=pool, settings=settings,
        )

        assert _private_messages(bot) == ["连接不可用"]

    async def test_exit_action_error_not_eliminated_aborts(
        self, in_game_env, monkeypatch
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        async def fake_send_forfeit_action(
            ws_arg: Any,  # noqa: ARG001 - unused
            settings_arg: Settings,  # noqa: ARG001 - unused
        ) -> ActionError:
            return ActionError(code="INVALID", message="无法弃权")

        import darkforest_bot.commands.exit as exit_mod

        monkeypatch.setattr(
            exit_mod, "send_forfeit_action", fake_send_forfeit_action
        )

        await handle_exit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store,
            pool=pool, settings=settings,
        )

        # 未淘汰 → 中止：不发 ROOM_LEAVE，状态保持 IN_GAME。
        assert _room_leave_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "无法弃权" in msgs[0]

        async with mgr.acquire(QQ):
            session = mgr.get_or_create(QQ)
            assert session.state == SessionState.IN_GAME
            assert session.room_id == ROOM_ID

    async def test_exit_action_error_eliminated_still_leaves(
        self, in_game_env, monkeypatch
    ) -> None:
        bot, ws, pool, mgr, store, settings = in_game_env

        # 缓存中本地玩家已淘汰。
        await _start_session(store, ws, FakePushCallback(), FakePushCallback())
        state = make_state_dict(
            local_player_id="p1",
            players=[
                {**_player_dict("p1", "Alice"), "eliminated": True},
                _player_dict("p2", "Bob"),
            ],
        )
        await _fire_full_sync(ws, state)

        async def fake_send_forfeit_action(
            ws_arg: Any,  # noqa: ARG001 - unused
            settings_arg: Settings,  # noqa: ARG001 - unused
        ) -> ActionError:
            return ActionError(code="INVALID", message="无法弃权")

        import darkforest_bot.commands.exit as exit_mod

        monkeypatch.setattr(
            exit_mod, "send_forfeit_action", fake_send_forfeit_action
        )

        await handle_exit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, game_session_store=store,
            pool=pool, settings=settings,
        )

        # 已淘汰视为成功 → 仍离开房间。
        assert _room_leave_calls(ws) == [ROOM_ID]
        assert ws.connected  # 保留 WS 连接
        assert _private_messages(bot) == ["你已离开房间"]

        async with mgr.acquire(QQ):
            session = mgr.get_or_create(QQ)
            assert session.state == SessionState.IDLE
            assert session.room_id is None
        assert store.get(QQ) is None
