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


# --- HTTPTransport headers（X-Agent-Sid 绑定）测试 ---


def _mock_stream_http_client() -> tuple[Any, Any, Any]:
    """把 streamable_http_client + ClientSession mock 成三元组/二元组异步 CM。"""
    from unittest.mock import AsyncMock, patch

    mock_shc = patch("autonomous_driver.mcp_client.streamable_http_client")
    mock = mock_shc.start()
    cm = AsyncMock()
    cm.__aenter__.return_value = ("read", "write")
    mock.return_value = cm

    mock_cs = patch("autonomous_driver.mcp_client.ClientSession")
    mock_cs_fn = mock_cs.start()
    session_cm = AsyncMock()
    session_cm.__aenter__.return_value = AsyncMock()
    mock_cs_fn.return_value = session_cm
    return mock_shc, mock, mock_cs


def test_http_transport_headers_constructs_http_client() -> None:
    """带 headers 时自建携带该 header 的 httpx2 client 并经 http_client= 传入 SDK。"""
    import asyncio

    import httpx2

    from autonomous_driver.mcp_client import HTTPTransport

    transport = HTTPTransport("http://localhost:9090/mcp", headers={"X-Agent-Sid": "ai1"})
    assert transport._headers == {"X-Agent-Sid": "ai1"}  # noqa: SLF001

    mock_shc, mock, mock_cs = _mock_stream_http_client()
    try:
        asyncio.run(transport.connect())
    finally:
        mock_shc.stop()
        mock_cs.stop()

    kwargs = mock.call_args.kwargs
    assert kwargs.get("terminate_on_close") is True, "必须显式 terminate_on_close=True"
    client = kwargs.get("http_client")
    assert isinstance(client, httpx2.AsyncClient), "http_client 应为自建 httpx2 client"
    assert client.headers.get("X-Agent-Sid") == "ai1", "httpx2 client 应携带 X-Agent-Sid header"


def test_http_transport_without_headers_passes_none_client() -> None:
    """无 headers 时 http_client 参数为 None（自由借用，向后兼容）。"""
    import asyncio

    from autonomous_driver.mcp_client import HTTPTransport

    transport = HTTPTransport("http://localhost:9090/mcp")
    mock_shc, mock, mock_cs = _mock_stream_http_client()
    try:
        asyncio.run(transport.connect())
    finally:
        mock_shc.stop()
        mock_cs.stop()

    kwargs = mock.call_args.kwargs
    assert kwargs.get("http_client") is None
    assert transport._http_client is None  # noqa: SLF001


def test_http_transport_close_closes_self_created_client() -> None:
    """close 先退出 SDK CM，再显式关闭自建 httpx2 client（防连接泄漏）。"""
    import asyncio

    from autonomous_driver.mcp_client import HTTPTransport

    transport = HTTPTransport("http://localhost:9090/mcp", headers={"X-Agent-Sid": "ai1"})
    mock_shc, _, mock_cs = _mock_stream_http_client()
    try:
        asyncio.run(transport.connect())
    finally:
        mock_shc.stop()
        mock_cs.stop()

    client = transport._http_client  # noqa: SLF001
    assert client is not None and not client.is_closed
    asyncio.run(transport.close())
    assert client.is_closed, "close 后自建 httpx2 client 必须已关闭"
    assert transport._http_client is None  # noqa: SLF001
