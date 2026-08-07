""".state command handler.

Usage in private message: .state

Renders the local player's cached ViewState to a starmap PNG + text summary
and sends them as a private message. If the cache is empty (e.g. the bot just
(re)connected and no fullSync has arrived yet), the command sends
``game:requestSync`` to the backend and waits for one ``game:fullSync`` event
(up to ``settings.state_request_timeout`` seconds) before rendering.

The session lock is held only for the initial state check (must be IN_GAME).
The cache lookup, WS request, and rendering happen outside the lock so a
slow backend reply does not block other commands from the same QQ (e.g. ``.log``).
"""

from __future__ import annotations

import asyncio
import base64
from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, Message, MessageEvent, MessageSegment
from nonebot.params import CommandArg

from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.render.starmap import render_starmap
from darkforest_bot.render.text import render_pending_hint, render_text_summary
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
    from darkforest_bot.backend.view_state import ViewState
    from darkforest_bot.config import Settings
    from darkforest_bot.session.manager import SessionManager

# nonebot2 command registration.
# Note: no to_me() rule — users invoke by typing ".state" directly. Works in
# both group and private contexts; replies are always private because the
# command is per-QQ (IN_GAME session required).
state_cmd = on_command("state", priority=10, block=True)


@state_cmd.handle()
async def _handle_state_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: ARG001, B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — extracts event data and delegates to core logic."""
    await handle_state_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


async def handle_state_request(
    bot: Any,
    user_id: int,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """Core .state command logic — extracted for testability.

    Args:
        bot: nonebot Bot instance (or mock with call_api in tests).
        user_id: QQ number of the user who issued the command.
        session_manager: SessionManager for state machine checks.
        game_session_store: GameSessionStore for ViewState cache lookup.
        pool: WSConnectionPool for backend WS access (used on cache miss).
        settings: Application settings (render + timeout config).
    """
    qq = user_id

    # 1. State check — must be IN_GAME to view state.
    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)
        if session.state != SessionState.IN_GAME:
            await _reply_private(bot, qq, "当前不在对局中，无法查看状态")
            return

    # 2. Cache lookup. If empty, request a fullSync and wait for it.
    game_session = game_session_store.get(qq)
    vs: ViewState | None = (
        game_session.view_state if game_session is not None else None
    )

    if vs is None:
        vs = await _fetch_state_via_ws(qq, pool, settings)
        if vs is None:
            await _reply_private(bot, qq, "状态请求超时或连接不可用，请稍后重试")
            return

    # 3. Render PNG + text, send as private message.
    await _send_rendered_state(bot, qq, vs, settings)


async def _fetch_state_via_ws(
    qq: int, pool: WSConnectionPool, settings: Settings
) -> ViewState | None:
    """Request a fullSync from backend and wait for one to arrive.

    Returns the parsed ViewState on success, or None on failure (WS
    unavailable, send failed, timeout, or parse error).
    """
    ws = pool.get(qq)
    if ws is None or not ws.connected:
        logger.warning("state command: WS unavailable for cache fetch", qq=qq)
        return None

    # Subscribe once to game:fullSync and resolve a future when it arrives.
    loop = asyncio.get_running_loop()
    sync_future: asyncio.Future[dict[str, Any]] = loop.create_future()

    async def on_full_sync(payload: dict[str, Any]) -> None:
        if not sync_future.done():
            sync_future.set_result(payload)

    unsub = ws.subscribe(ServerEvent.GAME_FULL_SYNC, on_full_sync)

    try:
        # Ask backend to re-send the current state.
        try:
            await ws.send(ClientEvent.GAME_REQUEST_SYNC)
        except Exception:
            logger.exception(
                "state command: ws.send(GAME_REQUEST_SYNC) failed", qq=qq
            )
            return None

        # Wait for fullSync. The GameSessionStore's own fullSync handler
        # will update the cache in parallel; we parse the payload ourselves
        # so the caller does not need to re-check the cache (which would
        # race with the store's handler).
        try:
            await asyncio.wait_for(
                sync_future, timeout=settings.state_request_timeout
            )
        except TimeoutError:
            logger.warning("state command: fullSync wait timed out", qq=qq)
            return None
    finally:
        unsub()

    # Parse the payload's "state" field into a typed ViewState.
    try:
        payload = sync_future.result()
    except asyncio.InvalidStateError:
        # Defensive: future should be resolved by now.
        return None

    state_data = payload.get("state")
    if not isinstance(state_data, dict):
        logger.warning(
            "state command: fullSync payload missing 'state'", qq=qq
        )
        return None

    # Late import to avoid circular dependency at module load time.
    from darkforest_bot.backend.view_state import ViewState as _VS

    try:
        return _VS.model_validate(state_data)
    except Exception:
        logger.exception("state command: ViewState parse failed", qq=qq)
        return None


async def _send_rendered_state(
    bot: Any, qq: int, vs: ViewState, settings: Settings
) -> None:
    """Render starmap PNG + text summary and send as a private message."""
    try:
        png = render_starmap(
            vs,
            canvas_size=settings.render_canvas_size,
            font_path=settings.render_font_path,
        )
    except Exception:
        logger.exception("state command: render_starmap failed", qq=qq)
        await _reply_private(bot, qq, "星图渲染失败，请稍后重试")
        return

    try:
        text = render_text_summary(vs, vs.local_player_id)
    except Exception:
        logger.exception("state command: render_text_summary failed", qq=qq)
        text = ""

    hint = render_pending_hint(vs, vs.local_player_id)
    if hint:
        text = f"{text}\n{hint}" if text else hint

    b64 = base64.b64encode(png).decode("ascii")
    image_segment = MessageSegment.image(f"base64://{b64}")
    # Concatenate image + newline + text into a single OneBot v11 Message.
    msg = Message([image_segment, MessageSegment.text("\n" + text)])
    await _reply_private(bot, qq, msg)


async def _reply_private(bot: Any, user_id: int, message: Any) -> None:
    """Send a private message. Failures are logged but not raised."""
    try:
        await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:
        logger.warning("Failed to send private message", user_id=user_id)
