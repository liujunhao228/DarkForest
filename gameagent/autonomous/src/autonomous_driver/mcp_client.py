"""MCP 客户端封装：长连接 Streamable HTTP + Transport 抽象（可 mock）。

与 analyser 的 MCPClient 不同（每次调用新建连接，仅适用于无状态回放工具），
驾驶器必须保持长连接：mcpserver 以 MCP session ID 映射 GameSession
（``sessionFromReq`` 取 ``req.GetSession().ID()``），ensure_connected 一次、
wait_for_event 阻塞等待、状态持续——全部依赖稳定 session。

Transport 协议抽象出 connect / call_tool / close，单测注入 FakeTransport
即可驱动高层逻辑，无需真实网络。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any, Protocol, cast

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, TypeAdapter

log = logging.getLogger("autonomous_driver")

# ---------------------------------------------------------------------------
# 连接稳定性常量
# ---------------------------------------------------------------------------

# connect() 建立 StreamableHTTP session 的超时（秒）。mcpserver 不可达时避免
# connect 无限挂起（否则 driver 的 _recover/_connect_with_retry 会被卡死）。
_CONNECT_TIMEOUT_S = 10.0

# 幂等/只读工具集：MCP 传输层失效重建后允许安全重放一次。这些调用即使
# 前一次响应丢失，重放也不会产生副作用（ensure_connected 重复连接是 no-op、
# wait_for_event 重复等待无害、get_* 纯查询）。**动作类工具（play_card/strike/
# broadcast/end_turn 等）不在集合内**：若写请求已送达但响应在断线时丢失，
# 重放会造成重复副作用，故只重建连接、不改发，交由 driver 主循环处理。
_IDEMPOTENT_TOOLS = frozenset(
    {
        "ensure_connected",
        "get_connection_status",
        "get_my_profile",
        "wait_for_event",
        "get_agent_view",
        "get_affordances",
    }
)


def _is_connection_error(e: BaseException) -> bool:
    """判定异常是否属于"MCP 传输层失效"（HTTP 闪断 / 连接重置 / 超时）。

    这类异常应触发重建连接；而工具本身的业务错误（isError 抛出的
    ValueError 等）不属于连接失效，不应触发重连。
    """
    if isinstance(e, (TimeoutError, ConnectionError, OSError)):
        return True
    transport_err = getattr(httpx2, "TransportError", None)
    if transport_err is not None and isinstance(e, transport_err):
        return True
    return False


def _brief(e: BaseException) -> str:
    """截断异常描述（日志用）。"""
    return str(e)[:200] or type(e).__name__


class _StrictModel(BaseModel):
    """strict extra=forbid：mcpserver 字段漂移在解析期暴露而非静默丢弃。"""

    model_config = ConfigDict(extra="forbid")


def _coerce_none_to_list(v: object) -> object:
    """把 JSON null 规整为空列表（Go nil 切片兼容）。"""
    return [] if v is None else v


NullableList = Annotated[list[Any], BeforeValidator(_coerce_none_to_list)]


# --- 事件 / 等待结果模型（对齐 gamesdk.GameEvent 与 tools.WaitForEventOutput） ---


class GameEvent(_StrictModel):
    """wait_for_event 返回的事件项。对齐 gamesdk.GameEvent。"""

    type: str = ""
    timestamp: int = 0
    payload: dict[str, Any] | None = None


class WaitForEventResult(_StrictModel):
    """wait_for_event 工具输出。对齐 tools.WaitForEventOutput。"""

    has_event: bool = Field(alias="hasEvent")
    events: NullableList = Field(default_factory=list, alias="events")
    delta: dict[str, Any] | None = None

    def typed_events(self) -> list[GameEvent]:
        """把 events 解析为 GameEvent 列表（类型安全入口）。"""
        if not self.events:
            return []
        return TypeAdapter(list[GameEvent]).validate_python(self.events)


# --- Transport 抽象 ---


class Transport(Protocol):
    """MCP 传输层：长连接 + 工具调用（单测可注入 Fake 实现）。"""

    async def connect(self) -> None: ...

    async def reconnect(self) -> None:
        """强制重建 MCP 传输层（失效后恢复用）。HTTPTransport 实现；Fake 可空实现。"""

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """调用工具并返回解析后的输出 JSON。"""

    async def close(self) -> None: ...


@asynccontextmanager
async def _session_for(
    url: str, http_client: httpx2.AsyncClient | None
) -> AsyncIterator[ClientSession]:
    """建立 StreamableHTTP 长连接并完成 initialize（session 生命周期由调用方持有）。

    StreamableHTTP 的 session id 协商由 SDK 内部处理（transport 生命周期内保持
    稳定），因此长连接下 mcpserver 的 GameSession 映射持续有效。
    mcp 2.x 的 ``streamable_http_client`` 解包为 (read, write) 二元组。
    ``http_client`` 为调用方提供的 httpx2 client（携带 X-Agent-Sid 等 header），
    SDK 不负责关闭它——由 HTTPTransport.close 显式关闭。
    """
    async with streamable_http_client(
        url, http_client=http_client, terminate_on_close=True
    ) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


class HTTPTransport:
    """官方 mcp SDK 的 StreamableHTTP 长连接实现。

    连接在实例生命周期内保持：connect() 进入内部 context manager 并持有 session，
    close() 退出。重复 connect 幂等。
    ``headers`` 非空时自建携带该 header 的 httpx2.AsyncClient 并经
    ``http_client=`` 传给 SDK（如 X-Agent-Sid 绑定账号）；SDK 对调用方提供的
    client 不负责关闭，close() 中显式 ``aclose()`` 防连接泄漏。
    """

    def __init__(self, url: str, headers: dict[str, str] | None = None) -> None:
        self._url = url
        self._headers = dict(headers) if headers else None
        self._http_client: httpx2.AsyncClient | None = None
        self._cm: Any = None
        self._session: ClientSession | None = None

    async def connect(self) -> None:
        if self._session is not None:
            return
        if self._headers is not None and self._http_client is None:
            self._http_client = httpx2.AsyncClient(headers=self._headers)
        self._cm = _session_for(self._url, self._http_client)
        try:
            self._session = await asyncio.wait_for(
                self._cm.__aenter__(), timeout=_CONNECT_TIMEOUT_S
            )
        except BaseException:
            # 连接失败：清空残留 CM，避免误判已连接（下次 connect 可重试重建）。
            self._cm = None
            self._session = None
            raise

    async def reconnect(self) -> None:
        """强制重建 MCP 传输层：先断开（幂等容错）再重连。

        与 connect() 的幂等短路不同，reconnect 无条件重建 StreamableHTTP
        session——用于 MCP 传输层失效（HTTP 闪断 / mcpserver 重启 / 空闲超时）
        后的恢复，使后续 call_tool 落到新 session（mcpserver 以新 session ID
        映射新 GameSession，再由 driver 的 ensure_connected 同步游戏状态）。
        """
        await self.close()
        await self.connect()

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if self._session is None:
            await self.connect()
        assert self._session is not None
        try:
            result = await self._session.call_tool(name, arguments or {})
            return _extract_payload(result)
        except BaseException as e:  # noqa: BLE001
            if not _is_connection_error(e):
                raise
            # MCP 传输层失效：重建连接，让后续调用落到新 session。
            # 只对幂等/只读工具重放一次（写请求若响应在断线时丢失，重放会
            # 造成重复副作用）；非幂等工具重连后原样抛出，交由 driver 主循环
            # 按拒绝/恢复处理。
            log.warning("MCP 连接失效(name=%s)，重建传输层: %s", name, _brief(e))
            await self.reconnect()
            if name in _IDEMPOTENT_TOOLS:
                result = await self._session.call_tool(name, arguments or {})
                return _extract_payload(result)
            raise

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
                # ExceptionGroup / httpcore2 asyncgen 拆除竞态（athrow:
                # asynchronous generator is already running）都属"已断开"的
                # 正常情况。吞掉，保证 close 幂等且不抛——否则 driver 局间/
                # 退出时会被会话拆除异常打断（实测 ai2 driver 首局后退出，
                # 3 局批量无结算）。与 skills/darkforest mcp_client.close
                # 的幂等容错模式保持一致。
                pass
        # 先退出 streamable_http_client 的 CM，再关自建 httpx2 client（先内后外）。
        client = self._http_client
        self._http_client = None
        if client is not None:
            await client.aclose()


def _extract_payload(result: CallToolResult) -> dict[str, Any]:
    """从 CallToolResult 提取输出 JSON。

    优先解析 structuredContent，回退到 text；isError 时抛带原始错误文本的
    ValueError（否则 JSONDecodeError 会掩盖 mcpserver 的真实错误）。
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


