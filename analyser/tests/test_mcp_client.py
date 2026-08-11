"""mcp_client 单测：解析 mcpserver 工具输出 JSON 的结果。"""

from __future__ import annotations

import json
from typing import Any

import pytest
from mcp.types import CallToolResult, TextContent

from darkforest_analyser.mcp_client import (
    MCPClient,
    ReplayDelta,
    ReplaySemanticOutput,
)


def _tool_result(payload: dict[str, Any]) -> CallToolResult:
    """构造 Go SDK 风格的 CallToolResult（text content 为 JSON 字符串）。"""
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))]
    )


DELTAS_PAYLOAD: dict[str, Any] = {
    "replayId": "r-1",
    "totalTurns": 2,
    "fromTurn": 1,
    "toTurn": 2,
    "deltas": [
        {
            "turn": 1,
            "playerId": "p1",
            "playerName": "Alice",
            "actions": [
                {
                    "playerId": "p1",
                    "action": "play_card",
                    "data": {"cardUid": "c-1", "targetSystem": 5},
                    "turn": 1,
                    "timestamp": 1000,
                }
            ],
            "changes": {
                "players": [
                    {
                        "playerId": "p1",
                        "playerName": "Alice",
                        "handAdded": ["星陨"],
                        "handRemoved": ["降维打击"],
                        "faceUpAdded": ["监听基地"],
                        "faceUpRemoved": None,
                        "energyDelta": -3,
                        "eliminated": False,
                    }
                ],
                "drawPileCountDelta": -2,
                "discardAdditions": None,
                "flyingStrikesAdded": ["降维打击"],
                "flyingStrikesRemoved": [],
                "destroyedStarsAdded": [7],
                "winner": "",
            },
        }
    ],
}

SEMANTIC_PAYLOAD: dict[str, Any] = {
    "found": True,
    "error": "",
    "omniscientView": {
        "players": [
            {
                "id": "p1",
                "name": "Alice",
                "color": "red",
                "energy": 1,
                "position": 3,
                "eliminated": False,
                "hand": [
                    {
                        "uid": "h1",
                        "defId": "strike_dimension",
                        "name": "降维打击",
                        "type": "strike",
                        "energy": 8,
                        "description": "",
                        "image": "strike_dimension.png",
                        "level": 4,
                        "speed": 1,
                    }
                ],
                "faceUpCards": [
                    {
                        "defId": "facility_listen",
                        "name": "监听基地",
                        "role": "utility",
                        "output": "监听基地",
                    }
                ],
                "broadcastHistory": None,
            },
            {
                "id": "p2",
                "name": "Bob",
                "color": "blue",
                "energy": 1,
                "position": 7,
                "eliminated": False,
                "hand": [],
                "faceUpCards": None,
                "broadcastHistory": [{"systemId": 7, "turn": 2}],
            },
        ],
        "drawPile": {"count": 2, "cardNames": None},
        "discardPile": ["星垒"],
        "flyingStrikes": [
            {
                "uid": "s1",
                "strikeName": "降维打击",
                "defId": "strike_dimension",
                "level": 4,
                "ownerId": "p1",
                "ownerName": "Alice",
                "position": 3,
                "targetSystem": 7,
                "arrived": True,
                "etaTurns": 0,
                "threatLevel": "high",
                "explain": "已到达目标星系，将把该星系二维化",
                "targetPlayerIds": ["p2"],
            }
        ],
        "destroyedStars": [7],
        "starEffects": [
            {"systemId": 7, "type": "annihilationStun", "appliedAtTurn": 2, "duration": -1}
        ],
        "turn": 2,
        "phase": "playing",
        "turnPhase": "play",
        "currentPlayerId": "p2",
        "gameMode": "classic",
        "winner": "",
        "currentPlayerName": "Bob",
    },
}


