"""P4 出牌类命令：.play / .deploy / .strike / .broadcast / .recycle。

每条命令在 IN_GAME 状态下解析参数（1-based 手牌序号 → Card UID；玩家名 →
Player ID），通过 send_game_action 封装 game:action 发送到 backend。
backend 在 settings.action_error_timeout 秒内回 game:error 时私信报错，
否则私信"已执行"。

命令参数解析失败（越界索引 / 未知玩家 / 参数不足 / 当前不可用）必须友好
私信报错，不抛异常到 nonebot。

注意：本模块所有 handle_xxx_request 函数为 nonebot handler 的纯逻辑抽离，
bot 参数用 Any（nonebot Bot 在测试中以 AsyncMock 替代）。
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
    assert_card_type,
    resolve_faceup_card,
    resolve_hand_card,
    resolve_player_by_name,
)
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
play_cmd = on_command("play", rule=require_at_in_group(), priority=10, block=True)
deploy_cmd = on_command("deploy", rule=require_at_in_group(), priority=10, block=True)
strike_cmd = on_command("strike", rule=require_at_in_group(), priority=10, block=True)
broadcast_cmd = on_command("broadcast", rule=require_at_in_group(), priority=10, block=True)
recycle_cmd = on_command("recycle", rule=require_at_in_group(), priority=10, block=True)


@play_cmd.handle()
async def _handle_play_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_play_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@deploy_cmd.handle()
async def _handle_deploy_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_deploy_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@strike_cmd.handle()
async def _handle_strike_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_strike_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@broadcast_cmd.handle()
async def _handle_broadcast_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_broadcast_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@recycle_cmd.handle()
async def _handle_recycle_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_recycle_request(
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


async def handle_play_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.play <手牌序号> — 出牌（仅设施/防御卡）。"""
    await _dispatch_single_index_action(
        bot=bot,
        user_id=user_id,
        raw_args=raw_args,
        action_name="playCard",
        usage=".play <手牌序号>",
        allowed_types=("facility", "defense"),
        action_label=".play",
        session_manager=session_manager,
        game_session_store=game_session_store,
        pool=pool,
        settings=settings,
    )


async def handle_deploy_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.deploy <手牌序号> — 部署（仅设施/防御卡）。"""
    await _dispatch_single_index_action(
        bot=bot,
        user_id=user_id,
        raw_args=raw_args,
        action_name="deployCard",
        usage=".deploy <手牌序号>",
        allowed_types=("facility", "defense"),
        action_label=".deploy",
        session_manager=session_manager,
        game_session_store=game_session_store,
        pool=pool,
        settings=settings,
    )


async def handle_recycle_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.recycle <场上牌序号> — 回收场上已部署的牌（仅设施/防御卡）。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split()
    if len(tokens) != 1 or not tokens[0].isdigit():
        await _reply_private(bot, qq, "用法: .recycle <场上牌序号>")
        return

    n = int(tokens[0])
    try:
        card = resolve_faceup_card(vs, n)
        assert_card_type(card, ("facility", "defense"), ".recycle")
    except ResolveError as exc:
        await _reply_private(bot, qq, str(exc))
        return

    data: dict[str, Any] = {"cardUid": card.uid}

    await _send_and_reply(
        bot, qq, "recycleCard", data, pool, settings
    )


async def handle_strike_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.strike <手牌序号> <星系> [玩家名] — 发起打击。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split()
    if len(tokens) < 2:
        await _reply_private(bot, qq, "用法: .strike <手牌序号> <星系> [玩家名]")
        return

    if not tokens[0].isdigit() or not tokens[1].isdigit():
        await _reply_private(bot, qq, "用法: .strike <手牌序号> <星系> [玩家名]")
        return

    n = int(tokens[0])
    target_system = int(tokens[1])

    try:
        card = resolve_hand_card(vs, n)
        assert_card_type(card, ("strike",), ".strike")
    except ResolveError as exc:
        await _reply_private(bot, qq, str(exc))
        return

    data: dict[str, Any] = {"cardUid": card.uid, "targetSystem": target_system}

    if len(tokens) >= 3:
        name = " ".join(tokens[2:])
        try:
            target = resolve_player_by_name(vs, name)
        except ResolveError as exc:
            await _reply_private(bot, qq, str(exc))
            return
        data["targetPlayerId"] = target.id

    await _send_and_reply(
        bot, qq, "strike", data, pool, settings
    )


async def handle_broadcast_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.broadcast <手牌序号> <星系> — 发起广播。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split()
    if len(tokens) != 2:
        await _reply_private(bot, qq, "用法: .broadcast <手牌序号> <星系>")
        return

    if not tokens[0].isdigit() or not tokens[1].isdigit():
        await _reply_private(bot, qq, "用法: .broadcast <手牌序号> <星系>")
        return

    n = int(tokens[0])
    target_system = int(tokens[1])

    try:
        card = resolve_hand_card(vs, n)
        assert_card_type(card, ("broadcast",), ".broadcast")
    except ResolveError as exc:
        await _reply_private(bot, qq, str(exc))
        return

    data: dict[str, Any] = {"cardUid": card.uid, "targetSystem": target_system}

    await _send_and_reply(
        bot, qq, "broadcast", data, pool, settings
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _dispatch_single_index_action(
    *,
    bot: Any,
    user_id: int,
    raw_args: str,
    action_name: str,
    usage: str,
    allowed_types: tuple[str, ...],
    action_label: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """Common path for .play/.deploy — single 1-based hand index arg with type guard."""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split()
    if len(tokens) != 1 or not tokens[0].isdigit():
        await _reply_private(bot, qq, f"用法: {usage}")
        return

    n = int(tokens[0])
    try:
        card = resolve_hand_card(vs, n)
        assert_card_type(card, allowed_types, action_label)
    except ResolveError as exc:
        await _reply_private(bot, qq, str(exc))
        return

    data: dict[str, Any] = {"cardUid": card.uid}

    await _send_and_reply(
        bot, qq, action_name, data, pool, settings
    )


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
