""".playai 命令：拉起 gameagent 的 AI 对手与真人进行对局。

用法::

    .playai [mode]   # 群聊需@机器人，私聊放行；mode 默认 classic
    .cancelai        # 取消进行中的 AI 对局等待

流程：
1. ``.playai`` 经 httpx POST 调 gameagent Agent 管理器
   ``{agent_manager_url}/api/spawn-agent``（body: agentName=ai_opponent_<随机>、
   gameMode=mode），创建 RLM 子 Agent（该 Agent 经 mcpserver 独立接入游戏并
   加入匹配队列）。
2. 受理后先在触发处回「AI 对手已就绪，正在匹配中...」，再启动**后台 asyncio
   task** 轮询 ``GET /api/agents/:childId``（每 5 秒一次，总超时
   settings.agent_manager_timeout，默认 300s）：
   - ``currentMatchId`` 非空（子 Agent 已汇报 match_found）→ 私聊发起者
     「AI 对手已进入对局」，跟踪结束；
   - status 为 error / cancelled / terminated / done → 私聊对应提示；
   - 超时 → 私聊「等待超时」，跟踪结束。
3. 轮询期间可用 ``.cancelai`` 取消：DELETE 该子 Agent + 置本地取消事件，
   后台 task 下一轮退出并清理跟踪。

模块级 ``_ACTIVE`` 按 QQ 记录进行中的跟踪（child_id + 取消事件），
进程重启即丢失（可接受）。

轮询语义对齐 gameagent 已扩展的 HTTP API：单查端点
``GET /api/agents/:childId`` 返回 ``{childId, agentName, status, startTime,
currentMatchId}``；``currentMatchId`` 由管理器在收到子 Agent 的
``match_found`` 汇报时填充，是「已进入对局」的权威信号。

设计上下文：docs/plans/2026-08-11-game-agent-rlm-workflow.md（Step 11）。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import httpx
from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import (
    Bot,
    GroupMessageEvent,
    Message,
    MessageEvent,
)
from nonebot.params import CommandArg

from darkforest_bot.rules.at_mention import require_at_in_group
from darkforest_bot.state import get_settings

if TYPE_CHECKING:
    from darkforest_bot.config import Settings

# nonebot2 command registration.
# 群聊需@机器人才响应（require_at_in_group 规则）；私聊放行。
playai_cmd = on_command("playai", rule=require_at_in_group(), priority=10, block=True)
cancelai_cmd = on_command("cancelai", rule=require_at_in_group(), priority=10, block=True)

# 支持的 mode（对齐 gameagent 任务提示中的 game_mode）。
_SUPPORTED_MODES: tuple[str, ...] = ("classic", "civilization_relics")

# 轮询间隔（秒）。
_POLL_INTERVAL_SECONDS: float = 5.0

# Agent 管理器 HTTP 超时（秒）。
_HTTP_TIMEOUT_SECONDS: float = 10.0


@dataclass(frozen=True)
class AgentInfo:
    """Agent 管理器 GET /api/agents/:childId 返回的单条子 Agent 状态。"""

    child_id: str
    agent_name: str
    status: str
    start_time: int
    current_match_id: str | None


@dataclass
class _PlayaiTracking:
    """单个 QQ 进行中的 AI 对局跟踪状态。"""

    child_id: str
    agent_name: str
    cancel_event: asyncio.Event


# 每 QQ 的进行中跟踪（模块级内存态，bot 重启丢失）。
_ACTIVE: dict[int, _PlayaiTracking] = {}


@playai_cmd.handle()
async def _handle_playai_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — extracts event data and delegates to core logic."""
    if isinstance(event, GroupMessageEvent):
        is_group = True
        group_id: int = event.group_id
    else:
        is_group = False
        group_id = 0
    await handle_playai_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        is_group=is_group,
        group_id=group_id,
        settings=get_settings(),
    )


@cancelai_cmd.handle()
async def _handle_cancelai_cmd(
    bot: Bot,
    event: MessageEvent,
) -> None:
    """nonebot2 handler — extracts event data and delegates to core logic."""
    if isinstance(event, GroupMessageEvent):
        is_group = True
        group_id: int = event.group_id
    else:
        is_group = False
        group_id = 0
    await handle_cancelai_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        is_group=is_group,
        group_id=group_id,
        settings=get_settings(),
    )


async def handle_playai_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    settings: Settings,
    is_group: bool = False,
    group_id: int = 0,
) -> None:
    """Core .playai command logic — extracted for testability.

    Args:
        bot: nonebot Bot instance (or mock with call_api in tests).
        user_id: QQ number of the user who issued the command.
        raw_args: Raw argument string after ".playai" (whitespace-stripped).
        settings: Application settings (agent_manager_url / timeout).
        is_group: Whether the command was issued in a group (vs private).
        group_id: Group ID if is_group, else 0 (ignored for private replies).
    """
    qq = user_id

    if qq in _ACTIVE:
        await _send(
            bot, is_group, group_id, qq,
            "已有进行中的 AI 对局，请先用 .cancelai 取消",
        )
        return

    mode = _parse_mode(raw_args)
    if mode is None:
        await _send(
            bot, is_group, group_id, qq,
            f"不支持的 mode，可用：{' / '.join(_SUPPORTED_MODES)}（默认 classic）",
        )
        return

    agent_name = f"ai_opponent_{uuid4().hex[:8]}"
    try:
        child_id = await _http_spawn(settings, agent_name, mode)
    except Exception:  # noqa: BLE001 - 连接失败统一提示
        logger.warning("spawn-agent 调用失败", url=settings.agent_manager_url)
        await _send(
            bot, is_group, group_id, qq,
            "AI 对手创建失败：无法连接 Agent 管理器",
        )
        return

    tracking = _PlayaiTracking(
        child_id=child_id,
        agent_name=agent_name,
        cancel_event=asyncio.Event(),
    )
    _ACTIVE[qq] = tracking

    await _send(bot, is_group, group_id, qq, "AI 对手已就绪，正在匹配中...")
    asyncio.create_task(
        _poll_agent_loop(bot, user_id, settings, is_group, group_id, tracking),
    )


