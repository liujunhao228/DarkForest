"""异步 MCP 客户端：通过官方 mcp Python SDK 的 StreamableHTTP 连接 mcpserver。

封装回放工具调用：

- ``call_get_replay_deltas`` → ``ReplayDelta``
- ``call_get_replay_semantic_view`` → ``ReplaySemanticOutput``

Pydantic 模型字段与 mcpserver 工具输出 JSON 对齐（桩源见
``mcpserver/internal/tools/replay_delta.go`` 与
``mcpserver/internal/semantic/omniscient_view.go``）。Go 端空切片会序列化为
``null``，因此数组字段用 ``NullableList``（复用
``bot/src/darkforest_bot/backend/view_state.py`` 的 BeforeValidator 思路）。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any, TypeVar, cast

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def _coerce_none_to_list(v: object) -> object:
    """把 JSON ``null`` 规整为空列表（Go nil 切片兼容）。"""
    return [] if v is None else v


_T = TypeVar("_T")

# 复用 bot's view_state.py 的 NullableList：接受 JSON null 并归一化为空列表。
NullableList = Annotated[list[_T], BeforeValidator(_coerce_none_to_list)]


class _StrictModel(BaseModel):
    """strict extra=forbid：backend/bot 字段漂移在解析期暴露而非静默丢弃。"""

    model_config = ConfigDict(extra="forbid")


class ActionRecord(_StrictModel):
    """回放中的一条动作记录。对齐 gamesdk.ActionRecord。"""

    player_id: str = Field(alias="playerId")
    action: str
    data: dict[str, Any] | None = None
    turn: int = 0
    timestamp: int = 0


class PlayerChange(_StrictModel):
    """单个玩家在本回合的关键状态变化（对齐 tools.PlayerChange）。"""

    player_id: str = Field(alias="playerId")
    player_name: str = Field(alias="playerName")
    hand_added: NullableList[str] = Field(default_factory=list, alias="handAdded")
    hand_removed: NullableList[str] = Field(default_factory=list, alias="handRemoved")
    face_up_added: NullableList[str] = Field(default_factory=list, alias="faceUpAdded")
    face_up_removed: NullableList[str] = Field(default_factory=list, alias="faceUpRemoved")
    energy_delta: int = Field(default=0, alias="energyDelta")
    eliminated: bool = False
    # 本回合新被淘汰时的原因：strike/forfeit/timeout/fallback
    elimination_reason: str = Field(default="", alias="eliminationReason")


class TurnChanges(_StrictModel):
    """回合边界关键状态差异（对齐 tools.TurnChanges）。"""

    players: NullableList[PlayerChange] = Field(default_factory=list)
    draw_pile_count_delta: int = Field(alias="drawPileCountDelta")
    discard_additions: NullableList[str] = Field(
        default_factory=list, alias="discardAdditions"
    )
    flying_strikes_added: NullableList[str] = Field(
        default_factory=list, alias="flyingStrikesAdded"
    )
    flying_strikes_removed: NullableList[str] = Field(
        default_factory=list, alias="flyingStrikesRemoved"
    )
    destroyed_stars_added: NullableList[int] = Field(
        default_factory=list, alias="destroyedStarsAdded"
    )
    winner: str = ""


class TurnDelta(_StrictModel):
    """单个回合的 delta（对齐 tools.TurnDelta）。"""

    turn: int
    player_id: str = Field(default="", alias="playerId")
    player_name: str = Field(default="", alias="playerName")
    actions: NullableList[ActionRecord] = Field(default_factory=list)
    changes: TurnChanges


class ReplayDelta(_StrictModel):
    """``get_replay_deltas`` 的完整输出（对齐 tools.GetReplayDeltasOutput）。"""

    replay_id: str = Field(alias="replayId")
    total_turns: int = Field(alias="totalTurns")
    from_turn: int = Field(alias="fromTurn")
    to_turn: int = Field(alias="toTurn")
    deltas: NullableList[TurnDelta] = Field(default_factory=list)


# ============================================================================
# OmniscientView（全知视角语义投影）
# ============================================================================


class Card(_StrictModel):
    """完整卡牌。对齐 gamesdk.Card。"""

    uid: str = ""
    def_id: str = Field(default="", alias="defId")
    name: str = ""
    type: str = ""
    energy: int = 0
    description: str = ""
    image: str = ""
    subtype: str | None = None
    range_: int | None = Field(default=None, alias="range")
    level: int | None = None
    speed: int | None = None
    effect: str | None = None
    protection_level: int | None = Field(default=None, alias="protectionLevel")
    energy_per_turn: int | None = Field(default=None, alias="energyPerTurn")
    ability: str | None = None


class SimpleCard(_StrictModel):
    """FaceUpCards 简化语义投影。对齐 semantic.SimpleCard。"""

    def_id: str = Field(alias="defId")
    name: str
    role: str = ""  # energy / defense / utility
    output: str = ""


class BroadcastHistoryEntry(_StrictModel):
    """玩家广播历史条目。对齐 gamesdk.BroadcastHistoryEntry。"""

    system_id: int = Field(alias="systemId")
    turn: int


class OmniscientDrawPile(_StrictModel):
    """全知视角抽牌堆摘要。对齐 semantic.OmniscientDrawPile。"""

    count: int = 0
    card_names: NullableList[str] = Field(default_factory=list, alias="cardNames")


class OmniscientStarEffect(_StrictModel):
    """星系效果最小投影。对齐 semantic.OmniscientStarEffect。"""

    system_id: int = Field(alias="systemId")
    type: str = ""
    applied_at_turn: int = Field(alias="appliedAtTurn")
    duration: int


class OmniscientStrike(_StrictModel):
    """全知视角下的飞行打击。对齐 semantic.OmniscientStrike。"""

    uid: str = ""
    strike_name: str = Field(alias="strikeName")
    def_id: str = Field(alias="defId")
    level: int = 0
    owner_id: str = Field(alias="ownerId")
    owner_name: str = Field(default="", alias="ownerName")
    position: int = 0
    target_system: int = Field(alias="targetSystem")
    arrived: bool = False
    eta_turns: int = Field(alias="etaTurns")
    threat_level: str = Field(default="none", alias="threatLevel")
    explain: str = ""
    target_player_ids: NullableList[str] = Field(default_factory=list, alias="targetPlayerIds")


class OmniscientPlayer(_StrictModel):
    """全知视角下的单个玩家（所有字段可见）。对齐 semantic.OmniscientPlayer。"""

    id: str = ""
    name: str = ""
    color: str = ""
    energy: int = 0
    position: int = 0
    eliminated: bool = False
    # strike/forfeit/timeout/fallback
    elimination_reason: str = Field(default="", alias="eliminationReason")
    hand: NullableList[Card] = Field(default_factory=list)
    face_up_cards: NullableList[SimpleCard] = Field(default_factory=list, alias="faceUpCards")
    broadcast_history: NullableList[BroadcastHistoryEntry] = Field(
        default_factory=list, alias="broadcastHistory"
    )


class OmniscientView(_StrictModel):
    """全知视角顶层视图。对齐 semantic.OmniscientView。"""

    players: NullableList[OmniscientPlayer] = Field(default_factory=list)
    draw_pile: OmniscientDrawPile = Field(default_factory=OmniscientDrawPile, alias="drawPile")
    discard_pile: NullableList[str] = Field(default_factory=list, alias="discardPile")
    flying_strikes: NullableList[OmniscientStrike] = Field(
        default_factory=list, alias="flyingStrikes"
    )
    destroyed_stars: NullableList[int] = Field(default_factory=list, alias="destroyedStars")
    star_effects: NullableList[OmniscientStarEffect] = Field(
        default_factory=list, alias="starEffects"
    )
    turn: int = 0
    phase: str = ""
    turn_phase: str = Field(alias="turnPhase")
    current_player_id: str = Field(alias="currentPlayerId")
    game_mode: str = Field(alias="gameMode")
    winner: str = ""
    current_player_name: str = Field(default="", alias="currentPlayerName")


class ReplaySemanticOutput(_StrictModel):
    """``get_replay_semantic_view`` 完整输出（对齐 tools.GetReplaySemanticViewOutput）。"""

    found: bool
    error: str = ""
    omniscient_view: OmniscientView | None = Field(default=None, alias="omniscientView")


class FetchSharedReplayOutput(_StrictModel):
    """``fetch_shared_replay`` 完整输出（对齐 tools.FetchSharedReplayOutput）。"""

    saved: bool = False
    replay_id: str = Field(default="", alias="replayId")
    match_id: str = Field(default="", alias="matchId")
    player_names: NullableList[str] = Field(default_factory=list, alias="playerNames")
    total_turns: int = Field(default=0, alias="totalTurns")
    winner: str = ""
    message: str = ""


# ============================================================================
# MCP 客户端
# ============================================================================


class MCPClient:
    """基于 StreamableHTTP 的 mcpserver 客户端。

    低层 ``call_tool`` 可被测试 monkeypatch 替换（返回 CallToolResult 或字符串），
    高层解析逻辑保持不变。
    """

    def __init__(self, url: str) -> None:
        self.url = url

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult:
        """调用 MCP 工具（streamable HTTP），返回 SDK 的 CallToolResult。

        streamable_http_client 是完整 StreamableHTTP 传输（内部已处理前后端
        session 协商与 SSE），ClientSession 包在传输之上做协议交互。
        """
        async with streamable_http_client(self.url) as (read, write, _get_session_id):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.call_tool(name, arguments)

    async def call_get_replay_deltas(
        self, replay_id: str, from_turn: int = 1, to_turn: int | None = None
    ) -> ReplayDelta:
        """读取回放逐回合 delta。"""
        arguments: dict[str, Any] = {"replayId": replay_id, "fromTurn": from_turn}
        if to_turn is not None:
            arguments["toTurn"] = to_turn
        result = await self.call_tool("get_replay_deltas", arguments)
        payload = _extract_payload(result)
        return ReplayDelta.model_validate(payload)

    async def call_get_replay_semantic_view(
        self, replay_id: str, turn: int
    ) -> ReplaySemanticOutput:
        """读取回放指定回合的全知视角投影。"""
        result = await self.call_tool(
            "get_replay_semantic_view", {"replayId": replay_id, "turn": turn}
        )
        payload = _extract_payload(result)
        return ReplaySemanticOutput.model_validate(payload)

    async def call_fetch_shared_replay(
        self, replay_id: str
    ) -> FetchSharedReplayOutput:
        """从游戏服务器拉取分享回放并持久化到本地 SQLite（供未命中时自动拉取）。"""
        result = await self.call_tool("fetch_shared_replay", {"replayId": replay_id})
        payload = _extract_payload(result)
        return FetchSharedReplayOutput.model_validate(payload)


@asynccontextmanager
async def mcp_session(url: str) -> AsyncIterator[tuple[Any, Any, Any]]:
    """建立一次 StreamableHTTP 连接上下文，返回 (read_stream, write_stream, get_session_id)。

    兼容测试场景（monkeypatch session 时可不走真实网络）。
    """
    async with streamable_http_client(url) as streams:
        yield streams


def _extract_payload(result: CallToolResult) -> dict[str, Any]:
    """从 CallToolResult 提取输出 JSON。

    Go SDK 同时把序列化后的输出 JSON 放进 ``content[0].text`` 与
    ``structuredContent``。优先解析 ``structuredContent``，回退到 text。

    工具返回错误时（``isError=true``，Go 端 error 文本），text 不是 JSON：
    不在这里崩溃，而是抛带原始错误文本的 ValueError，让上层拿到真实原因
    （否则 ``json.loads`` 抛出的 JSONDecodeError 会掩盖 mcpserver 的错误）。
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
