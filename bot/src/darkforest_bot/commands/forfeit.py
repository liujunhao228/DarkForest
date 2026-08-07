""".forfeit 命令：投降（弃权）。

使用后自己被淘汰，相当于主动弃权：
- 当前玩家弃权 → 回合推进到下一玩家（由 backend 处理）。
- 非当前玩家弃权 → 当前玩家不变。
- 弃权后仅剩一名存活玩家 → 游戏结束，剩余玩家获胜。

无参数。仅在 IN_GAME 状态可用。backend 收到 ``forfeit`` action 后通过
``EliminatePlayerForForfeit`` 淘汰该玩家并清理其手牌/设施/飞行中打击。

与 .exit 的区别：.forfeit 只弃权（自己被淘汰，留在房间观战/待对局结束）；
.exit 在弃权后还会离开房间。两者共用 send_forfeit_action 发送同一个
``forfeit`` action。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, Message, MessageEvent
from nonebot.params import CommandArg

from darkforest_bot.backend.game_action import ActionError, send_game_action
from darkforest_bot.rules.at_mention import require_at_in_group
from darkforest_bot.session.states import SessionState
from darkforest_bot.state import (
    get_pool,
    get_session_manager,
    get_settings,
)

if TYPE_CHECKING:
    from darkforest_bot.backend.pool import WSConnectionPool
    from darkforest_bot.config import Settings
    from darkforest_bot.session.manager import SessionManager

# nonebot2 command registration.
# 群聊需@机器人才响应（require_at_in_group 规则）；私聊放行。
# 可通过 GROUP_REQUIRE_AT_MENTION=false 全局关闭回退到旧行为。
forfeit_cmd = on_command("forfeit", rule=require_at_in_group(), priority=10, block=True)


async def send_forfeit_action(ws: Any, settings: Settings) -> ActionError | None:
    """发送 ``forfeit`` action（无 payload 字段，backend 仅按 playerID 淘汰）。

    Returns:
        None 表示成功（后端未在超时内回 game:error）；否则返回 ActionError。
    """
    return await send_game_action(
        ws, "forfeit", {}, timeout=settings.action_error_timeout
    )


@forfeit_cmd.handle()
async def _handle_forfeit_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: ARG001, B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_forfeit_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        session_manager=get_session_manager(),
        pool=get_pool(),
        settings=get_settings(),
    )


async def handle_forfeit_request(
    bot: Any,
    user_id: int,
    session_manager: SessionManager,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.forfeit — 投降（弃权），自己被淘汰。"""
    qq = user_id

    # 1. 状态检查 — 仅 IN_GAME 可弃权。
    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)
        if session.state != SessionState.IN_GAME:
            await _reply_private(bot, qq, "当前不在对局中")
            return

    # 2. WS 连接检查。
    ws = pool.get(qq)
    if ws is None:
        await _reply_private(bot, qq, "连接不可用")
        return

    # 3. 发送 forfeit action。
    result = await send_forfeit_action(ws, settings)
    if result is None:
        await _reply_private(bot, qq, "已弃权，你已被淘汰")
    else:
        await _reply_private(bot, qq, f"操作失败：{result.message}")


async def _reply_private(bot: Any, user_id: int, message: Any) -> None:
    """Send a private message. Failures are logged but not raised."""
    try:
        await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:  # noqa: BLE001 - best-effort reply
        logger.warning("Failed to send private message", user_id=user_id)
