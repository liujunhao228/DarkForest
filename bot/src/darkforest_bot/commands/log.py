""".log command handler.

Usage in private message: .log [count]

Renders the last ``count`` log entries (default ``settings.log_default_limit``,
capped at ``settings.log_max_limit``) from the cached ViewState and sends
them as a private message.

The session lock is held only for the initial state check (must be IN_GAME).
The cache lookup and rendering happen outside the lock.

If the cache is empty, the command replies "状态未加载，请先 .state" rather
than triggering a sync (logs are a secondary view; the user should run
``.state`` first to populate the cache).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, Message, MessageEvent
from nonebot.params import CommandArg

from darkforest_bot.render.text import render_logs
from darkforest_bot.session.states import SessionState
from darkforest_bot.state import (
    get_game_session_store,
    get_session_manager,
    get_settings,
)

if TYPE_CHECKING:
    from darkforest_bot.backend.game_session import GameSessionStore
    from darkforest_bot.config import Settings
    from darkforest_bot.session.manager import SessionManager

# nonebot2 command registration.
# Note: no to_me() rule — users invoke by typing ".log" directly. Replies
# are always private (the command is per-QQ and requires an IN_GAME session).
log_cmd = on_command("log", priority=10, block=True)


@log_cmd.handle()
async def _handle_log_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — extracts event data and delegates to core logic."""
    raw_args = args.extract_plain_text().strip()
    await handle_log_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=raw_args,
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        settings=get_settings(),
    )


async def handle_log_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    settings: Settings,
) -> None:
    """Core .log command logic — extracted for testability.

    Args:
        bot: nonebot Bot instance (or mock with call_api in tests).
        user_id: QQ number of the user who issued the command.
        raw_args: Raw argument string after ".log" (expected: empty or a
            non-negative integer count).
        session_manager: SessionManager for state machine checks.
        game_session_store: GameSessionStore for ViewState cache lookup.
        settings: Application settings (default + max log limits).
    """
    qq = user_id

    # 1. State check — must be IN_GAME to view logs.
    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)
        if session.state != SessionState.IN_GAME:
            await _reply_private(bot, qq, "当前不在对局中")
            return

    # 2. Parse count argument.
    count = _parse_log_count(raw_args, settings)
    if isinstance(count, str):
        # Parse error — reply with usage hint.
        await _reply_private(bot, qq, count)
        return

    # 3. Cache lookup — must have a populated ViewState.
    game_session = game_session_store.get(qq)
    if game_session is None or game_session.view_state is None:
        await _reply_private(bot, qq, "状态未加载，请先 .state")
        return

    # 4. Render logs and send.
    text = render_logs(game_session.view_state, limit=count)
    await _reply_private(bot, qq, text)


def _parse_log_count(raw_args: str, settings: Settings) -> int | str:
    """Parse the .log count argument.

    Returns an int count on success (clamped to ``log_max_limit``), or an
    error message string on failure.
    """
    if not raw_args:
        return settings.log_default_limit

    if not raw_args.isdigit():
        return f"用法: .log [数量]，数量 1-{settings.log_max_limit}"

    requested = int(raw_args)
    # Clamp to [1, log_max_limit]. Treat 0 as 1 (defensive — render_logs
    # already handles limit<=0 by returning "（暂无日志）", but a 0-count
    # request is almost certainly a user mistake).
    if requested < 1:
        requested = 1
    if requested > settings.log_max_limit:
        requested = settings.log_max_limit
    return requested


async def _reply_private(bot: Any, user_id: int, message: Any) -> None:
    """Send a private message. Failures are logged but not raised."""
    try:
        await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:
        logger.warning("Failed to send private message", user_id=user_id)
