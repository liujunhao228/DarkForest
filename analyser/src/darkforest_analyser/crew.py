"""CrewAI Flow 编排的 Map-Reduce 复盘分析流水线。

流程拓扑：

    start(fetch_deltas)
        └─▶ listen(map_phases)：按 ``totalTurns // 3`` 划分早/中/终盘三区间，
            并行 kickoff 3 个阶段分析 Agent（各带 ``get_replay_semantic_view``
            下钻工具）
                └─▶ listen(reduce_report)：汇总 Agent 综合三份分报告 + 胜者，
                    产出最终 markdown（含「复盘报告」「策略评估」两节）

依赖注入：``ReplayAnalysisFlow`` 接受 ``mcp_client`` 与 ``llm`` 参数，测试可
替换为 fake（见 ``tests/test_crew.py``）。LLM 缺省时经 ``build_llm`` 用
``crewai.LLM`` 按 Settings 构建。

控制台输出：Flow 以 ``suppress_flow_events=True`` 构造，关闭 CrewAI 的 Rich
面板（对用户无意义且会被 bot subprocess 捕获混入 stdout），保证 ``stdout``
仅含最终报告。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from crewai import LLM, Agent, Crew, Flow, Task
from crewai.flow.flow import listen, start
from crewai.llm import BaseLLM  # type: ignore[attr-defined]  # crewai 未显式导出
from crewai.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr

from darkforest_analyser.config import Settings, load_settings
from darkforest_analyser.mcp_client import MCPClient, ReplayDelta, TurnDelta

# ---------------------------------------------------------------------------
# 领域模型
# ---------------------------------------------------------------------------


class PhaseSegment(BaseModel):
    """一个分析阶段（早/中/终盘）的回合区间。"""

    name: str
    from_turn: int
    to_turn: int


class PhaseReport(BaseModel):
    """单个阶段的复盘分报告。"""

    phase: str
    markdown: str


class ReplayAnalysisState(BaseModel):
    """Flow 状态：各阶段共享的数据。"""

    replay_id: str = ""
    deltas: ReplayDelta | None = None
    segments: list[PhaseSegment] = Field(default_factory=list)
    phase_reports: list[PhaseReport] = Field(default_factory=list)
    winner: str = ""
    final_report: str = ""


PHASE_NAMES: tuple[str, str, str] = ("early", "mid", "late")

# ---------------------------------------------------------------------------
# LLM 构建
# ---------------------------------------------------------------------------


def build_llm(settings: Settings | None = None) -> BaseLLM:
    """按 Settings 构建 CrewAI LLM（OpenAI 兼容端点，如 DeepSeek）。"""
    s = settings or load_settings()
    kwargs: dict[str, Any] = {"model": s.analyse_llm_model}
    if s.analyse_llm_base_url:
        kwargs["base_url"] = s.analyse_llm_base_url
    if s.analyse_llm_api_key:
        kwargs["api_key"] = s.analyse_llm_api_key
    return LLM(**kwargs)


# ---------------------------------------------------------------------------
# 区间划分与回放摘要
# ---------------------------------------------------------------------------


def split_into_segments(deltas: ReplayDelta | None) -> list[PhaseSegment]:
    """把 1..totalTurns 均分为三区间（不足时允许空区间，调用方跳过）。"""
    if deltas is None or deltas.total_turns <= 0:
        return [PhaseSegment(name="early", from_turn=1, to_turn=0)]
    total = deltas.total_turns
    step = max(1, total // 3)
    segments: list[PhaseSegment] = []
    start_turn = 1
    for idx, name in enumerate(PHASE_NAMES):
        end_turn = min(total, start_turn + step - 1) if idx < len(PHASE_NAMES) - 1 else total
        segments.append(PhaseSegment(name=name, from_turn=start_turn, to_turn=end_turn))
        start_turn = end_turn + 1
    return segments


def _format_actions(turn: TurnDelta) -> str:
    bits = []
    for a in turn.actions:
        data = json.dumps(a.data, ensure_ascii=False) if a.data else ""
        bits.append(f"{turn.player_name or a.player_id} {a.action}({data})")
    return "; ".join(bits) or "无动作"


def _format_turn(turn: TurnDelta) -> str:
    change_bits = []
    for p in turn.changes.players:
        added = ",".join(p.hand_added) or "-"
        removed = ",".join(p.hand_removed) or "-"
        change_bits.append(f"{p.player_name}: +[{added}] -[{removed}] 能量{p.energy_delta:+d}")
    strikes = ",".join(turn.changes.flying_strikes_added) or "-"
    destroyed = ",".join(str(s) for s in turn.changes.destroyed_stars_added) or "-"
    return (
        f"回合{turn.turn}（{turn.player_name or turn.player_id}）："
        f"动作[{_format_actions(turn)}]；"
        f"变化[{'; '.join(change_bits)}]；"
        f"新增打击[{strikes}]；毁星[{destroyed}]"
    )


def format_deltas(deltas: ReplayDelta | None, from_turn: int, to_turn: int) -> str:
    """把区间内的回合 delta 格式化为紧凑文本（喂给阶段 Agent）。"""
    if deltas is None:
        return "(无回放数据)"
    lines = [
        _format_turn(t) for t in deltas.deltas if from_turn <= t.turn <= to_turn
    ]
    return "\n".join(lines) or "(该区间无回合记录)"


# ---------------------------------------------------------------------------
# Agent 提示词
# ---------------------------------------------------------------------------

PHASE_BACKSTORIES: dict[str, str] = {
    "early": (
        "你是《三体》风格的星际战争复盘分析师，专攻对局早期。"
        "你擅长从开局布局、扩张节奏与早期博弈中识别战略意图与潜在失误。"
    ),
    "mid": (
        "你是《三体》风格的星际战争复盘分析师，专攻对局中期。"
        "你擅长分析科技攀爬、打击交换与位置博弈的中盘角力。"
    ),
    "late": (
        "你是《三体》风格的星际战争复盘分析师，专攻对局终盘。"
        "你擅长从终局打击链、资源枯竭与生存竞争中总结决定胜负的转折点。"
    ),
}

PHASE_LABELS: dict[str, str] = {"early": "早期", "mid": "中期", "late": "终盘"}


def build_phase_prompt(segment: PhaseSegment, deltas: ReplayDelta | None) -> str:
    """构造阶段分析 Agent 的任务描述。"""
    label = PHASE_LABELS.get(segment.name, segment.name)
    return (
        f"分析回放中第 {segment.from_turn}-{segment.to_turn} 回合"
        f"（{label}阶段）的走势。\n\n"
        "本阶段回合明细：\n"
        f"{format_deltas(deltas, segment.from_turn, segment.to_turn)}\n\n"
        "分析要求：\n"
        "1. 识别该阶段每位玩家的关键决策与战略意图；\n"
        "2. 指出关键失误或错失的机会；\n"
        "3. 如需查看某回合的完整全知视角（所有玩家手牌、飞行打击、星系状态），"
        "调用 get_replay_semantic_view 工具下钻关键回合。\n\n"
        "输出：该阶段的 markdown 分报告，包含「关键决策」「失误与机会」小节。"
    )


def build_reduce_prompt(reports: list[PhaseReport], winner: str) -> str:
    """构造汇总 Agent 的任务描述。"""
    body = "\n\n".join(
        f"## {PHASE_LABELS.get(r.phase, r.phase)}分报告\n{r.markdown}" for r in reports
    )
    return (
        "你是一名《三体》风格的星际战争复盘总分析师。"
        "请综合以下阶段分报告，产出一份完整的对局复盘报告。\n\n"
        f'胜者：{winner or "未判定"}\n\n'
        "阶段分报告：\n"
        f"{body}\n\n"
        "输出格式（markdown），必须包含以下两节标题：\n"
        "# 复盘报告\n"
        "（对局总览、关键转折点、各阶段核心结论）\n\n"
        "# 策略评估\n"
        "（每位玩家的策略执行度、可改进点、胜因/败因分析）"
    )


# ---------------------------------------------------------------------------
# 语义视图下钻工具
# ---------------------------------------------------------------------------


class _SemanticViewInput(BaseModel):
    turn: int = Field(description="要下钻的玩家回合数")


_SEMANTIC_TOOL_NAME = "get_replay_semantic_view"
_SEMANTIC_TOOL_DESCRIPTION = (
    "获取指定回合的全知视角语义投影（所有玩家手牌、飞行打击、星系状态），"
    "用于下钻关键回合进行深度分析"
)


class SemanticViewTool(BaseTool):
    """包装 ``call_get_replay_semantic_view`` 的 CrewAI 工具。

    返回 JSON 文本；回放未命中时返回带说明的错误文本。
    """

    name: str = _SEMANTIC_TOOL_NAME
    description: str = _SEMANTIC_TOOL_DESCRIPTION
    args_schema: type[BaseModel] = _SemanticViewInput

    _client: MCPClient = PrivateAttr()
    _replay_id: str = PrivateAttr(default="")

    def __init__(self, client: MCPClient, replay_id: str) -> None:
        super().__init__(name=_SEMANTIC_TOOL_NAME, description=_SEMANTIC_TOOL_DESCRIPTION)
        self._client = client
        self._replay_id = replay_id

    @staticmethod
    def _resolve_turn(args: tuple[Any, ...], kwargs: dict[str, Any]) -> int:
        raw: Any
        if "turn" in kwargs:
            raw = kwargs["turn"]
        elif args:
            raw = args[0]
        else:
            raise ValueError("SemanticViewTool 缺少 turn 参数")
        return int(raw)

    def _run(self, *args: Any, **kwargs: Any) -> str:
        turn = self._resolve_turn(args, kwargs)
        return asyncio.run(self._arun(turn=turn))

    async def _arun(self, *args: Any, **kwargs: Any) -> str:
        turn = self._resolve_turn(args, kwargs)
        out = await self._client.call_get_replay_semantic_view(self._replay_id, turn)
        if not out.found:
            return f"[未找到回放：{out.error}]"
        return out.model_dump_json(by_alias=True, exclude_none=True)


# ---------------------------------------------------------------------------
# Flow
# ---------------------------------------------------------------------------


class ReplayAnalysisFlow(Flow[ReplayAnalysisState]):
    """Map-Reduce 复盘分析 Flow。

    Args:
        mcp_client: 已连接的 MCP 客户端（测试可传 fake）。
        llm: CrewAI LLM；缺省时用 ``build_llm`` 按 Settings 构建。
        settings: 运行配置；仅当 llm 未提供时生效。

    注意：Flow 以 ``suppress_flow_events=True`` 构造，关闭 CrewAI 的控制台
    Rich 面板（Flow Execution / Method Running / Completion 等）。这些面板
    无视 ``verbose`` 无条件打印，本包作为 subprocess 被 bot 消费，噪声会混入
    stdout 干扰用户，故经官方开关源头关掉。
    """

    # 显式声明 state 类型：mypy 对 Flow 泛型的 self.state 解析为 Any，声明后
    # 可静态推导字段类型（已用 demo 验证不改变 Flow 运行时语义）。
    state: ReplayAnalysisState = Field(default_factory=ReplayAnalysisState)

    def __init__(
        self,
        mcp_client: MCPClient,
        llm: BaseLLM | None = None,
        settings: Settings | None = None,
    ) -> None:
        super().__init__(tracing=False, suppress_flow_events=True)
        self.mcp_client = mcp_client
        self._llm = llm if llm is not None else build_llm(settings or load_settings())
        self._segments: list[PhaseSegment] = []

    # -- start -------------------------------------------------------------

    @start()
    async def fetch_deltas(self) -> ReplayDelta:
        """拉取全量逐回合 delta，并按 totalTurns//3 划分三区间。"""
        deltas = await self.mcp_client.call_get_replay_deltas(self.state.replay_id)
        self.state.deltas = deltas
        self._segments = split_into_segments(deltas)
        self.state.segments = self._segments
        return deltas

    # -- map ---------------------------------------------------------------

    @listen(fetch_deltas)
    async def map_phases(self) -> list[PhaseReport]:
        """并行 kickoff 3 个阶段分析 Crew（空区间跳过）。"""
        crews = [
            self._phase_crew(seg)
            for seg in self._segments
            if seg.from_turn <= seg.to_turn
        ]
        results = await asyncio.gather(*(crew.kickoff_async() for crew in crews))
        reports = [
            PhaseReport(phase=seg.name, markdown=str(result))
            for seg, result in zip(self._segments, results, strict=False)
            if seg.from_turn <= seg.to_turn
        ]
        self.state.phase_reports = reports
        return reports

    # -- reduce ------------------------------------------------------------

    @listen(map_phases)
    async def reduce_report(self) -> str:
        """汇总 Agent 综合三份分报告 + 胜者，产出最终复盘报告。"""
        winner = self._extract_winner()
        self.state.winner = winner
        result = await self._reduce_crew(winner).kickoff_async()
        self.state.final_report = str(result)
        return self.state.final_report

    # -- 内部构造 ----------------------------------------------------------

    def _phase_crew(self, segment: PhaseSegment) -> Crew:
        agent = Agent(
            role=f"{PHASE_LABELS.get(segment.name, segment.name)}复盘分析师",
            goal="分析该阶段的关键决策与失误，输出该阶段的复盘分报告",
            backstory=PHASE_BACKSTORIES.get(segment.name, PHASE_BACKSTORIES["early"]),
            llm=self._llm,
            tools=[SemanticViewTool(client=self.mcp_client, replay_id=self.state.replay_id)],
            verbose=False,
            max_iter=4,
        )
        task = Task(
            description=build_phase_prompt(segment, self.state.deltas),
            expected_output="该阶段的 markdown 复盘分报告",
            agent=agent,
        )
        return Crew(agents=[agent], tasks=[task], verbose=False, tracing=False)

    def _reduce_crew(self, winner: str) -> Crew:
        agent = Agent(
            role="复盘总分析师",
            goal="综合阶段分报告与胜者信息，产出包含「复盘报告」「策略评估」两节的最终复盘报告",
            backstory=(
                "你是《三体》风格的星际战争复盘总分析师，"
                "擅长综合多视角证据形成全局判断。"
            ),
            llm=self._llm,
            verbose=False,
            max_iter=4,
        )
        task = Task(
            description=build_reduce_prompt(self.state.phase_reports, winner),
            expected_output="包含「复盘报告」「策略评估」两节的 markdown 复盘报告",
            agent=agent,
        )
        return Crew(agents=[agent], tasks=[task], verbose=False, tracing=False)

    def _extract_winner(self) -> str:
        deltas = self.state.deltas
        if deltas is None:
            return ""
        for t in reversed(deltas.deltas):
            if t.changes.winner:
                return t.changes.winner
        return ""


