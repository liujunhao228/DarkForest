"""crew Flow 单测：Map-Reduce 编排（注入 fake MCP 客户端与 fake LLM）。

验证点：
- ``split_into_segments`` 按 totalTurns//3 划分三区间；
- ``format_deltas`` 输出紧凑回合摘要；
- Flow 全链路：start 拉 deltas → 并行 3 阶段分析 → reduce 汇总产出
  含「复盘报告」「策略评估」两节的 markdown；
- ``SemanticViewTool._arun`` 走 fake MCP 返回 JSON；
- ``ensure_replay_local`` 本地未命中时自动 fetch_shared_replay 拉取；
- ``run_replay_analysis`` 高层入口。
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from crewai.llm import BaseLLM
from mcp.types import CallToolResult, TextContent
from pydantic import model_validator

from darkforest_analyser.crew import (
    PhaseReport,
    ReplayAnalysisFlow,
    SemanticViewTool,
    build_reduce_prompt,
    ensure_replay_local,
    format_deltas,
    run_replay_analysis,
    split_into_segments,
)
from darkforest_analyser.mcp_client import MCPClient, ReplayDelta


def _tool_result(payload: dict[str, Any]) -> CallToolResult:
    """构造 Go SDK 风格的 CallToolResult（text content 为 JSON 字符串）。"""
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))]
    )


def _tool_error(message: str) -> CallToolResult:
    """构造 Go SDK 风格的错误 CallToolResult（isError=true，text 为纯文本错误）。"""
    return CallToolResult(
        content=[TextContent(type="text", text=message)], isError=True
    )


def _turn(turn_no: int, player_id: str, winner: str = "") -> dict[str, Any]:
    """构造单个 TurnDelta 的原始 JSON（对齐 mcpserver 输出）。"""
    player_name = "Alice" if player_id == "p1" else "Bob"
    return {
        "turn": turn_no,
        "playerId": player_id,
        "playerName": player_name,
        "actions": [
            {
                "playerId": player_id,
                "action": "play_card",
                "data": {"cardUid": f"c-{turn_no}", "targetSystem": turn_no},
                "turn": turn_no,
                "timestamp": turn_no * 1000,
            }
        ],
        "changes": {
            "players": [
                {
                    "playerId": player_id,
                    "playerName": player_name,
                    "handAdded": [f"卡{turn_no}"],
                    "handRemoved": [],
                    "faceUpAdded": [],
                    "faceUpRemoved": None,
                    "energyDelta": -1,
                    "eliminated": False,
                }
            ],
            "drawPileCountDelta": -1,
            "discardAdditions": [f"弃{turn_no}"],
            "flyingStrikesAdded": [] if turn_no % 2 else ["降维打击"],
            "flyingStrikesRemoved": [],
            "destroyedStarsAdded": [] if turn_no % 2 else [turn_no],
            "winner": winner,
        },
    }


DELTAS_PAYLOAD: dict[str, Any] = {
    "replayId": "r-1",
    "totalTurns": 6,
    "fromTurn": 1,
    "toTurn": 6,
    "deltas": [
        _turn(1, "p1"),
        _turn(2, "p2"),
        _turn(3, "p1"),
        _turn(4, "p2"),
        _turn(5, "p1"),
        _turn(6, "p2", winner="Bob"),
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
                    {"uid": "h1", "defId": "strike_dimension", "name": "降维打击", "type": "strike"}
                ],
                "faceUpCards": None,
                "broadcastHistory": None,
            }
        ],
        "drawPile": {"count": 2, "cardNames": None},
        "discardPile": ["星垒"],
        "flyingStrikes": [],
        "destroyedStars": [7],
        "starEffects": [],
        "turn": 2,
        "phase": "playing",
        "turnPhase": "play",
        "currentPlayerId": "p2",
        "gameMode": "classic",
        "winner": "",
        "currentPlayerName": "Bob",
    },
}


class FakeLLM(BaseLLM):
    """按提示词特征返回固定文本的 LLM（阶段 vs 汇总）。

    BaseLLM 的 before-validator 在默认值生效前校验 model 非空，故显式注入。
    """

    model: str = "fake"

    @model_validator(mode="before")
    @classmethod
    def _inject_model(cls, data: Any) -> Any:
        if isinstance(data, dict) and not data.get("model"):
            return {**data, "model": "fake"}
        return data

    def model_post_init(self, __context: object) -> None:
        self.calls = 0

    @staticmethod
    def _prompt_text(messages: str | list[Any] | Any) -> str:
        if isinstance(messages, str):
            return messages
        if isinstance(messages, list) and messages:
            last = messages[-1]
            if isinstance(last, dict):
                content = last.get("content", "")
            else:
                content = getattr(last, "content", "")
            if isinstance(content, list):
                return " ".join(
                    str(c.get("text", "")) if isinstance(c, dict) else str(c) for c in content
                )
            return str(content)
        return str(messages)

    def call(self, messages: str | list[Any] | Any, **kwargs: Any) -> str:
        self.calls += 1
        prompt = self._prompt_text(messages)
        if "输出格式" in prompt:
            return (
                "## 复盘报告\n（固定总览）\n\n## 策略评估\n（固定评估）"
            )
        return "## 关键决策\n固定阶段决策\n\n## 失误与机会\n固定失误分析"

    async def acall(self, messages: str | list[Any] | Any, **kwargs: Any) -> str:
        return self.call(messages, **kwargs)


def _make_client(monkeypatch) -> MCPClient:
    """构造 fake MCP 客户端：按工具名返回固定 JSON。"""
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        if name == "get_replay_deltas":
            assert arguments["replayId"] == "r-1"
            return _tool_result(DELTAS_PAYLOAD)
        if name == "get_replay_semantic_view":
            return _tool_result(SEMANTIC_PAYLOAD)
        raise AssertionError(f"unexpected tool: {name}")

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    return client


# ---------------------------------------------------------------------------
# 区间划分与摘要
# ---------------------------------------------------------------------------


def test_split_into_segments_even() -> None:
    deltas = ReplayDelta.model_validate(DELTAS_PAYLOAD)
    segs = split_into_segments(deltas)
    assert [(s.name, s.from_turn, s.to_turn) for s in segs] == [
        ("early", 1, 2),
        ("mid", 3, 4),
        ("late", 5, 6),
    ]


def test_split_into_segments_short_replay() -> None:
    payload = {**DELTAS_PAYLOAD, "totalTurns": 2, "deltas": DELTAS_PAYLOAD["deltas"][:2]}
    segs = split_into_segments(ReplayDelta.model_validate(payload))
    assert [(s.name, s.from_turn, s.to_turn) for s in segs] == [
        ("early", 1, 1),
        ("mid", 2, 2),
        ("late", 3, 2),  # 空区间，调用方跳过
    ]


def test_split_into_segments_none() -> None:
    segs = split_into_segments(None)
    assert len(segs) == 1 and segs[0].name == "early"


def test_format_deltas() -> None:
    deltas = ReplayDelta.model_validate(DELTAS_PAYLOAD)
    text = format_deltas(deltas, from_turn=1, to_turn=2)
    assert "回合1" in text and "回合2" in text
    assert "Alice" in text and "Bob" in text
    assert "play_card" in text
    assert "降维打击" in text
    assert "回合3" not in text


# ---------------------------------------------------------------------------
# SemanticViewTool
# ---------------------------------------------------------------------------


async def test_semantic_view_tool_arun(monkeypatch) -> None:
    client = _make_client(monkeypatch)
    tool = SemanticViewTool(client=client, replay_id="r-1")
    out = await tool._arun(turn=2)
    payload = json.loads(out)
    assert payload["found"] is True
    assert payload["omniscientView"]["turn"] == 2
    assert payload["omniscientView"]["players"][0]["name"] == "Alice"


async def test_semantic_view_tool_not_found(monkeypatch) -> None:
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        return _tool_result({"found": False, "error": "未在本地找到该回放"})

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    tool = SemanticViewTool(client=client, replay_id="missing")
    out = await tool._arun(turn=1)
    assert "未在本地找到" in out


# ---------------------------------------------------------------------------
# Flow 全链路
# ---------------------------------------------------------------------------


async def test_flow_map_reduce_produces_final_report(monkeypatch) -> None:
    client = _make_client(monkeypatch)
    llm = FakeLLM()
    flow = ReplayAnalysisFlow(mcp_client=client, llm=llm)
    assert flow.suppress_flow_events is True
    await flow.kickoff_async(inputs={"replay_id": "r-1"})

    # Map：3 个阶段各 1 份分报告
    assert len(flow.state.phase_reports) == 3
    phases = {r.phase for r in flow.state.phase_reports}
    assert phases == {"early", "mid", "late"}
    assert all("关键决策" in r.markdown for r in flow.state.phase_reports)

    # winner 从 deltas 提取
    assert flow.state.winner == "Bob"

    # Reduce：最终报告含两节标题
    report = flow.state.final_report
    assert "复盘报告" in report
    assert "策略评估" in report
    # FakeLLM 覆盖 phase 分析（3）与汇总（1）
    assert llm.calls >= 4


async def test_flow_kickoff_emits_no_console_noise(
    monkeypatch, capsys
) -> None:
    """Flow 全程不向 stdout/stderr 打印 CrewAI Rich 面板噪声。

    ``suppress_flow_events=True`` 应关闭 Flow Execution / Method Running 等
    面板，避免被 bot subprocess 捕获混入聊天消息。
    """
    client = _make_client(monkeypatch)
    flow = ReplayAnalysisFlow(mcp_client=client, llm=FakeLLM())
    await flow.kickoff_async(inputs={"replay_id": "r-1"})

    out, err = capsys.readouterr()
    combined = out + err
    assert "Flow" not in combined
    assert "🌊" not in combined
    assert "┌" not in combined
    assert "复盘报告" not in out  # 报告经 final_report 返回，不走控制台


async def test_run_replay_analysis_helper(monkeypatch) -> None:
    client = _make_client(monkeypatch)
    report = await run_replay_analysis("r-1", mcp_client=client, llm=FakeLLM())
    assert "复盘报告" in report
    assert "策略评估" in report


# ---------------------------------------------------------------------------
# ensure_replay_local：未命中自动拉取
# ---------------------------------------------------------------------------


async def test_ensure_replay_local_hit_skips_fetch(monkeypatch) -> None:
    """本地已命中 → 不调 fetch_shared_replay。"""
    calls: list[str] = []
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        calls.append(name)
        if name == "get_replay_deltas":
            return _tool_result(DELTAS_PAYLOAD)
        raise AssertionError(f"unexpected tool: {name}")

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    await ensure_replay_local(client, "r-1")
    assert calls == ["get_replay_deltas"]


async def test_ensure_replay_local_miss_auto_fetches(monkeypatch) -> None:
    """本地未命中 → 自动 fetch_shared_replay 拉取成功。"""
    calls: list[str] = []
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        calls.append(name)
        if name == "get_replay_deltas":
            return _tool_error('回放 "r-9" 未在本地找到，请先调用 fetch_shared_replay 拉取')
        if name == "fetch_shared_replay":
            assert arguments == {"replayId": "r-9"}
            return _tool_result({"saved": True, "replayId": "r-9", "totalTurns": 6})
        raise AssertionError(f"unexpected tool: {name}")

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    await ensure_replay_local(client, "r-9")
    assert calls == ["get_replay_deltas", "fetch_shared_replay"]


async def test_ensure_replay_local_fetch_failure_raises_clear(monkeypatch) -> None:
    """拉取失败（游戏服务器不可达）→ 抛「自动拉取回放失败」。"""
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        if name == "get_replay_deltas":
            return _tool_error('回放 "r-9" 未在本地找到')
        if name == "fetch_shared_replay":
            return _tool_error("从游戏服务器拉取分享回放失败: connection refused")
        raise AssertionError(f"unexpected tool: {name}")

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    with pytest.raises(ValueError) as excinfo:
        await ensure_replay_local(client, "r-9")
    assert "自动拉取回放失败" in str(excinfo.value)


async def test_run_replay_analysis_auto_fetches_then_analyzes(monkeypatch) -> None:
    """端到端：探活未命中 → 自动拉取 → 正常分析产出两节报告。"""
    calls: list[str] = []
    client = MCPClient(url="http://localhost:9090/mcp")

    async def fake_call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        calls.append(name)
        if name == "get_replay_deltas":
            if arguments.get("toTurn") == 1:
                # 探活调用（ensure_replay_local）：未命中
                return _tool_error('回放 "r-1" 未在本地找到')
            return _tool_result(DELTAS_PAYLOAD)
        if name == "fetch_shared_replay":
            return _tool_result({"saved": True, "replayId": "r-1", "totalTurns": 6})
        if name == "get_replay_semantic_view":
            return _tool_result(SEMANTIC_PAYLOAD)
        raise AssertionError(f"unexpected tool: {name}")

    monkeypatch.setattr(client, "call_tool", fake_call_tool)
    report = await run_replay_analysis("r-1", mcp_client=client, llm=FakeLLM())

    assert "复盘报告" in report
    assert "策略评估" in report
    assert "fetch_shared_replay" in calls


def test_build_reduce_prompt_includes_winner() -> None:
    prompt = build_reduce_prompt(
        [PhaseReport(phase="early", markdown="早期报告")],
        winner="Bob",
    )
    assert "Bob" in prompt
    assert "复盘报告" in prompt
    assert "策略评估" in prompt


def _turn_with_elimination(reason: str | None, reason_field: bool = True) -> dict[str, Any]:
    """构造含淘汰玩家的 TurnDelta 原始 JSON。"""
    data = _turn(2, "p2")
    pc = data["changes"]["players"][0]
    pc["eliminated"] = True
    if reason_field:
        pc["eliminationReason"] = reason or ""
    return data


def test_format_turn_renders_elimination_reason() -> None:
    """_format_turn 渲染淘汰原因：timeout → 「淘汰（回合超时）」。"""
    from darkforest_analyser.crew import _format_turn

    deltas = ReplayDelta.model_validate(
        {
            "replayId": "r-1",
            "totalTurns": 2,
            "fromTurn": 1,
            "toTurn": 2,
            "deltas": [_turn_with_elimination("timeout")],
        }
    )
    text = _format_turn(deltas.deltas[0])
    assert "淘汰（回合超时）" in text


def test_format_turn_renders_fallback_and_forfeit_and_strike() -> None:
    """_format_turn 对四种原因分别渲染对应中文标签。"""
    from darkforest_analyser.crew import _format_turn

    cases = {
        "fallback": "断线兜底",
        "forfeit": "弃权",
        "strike": "局内打击",
        "timeout": "回合超时",
    }
    for reason, label in cases.items():
        deltas = ReplayDelta.model_validate(
            {
                "replayId": "r-1",
                "totalTurns": 2,
                "fromTurn": 1,
                "toTurn": 2,
                "deltas": [_turn_with_elimination(reason)],
            }
        )
        text = _format_turn(deltas.deltas[0])
        assert f"淘汰（{label}）" in text, f"reason={reason} 应渲染为 {label}"


def test_format_turn_renders_unknown_reason() -> None:
    """_format_turn 对缺失/未知原因渲染「原因未知」，禁止编造。"""
    from darkforest_analyser.crew import _format_turn

    # 缺省字段（无 eliminationReason key）
    deltas = ReplayDelta.model_validate(
        {
            "replayId": "r-1",
            "totalTurns": 2,
            "fromTurn": 1,
            "toTurn": 2,
            "deltas": [_turn_with_elimination(None, reason_field=False)],
        }
    )
    text = _format_turn(deltas.deltas[0])
    assert "淘汰（原因未知）" in text

    # 未知值
    deltas2 = ReplayDelta.model_validate(
        {
            "replayId": "r-1",
            "totalTurns": 2,
            "fromTurn": 1,
            "toTurn": 2,
            "deltas": [_turn_with_elimination("mystery")],
        }
    )
    assert "淘汰（原因未知）" in _format_turn(deltas2.deltas[0])


def test_phase_prompt_requires_elimination_reason() -> None:
    """build_phase_prompt 显式要求区分淘汰原因且禁止编造。"""
    from darkforest_analyser.crew import build_phase_prompt, split_into_segments

    segs = split_into_segments(
        ReplayDelta.model_validate(DELTAS_PAYLOAD)
    )
    prompt = build_phase_prompt(segs[0], None)
    assert "淘汰原因" in prompt
    assert "禁止自行编造淘汰原因" in prompt
