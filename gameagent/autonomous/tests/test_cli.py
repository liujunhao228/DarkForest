"""CLI 单测：--script 必填、缺省子命令路由、validate 子命令。

Swarm 语义下 driver 只执行脚本协议；缺省静默降级 RuleDecider 会改变对局
语义（batch 结果无法归因脚本），违反优雅降级原则——CLI 直接以必填参数
形式拒绝。双命令（run / validate）后旧用法 ``python -m autonomous_driver
--script ...`` 经 _route_argv 缺省路由到 run，本文件同时覆盖路由逻辑。
"""

from __future__ import annotations

from typer.testing import CliRunner

from autonomous_driver.cli import _route_argv, app

runner = CliRunner()


def test_route_argv_inserts_run_for_legacy_usage() -> None:
    """旧用法（argv[1] 是选项）→ 插入 run；显式子命令不动。"""
    assert _route_argv(["python", "--script", "a.py", "--games", "10"]) == [
        "python", "run", "--script", "a.py", "--games", "10",
    ]
    assert _route_argv(["python"]) == ["python", "run"]
    assert _route_argv(["python", "run", "--script", "a.py"]) == [
        "python", "run", "--script", "a.py",
    ]
    assert _route_argv(["python", "validate", "--script", "a.py"]) == [
        "python", "validate", "--script", "a.py",
    ]


def test_cli_requires_script() -> None:
    """不带 --script 调用：typer 必填参数缺失 → 非零退出，且不进入对局。"""
    result = runner.invoke(app, ["run", "--mcp-url", "http://localhost:9090/mcp"])

    assert result.exit_code != 0
    assert "Missing option" in result.output
    assert "--script" in result.output


def test_cli_script_help_marks_required() -> None:
    result = runner.invoke(app, ["run", "--help"])
    assert result.exit_code == 0
    # 必填参数在 help 中以 * 标注 + [required]（typer 默认行为）
    assert "--script" in result.output
    assert "脚本路径" in result.output
    assert "[required]" in result.output


def test_cli_missing_script_even_with_games() -> None:
    """给了 --games 但缺 --script：同样拒绝（参数缺失与局数无关）。"""
    result = runner.invoke(
        app, ["run", "--mcp-url", "http://localhost:9090/mcp", "--games", "10"]
    )
    assert result.exit_code != 0
    assert "--script" in result.output


def test_cli_help_lists_commands() -> None:
    """双命令：run / validate 都在 help 中。"""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "run" in result.output
    assert "validate" in result.output
