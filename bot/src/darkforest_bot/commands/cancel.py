""".cancel command handler.

Usage: @bot .cancel (in group) or .cancel (in private message).

Cancels matchmaking queue. Only valid when session is in MATCHMAKING state.
In IN_ROOM / IN_GAME states, the user must leave the room via a different
command (P3+); .cancel only touches the matchmaking queue.

The session lock is held for the entire cancel flow (including the
``match:queueCancelled`` wait) so that a concurrent ``.match`` from the same
QQ cannot race with the cancel. This is a per-QQ lock, so it only affects
the cancelling user.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import (
    Bot,
    GroupMessageEvent,
    Message,
    MessageEvent,
)
from nonebot.params import CommandArg

from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.rules.at_mention import require_at_in_group
from darkforest_bot.session.states import SessionState
from darkforest_bot.state import get_pool, get_session_manager

if TYPE_CHECKING:
    from darkforest_bot.backend.pool import WSConnectionPool
    from darkforest_bot.session.manager import SessionManager

# Timeout (seconds) to wait for backend's match:queueCancelled confirmation.
CANCEL_TIMEOUT: float = 10.0

# nonebot2 command registration.
# 群聊需@机器人才响应（require_at_in_group 规则）；私聊放行。
# 可通过 GROUP_REQUIRE_AT_MENTION=false 全局关闭回退到旧行为。
cancel_cmd = on_command("cancel", rule=require_at_in_group(), priority=10, block=True)


@cancel_cmd.handle()
async def _handle_cancel_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: ARG001, B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — extracts event data and delegates to core logic."""
    if isinstance(event, GroupMessageEvent):
        is_group = True
        group_id: int = event.group_id
    else:
        is_group = False
        group_id = 0
    await handle_cancel_request(
        bot=bot,
        user_id=event.user_id,
        is_group=is_group,
        group_id=group_id,
        pool=get_pool(),
        session_manager=get_session_manager(),
    )


async def handle_cancel_request(
    bot: Any,
    user_id: int,
    is_group: bool,
    group_id: int,
    pool: WSConnectionPool,
    session_manager: SessionManager,
) -> None:
    """Core cancel command logic — extracted for testability.

    Args:
        bot: nonebot Bot instance (or mock with call_api in tests).
        user_id: QQ number of the user who issued the command.
        is_group: Whether the command was issued in a group (vs private).
        group_id: Group ID if is_group, else 0 (ignored for private replies).
        pool: WSConnectionPool for backend connections.
        session_manager: SessionManager for state machine.
    """
    qq = user_id

    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)

        # 1. State check — only MATCHMAKING can be cancelled.
        if session.state != SessionState.MATCHMAKING:
            await _reply(
                bot,
                is_group,
                group_id,
                qq,
                f"当前不在匹配队列中（状态：{session.state.value}）",
            )
            return

        # 2. WS connection check.
        ws = pool.get(qq)
        if ws is None or not ws.connected:
            await _reply(bot, is_group, group_id, qq, "连接已断开，请重新 .match")
            session_manager.clear(qq)
            return

        # 3. Subscribe to match:queueCancelled confirmation.
        loop = asyncio.get_running_loop()
        cancelled_future: asyncio.Future[dict[str, Any]] = loop.create_future()

        async def on_cancelled(payload: dict[str, Any]) -> None:
            if not cancelled_future.done():
                cancelled_future.set_result(payload)

        unsub = ws.subscribe(ServerEvent.MATCH_QUEUE_CANCELLED, on_cancelled)

        try:
            # 4. Send match:cancelQueue to backend.
            await ws.send(ClientEvent.MATCH_CANCEL_QUEUE)

            # 5. Wait for backend confirmation.
            try:
                await asyncio.wait_for(cancelled_future, timeout=CANCEL_TIMEOUT)
            except TimeoutError:
                logger.error("cancel queue confirmation timeout", qq=qq)
                await _reply(bot, is_group, group_id, qq, "取消失败，请稍后重试")
                return
            except Exception:
                logger.exception("cancel command failed", qq=qq)
                await _reply(bot, is_group, group_id, qq, "取消失败，请稍后重试")
                return

            # 6. Transition to IDLE and confirm.
            session_manager.transition(qq, SessionState.IDLE)
            await _reply(bot, is_group, group_id, qq, "已取消匹配")
        finally:
            unsub()


async def _reply(
    bot: Any,
    is_group: bool,
    group_id: int,
    user_id: int,
    message: str,
) -> None:
    """Reply in the appropriate context (group or private).

    Failures are logged but not raised so the command handler never crashes
    on a notification error.
    """
    try:
        if is_group:
            await bot.call_api("send_group_msg", group_id=group_id, message=message)
        else:
            await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:
        logger.warning("Failed to send reply", is_group=is_group, user_id=user_id)
