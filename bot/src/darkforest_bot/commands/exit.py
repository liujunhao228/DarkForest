""".exit 命令：退出当前对局（弃权）。

使用后自己被淘汰，相当于主动弃权：
- 当前玩家弃权 → 回合推进到下一玩家（由 backend 处理）。
- 非当前玩家弃权 → 当前玩家不变。
- 弃权后仅剩一名存活玩家 → 游戏结束，剩余玩家获胜。

无参数。仅在 IN_GAME 状态可用。backend 收到 ``forfeit`` action 后通过
``EliminatePlayerForForfeit`` 淘汰该玩家并清理其手牌/设施/飞行中打击。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, Message, MessageEvent
from nonebot.params import CommandArg

from darkforest_bot.backend.game_action import send_game_action
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
# on_command 的第一个参数是匹配字符串（".exit"），与 Python 内置 exit 无关。
exit_cmd = on_command("exit", priority=10, block=True)


@exit_cmd.handle()
async def _handle_exit_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: ARG001, B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_exit_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        session_manager=get_session_manager(),
        pool=get_pool(),
        settings=get_settings(),
    )


async def handle_exit_request(
    bot: Any,
    user_id: int,
    session_manager: SessionManager,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.exit — 退出当前对局（弃权），自己被淘汰。"""
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

    # 3. 发送 forfeit action（无 payload 字段，backend 仅按 playerID 淘汰）。
    result = await send_game_action(
        ws, "forfeit", {}, timeout=settings.action_error_timeout
    )
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
