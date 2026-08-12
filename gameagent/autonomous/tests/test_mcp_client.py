"""mcp_client 单测：FakeTransport 驱动，验证解析与语义封装。"""

from __future__ import annotations

from typing import Any

import pytest

from autonomous_driver.mcp_client import (
    GameEvent,
    GameMCPClient,
    WaitForEventResult,
)


class FakeTransport:
    """可编程 Transport：按工具名返回预设 JSON，记录调用。"""

    def __init__(self, responses: dict[str, Any] | None = None) -> None:
        self.responses: dict[str, Any] = responses or {}
        self.calls: list[tuple[str, dict[str, Any] | None]] = []
        self.connected = False
        self.closed = False

    async def connect(self) -> None:
        self.connected = True

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append((name, arguments))
        if name not in self.responses:
            raise AssertionError(f"未预设工具响应: {name}")
        return self.responses[name]

    async def close(self) -> None:
        self.closed = True


class RaisingTransport:
    """返回 isError 的工具结果（验证错误透传）。"""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def connect(self) -> None:
        pass

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append(name)
        raise ValueError(f"MCP 工具返回错误：boom [{name}]")

    async def close(self) -> None:
        pass


def _transport(responses: dict[str, Any] | None = None) -> FakeTransport:
    return FakeTransport(responses)


@pytest.mark.asyncio
async def test_connect_and_close_propagate_to_transport() -> None:
    t = _transport()
    client = GameMCPClient(t)
    await client.connect()
    assert t.connected
    await client.close()
    assert t.closed


@pytest.mark.asyncio
async def test_call_passes_arguments_through() -> None:
    t = _transport({"get_connection_status": {"wsState": "connected"}})
    client = GameMCPClient(t)
    out = await client.get_connection_status()
    assert out["wsState"] == "connected"
    assert t.calls == [("get_connection_status", None)]


@pytest.mark.asyncio
async def test_join_match_queue_passes_game_mode_and_count() -> None:
    t = _transport({"join_match_queue": {"joined": True}})
    client = GameMCPClient(t)
    out = await client.join_match_queue("civilization_relics", preferred_count=3)
    assert out["joined"] is True
    assert t.calls == [
        ("join_match_queue", {"preferredCount": 3, "gameMode": "civilization_relics"})
    ]


@pytest.mark.asyncio
async def test_wait_for_event_parses_result_and_events() -> None:
    t = _transport(
        {
            "wait_for_event": {
                "hasEvent": True,
                "events": [
                    {
                        "type": "match:found",
                        "timestamp": 1700000000000,
                        "payload": {"roomId": "r1"},
                    },
                ],
                "delta": None,
            }
        }
    )
    client = GameMCPClient(t)
    result = await client.wait_for_event(60)
    assert isinstance(result, WaitForEventResult)
    assert result.has_event is True
    assert t.calls == [("wait_for_event", {"timeoutSeconds": 60})]
    events = result.typed_events()
    assert len(events) == 1
    assert isinstance(events[0], GameEvent)
    assert events[0].type == "match:found"
    assert events[0].payload == {"roomId": "r1"}


@pytest.mark.asyncio
async def test_wait_for_event_timeout_returns_no_event() -> None:
    t = _transport({"wait_for_event": {"hasEvent": False}})
    client = GameMCPClient(t)
    result = await client.wait_for_event(30)
    assert result.has_event is False
    assert result.typed_events() == []


@pytest.mark.asyncio
async def test_wait_for_event_events_null_coerced_to_empty() -> None:
    # Go 端空切片序列化为 null，必须规整为 []
    t = _transport({"wait_for_event": {"hasEvent": False, "events": None, "delta": None}})
    client = GameMCPClient(t)
    result = await client.wait_for_event(30)
    assert result.events == []
    assert result.typed_events() == []


@pytest.mark.asyncio
async def test_action_helpers_build_arguments() -> None:
    t = _transport(
        {
            "play_card": {"success": True},
            "deploy_card": {"success": True},
            "strike": {"success": True},
            "broadcast": {"success": True},
            "end_turn": {"success": True},
        }
    )
    client = GameMCPClient(t)
    await client.play_card("card-1")
    await client.deploy_card("card-0")
    await client.strike("card-2", target_system=5)
    await client.broadcast("card-8", target_system=4)
    await client.end_turn(discard_cards=["card-9"])
    assert t.calls == [
        ("play_card", {"cardUid": "card-1"}),
        ("deploy_card", {"cardUid": "card-0"}),
        ("strike", {"cardUid": "card-2", "targetSystem": 5}),
        ("broadcast", {"cardUid": "card-8", "targetSystem": 4}),
        ("end_turn", {"discardCards": ["card-9"]}),
    ]


@pytest.mark.asyncio
async def test_rejoin_room_empty_room_id_sends_no_args() -> None:
    t = _transport({"rejoin_room": {"rejoined": True, "roomId": "r9"}})
    client = GameMCPClient(t)
    out = await client.rejoin_room()
    assert out["rejoined"] is True
    assert t.calls == [("rejoin_room", {})]


@pytest.mark.asyncio
async def test_transport_error_propagates() -> None:
    t = RaisingTransport()
    client = GameMCPClient(t)
    with pytest.raises(ValueError, match="boom"):
        await client.get_agent_view()
