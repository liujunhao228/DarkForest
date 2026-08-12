"""DarkForest 游戏 API 顶层模块。

供 prime-agent 的 IPython 内核预导入后由游戏 Agent 直接调用。所有函数均为
``async``，内部经 ``DarkForestMCPClient``（Streamable HTTP 长连接）转发到
mcpserver；返回值是解析后的 JSON 结构（dict），不是裸文本。

用法：:

    import darkforest

    await darkforest.connect("ai1")
    await darkforest.join_match_queue()
    loop:
        evt = await darkforest.wait_for_event(30)
        ...
        await darkforest.end_turn()
    await darkforest.disconnect()

每个子 Agent 对应一个独立进程（IPython 内核），模块级共享一个 client 实例即可
（对应 mcpserver 一个 session / 账户池条目）。
"""

from __future__ import annotations

import os
from typing import Any

from .mcp_client import DarkForestMCPClient
from .validator import validate_action

__all__ = [
    "connect",
    "disconnect",
    "get_view",
    "get_affordances",
    "get_recent_delta",
    "wait_for_event",
    "join_match_queue",
    "cancel_match_queue",
    "play_card",
    "deploy_card",
    "strike",
    "broadcast",
    "respond_broadcast",
    "select_broadcast_responder",
    "cancel_broadcast",
    "recycle_card",
    "end_turn",
    "lightspeed_ship",
    "forfeit_game",
    "validate_action",
]

_DEFAULT_MCP_URL = "http://localhost:9090/mcp"
_client: DarkForestMCPClient | None = None


def _require_client() -> DarkForestMCPClient:
    if _client is None:
        raise RuntimeError("尚未连接：请先 await darkforest.connect(agent_name)")
    return _client


# --- 连接 / 生命周期 ---


async def connect(agent_name: str) -> dict[str, Any]:
    """建立 MCP 长连接并调用 ``ensure_connected``。

    ``agent_name`` 是 mcpserver 账户池里的 agent sid（信任模式无需鉴权头）。
    重复调用幂等，返回 ``{connected, accountId, displayName, playerId}``。
    """
    global _client
    if _client is None:
        url = os.environ.get("MCP_URL", _DEFAULT_MCP_URL)
        _client = DarkForestMCPClient(url, agent_name)
        await _client.connect()
    return await _client.call_tool("ensure_connected")


async def disconnect() -> dict[str, Any]:
    """调用 ``disconnect``，断开游戏连接并归还账户到池。返回 ``{success}``。"""
    try:
        return await _require_client().call_tool("disconnect")
    finally:
        global _client
        if _client is not None:
            await _client.close()
            _client = None


# --- 查询 / 感知 ---


async def get_view() -> dict[str, Any]:
    """调 ``get_agent_view``：返回五层语义视图，仅游戏中填充，否则 ``{inGame: false}``。"""
    return await _require_client().call_tool("get_agent_view")


async def get_affordances() -> dict[str, Any]:
    """调 ``get_affordances``：返回当前合法动作集 ``{inGame, affordance}``。"""
    return await _require_client().call_tool("get_affordances")


async def get_recent_delta() -> dict[str, Any]:
    """调 ``get_recent_delta``：返回最近一次 fullSync 的结构化 diff。"""
    return await _require_client().call_tool("get_recent_delta")


async def wait_for_event(timeout_seconds: int = 30) -> dict[str, Any]:
    """调 ``wait_for_event``：阻塞等待新游戏事件，返回 ``{hasEvent, events, delta}``。"""
    return await _require_client().call_tool(
        "wait_for_event", {"timeoutSeconds": timeout_seconds}
    )


# --- 匹配 / 队列 ---


async def join_match_queue(
    preferred_count: int = 2, game_mode: str = "classic"
) -> dict[str, Any]:
    """调 ``join_match_queue``：加入快速匹配队列，人数达到 ``preferred_count`` 即开房。"""
    return await _require_client().call_tool(
        "join_match_queue",
        {"preferredCount": preferred_count, "gameMode": game_mode},
    )


async def cancel_match_queue() -> dict[str, Any]:
    """调 ``cancel_match_queue``：取消快速匹配队列。返回 ``{cancelled}``。"""
    return await _require_client().call_tool("cancel_match_queue")


# --- 动作 ---


async def play_card(card_uid: str) -> dict[str, Any]:
    """调 ``play_card``：出牌。"""
    return await _require_client().call_tool("play_card", {"cardUid": card_uid})


async def deploy_card(card_uid: str) -> dict[str, Any]:
    """调 ``deploy_card``：部署设施卡。"""
    return await _require_client().call_tool("deploy_card", {"cardUid": card_uid})


async def strike(
    card_uid: str, target_system: int, target_player_id: str = ""
) -> dict[str, Any]:
    """调 ``strike``：发射打击卡牌。仅「科技锁死」卡允许传 ``target_player_id``。"""
    args: dict[str, Any] = {"cardUid": card_uid, "targetSystem": target_system}
    if target_player_id:
        args["targetPlayerId"] = target_player_id
    return await _require_client().call_tool("strike", args)


async def broadcast(card_uid: str, target_system: int) -> dict[str, Any]:
    """调 ``broadcast``：发起广播。"""
    return await _require_client().call_tool(
        "broadcast", {"cardUid": card_uid, "targetSystem": target_system}
    )


async def respond_broadcast(agreed: bool, card_uid: str = "") -> dict[str, Any]:
    """调 ``respond_broadcast``：同意合作（``agreed=true`` 时必须传广播卡）或伪装。"""
    args: dict[str, Any] = {"agreed": agreed}
    if card_uid:
        args["cardUid"] = card_uid
    return await _require_client().call_tool("respond_broadcast", args)


async def select_broadcast_responder(responder_id: str) -> dict[str, Any]:
    """调 ``select_broadcast_responder``：广播发起者选择响应者。"""
    return await _require_client().call_tool(
        "select_broadcast_responder", {"responderId": responder_id}
    )


async def cancel_broadcast() -> dict[str, Any]:
    """调 ``cancel_broadcast``：取消当前广播。"""
    return await _require_client().call_tool("cancel_broadcast")


async def recycle_card(card_uid: str) -> dict[str, Any]:
    """调 ``recycle_card``：回收场上明牌。"""
    return await _require_client().call_tool("recycle_card", {"cardUid": card_uid})


async def end_turn(
    discard_cards: list[str] | None = None, public_discard: bool = False
) -> dict[str, Any]:
    """调 ``end_turn``：结束当前回合，可同时弃牌。"""
    args: dict[str, Any] = {}
    if discard_cards:
        args["discardCards"] = discard_cards
    if public_discard:
        args["publicDiscard"] = True
    return await _require_client().call_tool("end_turn", args)


async def lightspeed_ship(
    mode: str,
    target_system: int,
    carry_energy: int,
    message: str,
    leave_behind: bool,
    broadcast_on_inherit: bool | None = None,
) -> dict[str, Any]:
    """调 ``lightspeed_ship``：光速飞船跃迁（普通 / 文明遗迹模式行为分化）。"""
    args: dict[str, Any] = {
        "mode": mode,
        "targetSystem": target_system,
        "carryEnergy": carry_energy,
        "message": message,
        "leaveBehind": leave_behind,
    }
    if broadcast_on_inherit is not None:
        args["broadcastOnInherit"] = broadcast_on_inherit
    return await _require_client().call_tool("lightspeed_ship", args)


async def forfeit_game() -> dict[str, Any]:
    """调 ``forfeit_game``：主动弃权并触发结算。"""
    return await _require_client().call_tool("forfeit_game")
