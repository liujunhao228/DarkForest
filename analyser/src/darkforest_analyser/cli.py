"""复盘分析 CLI 入口（typer）。

用法::

    analyser <replay_id> [--mcp-url URL] [--llm-model MODEL] [--output FILE]

console script 由 ``pyproject.toml`` 的 ``[project.scripts]`` 声明
（``analyser = darkforest_analyser.cli:main``），entry point 直接指向命令
函数，使 ``analyser <replay_id>`` 无需子命令即可直达（typer 的 callback
位置参数会与命令分派冲突，故不采用）。

高层入口 ``run_replay_analysis`` 同时被 bot 的 ``.analyse`` 命令复用，CLI
仅负责参数解析与输出物化（stdout 或文件）。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Annotated

import typer

from darkforest_analyser.config import Settings
from darkforest_analyser.crew import run_replay_analysis
from darkforest_analyser.mcp_client import MCPClient

app = typer.Typer(
    name="analyser",
    help="对本地回放执行《三体》星际战争复盘分析，产出「复盘报告」「策略评估」两节 markdown",
    no_args_is_help=True,
)


@app.command()
def main(
    replay_id: Annotated[str, typer.Argument(help="本地保存的回放 ID")],
    mcp_url: Annotated[
        str | None,
        typer.Option(
            "--mcp-url",
            help="mcpserver 的 Streamable HTTP MCP 端点（默认取环境 ANALYSE_MCP_URL）",
        ),
    ] = None,
    llm_model: Annotated[
        str | None,
        typer.Option(
            "--llm-model",
            help="LLM 模型名（默认取环境 ANALYSE_LLM_MODEL）",
        ),
    ] = None,
    output: Annotated[
        Path | None,
        typer.Option(
            "--output",
            help="把报告写入指定文件（缺省输出到 stdout）",
        ),
    ] = None,
) -> None:
    """对 REPLAY_ID 对应的本地回放执行复盘分析，输出 markdown 报告。"""
    settings = Settings()
    if mcp_url is not None:
        settings.analyse_mcp_url = mcp_url
    if llm_model is not None:
        settings.analyse_llm_model = llm_model

    client = MCPClient(url=settings.analyse_mcp_url)
    report = asyncio.run(
        run_replay_analysis(replay_id, mcp_client=client, settings=settings)
    )

    if output is None:
        typer.echo(report)
    else:
        output.write_text(report, encoding="utf-8")
        typer.echo(f"复盘报告已写入：{output}", err=True)
