"""CLI 入口：python -m autonomous_driver --mcp-url <url> [--game-mode <mode>] [--games N]。

示例：
    python -m autonomous_driver --mcp-url http://localhost:9090/mcp
    python -m autonomous_driver --mcp-url http://localhost:9090/mcp --game-mode civilization_relics
    python -m autonomous_driver --mcp-url http://localhost:9090/mcp --games 10   # 批量连打 10 局
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
    games: int,
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
    if games <= 1:
        return asyncio.run(driver.run())
    outcomes = asyncio.run(driver.run_batch(games))
    ok = sum(1 for o in outcomes if o.exit_code == 0)
    log = logging.getLogger("autonomous_driver")
    log.info("批量结束: %s/%s 局正常完成", ok, games)
    return 0 if ok == games else 1


@app.command()
def run(
    mcp_url: str = typer.Option(..., "--mcp-url", "-u", help="mcpserver Streamable HTTP 地址"),
    game_mode: str = typer.Option("classic", "--game-mode", "-m", help="对局模式"),
    games: int = typer.Option(1, "--games", "-n", min=1, help="连打局数（1=单局语义）"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="DEBUG 日志"),
) -> None:
    """跑完 N 局后退出（默认 1 局；--games N 批量连打，局间 reset 隔离）。"""
    raise typer.Exit(_main(mcp_url, game_mode, games, verbose))


if __name__ == "__main__":
    app()
