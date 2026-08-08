"""CLI 入口测试：typer.testing.CliRunner + monkeypatch run_replay_analysis。

断言维度：默认 stdout 输出含「复盘报告」「策略评估」两节标题、--output 写文件、
--mcp-url/--llm-model 覆盖 Settings、底层异常传播为非零退出码。
"""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from darkforest_analyser import cli

runner = CliRunner()

SAMPLE_REPORT = (
    "# 复盘报告\n\n"
    "对局总览：测试对局。\n\n"
    "关键转折点：第 3 回合的打击交换。\n\n"
    "# 策略评估\n\n"
    "玩家A：扩张稳健。\n"
)


def _patch_report(
    monkeypatch: object, captured: dict[str, object] | None = None
) -> None:
    async def fake_run(
        replay_id: str,
        mcp_client: object = None,
        llm: object = None,
        settings: object = None,
    ) -> str:
        if captured is not None:
            captured["replay_id"] = replay_id
            captured["settings"] = settings
        return SAMPLE_REPORT

    monkeypatch.setattr(cli, "run_replay_analysis", fake_run)  # type: ignore[attr-defined]


def test_analyse_stdout_contains_sections(monkeypatch: object) -> None:
    _patch_report(monkeypatch)
    result = runner.invoke(cli.app, ["replay-abc"])
    assert result.exit_code == 0
    assert "# 复盘报告" in result.stdout
    assert "# 策略评估" in result.stdout


def test_analyse_writes_output_file(monkeypatch: object, tmp_path: Path) -> None:
    _patch_report(monkeypatch)
    out = tmp_path / "report.md"
    result = runner.invoke(cli.app, ["replay-abc", "--output", str(out)])
    assert result.exit_code == 0
    assert out.read_text(encoding="utf-8") == SAMPLE_REPORT


def test_analyse_passes_cli_overrides(monkeypatch: object) -> None:
    captured: dict[str, object] = {}
    _patch_report(monkeypatch, captured)
    result = runner.invoke(
        cli.app,
        [
            "replay-abc",
            "--mcp-url",
            "http://127.0.0.1:9999/mcp",
            "--llm-model",
            "gpt-test",
        ],
    )
    assert result.exit_code == 0
    assert captured["replay_id"] == "replay-abc"
    settings = captured["settings"]
    assert settings.analyse_mcp_url == "http://127.0.0.1:9999/mcp"  # type: ignore[attr-defined]
    assert settings.analyse_llm_model == "gpt-test"  # type: ignore[attr-defined]


def test_analyse_failure_propagates_nonzero_exit(monkeypatch: object) -> None:
    async def fake_run(*args: object, **kwargs: object) -> str:
        raise RuntimeError("mcpserver 不可达")

    monkeypatch.setattr(cli, "run_replay_analysis", fake_run)  # type: ignore[attr-defined]
    result = runner.invoke(cli.app, ["replay-abc"])
    assert result.exit_code != 0
