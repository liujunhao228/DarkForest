"""Tests for commands/forfeit.py — .forfeit 弃权投降当前对局。"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.game_action import ActionError
from darkforest_bot.backend.protocol import ClientEvent
from darkforest_bot.commands.forfeit import handle_forfeit_request
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


def _setup_in_game(mgr: SessionManager) -> None:
    """通过合法的状态转换路径进入 IN_GAME。"""
    session = mgr.get_or_create(QQ)
    session.state = SessionState.MATCHMAKING
    session.state = SessionState.IN_ROOM
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


@pytest.fixture()
def in_game_env():
    bot = AsyncMock()
    ws = FakeWS()
    pool = FakePool(ws)
    mgr = SessionManager()
    settings = Settings(action_error_timeout=0.05, render_canvas_size=200)
    _setup_in_game(mgr)
    return bot, ws, pool, mgr, settings


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestForfeitCommand:
    async def test_forfeit_in_game_sends_forfeit(self, in_game_env) -> None:
        bot, ws, pool, mgr, settings = in_game_env

        await handle_forfeit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, pool=pool, settings=settings,
        )

        actions = _game_action_calls(ws)
        assert actions == [("forfeit", {})]
        assert _private_messages(bot) == ["已弃权，你已被淘汰"]

    async def test_forfeit_when_not_in_game_replies_state_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, settings = in_game_env

        async def _reset() -> None:
            async with mgr.acquire(QQ):
                mgr.clear(QQ)

        await _reset()

        await handle_forfeit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, pool=pool, settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前不在对局中" in msgs[0]

    async def test_forfeit_in_matchmaking_replies_state_error(
        self, in_game_env
    ) -> None:
        bot, ws, pool, mgr, settings = in_game_env

        # 回退到 MATCHMAKING 状态
        async with mgr.acquire(QQ):
            session = mgr.get_or_create(QQ)
            session.state = SessionState.IN_ROOM
            session.state = SessionState.MATCHMAKING

        await handle_forfeit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, pool=pool, settings=settings,
        )

        assert _game_action_calls(ws) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前不在对局中" in msgs[0]

    async def test_forfeit_with_no_ws_replies_unavailable(self, in_game_env) -> None:
        bot, _ws, _pool, mgr, settings = in_game_env
        pool = FakePool(None)  # 无 WS 连接

        await handle_forfeit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, pool=pool, settings=settings,
        )

        assert _private_messages(bot) == ["连接不可用"]

    async def test_forfeit_action_error_replies_failure_message(
        self, in_game_env, monkeypatch
    ) -> None:
        bot, ws, pool, mgr, settings = in_game_env

        async def fake_send_game_action(
            ws_arg: Any,  # noqa: ARG001 - unused
            action: str,
            data: dict[str, Any],  # noqa: ARG001 - unused
            *,
            timeout: float = 2.0,  # noqa: ARG001 - unused
        ) -> ActionError:
            return ActionError(code="INVALID", message="无法弃权")

        import darkforest_bot.commands.forfeit as forfeit_mod

        monkeypatch.setattr(forfeit_mod, "send_game_action", fake_send_game_action)

        await handle_forfeit_request(
            bot=bot, user_id=QQ,
            session_manager=mgr, pool=pool, settings=settings,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "无法弃权" in msgs[0]
