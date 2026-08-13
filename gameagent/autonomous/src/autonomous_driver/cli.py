"""CLI 入口：python -m autonomous_driver --script <path> [--mcp-url <url>] [--games N]。

示例：
    python -m autonomous_driver --script rules/s1/v1.py --mcp-url http://localhost:9090/mcp
    python -m autonomous_driver --script rules/s1/v1.py --games 10
    python -m autonomous_driver --script rules/s1/v1.py --game-mode civilization_relics
    python -m autonomous_driver --script rules/s1/v1.py --games 10 --smoke-first
    python -m autonomous_driver validate --script rules/s1/v1.py   # L1 离线校验门

``--script`` 为**必填**：driver 只执行脚本协议（ScriptDecider），缺省不降级到
内置 RuleDecider——Swarm 下对局结果必须反映脚本质量，静默降级会破坏复盘迭代
语义（batch 数据无法归因到脚本）。

``validate`` 子命令（L1 离线校验门，设计文档 §4.5）：导入/结构 + 干跑，exit
0=通过 / 2=失败（reason 可读）。``--smoke-first``（L2 首局即冒烟）：批量第一局
兼作动态冒烟，首局 exit_code≠0 或 rejections ≥ 阈值即中止剩余局、CLI exit 1。
"""

from __future__ import annotations

import asyncio
import logging

import typer

from autonomous_driver.decide import load_script_decider
from autonomous_driver.driver import Driver
from autonomous_driver.mcp_client import GameMCPClient, HTTPTransport
from autonomous_driver.validate_script import validate_script

app = typer.Typer(help="DarkForest 自主对局驾驶器（纯 MCP client）")


def _route_argv(argv: list[str]) -> list[str]:
    """缺省子命令路由：argv[1] 不是子命令（run / validate）时插入 run。

    双命令后 typer 不再隐式路由到唯一命令，旧用法
    ``python -m autonomous_driver --script <path> --games N`` 会报
    "No such option"——__main__ 经本函数把缺省用法补成 ``run`` 子命令，
    保持 spawn_driver / 文档中的既有命令行不变；显式 ``validate`` 不受影响。
    """
    if len(argv) < 2 or argv[1] not in ("run", "validate"):
        out = argv[:]
        out.insert(1, "run")
        return out
    return argv


def _main(
    mcp_url: str,
    game_mode: str,
    games: int,
    script: str,
    verbose: bool,
    smoke_first: bool,
) -> int:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    transport = HTTPTransport(mcp_url)
    client = GameMCPClient(transport)
    decider = load_script_decider(script)  # 必填：无脚本直接抛 ScriptLoadError
    driver = Driver(client, decider, game_mode=game_mode)
    if games <= 1:
        return asyncio.run(driver.run())
    outcomes = asyncio.run(driver.run_batch(games, smoke_first=smoke_first))
    log = logging.getLogger("autonomous_driver")
    if driver.smoke_aborted:
        log.error("冒烟失败：首局异常或拒绝过多，中止剩余局（已打 %s/%s 局）", len(outcomes), games)
        return 1
    ok = sum(1 for o in outcomes if o.exit_code == 0)
    log.info("批量结束: %s/%s 局正常完成", ok, games)
    return 0 if ok == games else 1


@app.command()
def run(
    mcp_url: str = typer.Option(..., "--mcp-url", "-u", help="mcpserver Streamable HTTP 地址"),
    game_mode: str = typer.Option("classic", "--game-mode", "-m", help="对局模式"),
    games: int = typer.Option(1, "--games", "-n", min=1, help="连打局数（1=单局语义）"),
    script: str = typer.Option(..., "--script", "-s", help="ScriptDecider 脚本路径（必填）"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="DEBUG 日志"),
    smoke_first: bool = typer.Option(
        False, "--smoke-first", help="批量第一局兼作动态冒烟（首局异常/拒绝超阈值即中止）"
    ),
) -> None:
    """跑完 N 局后退出（默认 1 局；--games N 批量连打，局间 reset 隔离）。"""
    raise typer.Exit(_main(mcp_url, game_mode, games, script, verbose, smoke_first))


@app.command()
def validate(
    script: str = typer.Option(..., "--script", "-s", help="ScriptDecider 脚本路径（必填）"),
) -> None:
    """L1 离线校验门：导入/结构 + 干跑。exit 0=通过 / 2=失败（reason 可读）。"""
    result = validate_script(script)
    if result.ok:
        typer.echo(f"校验通过: {script}（干跑 {result.steps} 次决策）")
        raise typer.Exit(0)
    typer.echo(f"校验失败: {result.reason}", err=True)
    raise typer.Exit(2)


if __name__ == "__main__":
    app()
