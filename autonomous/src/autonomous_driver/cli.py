"""CLI 入口：python -m autonomous_driver --mcp-url <url> [--game-mode <mode>]。

示例：
    python -m autonomous_driver --mcp-url http://localhost:9090/mcp
    python -m autonomous_driver --mcp-url http://localhost:9090/mcp --game-mode civilization_relics
"""

from __future__ import annotations

import asyncio
import logging

import typer

from autonomous_driver.decide import RuleDecider
from autonomous_driver.driver import Driver
from autonomous_driver.mcp_client import GameMCPClient, HTTPTransport

app = typer.Typer(help="DarkForest 自主对局驾驶器（纯 MCP client）")


def _main(
    mcp_url: str,
    game_mode: str,
    verbose: bool,
) -> int:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    transport = HTTPTransport(mcp_url)
    client = GameMCPClient(transport)
    decider = RuleDecider()
    driver = Driver(client, decider, game_mode=game_mode)
    return asyncio.run(driver.run())


@app.command()
def run(
    mcp_url: str = typer.Option(..., "--mcp-url", "-u", help="mcpserver Streamable HTTP 地址"),
    game_mode: str = typer.Option("classic", "--game-mode", "-m", help="对局模式"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="DEBUG 日志"),
) -> None:
    """跑完一场对局后退出（--once 语义）。"""
    raise typer.Exit(_main(mcp_url, game_mode, verbose))


if __name__ == "__main__":
    app()
