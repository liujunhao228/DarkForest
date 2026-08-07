"""P4 跃迁命令：.jump <星系> [携带能量] [消息]。

- .jump 5 — 跃迁到星系 5，不携带能量，无消息。
- .jump 5 3 — 跃迁并携带 3 能量。
- .jump 5 3 hello world — 跃迁、携带 3 能量、附消息 "hello world"。
- .jump 5 hello — 跃迁到星系 5，tokens[1] 非数字 → carryEnergy=0，
  message="hello"（剩余 tokens 用空格连接）。

backend action="lightspeedShip"，data 包含 targetSystem / carryEnergy /
message / leaveBehind / broadcastOnInherit 五字段。broadcastOnInherit 是
*bool | None，JSON 序列化 None → null。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, Message, MessageEvent
from nonebot.params import CommandArg

from darkforest_bot.backend.game_action import send_game_action
from darkforest_bot.backend.view_state import ViewState
from darkforest_bot.rules.at_mention import require_at_in_group
from darkforest_bot.session.states import SessionState
from darkforest_bot.state import (
    get_game_session_store,
    get_pool,
    get_session_manager,
    get_settings,
)

if TYPE_CHECKING:
    from darkforest_bot.backend.game_session import GameSessionStore
    from darkforest_bot.backend.pool import WSConnectionPool
    from darkforest_bot.config import Settings
    from darkforest_bot.session.manager import SessionManager

# nonebot2 command registration.
# 群聊需@机器人才响应（require_at_in_group 规则）；私聊放行。
# 可通过 GROUP_REQUIRE_AT_MENTION=false 全局关闭回退到旧行为。
jump_cmd = on_command("jump", rule=require_at_in_group(), priority=10, block=True)


@jump_cmd.handle()
async def _handle_jump_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_jump_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


# ---------------------------------------------------------------------------
# Core logic — extracted for testability (bot arg is Any for AsyncMock).
# ---------------------------------------------------------------------------


async def handle_jump_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.jump <星系> [携带能量] [消息] — 跃迁。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split() if raw_args.strip() else []
    if len(tokens) < 1:
        await _reply_private(bot, qq, "用法: .jump <星系> [携带能量] [消息]")
        return

    if not tokens[0].isdigit():
        await _reply_private(bot, qq, "用法: .jump <星系> [携带能量] [消息]")
        return

    target_system = int(tokens[0])

    carry_energy = 0
    message = ""
    if len(tokens) >= 2:
        if tokens[1].isdigit():
            carry_energy = int(tokens[1])
            if len(tokens) >= 3:
                message = " ".join(tokens[2:])
        else:
            # tokens[1] is non-numeric → carryEnergy stays 0, message picks
            # up all remaining tokens (including tokens[1]).
            message = " ".join(tokens[1:])

    data: dict[str, Any] = {
        "targetSystem": target_system,
        "carryEnergy": carry_energy,
        "message": message,
        "leaveBehind": False,
        "broadcastOnInherit": None,
    }
    await _send_and_reply(bot, qq, "lightspeedShip", data, pool, settings)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _require_in_game_view_state(
    bot: Any,
    qq: int,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
) -> ViewState | None:
    """Check IN_GAME + cache populated. Returns ViewState or None (after replying)."""
    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)
        if session.state != SessionState.IN_GAME:
            await _reply_private(bot, qq, "当前不在对局中")
            return None

    game_session = game_session_store.get(qq)
    if game_session is None or game_session.view_state is None:
        await _reply_private(bot, qq, "状态未加载，请先 .state")
        return None

    return game_session.view_state


async def _send_and_reply(
    bot: Any,
    qq: int,
    action: str,
    data: dict[str, Any],
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """Send game:action and reply with success/error message."""
    ws = pool.get(qq)
    if ws is None:
        await _reply_private(bot, qq, "连接不可用")
        return

    result = await send_game_action(
        ws, action, data, timeout=settings.action_error_timeout
    )
    if result is None:
        await _reply_private(bot, qq, "已执行")
    else:
        await _reply_private(bot, qq, f"操作失败：{result.message}")


async def _reply_private(bot: Any, user_id: int, message: Any) -> None:
    """Send a private message. Failures are logged but not raised."""
    try:
        await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:  # noqa: BLE001 - best-effort reply
        logger.warning("Failed to send private message", user_id=user_id)
