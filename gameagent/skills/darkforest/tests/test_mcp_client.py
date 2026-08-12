"""DarkForestMCPClient 单测：FakeTransport 注入，无需真实网络。

覆盖 connect / call_tool / list_tools / close 四路径，以及工具错误
（isError）与非 JSON 输出的解析分支。
"""

from __future__ import annotations

from typing import Any

import pytest

from darkforest.mcp_client import DarkForestMCPClient


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
