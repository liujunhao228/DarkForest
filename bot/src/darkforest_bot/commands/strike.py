"""P4 打击生命周期命令：.move / .pick / .announce / .retarget / .discard / .skip。

打击生命周期由 backend 通过 PendingAction 推进。bot 这边的责任是：
1. 校验 IN_GAME + ViewState 缓存 + PendingAction 非空且类型匹配。
2. 解析参数（1-based 打击序号 → FlyingStrikeView.uid）。
3. 把 PendingAction.type 映射到 backend action 名（同名即匹配，少数
   类型存在多态分派，如 .skip 按 pa.type 派发不同 action）。

注意 .skip 与 .retarget 是上下文敏感的：根据当前 PendingAction.type
派发到不同 backend action。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, Message, MessageEvent
from nonebot.params import CommandArg

from darkforest_bot.backend.game_action import send_game_action
from darkforest_bot.backend.resolve import ResolveError, resolve_strike
from darkforest_bot.backend.view_state import PendingAction, ViewState
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
move_cmd = on_command("move", priority=10, block=True)
pick_cmd = on_command("pick", priority=10, block=True)
announce_cmd = on_command("announce", priority=10, block=True)
retarget_cmd = on_command("retarget", priority=10, block=True)
discard_cmd = on_command("discard", priority=10, block=True)
skip_cmd = on_command("skip", priority=10, block=True)


@move_cmd.handle()
async def _handle_move_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_move_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@pick_cmd.handle()
async def _handle_pick_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_pick_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@announce_cmd.handle()
async def _handle_announce_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008, ARG001 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_announce_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@retarget_cmd.handle()
async def _handle_retarget_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_retarget_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@discard_cmd.handle()
async def _handle_discard_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_discard_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


@skip_cmd.handle()
async def _handle_skip_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008, ARG001 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_skip_request(
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


async def handle_move_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.move <打击序号> <星系> — strikeMove 阶段移动打击。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split()
    if len(tokens) != 2 or not tokens[0].isdigit() or not tokens[1].isdigit():
        await _reply_private(bot, qq, "用法: .move <打击序号> <星系>")
        return

    idx = int(tokens[0])
    target_system = int(tokens[1])

    pa = _check_pending(vs, {"strikeMove"})
    if isinstance(pa, str):
        await _reply_private(bot, qq, pa)
        return

    try:
        strike = resolve_strike(vs, idx)
    except ResolveError as exc:
        await _reply_private(bot, qq, str(exc))
        return

    data: dict[str, Any] = {"strikeUid": strike.uid, "targetSystem": target_system}
    await _send_and_reply(bot, qq, "moveStrike", data, pool, settings)


async def handle_pick_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.pick <打击序号> — strikeSelect 阶段从待处理列表中选一个打击。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split()
    if len(tokens) != 1 or not tokens[0].isdigit():
        await _reply_private(bot, qq, "用法: .pick <打击序号>")
        return

    idx = int(tokens[0])

    pa = _check_pending(vs, {"strikeSelect"})
    if isinstance(pa, str):
        await _reply_private(bot, qq, pa)
        return

    # strikeSelect uses pa.strike_uids (a list); idx is into that list, NOT
    # into view_state.flying_strikes. resolve_strike() would resolve against
    # flying_strikes — we cannot use it here.
    if idx < 1 or idx > len(pa.strike_uids):
        await _reply_private(
            bot, qq, f"打击序号 {idx} 越界，待处理 {len(pa.strike_uids)} 个"
        )
        return

    data: dict[str, Any] = {"strikeUid": pa.strike_uids[idx - 1]}
    await _send_and_reply(bot, qq, "selectStrike", data, pool, settings)


async def handle_announce_request(
    bot: Any,
    user_id: int,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.announce — announceStrike 阶段宣布打击到达。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    pa = _check_pending(vs, {"announceStrike"})
    if isinstance(pa, str):
        await _reply_private(bot, qq, pa)
        return

    data: dict[str, Any] = {}
    await _send_and_reply(bot, qq, "announceStrike", data, pool, settings)


async def handle_retarget_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.retarget <打击序号> <星系> — 上下文敏感：
    - strikeMove 阶段 → action="retargetStrike"
    - strikeMissedFree / strikeMissedRequireTarget 阶段 → action="retargetMissedStrike"
    """
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split()
    if len(tokens) != 2 or not tokens[0].isdigit() or not tokens[1].isdigit():
        await _reply_private(bot, qq, "用法: .retarget <打击序号> <星系>")
        return

    idx = int(tokens[0])
    target_system = int(tokens[1])

    pa = _check_pending(
        vs, {"strikeMove", "strikeMissedFree", "strikeMissedRequireTarget"}
    )
    if isinstance(pa, str):
        await _reply_private(bot, qq, pa)
        return

    try:
        strike = resolve_strike(vs, idx)
    except ResolveError as exc:
        await _reply_private(bot, qq, str(exc))
        return

    action = "retargetStrike" if pa.type == "strikeMove" else "retargetMissedStrike"
    data: dict[str, Any] = {"strikeUid": strike.uid, "targetSystem": target_system}
    await _send_and_reply(bot, qq, action, data, pool, settings)


async def handle_discard_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.discard <打击序号> — strikeMissedFree 阶段丢弃落空的打击。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    tokens = raw_args.split()
    if len(tokens) != 1 or not tokens[0].isdigit():
        await _reply_private(bot, qq, "用法: .discard <打击序号>")
        return

    idx = int(tokens[0])

    pa = _check_pending(vs, {"strikeMissedFree"})
    if isinstance(pa, str):
        await _reply_private(bot, qq, pa)
        return

    try:
        strike = resolve_strike(vs, idx)
    except ResolveError as exc:
        await _reply_private(bot, qq, str(exc))
        return

    data: dict[str, Any] = {"strikeUid": strike.uid}
    await _send_and_reply(bot, qq, "discardMissedStrike", data, pool, settings)


async def handle_skip_request(
    bot: Any,
    user_id: int,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.skip — 上下文敏感，按 pa.type 派发不同 backend action。"""
    qq = user_id
    vs = await _require_in_game_view_state(
        bot, qq, session_manager, game_session_store
    )
    if vs is None:
        return

    pa = _check_pending(
        vs,
        {"strikeSelect", "strikeMove", "announceStrike", "strikeMissedFree"},
    )
    if isinstance(pa, str):
        await _reply_private(bot, qq, pa)
        return

    if pa.type == "strikeSelect":
        action = "skipStrikeSelect"
        data: dict[str, Any] = {}
    elif pa.type == "strikeMove":
        action = "skipStrikeMove"
        data = {}
    elif pa.type == "announceStrike":
        action = "skipAnnounceStrike"
        data = {}
    elif pa.type == "strikeMissedFree":
        action = "skipMissedStrike"
        data = {"strikeUid": pa.strike_uid}
    else:
        # Defensive — _check_pending should have rejected other types.
        await _reply_private(bot, qq, f"当前不可跳过（待处理：{pa.type}）")
        return

    await _send_and_reply(bot, qq, action, data, pool, settings)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _check_pending(
    vs: ViewState, allowed_types: set[str]
) -> PendingAction | str:
    """Verify vs.pending_action is set and its type is in allowed_types.

    Returns the PendingAction on success, or an error message string on
    failure (caller is responsible for private-messaging it back).
    """
    pa = vs.pending_action
    if pa is None:
        return "当前无需操作"
    if pa.type not in allowed_types:
        return f"当前不可此操作（当前待处理：{pa.type}）"
    return pa


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