async def test_call_get_replay_deltas(monkeypatch) -> None:
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        assert name == "get_replay_deltas"
        assert arguments["replayId"] == "r-1"
        assert arguments["fromTurn"] == 1
        assert arguments["toTurn"] == 2
        return _tool_result(DELTAS_PAYLOAD)

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    out: ReplayDelta = await client.call_get_replay_deltas("r-1", 1, 2)

    assert out.replay_id == "r-1"
    assert out.total_turns == 2
    assert len(out.deltas) == 1
    delta = out.deltas[0]
    assert delta.turn == 1
    assert delta.player_name == "Alice"
    assert delta.actions[0].action == "play_card"
    assert delta.actions[0].data == {"cardUid": "c-1", "targetSystem": 5}
    assert delta.changes.draw_pile_count_delta == -2
    assert delta.changes.players[0].hand_added == ["星陨"]
    assert delta.changes.players[0].face_up_removed == []
    assert delta.changes.discard_additions == []
    assert delta.changes.flying_strikes_added == ["降维打击"]
    assert delta.changes.destroyed_stars_added == [7]


async def test_call_get_replay_deltas_without_to_turn(monkeypatch) -> None:
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        assert "toTurn" not in arguments
        return _tool_result(DELTAS_PAYLOAD)

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    out = await client.call_get_replay_deltas("r-1", 1)
    assert out.to_turn == 2


async def test_call_get_replay_semantic_view(monkeypatch) -> None:
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        assert name == "get_replay_semantic_view"
        assert arguments == {"replayId": "r-1", "turn": 2}
        return _tool_result(SEMANTIC_PAYLOAD)

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    out: ReplaySemanticOutput = await client.call_get_replay_semantic_view("r-1", 2)

    assert out.found is True
    assert out.error == ""
    assert out.omniscient_view is not None
    view = out.omniscient_view
    assert view.turn == 2
    assert view.game_mode == "classic"
    assert view.phase == "playing"

    alice = view.players[0]
    assert alice.name == "Alice"
    assert alice.energy == 1
    assert alice.hand[0].name == "降维打击"
    assert alice.hand[0].level == 4
    assert alice.face_up_cards[0].role == "utility"
    assert alice.broadcast_history == []

    bob = view.players[1]
    assert bob.hand == []
    assert bob.face_up_cards == []
    assert bob.broadcast_history[0].system_id == 7

    assert view.draw_pile.count == 2
    assert view.draw_pile.card_names == []
    assert view.discard_pile == ["星垒"]

    strike = view.flying_strikes[0]
    assert strike.threat_level == "high"
    assert strike.eta_turns == 0
    assert strike.target_player_ids == ["p2"]

    assert view.destroyed_stars == [7]
    assert view.star_effects[0].type == "annihilationStun"
    assert view.current_player_name == "Bob"


async def test_call_get_replay_semantic_view_not_found(monkeypatch) -> None:
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        return _tool_result({"found": False, "error": "未在本地找到该回放"})

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    out = await client.call_get_replay_semantic_view("missing", 1)

    assert out.found is False
    assert "未在本地找到" in out.error
    assert out.omniscient_view is None


async def test_call_tool_error_raises_with_raw_message(monkeypatch) -> None:
    """工具返回 isError=true（Go 端 error 文本）→ 抛带原始错误消息的 ValueError。

    回归：此前 ``_extract_payload`` 把错误文本当 JSON 解析，抛出的
    JSONDecodeError 掩盖了 mcpserver 的真实错误（如回放未命中）。
    """
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        return CallToolResult(
            content=[
                TextContent(
                    type="text",
                    text='回放 "abc" 未在本地找到，请先调用 fetch_shared_replay 拉取',
                )
            ],
            isError=True,
        )

    monkeypatch.setattr(client, "call_tool", fake_call_tool)

    with pytest.raises(ValueError) as excinfo:
        await client.call_get_replay_deltas("abc", 1)
    assert "未在本地找到" in str(excinfo.value)


async def test_call_tool_non_json_text_raises_with_preview(monkeypatch) -> None:
    """isError=false 但 text 不是 JSON → 抛带内容预览的 ValueError 而非 JSONDecodeError。"""
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        return CallToolResult(
            content=[TextContent(type="text", text="plain text, not json")],
            isError=False,
        )

    monkeypatch.setattr(client, "call_tool", fake_call_tool)

    with pytest.raises(ValueError) as excinfo:
        await client.call_get_replay_deltas("abc", 1)
    assert "非 JSON" in str(excinfo.value)
    assert "plain text" in str(excinfo.value)


