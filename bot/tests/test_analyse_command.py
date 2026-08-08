"""Tests for commands/analyse.py — .analyse 对局复盘分析命令。

覆盖三场景（monkeypatch subprocess 模拟 analyser CLI）：
1. replayId 缺失且无最近对局 → 私聊提示「请指定回放ID」
2. 本地回放未命中（analyser 非零退出且 stderr 含「未在本地找到」）
   → 提示「回放未在本地找到，请先保存」
3. 分析成功 → 私聊回传 markdown 报告（含「复盘报告」「策略评估」两节）

复用 conftest.py 的 autouse fixture：每个测试前 init_state() 重建
Settings / SessionManager / GameSessionStore，测试内直接经 get_game_session_store()
获取空 store（无最近对局）。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

import darkforest_bot.commands.analyse as analyse_mod
from darkforest_bot.commands.analyse import (
    _chunk_markdown,
    _clean_analyser_stdout,
    _extract_error_summary,
    handle_analyse_request,
)
from darkforest_bot.config import Settings
from darkforest_bot.state import get_game_session_store

QQ = 12345

REPORT = (
    "# 复盘报告\n\n"
    "对局总览：红方早期抢占星系 3，中期双线打击。\n\n"
    "关键转折点：第 5 回合毁灭核心星系。\n\n"
    "# 策略评估\n\n"
    "红方策略执行度 90%，蓝方过于保守。"
)


def _fake_runner(
    returncode: int = 0, stdout: str = "", stderr: str = ""
) -> Any:
    """构造 async run_analyser fake（返回固定结果）。"""

    async def _run(replay_id: str, settings: Settings) -> analyse_mod.AnalyserResult:
        return analyse_mod.AnalyserResult(
            returncode=returncode, stdout=stdout, stderr=stderr
        )

    return _run


def _private_messages(bot: AsyncMock) -> list[Any]:
    """返回全部 send_private_msg 调用的 message 参数。"""
    calls = [
        c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"
    ]
    return [c.kwargs["message"] for c in calls]


def _flow_panel(title: str, body: list[str], width: int = 72) -> str:
    """按 CrewAI Rich 面板的边框结构构造测试噪声。"""
    t = f" {title} "
    pad = width - len(t) - 2
    left, right = pad // 2, pad - pad // 2
    lines = [f"┌{'─' * left}{t}{'─' * right}┐"]
    for b in body:
        lines.append(f"│  {b:<{width - 4}}  │")
    lines.append(f"└{'─' * width}┘")
    return "\n".join(lines)


NOISY_REPORT = (
    _flow_panel("🌊 Flow Execution", ["Starting Flow Execution", "Name: ReplayAnalysisFlow"])
    + "\n\n"
    + _flow_panel("🔄 Flow Method Running", ["Method: fetch_deltas", "Status: Running"])
    + "\n\n"
    + REPORT
)


class TestAnalyseCommand:
    async def test_missing_replay_id_without_last_replay_prompts(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """场景1：无参数且无最近对局 → 「请指定回放ID」，不调 analyser。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()  # 空 store：无最近对局
        called: list[tuple[str, Settings]] = []

        async def fake_run(
            replay_id: str, settings: Settings,
        ) -> analyse_mod.AnalyserResult:
            called.append((replay_id, settings))
            return analyse_mod.AnalyserResult()

        monkeypatch.setattr(analyse_mod, "run_analyser", fake_run)

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="", settings=settings,
            game_session_store=store,
        )

        assert called == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "请指定回放ID" in msgs[0]

    async def test_missing_replay_id_uses_last_replay(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """无参数但有最近对局 → 用最近对局 ID 调 analyser。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()
        store.record_replay_settled(QQ, "recent-replay-1")
        seen: list[str] = []

        async def fake_run(
            replay_id: str, settings: Settings,
        ) -> analyse_mod.AnalyserResult:
            seen.append(replay_id)
            return analyse_mod.AnalyserResult(returncode=0, stdout=REPORT)

        monkeypatch.setattr(analyse_mod, "run_analyser", fake_run)

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="", settings=settings,
            game_session_store=store,
        )

        assert seen == ["recent-replay-1"]
        msgs = _private_messages(bot)
        assert len(msgs) == 2
        assert "等待" in msgs[0]
        assert "复盘报告" in msgs[1]

    async def test_local_replay_miss_reports_not_found(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """场景2：analyser 非零退出且 stderr 含「未在本地找到」→ 明确提示。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()
        stderr = 'Error: 回放 "abc-123" 未在本地找到，请先调用 fetch_shared_replay 拉取'

        monkeypatch.setattr(
            analyse_mod, "run_analyser",
            _fake_runner(returncode=1, stderr=stderr),
        )

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="abc-123", settings=settings,
            game_session_store=store,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 2
        assert "等待" in msgs[0]
        assert "回放未在本地找到" in msgs[1]
        assert "请先保存" in msgs[1]

    async def test_failure_with_empty_stdout_reports_failure(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """非零退出但 stderr 不含「未在本地找到」→ 分析失败 + stderr 摘要。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()

        monkeypatch.setattr(
            analyse_mod, "run_analyser",
            _fake_runner(returncode=2, stderr="连接 mcpserver 失败"),
        )

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="abc-123", settings=settings,
            game_session_store=store,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 2
        assert "等待" in msgs[0]
        assert "分析失败" in msgs[1]
        assert "连接 mcpserver 失败" in msgs[1]

    async def test_failure_reports_real_error_not_crewai_noise(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """stderr 混入 crewai UserWarning 噪音 → 私聊摘要过滤噪音、展示真实错误。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()
        stderr = (
            r"E:\analyser\.venv\Lib\site-packages\crewai\flow\runtime\__init__.py:426: "
            'UserWarning: Field name "state" shadows an attribute\n'
            "  return super().__new__(mcs, name, bases, namespace)\n"
            "litellm.exceptions.APIError: API call failed: 401 Invalid API key\n"
        )

        monkeypatch.setattr(
            analyse_mod, "run_analyser",
            _fake_runner(returncode=1, stderr=stderr),
        )

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="abc-123", settings=settings,
            game_session_store=store,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 2
        assert "等待" in msgs[0]
        assert "分析失败" in msgs[1]
        assert "Invalid API key" in msgs[1]
        assert "UserWarning" not in msgs[1]

    async def test_success_replies_report(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """场景3：分析成功 → 私聊回传报告（含两节标题）。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()

        monkeypatch.setattr(
            analyse_mod, "run_analyser", _fake_runner(stdout=REPORT),
        )

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="abc-123", settings=settings,
            game_session_store=store,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 2
        assert "等待" in msgs[0]
        assert "复盘报告" in msgs[1]
        assert "策略评估" in msgs[1]

    async def test_acknowledge_sent_first_with_replay_id(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """即时等待提示先于报告回传，且包含待分析回放 ID。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()

        async def fake_run(
            replay_id: str, settings: Settings,
        ) -> analyse_mod.AnalyserResult:
            return analyse_mod.AnalyserResult(returncode=0, stdout=REPORT)

        monkeypatch.setattr(analyse_mod, "run_analyser", fake_run)

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="id-xyz", settings=settings,
            game_session_store=store,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 2
        assert "id-xyz" in msgs[0]
        assert "等待" in msgs[0]
        assert "复盘报告" in msgs[1]

    async def test_success_strips_crewai_flow_noise(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """成功但 stdout 混入 CrewAI Flow 面板 → 回传消息只含报告。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()

        monkeypatch.setattr(
            analyse_mod, "run_analyser", _fake_runner(stdout=NOISY_REPORT),
        )

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="abc-123", settings=settings,
            game_session_store=store,
        )

        msgs = _private_messages(bot)
        joined = "\n".join(str(m) for m in msgs)
        assert "复盘报告" in joined
        assert "策略评估" in joined
        assert "┌" not in joined
        assert "Flow" not in joined
        assert "🌊" not in joined

    async def test_long_report_split_into_multiple_messages(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """报告超长 → 按段落拆成多条私聊消息，内容完整。"""
        bot = AsyncMock()
        settings = Settings()
        store = get_game_session_store()
        long_paragraph = "长段落。\n" * 2000  # 单段落超长
        report = (
            f"# 复盘报告\n\n{long_paragraph}\n\n"
            f"# 策略评估\n\n结论。"
        )

        monkeypatch.setattr(
            analyse_mod, "run_analyser", _fake_runner(stdout=report),
        )

        await handle_analyse_request(
            bot=bot, user_id=QQ, raw_args="abc-123", settings=settings,
            game_session_store=store,
        )

        msgs = _private_messages(bot)
        assert len(msgs) >= 2
        joined = "\n".join(str(m) for m in msgs)
        assert "复盘报告" in joined
        assert "策略评估" in joined


class TestChunkMarkdown:
    def test_short_text_single_chunk(self) -> None:
        chunks = _chunk_markdown(REPORT)
        assert chunks == [REPORT]

    def test_long_text_split_keeps_paragraphs(self) -> None:
        para = "段落内容。" * 500  # 1500 字，小于 max_len
        text = "\n\n".join([f"段落{i}\n{para}" for i in range(10)])
        chunks = _chunk_markdown(text, max_len=2000)
        assert len(chunks) > 1
        assert all(len(c) <= 2000 for c in chunks)
        # 内容不丢失（拼接后子串）
        assert "段落9" in "\n".join(chunks)

    def test_overlong_single_paragraph_split_by_lines(self) -> None:
        text = "行内容。" * 3000  # 9000 字单段落
        chunks = _chunk_markdown(text, max_len=4000)
        assert len(chunks) > 1
        assert all(len(c) <= 4000 for c in chunks)
        assert "行内容" in "".join(chunks)

    def test_empty_text_returns_single_empty_chunk(self) -> None:
        assert _chunk_markdown("") == [""]


class TestCleanAnalyserStdout:
    def test_noisy_stdout_reduces_to_report(self) -> None:
        cleaned = _clean_analyser_stdout(NOISY_REPORT)
        assert "复盘报告" in cleaned
        assert "策略评估" in cleaned
        assert "┌" not in cleaned
        assert "│" not in cleaned
        assert "Flow" not in cleaned
        assert "🌊" not in cleaned

    def test_plain_report_passthrough(self) -> None:
        assert _clean_analyser_stdout(REPORT) == REPORT

    def test_ansi_escape_stripped(self) -> None:
        text = "\x1b[32m# 复盘报告\x1b[0m\n\x1b[1m对局总览\x1b[0m"
        cleaned = _clean_analyser_stdout(text)
        assert cleaned == "# 复盘报告\n对局总览"
        assert "\x1b" not in cleaned

    def test_unclosed_panel_keeps_trailing_report(self) -> None:
        """面板未闭合（缺底边）→ 后续报告行不被误吞。"""
        panel_lines = _flow_panel(
            "🌊 Flow Started", ["Name: ReplayAnalysisFlow"]
        ).splitlines()
        broken = "\n".join(panel_lines[:-1]) + "\n\n" + REPORT
        cleaned = _clean_analyser_stdout(broken)
        assert "复盘报告" in cleaned
        assert "策略评估" in cleaned

    def test_panel_only_returns_empty(self) -> None:
        noise = (
            _flow_panel("🌊 Flow Execution", ["Starting Flow Execution"])
            + "\n"
            + _flow_panel("✅ Flow Completion", ["Flow Execution Completed"])
        )
        assert _clean_analyser_stdout(noise) == ""

    def test_blank_runs_collapsed(self) -> None:
        text = f"{REPORT}\n\n\n\n\n# 尾部标题"
        cleaned = _clean_analyser_stdout(text)
        assert "\n\n\n" not in cleaned
        assert "# 尾部标题" in cleaned


class _FakeProc:
    """模拟 asyncio subprocess：记录 kill 调用，communicate 返回空。"""

    def __init__(self) -> None:
        self.returncode = -1
        self.killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        return b"", b""

    def kill(self) -> None:
        self.killed = True


class TestExtractErrorSummary:
    def test_plain_error_kept_verbatim(self) -> None:
        assert _extract_error_summary("连接 mcpserver 失败") == "连接 mcpserver 失败"

    def test_crewai_warning_noise_filtered(self) -> None:
        """crewai UserWarning 块 + 真实错误 → 只保留真实错误。"""
        stderr = (
            r"E:\analyser\.venv\Lib\site-packages\crewai\flow\runtime\__init__.py:426: "
            "UserWarning: Field name \"state\" in \"ReplayAnalysisFlow\" shadows "
            "an attribute in parent \"Flow.__class_getitem__.<locals>._FlowGeneric\"\n"
            "  return super().__new__(mcs, name, bases, namespace)\n"
            "\n"
            "Traceback (most recent call last):\n"
            '  File "darkforest_analyser\\cli.py", line 68, in main\n'
            "    report = asyncio.run(run_replay_analysis(...))\n"
            "litellm.exceptions.APIError: API call failed: 401 Invalid API key\n"
        )
        summary = _extract_error_summary(stderr)
        assert "UserWarning" not in summary
        assert "APIError" in summary
        assert "Invalid API key" in summary

    def test_all_warning_falls_back_to_raw(self) -> None:
        """全被过滤（只有 warning）→ 退回原始 stderr。"""
        stderr = (
            r"site-packages\crewai\flow\runtime\__init__.py:426: UserWarning: "
            "Field name \"state\" shadows an attribute\n"
            "  return super().__new__(mcs, name, bases, namespace)\n"
        )
        summary = _extract_error_summary(stderr)
        assert "UserWarning" in summary  # 原样退回

    def test_long_tail_kept_with_ellipsis(self) -> None:
        text = "开头噪音\n" + "中间填充\n" * 50 + "真实错误在结尾:InvalidRequestError: balance insufficient"
        summary = _extract_error_summary(text, limit=60)
        assert summary.startswith("…")
        assert "InvalidRequestError: balance insufficient" in summary
        assert len(summary) <= 61  # 前缀 + 60 字符

    def test_mixed_warnings_and_error_keeps_error_tail(self) -> None:
        """多条 warning + 错误 → 摘要含错误、不含任何 Warning 字样。"""
        stderr = (
            "path1.py:1: DeprecationWarning: deprecated stuff\n"
            "  code line\n"
            "path2.py:2: UserWarning: more noise\n"
            "  another line\n"
            "RuntimeError: 分析失败：LLM 返回空\n"
        )
        summary = _extract_error_summary(stderr)
        assert "RuntimeError" in summary
        assert "LLM 返回空" in summary
        assert "Warning" not in summary


class TestRunAnalyser:
    def test_settings_default_timeout_is_600(self) -> None:
        """默认 analyse_timeout 为 600s（多次 LLM 调用预留充足时间）。"""
        settings = Settings()
        assert settings.analyse_timeout == 600.0

    async def test_timeout_kills_process_and_reports_dynamic_seconds(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """超时 → 杀进程 + 提示使用 settings.analyse_timeout 的动态秒数。"""
        proc = _FakeProc()

        async def fake_wait_for(awaitable: Any, timeout: float) -> Any:
            raise TimeoutError()

        async def fake_create_subprocess_exec(
            *args: Any, **kwargs: Any,
        ) -> _FakeProc:
            return proc

        monkeypatch.setattr(analyse_mod.asyncio, "wait_for", fake_wait_for)
        monkeypatch.setattr(
            analyse_mod.asyncio, "create_subprocess_exec",
            fake_create_subprocess_exec,
        )

        settings = Settings(analyse_timeout=300.0)
        result = await analyse_mod.run_analyser("abc-123", settings)

        assert proc.killed
        assert result.returncode == -1
        assert "分析超时" in result.stderr
        assert "300s" in result.stderr

    async def test_binary_not_found_returns_clear_error(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """analyser 可执行文件缺失 → 明确错误而非裸异常。"""

        async def fake_create_subprocess_exec(
            *args: Any, **kwargs: Any,
        ) -> _FakeProc:
            raise FileNotFoundError()

        monkeypatch.setattr(
            analyse_mod.asyncio, "create_subprocess_exec",
            fake_create_subprocess_exec,
        )

        settings = Settings(analyse_bin="no-such-analyser")
        result = await analyse_mod.run_analyser("abc-123", settings)

        assert result.returncode == -1
        assert "找不到 analyser 可执行文件" in result.stderr
        assert "no-such-analyser" in result.stderr

    async def test_passes_cwd_to_subprocess(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """ANALYSE_CWD 配置 → 子进程在该目录启动（analyser 相对 cwd 读 .env
        的 LLM 配置）；留空 → cwd 为 None（继承 bot cwd）。"""
        captured: dict[str, Any] = {}

        async def fake_create_subprocess_exec(
            *args: Any, **kwargs: Any,
        ) -> _FakeProc:
            captured["args"] = args
            captured["cwd"] = kwargs.get("cwd")
            return _FakeProc()

        monkeypatch.setattr(
            analyse_mod.asyncio, "create_subprocess_exec",
            fake_create_subprocess_exec,
        )

        # 配置 ANALYSE_CWD
        settings = Settings(analyse_cwd=r"E:\DarkForest\analyser")
        await analyse_mod.run_analyser("abc-123", settings)
        assert captured["cwd"] == r"E:\DarkForest\analyser"
        assert captured["args"][0] == settings.analyse_bin

        # 留空 → 继承 bot cwd（_env_file=None 隔离 bot/.env 的 ANALYSE_CWD）
        await analyse_mod.run_analyser("abc-123", Settings(_env_file=None))
        assert captured["cwd"] is None