# ---------------------------------------------------------------------------
# CLI 高层入口
# ---------------------------------------------------------------------------

# ``get_replay_deltas`` 未命中回放时 Go 端错误文本的标记。
_REPLAY_NOT_FOUND_MARKER = "未在本地找到"


async def ensure_replay_local(client: MCPClient, replay_id: str) -> None:
    """确保回放已持久化到本地 SQLite；未命中时自动 fetch_shared_replay 拉取。

    .analyse 的使用预期是「分析前自动拉取」，而不是要求用户手动保存。
    拉取失败（游戏服务器不可达 / 回放不存在 / 账号池无可用）时抛清晰异常，
    由上层透出给用户。
    """
    try:
        # 轻量探活：只取 1 回合，命中即认为本地已就绪。
        await client.call_get_replay_deltas(replay_id, from_turn=1, to_turn=1)
        return
    except ValueError as exc:
        if _REPLAY_NOT_FOUND_MARKER not in str(exc):
            raise
    try:
        out = await client.call_fetch_shared_replay(replay_id)
    except ValueError as exc:
        raise ValueError(f"自动拉取回放失败：{exc}") from exc
    if not out.saved:
        raise ValueError(f"自动拉取回放失败：{out.message or '未知原因'}")


async def run_replay_analysis(
    replay_id: str,
    mcp_client: MCPClient | None = None,
    llm: BaseLLM | None = None,
    settings: Settings | None = None,
) -> str:
    """跑完整复盘流水线，返回最终 markdown（CLI 与 bot .analyse 消费）。

    分析前先 ``ensure_replay_local``：本地未命中时自动经 fetch_shared_replay
    拉取，避免「请先保存」的手动前置步骤。
    """
    s = settings or load_settings()
    client = mcp_client if mcp_client is not None else MCPClient(url=s.analyse_mcp_url)
    await ensure_replay_local(client, replay_id)
    flow = ReplayAnalysisFlow(mcp_client=client, llm=llm, settings=s)
    await flow.kickoff_async(inputs={"replay_id": replay_id})
    return flow.state.final_report