async def test_call_fetch_shared_replay(monkeypatch) -> None:
    """fetch_shared_replay 成功输出解析。"""
    client = MCPClient(url="http://localhost:9090/mcp")
    payload: dict[str, Any] = {
        "saved": True,
        "replayId": "r-1",
        "matchId": "m-1",
        "playerNames": ["Alice", "Bob"],
        "totalTurns": 6,
        "winner": "Bob",
    }

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        assert name == "fetch_shared_replay"
        assert arguments == {"replayId": "r-1"}
        return _tool_result(payload)

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    out = await client.call_fetch_shared_replay("r-1")

    assert out.saved is True
    assert out.replay_id == "r-1"
    assert out.match_id == "m-1"
    assert out.player_names == ["Alice", "Bob"]
    assert out.total_turns == 6
    assert out.winner == "Bob"


async def test_player_change_elimination_reason(monkeypatch) -> None:
    """PlayerChange 解析 eliminationReason：新淘汰回合非空、缺省字段为空串。"""
    client = MCPClient(url="http://localhost:9090/mcp")
    payload = {
        "replayId": "r-1",
        "totalTurns": 2,
        "fromTurn": 1,
        "toTurn": 2,
        "deltas": [
            {
                "turn": 2,
                "playerId": "p2",
                "playerName": "Bob",
                "actions": [],
                "changes": {
                    "players": [
                        {
                            "playerId": "p2",
                            "playerName": "Bob",
                            "handAdded": None,
                            "handRemoved": None,
                            "faceUpAdded": None,
                            "faceUpRemoved": None,
                            "energyDelta": 0,
                            "eliminated": True,
                            "eliminationReason": "timeout",
                        },
                        {
                            "playerId": "p1",
                            "playerName": "Alice",
                            "handAdded": None,
                            "handRemoved": None,
                            "faceUpAdded": None,
                            "faceUpRemoved": None,
                            "energyDelta": 0,
                            "eliminated": False,
                        },
                    ],
                    "drawPileCountDelta": 0,
                    "discardAdditions": None,
                    "flyingStrikesAdded": None,
                    "flyingStrikesRemoved": None,
                    "destroyedStarsAdded": None,
                    "winner": "p1",
                },
            }
        ],
    }

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        return _tool_result(payload)

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    out = await client.call_get_replay_deltas("r-1", 1, 2)
    players = out.deltas[0].changes.players
    by_id = {p.player_id: p for p in players}
    assert by_id["p2"].eliminated is True
    assert by_id["p2"].elimination_reason == "timeout"
    # 未提供 eliminationReason 的玩家解析为空串
    assert by_id["p1"].eliminated is False
    assert by_id["p1"].elimination_reason == ""


async def test_omniscient_player_elimination_reason(monkeypatch) -> None:
    """OmniscientPlayer 解析 eliminationReason：已淘汰玩家透传原因。"""
    client = MCPClient(url="http://localhost:9090/mcp")
    payload = {
        "found": True,
        "error": "",
        "omniscientView": {
            "players": [
                {
                    "id": "p2",
                    "name": "Bob",
                    "color": "blue",
                    "energy": 0,
                    "position": 7,
                    "eliminated": True,
                    "eliminationReason": "fallback",
                    "hand": [],
                    "faceUpCards": None,
                    "broadcastHistory": None,
                }
            ],
            "drawPile": {"count": 0, "cardNames": None},
            "discardPile": None,
            "flyingStrikes": None,
            "destroyedStars": None,
            "starEffects": None,
            "turn": 3,
            "phase": "gameOver",
            "turnPhase": "play",
            "currentPlayerId": "p1",
            "gameMode": "classic",
            "winner": "p1",
            "currentPlayerName": "Alice",
        },
    }

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        return _tool_result(payload)

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    out = await client.call_get_replay_semantic_view("r-1", 3)
    assert out.omniscient_view is not None
    p2 = out.omniscient_view.players[0]
    assert p2.eliminated is True
    assert p2.elimination_reason == "fallback"
