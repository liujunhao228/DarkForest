"""双驾驶器互打 e2e：验证「账号→排队→对局→结算→回放」全链路。

用法：
    uv run python -m e2e.duel --mcp-url http://localhost:9090/mcp

依赖：docker compose trust 栈已启动，AGENT_SEED_NAME 播种 ≥2 个 agent
（docker-compose.trust.yml 默认 ai1:AgentOne,ai2:AgentTwo）。

两个驾驶器实例各建独立 MCP session（各自借一个 trust agent），同时加入
快速匹配队列 → 后端配对 → 对局推进 → 结算 → 回放落库。脚本断言双方都
正常到达 game_over 且回放已 fetch（driver 日志含 replayId）。
"""

from __future__ import annotations

import asyncio
import json
import logging

import typer

from autonomous_driver.decide import RuleDecider
from autonomous_driver.driver import Driver
from autonomous_driver.mcp_client import GameMCPClient, HTTPTransport

app = typer.Typer(help="双驾驶器互打 e2e")
log = logging.getLogger("e2e.duel")

E2E_TIMEOUT = 1800  # 一场对局总超时（秒）；规则策略对局偏长，放宽到 30 分钟


async def _run_one(name: str, sid: str, mcp_url: str, game_mode: str) -> dict:
    # sid 经 X-Agent-Sid header 指名绑定账号（同名 Agent 恒用同一账号），
    # 双驾驶器各钉 ai1/ai2，确定性验证账号归属稳定。
    transport = HTTPTransport(mcp_url, headers={"X-Agent-Sid": sid})
    client = GameMCPClient(transport)
    driver = Driver(client, RuleDecider(), game_mode=game_mode)
    log.info("%s: 启动驾驶器（绑定 %s）", name, sid)
    try:
        code = await asyncio.wait_for(driver.run(), timeout=E2E_TIMEOUT)
    except TimeoutError:
        log.error("%s: e2e 超时（%ss）", name, E2E_TIMEOUT)
        code = 2
        # wait_for 取消后 transport 的 anyio cancel scope 可能报错；尽力清理并吞掉
        try:
            await client.close()
        except Exception:  # noqa: BLE001
            pass
    log.info("%s: 结束 code=%s state=%s", name, code, driver.state.value)
    return {"name": name, "sid": sid, "code": code, "state": driver.state.value}


async def _main(mcp_url: str, game_mode: str) -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
    )
    # 钉 ai1/ai2 与 docker-compose.trust.yml 播种一致（AGENT_SEED_NAME 需播种
    # ≥2 且名字对应，否则第二个驾驶器明确报「不在账户池/agent 名单中」）。
    results = await asyncio.gather(
        _run_one("agent-a", "ai1", mcp_url, game_mode),
        _run_one("agent-b", "ai2", mcp_url, game_mode),
    )
    print(json.dumps(results, ensure_ascii=False, indent=2))
    ok = all(r["code"] == 0 and r["state"] == "game_over" for r in results)
    if not ok:
        log.error("e2e 未通过: %s", results)
        return 1
    log.info("e2e 通过：双驾驶器均完成对局并落库回放")
    return 0


@app.command()
def duel(
    mcp_url: str = typer.Option(..., "--mcp-url", "-u", help="mcpserver Streamable HTTP 地址"),
    game_mode: str = typer.Option("classic", "--game-mode", "-m"),
) -> None:
    raise typer.Exit(asyncio.run(_main(mcp_url, game_mode)))


if __name__ == "__main__":
    app()
