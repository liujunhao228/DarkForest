"""finish_game 单测：权威终局视图 → game_ended 上报。

覆盖：gameOver 为空（对局未结束）拒绝；gameOver 非空构造 game_ended 经
agent_message.send 上报；agent_message 缺失/抛异常兜底返回 ok:false。
"""

from __future__ import annotations

import sys
import types
from typing import Any
from unittest.mock import AsyncMock

import pytest

import darkforest
from darkforest.mcp_client import DarkForestMCPClient


class GameOverTransport:
    """按 get_agent_view 返回预置视图的 Fake Transport。"""

    def __init__(self, view: dict[str, Any]) -> None:
        self.view = view
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    async def connect(self) -> None:
        pass

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        self.calls.append((name, arguments))
        if name == "get_agent_view":
            return self.view
        return {}

    async def list_tools(self) -> list[str]:
        return []

    async def close(self) -> None:
        pass


def make_client(fake: GameOverTransport) -> DarkForestMCPClient:
    client = DarkForestMCPClient("http://localhost:9090/mcp", "ai1")
    client._transport = fake  # noqa: SLF001  注入 Fake 以替代 HTTPTransport
    return client


def inject_agent_message(send: AsyncMock) -> types.ModuleType:
    mod = types.ModuleType("agent_message")
    mod.send = send
    sys.modules["agent_message"] = mod
    return mod


@pytest.fixture(autouse=True)
def _reset_state() -> None:
    yield
    darkforest._client = None  # noqa: SLF001
    sys.modules.pop("agent_message", None)


@pytest.mark.asyncio
async def test_finish_game_rejects_when_not_over() -> None:
    fake = GameOverTransport({"inGame": False})
    darkforest._client = make_client(fake)  # noqa: SLF001

    out = await darkforest.finish_game(memories_created=2)

    assert out == {"ok": False, "reason": "对局未结束"}
    assert fake.calls == [("get_agent_view", None)]


@pytest.mark.asyncio
async def test_finish_game_reports_game_ended() -> None:
    view = {
        "inGame": False,
        "gameOver": {
            "result": "win",
            "replayId": "rp-1",
            "winner": "ai1",
            "totalTurn": 12,
            "eliminated": [],
        },
    }
    fake = GameOverTransport(view)
    darkforest._client = make_client(fake)  # noqa: SLF001
    send = AsyncMock()
    inject_agent_message(send)

    out = await darkforest.finish_game(memories_created=3)

    assert out == {
        "ok": True,
        "result": "win",
        "matchId": "rp-1",
        "memories_created": 3,
    }
    send.assert_awaited_once()
    call = send.await_args
    assert call is not None
    assert call.kwargs.get("receiver_role") == "parent"
    import json

    payload = json.loads(call.args[0])
    assert payload == {
        "event": "game_ended",
        "matchId": "rp-1",
        "result": "win",
        "memories_created": 3,
    }


@pytest.mark.asyncio
async def test_finish_game_ok_false_when_agent_message_missing() -> None:
    view = {"inGame": False, "gameOver": {"result": "loss", "replayId": "rp-2"}}
    fake = GameOverTransport(view)
    darkforest._client = make_client(fake)  # noqa: SLF001
    # 不注入 agent_message：内核模块缺失 → ImportError 兜底

    out = await darkforest.finish_game()

    assert out["ok"] is False
    assert "agent_message" in out["reason"]


@pytest.mark.asyncio
async def test_finish_game_ok_false_when_send_raises() -> None:
    view = {"inGame": False, "gameOver": {"result": "draw"}}
    fake = GameOverTransport(view)
    darkforest._client = make_client(fake)  # noqa: SLF001
    send = AsyncMock(side_effect=RuntimeError("网络中断"))
    inject_agent_message(send)

    out = await darkforest.finish_game()

    assert out["ok"] is False
    assert "网络中断" in out["reason"]


@pytest.mark.asyncio
async def test_finish_game_empty_match_id_falls_back_to_empty_string() -> None:
    view = {"inGame": False, "gameOver": {"result": "draw"}}
    fake = GameOverTransport(view)
    darkforest._client = make_client(fake)  # noqa: SLF001
    send = AsyncMock()
    inject_agent_message(send)

    out = await darkforest.finish_game()

    assert out["ok"] is True
    assert out["matchId"] == ""
    payload = send.await_args.args[0]
    import json

    assert json.loads(payload)["matchId"] == ""
