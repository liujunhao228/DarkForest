"""P4 广播响应命令：.agree / .refuse / .select / .bcancel。

- .agree — 同意广播（无参数）。
- .refuse [N] — 拒绝广播，可选附带手牌 N（用于反击）。
- .select <玩家名> — 在广播 select 阶段选择响应者。
- .bcancel — 取消自己发起的广播（命名独立于 P2 .cancel 以避免冲突）。

所有命令均要求 IN_GAME 状态且本地 ViewState 缓存已加载。解析失败/
backend game:error 友好私信报错，不抛异常到 nonebot。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, Message, MessageEvent
from nonebot.params import CommandArg

from darkforest_bot.backend.game_action import send_game_action
from darkforest_bot.backend.resolve import (
    ResolveError,
    resolve_hand_card,
    resolve_responder,
)
from darkforest_bot.backend.view_state import ViewState
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
agree_cmd = on_command("agree", priority=10, block=True)
refuse_cmd = on_command("refuse", priority=10, block=True)
select_cmd = on_command("select", priority=10, block=True)
bcancel_cmd = on_command("bcancel", priority=10, block=True)


@agree_cmd.handle()
async def _handle_agree_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_agree_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@refuse_cmd.handle()
async def _handle_refuse_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_refuse_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@select_cmd.handle()
async def _handle_select_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_select_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@bcancel_cmd.handle()
async def _handle_bcancel_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008, ARG001 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_bcancel_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


# ---------------------------------------------------------------------------
# Core logic — extracted for testability (bot arg is Any for AsyncMock).
# ---------------------------------------------------------------------------


async def handle_agree_request(
    bot: Any,
    user_id: int,
    raw_args: str,  # noqa: ARG001 - unused, .agree takes no args
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.agree — 同意广播。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    data: dict[str, Any] = {"agreed": True}
    await _send_and_reply(bot, qq, "respondBroadcast", data, pool, settings)


async def handle_refuse_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.refuse [N] — 拒绝广播，可选附带手牌 N。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    data: dict[str, Any] = {"agreed": False}
    stripped = raw_args.strip()
    if stripped:
        if not stripped.isdigit():
            await _reply_private(bot, qq, "用法: .refuse [手牌序号]")
            return
        n = int(stripped)
        try:
            card = resolve_hand_card(vs, n)
        except ResolveError as exc:
            await _reply_private(bot, qq, str(exc))
            return
        data["cardUid"] = card.uid

    await _send_and_reply(bot, qq, "respondBroadcast", data, pool, settings)


async def handle_select_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.select <玩家名> — 选择广播响应者。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    name = raw_args.strip()
    if not name:
        await _reply_private(bot, qq, "用法: .select <玩家名>")
        return

    try:
        responder_id = resolve_responder(vs, name)
    except ResolveError as exc:
        await _reply_private(bot, qq, str(exc))
        return

    data: dict[str, Any] = {"responderId": responder_id}
    await _send_and_reply(
        bot, qq, "selectBroadcastResponder", data, pool, settings
    )


async def handle_bcancel_request(
    bot: Any,
    user_id: int,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.bcancel — 取消自己发起的广播。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    data: dict[str, Any] = {}
    await _send_and_reply(bot, qq, "cancelBroadcast", data, pool, settings)


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
