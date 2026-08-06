""".match command handler.

Usage in group chat: @bot .match [count] [mode]
- count: 3-5 (default from settings.default_match_count)
- mode: "classic" or "civilization_relics" (default from settings.default_match_mode)

Flow:
    1. Parse args, validate
    2. Check session is IDLE, transition to MATCHMAKING
    3. Connect WS (one-QQ-one-WS via pool)
    4. Subscribe to login_success, match_found, match_error, room_joined, game_started
    5. Send match:joinQueue, reply "匹配中..."
    6. Wait for login_success (update player_id)
    7. Wait for match_found or match_error (5min timeout)
    8. On match_found: transition to IN_ROOM, notify group + private
    9. Wait for room_joined, send room:ready (auto-ready)
    10. Wait for game_started, transition to IN_GAME

The session lock is NOT held during waits — only during state checks and
transitions. This allows .cancel to acquire the lock between wait phases.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, GroupMessageEvent, Message
from nonebot.params import CommandArg

from darkforest_bot.backend.protocol import (
    ClientEvent,
    MatchFoundPayload,
    PlayerInfo,
    ServerEvent,
)
from darkforest_bot.notifications.match_found import notify_match_found
from darkforest_bot.session.states import IllegalTransitionError, SessionState
from darkforest_bot.state import get_pool, get_session_manager, get_settings

if TYPE_CHECKING:
    from darkforest_bot.backend.pool import WSConnectionPool
    from darkforest_bot.config import Settings
    from darkforest_bot.session.manager import SessionManager

# Valid game modes.
VALID_MODES: frozenset[str] = frozenset({"classic", "civilization_relics"})

# Timeouts (seconds).
LOGIN_TIMEOUT: float = 10.0
MATCH_TIMEOUT: float = 300.0
ROOM_JOINED_TIMEOUT: float = 60.0
GAME_STARTED_TIMEOUT: float = 120.0

# nonebot2 command registration.
# Note: no to_me() rule — users invoke by typing ".match" directly in group.
# SnowLuma's @ format varies across OneBot implementations; requiring to_me()
# caused silent no-ops. The command prefix "." already disambiguates.
match_cmd = on_command("match", priority=10, block=True)


@match_cmd.handle()
async def _handle_match_cmd(
    bot: Bot,
    event: GroupMessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — extracts event data and delegates to core logic."""
    sender_name = (event.sender.card or event.sender.nickname or "").strip()
    await handle_match_request(
        bot=bot,
        group_id=event.group_id,
        user_id=event.user_id,
        sender_name=sender_name,
        raw_args=args.extract_plain_text().strip(),
        pool=get_pool(),
        session_manager=get_session_manager(),
        settings=get_settings(),
    )


def parse_match_args(
    raw_args: str,
    default_count: int,
    default_mode: str,
    count_min: int,
    count_max: int,
) -> tuple[int, str] | str:
    """Parse .match arguments.

    Returns (count, mode) on success, or an error message string on failure.
    """
    tokens = raw_args.split() if raw_args else []
    count: int | None = None
    mode: str | None = None

    for token in tokens:
        if token.isdigit():
            if count is not None:
                return "参数无效：玩家数重复，用法 .match [count] [mode]"
            count = int(token)
        elif token in VALID_MODES:
            if mode is not None:
                return "参数无效：模式重复，用法 .match [count] [mode]"
            mode = token
        else:
            return f"参数无效：{token}，用法 .match [count] [mode]"

    if count is None:
        count = default_count
    if mode is None:
        mode = default_mode

    if not (count_min <= count <= count_max):
        return f"玩家数必须在 {count_min}-{count_max} 之间"

    return count, mode


