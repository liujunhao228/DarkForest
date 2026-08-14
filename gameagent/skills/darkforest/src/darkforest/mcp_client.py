"""DarkForest MCP 客户端封装：长连接 StreamableHTTP + Transport 抽象（可 mock）。

游戏 Agent 必须保持长连接：mcpserver 以 MCP session ID 映射 GameSession
（``sessionFromReq`` 取 MCP session，账户池按 session 借用 agent 账户），
``ensure_connected`` 一次、``wait_for_event`` 阻塞等待、状态持续——全部依赖
稳定 session。每个子 Agent 持有一个独立的 ``DarkForestMCPClient`` 实例，
对应 mcpserver 一个 MCP session / 账户池条目，互不串货。

Transport 协议抽象出 connect / call_tool / list_tools / close，单测注入
FakeTransport 即可驱动高层逻辑，无需真实网络。

协议版本说明：锁定 ``mcp>=1.0,<2.0``。mcpserver 基于
Go SDK v1.6.1（协议 2025-11-25），尚未跟进 MCP 2.0（2026-07-28 的
per-request 信封时代）；mcp 2.x 的 ``CallToolResult`` 字段已改 snake_case、
``streamable_http_client`` 返回类型也变，与 Go 端不兼容。
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Protocol, cast

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult

# Go SDK v1.6.1 的 StreamableHTTP 在连接时发 `event: prime` priming 事件
# （resumability 机制）；Python mcp 1.x 不识别该事件名，每次连接打 3 条
# "Unknown SSE event: prime" 警告。连接本身正常（SDK 忽略后继续解析
# message 事件），但警告会污染子 Agent 的 IPython 输出、误导 LLM 以为
# 协议异常——这里过滤掉该消息。
_PRIME_WARNING_FILTER: logging.Filter | None = None


class _PrimeEventFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "Unknown SSE event" not in msg


def _suppress_prime_event_warning() -> None:
    global _PRIME_WARNING_FILTER
    if _PRIME_WARNING_FILTER is not None:
        return
    logger = logging.getLogger("mcp.client.streamable_http")
    _PRIME_WARNING_FILTER = _PrimeEventFilter()
    logger.addFilter(_PRIME_WARNING_FILTER)


_suppress_prime_event_warning()


class Transport(Protocol):
    """MCP 传输层：长连接 + 工具调用（单测可注入 Fake 实现）。"""

    async def connect(self) -> None: ...

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """调用工具并返回解析后的输出 JSON（非文本）。"""

    async def list_tools(self) -> list[str]:
        """列出可用工具名（调试用）。"""

    async def close(self) -> None: ...


@asynccontextmanager
async def _session_for(
    url: str, http_client: httpx.AsyncClient | None
) -> AsyncIterator[ClientSession]:
    """建立 StreamableHTTP 长连接并完成 initialize（session 生命周期由调用方持有）。

    StreamableHTTP 的 session id 协商由 SDK 内部处理（transport 生命周期内保持
    稳定），因此长连接下 mcpserver 的 GameSession 映射持续有效。
    mcp 1.x 的 ``streamable_http_client`` 解包为 (read, write, get_session_id)。
    ``http_client`` 为调用方提供的 httpx client（携带 X-Agent-Sid 等 header），
    SDK 不负责关闭它——由 HTTPTransport.close 显式关闭。
    """
    async with streamable_http_client(
        url, http_client=http_client, terminate_on_close=True
    ) as (read, write, _get_session_id):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


class HTTPTransport:
    """官方 mcp SDK 的 StreamableHTTP 长连接实现。

    连接在实例生命周期内保持：connect() 进入内部 context manager 并持有
    session，close() 退出。重复 connect 幂等。
    ``headers`` 非空时自建携带该 header 的 httpx.AsyncClient 并经
    ``http_client=`` 传给 SDK（如 X-Agent-Sid 绑定账号）；SDK 对调用方提供的
    client 不负责关闭，close() 中显式 ``aclose()`` 防连接泄漏。
    """

    def __init__(self, url: str, headers: dict[str, str] | None = None) -> None:
        self._url = url
        self._headers = dict(headers) if headers else None
        self._http_client: httpx.AsyncClient | None = None
        self._cm: Any = None
        self._session: ClientSession | None = None

    async def connect(self) -> None:
        if self._session is not None:
            return
        if self._headers is not None and self._http_client is None:
            self._http_client = httpx.AsyncClient(headers=self._headers)
        self._cm = _session_for(self._url, self._http_client)
        self._session = await self._cm.__aenter__()

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if self._session is None:
            await self.connect()
        assert self._session is not None
        result = await self._session.call_tool(name, arguments or {})
        return _extract_payload(result)

    async def list_tools(self) -> list[str]:
        if self._session is None:
            await self.connect()
        assert self._session is not None
        result = await self._session.list_tools()
        return [tool.name for tool in result.tools]

    async def close(self) -> None:
        if self._cm is None and self._http_client is None:
            return
        cm = self._cm
        self._cm = None
        self._session = None
        if cm is not None:
            try:
                await cm.__aexit__(None, None, None)
            except BaseException:
                # 断开连接本身就是目的：服务器已关流 / SSE 结束 / anyio
                # ExceptionGroup（CancelledError 等）都属于"已断开"的正常情况。
                # 吞掉，保证 disconnect() 幂等且不抛，子 Agent 不会被"断开失败"
                # 的异常卡在终局清理（E2E 中 ai1 因此陷入探索循环直到超时）。
                pass
        # 先退出 streamable_http_client 的 CM，再关自建 httpx client（先内后外）。
        client = self._http_client
        self._http_client = None
        if client is not None:
            await client.aclose()


def _extract_payload(result: CallToolResult) -> dict[str, Any]:
    """从 CallToolResult 提取输出 JSON。

    优先解析 ``structuredContent``（mcp 1.x 驼峰字段），回退到 content[0].text。
    ``isError`` 时抛带原始错误文本的 ValueError（否则 JSONDecodeError 会掩盖
    mcpserver 的真实错误）。
    """
    if getattr(result, "isError", False):
        raw = _first_text(result)
        raise ValueError(f"MCP 工具返回错误：{raw or '(空错误消息)'}")

    sc = getattr(result, "structuredContent", None)
    if sc is not None:
        if isinstance(sc, dict):
            return sc
        if isinstance(sc, str):
            return cast("dict[str, Any]", json.loads(sc))
    raw = _first_text(result)
    if raw is not None:
        try:
            return cast("dict[str, Any]", json.loads(raw))
        except json.JSONDecodeError:
            raise ValueError(
                f"MCP 工具返回非 JSON 内容（无法解析）：{raw[:300]}"
            ) from None
    raise ValueError("MCP 工具返回内容为空，无法解析 JSON")


def _first_text(result: CallToolResult) -> str | None:
    """返回 CallToolResult 中第一个非空 text 内容。"""
    for item in result.content:
        text = getattr(item, "text", None)
        if isinstance(text, str) and text:
            return text
    return None


class DarkForestMCPClient:
    """DarkForest 游戏 MCP 客户端：长连接 + 统一工具调用入口。

    每个子 Agent 持有一个独立实例（对应 mcpserver 一个 session / 账户池条目）。
    ``agent_name`` 即绑定账号（X-Agent-Sid header）：同名 Agent 恒用同一账号，
    mcpserver 池层按指名借用仲裁；冲突（他人占用/不在名单）明确报错。
    """

    def __init__(self, mcp_url: str, agent_name: str) -> None:
        self.mcp_url = mcp_url
        self.agent_name = agent_name
        self._transport: Transport = HTTPTransport(
            mcp_url, headers={"X-Agent-Sid": agent_name}
        )

    async def connect(self) -> None:
        """建立（或确认已建立）到 mcpserver 的 StreamableHTTP 长连接。"""
        await self._transport.connect()

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """统一工具调用入口，返回解析后的输出 JSON（非文本）。"""
        return await self._transport.call_tool(name, arguments)

    async def list_tools(self) -> list[str]:
        """列出可用工具名（调试用）。"""
        return await self._transport.list_tools()

    async def close(self) -> None:
        """断开连接。重复调用安全（幂等）。"""
        await self._transport.close()
