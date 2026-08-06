"""Bot process entry point.

Wires together the singletons (Settings, SessionManager, WSConnectionPool),
configures nonebot2 with the OneBot v11 adapter, and starts the reverse-WS
server that SnowLuma connects to.

Startup sequence:
    1. ``init_state()`` — loads Settings + creates SessionManager (state.py)
    2. Build ``_on_reconnect`` callback — clears session + DMs the user on
       backend WS reconnect (P2 design: no automatic session recovery)
    3. Create WSConnectionPool with the callback and attach via ``set_pool()``
    4. ``init_nonebot(settings)`` — register OneBot v11 adapter + load plugins
    5. ``nonebot.run()`` — block on the reverse-WS server

The bot instance is obtained dynamically via ``nonebot.get_bot()`` inside
callbacks (not at import time) because the bot is only available after
SnowLuma connects.
"""

from __future__ import annotations

import sys

import nonebot
from loguru import logger

from darkforest_bot.backend.pool import OnReconnectCallback, WSConnectionPool
from darkforest_bot.onebot_setup import init_nonebot
from darkforest_bot.state import (
    get_session_manager,
    get_settings,
    init_state,
    set_pool,
)


def _configure_logging(level: str) -> None:
    """Configure loguru with the given level and a stderr sink."""
    logger.remove()
    logger.add(sys.stderr, level=level.upper(), enqueue=True)


def _build_on_reconnect() -> OnReconnectCallback:
    """Create the on_reconnect callback for WSConnectionPool.

    Returns an async callable ``(qq: int) -> None`` that:
        1. Clears the session for ``qq`` (reset to IDLE, drop room/ws)
        2. Attempts to DM the user "连接断开，请重新 .match"

    The DM is best-effort: the bot may not be connected yet, or the user
    may not have added the bot as a friend. All exceptions are swallowed.
    """
    session_manager = get_session_manager()

    async def _on_reconnect(qq: int) -> None:
        logger.warning("Backend WS reconnected — resetting session", qq=qq)
        try:
            async with session_manager.acquire(qq):
                session_manager.clear(qq)
        except Exception:
            logger.exception("Failed to clear session on reconnect", qq=qq)

        try:
            bot = nonebot.get_bot()
            await bot.call_api(
                "send_private_msg",
                user_id=qq,
                message="连接断开，请重新 .match",
            )
        except Exception:
            logger.debug("DM on reconnect failed (ignored)", qq=qq)

    return _on_reconnect


def main() -> None:
    """Bot entry point — wire singletons, init nonebot2, run."""
    # 1. Load settings + create session manager.
    init_state()
    settings = get_settings()

    # 2. Configure logging.
    _configure_logging(settings.log_level)
    logger.info(
        "Starting darkforest-bot",
        backend_ws_url=settings.backend_ws_url,
        bot_ws_host=settings.bot_ws_host,
        bot_ws_port=settings.bot_ws_port,
    )

    # 3. Create WS connection pool with reconnect callback.
    on_reconnect = _build_on_reconnect()
    pool = WSConnectionPool(
        backend_ws_url=settings.backend_ws_url,
        on_reconnect=on_reconnect,
    )
    set_pool(pool)

    # 4. Initialize nonebot2 (registers adapter, loads command plugins).
    init_nonebot(settings)
    logger.info("nonebot2 initialized, waiting for SnowLuma to connect...")

    # 5. Run the reverse-WS server (blocks until interrupted).
    nonebot.run()


if __name__ == "__main__":
    main()