async def handle_match_request(
    bot: Any,
    group_id: int,
    user_id: int,
    sender_name: str,
    raw_args: str,
    pool: WSConnectionPool,
    session_manager: SessionManager,
    settings: Settings,
) -> None:
    """Core match command logic — extracted for testability.

    Args:
        bot: nonebot Bot instance (or mock with call_api in tests).
        group_id: QQ group ID where the command was issued.
        user_id: QQ number of the user who issued the command.
        sender_name: Display name (group card > nickname).
        raw_args: Raw argument string after ".match".
        pool: WSConnectionPool for backend connections.
        session_manager: SessionManager for state machine.
        settings: Application settings.
    """
    qq = user_id

    # 1. Parse and validate args.
    parse_result = parse_match_args(
        raw_args,
        settings.default_match_count,
        settings.default_match_mode,
        settings.match_count_min,
        settings.match_count_max,
    )
    if isinstance(parse_result, str):
        await _reply_group(bot, group_id, parse_result)
        return
    count, mode = parse_result

    # 2. Check session state and transition to MATCHMAKING.
    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)
        if session.state != SessionState.IDLE:
            await _reply_group(bot, group_id, f"当前状态：{session.state.value}，请先 .cancel")
            return
        session_manager.set_player_info(qq, player_id="", display_name=sender_name)
        session_manager.transition(qq, SessionState.MATCHMAKING)

    # 3. Connect WS.
    try:
        ws = await pool.get_or_connect(qq, sender_name)
    except Exception:
        logger.exception("WS connect failed", qq=qq)
        await _reply_group(bot, group_id, "连接后端失败，请稍后重试")
        await _reset_to_idle(session_manager, qq)
        return

    # 4. Subscribe to events and create futures.
    loop = asyncio.get_running_loop()
    login_success_future: asyncio.Future[dict[str, Any]] = loop.create_future()
    match_found_future: asyncio.Future[dict[str, Any]] = loop.create_future()
    match_error_future: asyncio.Future[dict[str, Any]] = loop.create_future()
    room_joined_future: asyncio.Future[dict[str, Any]] = loop.create_future()
    game_started_future: asyncio.Future[dict[str, Any]] = loop.create_future()

    unsubs: list[Any] = []

    async def on_login_success(payload: dict[str, Any]) -> None:
        if not login_success_future.done():
            login_success_future.set_result(payload)

    async def on_match_found(payload: dict[str, Any]) -> None:
        if not match_found_future.done():
            match_found_future.set_result(payload)

    async def on_match_error(payload: dict[str, Any]) -> None:
        if not match_error_future.done():
            match_error_future.set_result(payload)

    async def on_room_joined(payload: dict[str, Any]) -> None:
        if not room_joined_future.done():
            room_joined_future.set_result(payload)

    async def on_game_started(payload: dict[str, Any]) -> None:
        if not game_started_future.done():
            game_started_future.set_result(payload)

    unsubs.append(ws.subscribe(ServerEvent.PLAYER_LOGIN_SUCCESS, on_login_success))
    unsubs.append(ws.subscribe(ServerEvent.MATCH_FOUND, on_match_found))
    unsubs.append(ws.subscribe(ServerEvent.MATCH_ERROR, on_match_error))
    unsubs.append(ws.subscribe(ServerEvent.ROOM_JOINED, on_room_joined))
    unsubs.append(ws.subscribe(ServerEvent.ROOM_GAME_STARTED, on_game_started))
    logger.info("Subscribed to events, sending match:joinQueue", qq=qq, count=count, mode=mode)

    try:
        # 5. Send match:joinQueue and reply.
        await ws.send(
            ClientEvent.MATCH_JOIN_QUEUE,
            {"preferredCount": count, "gameMode": mode},
        )
        await _reply_group(bot, group_id, "匹配中...")
        logger.info("match:joinQueue sent, waiting for login_success", qq=qq)

        # 6. Wait for login_success (non-fatal timeout).
        try:
            login_payload = await asyncio.wait_for(login_success_future, timeout=LOGIN_TIMEOUT)
            player = PlayerInfo.model_validate(login_payload)
            async with session_manager.acquire(qq):
                session_manager.set_player_info(
                    qq, player_id=player.id, display_name=player.display_name
                )
        except TimeoutError:
            logger.warning("login_success timeout (non-fatal)", qq=qq)

        # 7. Wait for match_found or match_error.
        logger.info("Waiting for match_found or match_error", qq=qq, timeout=MATCH_TIMEOUT)
        done, _pending = await asyncio.wait(
            [match_found_future, match_error_future],
            timeout=MATCH_TIMEOUT,
            return_when=asyncio.FIRST_COMPLETED,
        )
        logger.info("Wait returned", qq=qq, done_count=len(done), pending_count=len(_pending))

        if match_error_future in done:
            error_payload = match_error_future.result()
            from darkforest_bot.backend.protocol import ErrorResponse

            err = ErrorResponse.model_validate(error_payload)
            logger.warning("match:error received", qq=qq, code=err.code, message=err.message)
            await _reply_group(bot, group_id, f"匹配失败：{err.message}")
            await _reset_to_idle(session_manager, qq)
            return

        if match_found_future not in done:
            logger.warning("match wait timed out", qq=qq)
            await _reply_group(bot, group_id, "匹配超时，请稍后重试")
            await _reset_to_idle(session_manager, qq)
            return

        # 8. Process match_found.
        found_payload = match_found_future.result()
        mf = MatchFoundPayload.model_validate(found_payload)
        try:
            async with session_manager.acquire(qq):
                session_manager.transition(qq, SessionState.IN_ROOM, room_id=mf.room_id)
        except IllegalTransitionError:
            logger.warning("Session was cancelled during match wait", qq=qq)
            await _reply_group(bot, group_id, "匹配已取消（会话状态已变更）")
            return

        await notify_match_found(
            bot=bot,
            group_id=group_id,
            current_qq=qq,
            players=mf.players,
            room_code=mf.room_code,
        )

        # 9. Wait for room_joined, then send room:ready.
        try:
            await asyncio.wait_for(room_joined_future, timeout=ROOM_JOINED_TIMEOUT)
        except TimeoutError:
            await _reply_group(bot, group_id, "房间加入超时，请稍后重试")
            await _reset_to_idle(session_manager, qq)
            return

        await ws.send(ClientEvent.ROOM_READY, room_id=mf.room_id)

        # 10. Wait for game_started, then transition to IN_GAME.
        try:
            await asyncio.wait_for(game_started_future, timeout=GAME_STARTED_TIMEOUT)
        except TimeoutError:
            await _reply_group(bot, group_id, "游戏开始超时，请稍后重试")
            await _reset_to_idle(session_manager, qq)
            return

        try:
            async with session_manager.acquire(qq):
                session_manager.transition(qq, SessionState.IN_GAME)
        except IllegalTransitionError:
            logger.warning("Session changed during game start wait", qq=qq)
            return

        await _reply_private(bot, qq, "对局已开始")

    finally:
        for unsub in unsubs:
            unsub()
        logger.info("match handler completed", qq=qq)


async def _reply_group(bot: Any, group_id: int, message: str) -> None:
    """Send a group message. Failures are logged but not raised."""
    try:
        await bot.call_api("send_group_msg", group_id=group_id, message=message)
    except Exception:
        logger.warning("Failed to send group message", group_id=group_id)


async def _reply_private(bot: Any, user_id: int, message: str) -> None:
    """Send a private message. Failures are logged but not raised."""
    try:
        await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:
        logger.warning("Failed to send private message", user_id=user_id)


async def _reset_to_idle(session_manager: SessionManager, qq: int) -> None:
    """Reset session to IDLE state. Used on error/timeout cleanup."""
    try:
        async with session_manager.acquire(qq):
            session = session_manager.get_or_create(qq)
            if session.state == SessionState.MATCHMAKING:
                session_manager.transition(qq, SessionState.IDLE)
            elif session.state in (SessionState.IN_ROOM, SessionState.IN_GAME):
                session_manager.clear(qq)
    except Exception:
        logger.exception("Failed to reset session to IDLE", qq=qq)