async def handle_cancelai_request(
    bot: Any,
    user_id: int,
    settings: Settings,
    is_group: bool = False,
    group_id: int = 0,
) -> None:
    """Core .cancelai command logic — cancels the active AI opponent wait."""
    qq = user_id
    tracking = _ACTIVE.get(qq)
    if tracking is None:
        await _send(bot, is_group, group_id, qq, "当前没有进行中的 AI 对局")
        return

    try:
        await _http_delete_agent(settings, tracking.child_id)
    except Exception:  # noqa: BLE001 - 删除失败不影响本地取消
        logger.warning("delete-agent 调用失败", child_id=tracking.child_id)

    tracking.cancel_event.set()
    if _ACTIVE.get(qq) is tracking:
        _ACTIVE.pop(qq, None)
    await _send(bot, is_group, group_id, qq, "已取消 AI 对手")


async def _poll_agent_loop(
    bot: Any,
    user_id: int,
    settings: Settings,
    is_group: bool,
    group_id: int,
    tracking: _PlayaiTracking,
) -> None:
    """后台轮询子 Agent 状态直到「进入对局」/ 失败 / 超时 / 取消。

    成功进入对局或流程结束后清理 ``_ACTIVE``（仅当仍是本跟踪时，避免误删
    取消后新发起的对局）。
    """
    qq = user_id
    try:
        deadline = time.monotonic() + settings.agent_manager_timeout
        while not tracking.cancel_event.is_set():
            if time.monotonic() >= deadline:
                await _send(
                    bot, is_group, group_id, qq,
                    "等待超时：AI 对手未在时限内进入对局，已放弃跟踪",
                )
                return

            info = await _http_get_agent(settings, tracking.child_id)
            if info is None:
                await _send(
                    bot, is_group, group_id, qq, "AI 对手已被移除或不存在",
                )
                return
            if info.current_match_id:
                await _send(bot, is_group, group_id, qq, "AI 对手已进入对局")
                return
            if info.status in ("error", "cancelled", "terminated"):
                await _send(
                    bot, is_group, group_id, qq,
                    f"AI 对手状态异常（{info.status}），未能进入对局",
                )
                return
            if info.status == "done":
                await _send(bot, is_group, group_id, qq, "AI 对手对局已结束")
                return

            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
    finally:
        if _ACTIVE.get(qq) is tracking:
            _ACTIVE.pop(qq, None)


def _parse_mode(raw_args: str) -> str | None:
    """解析 .playai 参数；缺省回 classic，未知 mode 返回 None。"""
    tokens = raw_args.split()
    if not tokens:
        return "classic"
    mode = tokens[0].lower()
    if mode not in _SUPPORTED_MODES:
        return None
    return mode


async def _http_spawn(settings: Settings, agent_name: str, game_mode: str) -> str:
    """POST /api/spawn-agent，返回 childId。"""
    async with httpx.AsyncClient(
        base_url=settings.agent_manager_url, timeout=_HTTP_TIMEOUT_SECONDS,
    ) as client:
        resp = await client.post(
            "/api/spawn-agent",
            json={"agentName": agent_name, "gameMode": game_mode},
        )
        resp.raise_for_status()
        data = resp.json()
    child_id = data.get("childId")
    if not isinstance(child_id, str) or not child_id:
        raise RuntimeError("spawn-agent 响应缺少 childId")
    return child_id


async def _http_get_agent(settings: Settings, child_id: str) -> AgentInfo | None:
    """GET /api/agents/:childId；404 返回 None。"""
    async with httpx.AsyncClient(
        base_url=settings.agent_manager_url, timeout=_HTTP_TIMEOUT_SECONDS,
    ) as client:
        resp = await client.get(f"/api/agents/{child_id}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
    return AgentInfo(
        child_id=str(data.get("childId") or ""),
        agent_name=str(data.get("agentName") or ""),
        status=str(data.get("status") or ""),
        start_time=int(data.get("startTime") or 0),
        current_match_id=data.get("currentMatchId"),
    )


async def _http_delete_agent(settings: Settings, child_id: str) -> None:
    """DELETE /api/agents/:childId。"""
    async with httpx.AsyncClient(
        base_url=settings.agent_manager_url, timeout=_HTTP_TIMEOUT_SECONDS,
    ) as client:
        resp = await client.delete(f"/api/agents/{child_id}")
        resp.raise_for_status()


async def _send(
    bot: Any, is_group: bool, group_id: int, user_id: int, message: Any,
) -> None:
    """Reply in the same channel as the trigger (group or private).

    Failures are logged but not raised.
    Group 回复带 group_id；私聊仅带 user_id。
    """
    try:
        if is_group:
            await bot.call_api("send_group_msg", group_id=group_id, message=message)
        else:
            await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:  # noqa: BLE001 - best-effort reply
        logger.warning(
            "Failed to send reply",
            is_group=is_group,
            user_id=user_id,
            group_id=group_id,
        )
