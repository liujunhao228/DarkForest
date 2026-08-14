"""mcp_client 单测：FakeTransport 驱动，验证解析与语义封装。"""

from __future__ import annotations

from typing import Any

import pytest

from autonomous_driver.mcp_client import (
    GameEvent,
    GameMCPClient,
    HTTPTransport,
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


# --- 连接稳定性：失效重建 / 幂等重试 / 非幂等不重放 / 错误分类 ---


class _FakeToolResult:
    """最小 CallToolResult 替身（_extract_payload 依赖 content[].text）。"""

    def __init__(self, text: str) -> None:
        self.isError = False
        self.structuredContent = None
        self.content = [type("_C", (), {"text": text})()]


class _FlakyHTTPTransport(HTTPTransport):
    """可编程：首个 session 首次调用抛连接错误，reconnect 换新 session。

    继承 HTTPTransport 只为复用其 call_tool 的重建/重试逻辑；connect/reconnect/
    close 全部本地接管，不真正联网。
    """

    def __init__(self) -> None:
        super().__init__("http://localhost:9090/mcp")
        self._session: Any = None
        self.reconnects = 0
        self._gen = 0

    def _sess(self) -> Any:
        class _Session:
            def __init__(self, gen: int) -> None:
                self.gen = gen
                self.calls = 0

            async def call_tool(
                self, name: str, arguments: dict[str, Any] | None = None
            ) -> Any:
                self.calls += 1
                if self.gen == 0 and self.calls == 1:
                    raise ConnectionResetError("connection reset")
                return _FakeToolResult('{"ok": true}')

        return _Session(self._gen)

    async def connect(self) -> None:
        if self._session is None:
            self._session = self._sess()

    async def reconnect(self) -> None:
        self.reconnects += 1
        self._gen += 1
        self._session = self._sess()

    async def close(self) -> None:
        self._session = None


def test_is_connection_error_classifies() -> None:
    """连接类异常判定：网络错误→True，业务错误（isError 抛 ValueError）→False。"""
    from autonomous_driver.mcp_client import _is_connection_error

    assert _is_connection_error(ConnectionResetError("x"))
    assert _is_connection_error(TimeoutError("x"))
    assert _is_connection_error(OSError("x"))
    assert not _is_connection_error(ValueError("MCP 工具返回错误: boom"))


@pytest.mark.asyncio
async def test_call_tool_reconnects_and_retries_idempotent() -> None:
    """幂等工具遇连接错误：重建传输层后重放一次成功，不向调用方抛错。"""
    t = _FlakyHTTPTransport()
    client = GameMCPClient(t)
    out = await client.get_agent_view()
    assert out == {"ok": True}
    assert t.reconnects == 1, "应重建一次 MCP 传输层"


@pytest.mark.asyncio
async def test_call_tool_reconnects_but_does_not_replay_action() -> None:
    """非幂等动作遇连接错误：重建传输层但不重放（防重复副作用），原样上抛。"""
    t = _FlakyHTTPTransport()
    client = GameMCPClient(t)
    with pytest.raises(ConnectionResetError):
        await client.play_card("card-1")
    assert t.reconnects == 1, "连接已重建，为后续调用就绪"


@pytest.mark.asyncio
async def test_reconnect_calls_close_then_connect() -> None:
    """reconnect 无条件重建：先断开再重连（区别于 connect 的幂等短路）。"""
    transport = HTTPTransport("http://localhost:9090/mcp")
    calls: list[str] = []

    async def _fake_close() -> None:
        calls.append("close")

    async def _fake_connect() -> None:
        calls.append("connect")

    transport.close = _fake_close  # type: ignore[method-assign]
    transport.connect = _fake_connect  # type: ignore[method-assign]
    await transport.reconnect()
    assert calls == ["close", "connect"]