# --- 游戏语义封装（driver 使用） ---


class GameMCPClient:
    """驾驶器的游戏 MCP 客户端：长连接 + 游戏工具封装。

    ``call`` 为底层工具调用入口；各方法为游戏语义的薄封装，返回解析后的
    输出 JSON（结构以 mcpserver 工具输出为准）。
    """

    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def connect(self) -> None:
        await self._transport.connect()

    async def close(self) -> None:
        await self._transport.close()

    async def reconnect_mcp(self) -> None:
        """强制重建 MCP 传输层（driver 恢复路径用）。

        driver 的 _recover 在重新同步游戏状态前先调用本方法，确保
        ensure_connected 落在新 session 而非失效的旧连接上。
        """
        await self._transport.reconnect()

    async def call(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        return await self._transport.call_tool(name, arguments)

    # --- 连接 ---

    async def ensure_connected(self) -> dict[str, Any]:
        return await self.call("ensure_connected")

    async def get_connection_status(self) -> dict[str, Any]:
        return await self.call("get_connection_status")

    # --- 匹配 / 房间 ---

    async def join_match_queue(
        self, game_mode: str = "classic", preferred_count: int = 2
    ) -> dict[str, Any]:
        return await self.call(
            "join_match_queue",
            {"preferredCount": preferred_count, "gameMode": game_mode},
        )

    async def rejoin_room(self, room_id: str = "") -> dict[str, Any]:
        args: dict[str, Any] = {}
        if room_id:
            args["roomId"] = room_id
        return await self.call("rejoin_room", args)

    # --- 状态 / 感知 ---

    async def wait_for_event(self, timeout_seconds: int = 30) -> WaitForEventResult:
        """阻塞等待事件：解析为 WaitForEventResult（含 hasEvent / events / delta）。"""
        out = await self.call("wait_for_event", {"timeoutSeconds": timeout_seconds})
        return WaitForEventResult.model_validate(out)

    async def get_agent_view(self) -> dict[str, Any]:
        return await self.call("get_agent_view")

    async def get_affordances(self) -> dict[str, Any]:
        return await self.call("get_affordances")

    # --- 行动（driver 按状态机输出调用，参数以 affordance legalTargets 为准） ---

    async def play_card(self, card_uid: str) -> dict[str, Any]:
        """出牌（MCP play_card 仅接受 cardUid，不带目标星系）。"""
        return await self.call("play_card", {"cardUid": card_uid})

    async def deploy_card(self, card_uid: str) -> dict[str, Any]:
        """部署设施卡（MCP deploy_card 仅接受 cardUid）。"""
        return await self.call("deploy_card", {"cardUid": card_uid})

    async def strike(self, card_uid: str, target_system: int) -> dict[str, Any]:
        return await self.call("strike", {"cardUid": card_uid, "targetSystem": target_system})

    async def broadcast(self, card_uid: str, target_system: int) -> dict[str, Any]:
        return await self.call("broadcast", {"cardUid": card_uid, "targetSystem": target_system})

    async def respond_broadcast(self, agreed: bool, card_uid: str | None = None) -> dict[str, Any]:
        args: dict[str, Any] = {"agreed": agreed}
        if card_uid:
            args["cardUid"] = card_uid
        return await self.call("respond_broadcast", args)

    async def select_broadcast_responder(self, responder_player_id: str) -> dict[str, Any]:
        return await self.call(
            "select_broadcast_responder", {"responderId": responder_player_id}
        )

    async def cancel_broadcast(self) -> dict[str, Any]:
        return await self.call("cancel_broadcast")

    async def recycle_card(self, card_uid: str) -> dict[str, Any]:
        return await self.call("recycle_card", {"cardUid": card_uid})

    async def end_turn(self, discard_cards: list[str] | None = None) -> dict[str, Any]:
        args: dict[str, Any] = {}
        if discard_cards:
            args["discardCards"] = discard_cards
        return await self.call("end_turn", args)

    async def resolve_strike_action(
        self,
        option: str,
        strike_uid: str | None = None,
        target_system: int | None = None,
    ) -> dict[str, Any]:
        args: dict[str, Any] = {"option": option}
        if strike_uid:
            args["strikeUid"] = strike_uid
        if target_system is not None:
            args["targetSystem"] = target_system
        return await self.call("resolve_strike_action", args)

    async def forfeit_game(self) -> dict[str, Any]:
        return await self.call("forfeit_game")

    # --- 回放 ---

    async def fetch_and_save_replay(self) -> dict[str, Any]:
        return await self.call("fetch_and_save_replay")
