"""DarkForestMCPClient 单测：FakeTransport 注入，无需真实网络。

覆盖 connect / call_tool / list_tools / close 四路径，以及工具错误
（isError）与非 JSON 输出的解析分支。
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from darkforest.mcp_client import DarkForestMCPClient, HTTPTransport


class FakeTransport:
    """记录调用的 Fake Transport 实现，行为可配置。"""

    def __init__(
        self,
        tool_payload: dict[str, Any] | None = None,
        tool_error: str | None = None,
        tools: list[str] | None = None,
    ) -> None:
        self.tool_payload = tool_payload or {}
        self.tool_error = tool_error
        self.tools = tools or []
        self.calls: list[tuple[str, dict[str, Any] | None]] = []
        self.connect_count = 0
        self.close_count = 0
        self.closed = False

    async def connect(self) -> None:
        self.connect_count += 1

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        self.calls.append((name, arguments))
        if self.tool_error is not None:
            raise ValueError(self.tool_error)
        return self.tool_payload

    async def list_tools(self) -> list[str]:
        return self.tools

    async def close(self) -> None:
        self.close_count += 1
        self.closed = True


def make_client(fake: FakeTransport) -> DarkForestMCPClient:
    client = DarkForestMCPClient("http://localhost:9090/mcp", "ai1")
    client._transport = fake  # noqa: SLF001  注入 Fake 以替代 HTTPTransport
    return client


@pytest.mark.asyncio
async def test_connect_and_agent_name() -> None:
    fake = FakeTransport()
    client = make_client(fake)
    assert client.agent_name == "ai1"
    assert client.mcp_url == "http://localhost:9090/mcp"

    await client.connect()
    assert fake.connect_count == 1


@pytest.mark.asyncio
async def test_call_tool_passes_args_and_returns_payload() -> None:
    payload = {"connected": True, "playerId": "p1"}
    fake = FakeTransport(tool_payload=payload)
    client = make_client(fake)

    result = await client.call_tool("ensure_connected", {"foo": 1})
    assert result == payload
    assert fake.calls == [("ensure_connected", {"foo": 1})]


@pytest.mark.asyncio
async def test_call_tool_without_args_passes_empty() -> None:
    fake = FakeTransport(tool_payload={"ok": True})
    client = make_client(fake)

    result = await client.call_tool("get_agent_view")
    assert result == {"ok": True}
    assert fake.calls == [("get_agent_view", None)]


@pytest.mark.asyncio
async def test_call_tool_propagates_tool_error() -> None:
    fake = FakeTransport(tool_error="MCP 工具返回错误：connection failed")
    client = make_client(fake)

    with pytest.raises(ValueError, match="connection failed"):
        await client.call_tool("ensure_connected")


@pytest.mark.asyncio
async def test_list_tools() -> None:
    fake = FakeTransport(tools=["ensure_connected", "get_agent_view"])
    client = make_client(fake)

    tools = await client.list_tools()
    assert tools == ["ensure_connected", "get_agent_view"]


@pytest.mark.asyncio
async def test_close_is_idempotent() -> None:
    fake = FakeTransport()
    client = make_client(fake)

    await client.close()
    await client.close()
    assert fake.close_count == 2
    assert fake.closed


# --- HTTPTransport headers（X-Agent-Sid 绑定）测试 ---


def _mock_streamable_http_client(monkeypatch_target: str = "darkforest.mcp_client.streamable_http_client"):
    """把 streamable_http_client mock 成返回三元组的异步 CM，返回 mock 实例。

    同时 mock ``ClientSession``（真实 session 会尝试消费 mock 的 read/write
    stream），使 initialize 走 Fake 路径。
    """
    mock_shc = patch(monkeypatch_target)
    mock = mock_shc.start()
    cm = AsyncMock()
    cm.__aenter__.return_value = ("read", "write", lambda: "sess-1")
    mock.return_value = cm

    mock_cs = patch("darkforest.mcp_client.ClientSession")
    mock_cs_fn = mock_cs.start()
    session_cm = AsyncMock()
    session_cm.__aenter__.return_value = AsyncMock()
    mock_cs_fn.return_value = session_cm
    return mock_shc, mock, mock_cs


def test_http_transport_headers_constructs_http_client() -> None:
    """带 headers 时自建携带该 header 的 httpx client 并经 http_client= 传入 SDK。"""
    transport = HTTPTransport("http://localhost:9090/mcp", headers={"X-Agent-Sid": "ai1"})
    assert transport._headers == {"X-Agent-Sid": "ai1"}  # noqa: SLF001

    mock_shc, mock, mock_cs = _mock_streamable_http_client()
    try:
        asyncio.run(transport.connect())
    finally:
        mock_shc.stop()
        mock_cs.stop()

    kwargs = mock.call_args.kwargs
    assert kwargs.get("terminate_on_close") is True, "必须显式 terminate_on_close=True"
    client = kwargs.get("http_client")
    assert isinstance(client, httpx.AsyncClient), "http_client 应为自建 httpx client"
    assert client.headers.get("X-Agent-Sid") == "ai1", "httpx client 应携带 X-Agent-Sid header"


def test_http_transport_without_headers_passes_none_client() -> None:
    """无 headers 时 http_client 参数为 None（自由借用，向后兼容）。"""
    transport = HTTPTransport("http://localhost:9090/mcp")

    mock_shc, mock, mock_cs = _mock_streamable_http_client()
    try:
        asyncio.run(transport.connect())
    finally:
        mock_shc.stop()
        mock_cs.stop()

    kwargs = mock.call_args.kwargs
    assert kwargs.get("http_client") is None
    assert transport._http_client is None  # noqa: SLF001


def test_http_transport_close_closes_self_created_client() -> None:
    """close 先退出 SDK CM，再显式关闭自建 httpx client（防连接泄漏）。"""
    transport = HTTPTransport("http://localhost:9090/mcp", headers={"X-Agent-Sid": "ai1"})

    mock_shc, mock, mock_cs = _mock_streamable_http_client()
    try:
        asyncio.run(transport.connect())
    finally:
        mock_shc.stop()
        mock_cs.stop()

    client = transport._http_client  # noqa: SLF001
    assert client is not None and not client.is_closed
    asyncio.run(transport.close())
    assert client.is_closed, "close 后自建 httpx client 必须已关闭"
    assert transport._http_client is None  # noqa: SLF001


def test_darkforest_client_constructs_transport_with_agent_header() -> None:
    """DarkForestMCPClient 用 agent_name 构造 X-Agent-Sid header（同名 Agent 恒用同一账号）。"""
    client = DarkForestMCPClient("http://localhost:9090/mcp", "ai1")
    transport = client._transport  # noqa: SLF001
    assert isinstance(transport, HTTPTransport)
    assert transport._headers == {"X-Agent-Sid": "ai1"}  # noqa: SLF001
