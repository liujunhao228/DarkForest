"""nonebot2 initialization for OneBot 11 reverse-WS (SnowLuma) integration.

SnowLuma connects TO the bot's WS server (reverse WS). nonebot2 with the
default FastAPI driver provides this out of the box — the bot listens on
``bot_ws_host:bot_ws_port`` and SnowLuma establishes the WS connection.

This module sets up nonebot2 with:
- OneBot v11 adapter (for QQ protocol)
- Command prefix ``.`` (e.g. ``.match``, ``.cancel``)
- Plugin loading for match/cancel command handlers

``init_nonebot()`` must be called exactly once per process, before
``nonebot.run()``.
"""

from __future__ import annotations

import nonebot
from nonebot.adapters.onebot.v11 import Adapter as OneBotV11Adapter

from darkforest_bot.config import Settings

# Plugins to load on init. These module paths must exist at runtime.
_PLUGIN_MODULES: tuple[str, ...] = (
    "darkforest_bot.commands.match",
    "darkforest_bot.commands.cancel",
)


def init_nonebot(settings: Settings) -> None:
    """Initialize nonebot2 with OneBot v11 adapter and load command plugins.

    This configures:
    - Log level, WS host/port for reverse WS server
    - Command prefix ``.`` with no separator
    - OneBot v11 adapter registration
    - Match and cancel command plugin loading

    Must be called before ``nonebot.run()``. Calling twice in the same
    process raises ``RuntimeError`` from nonebot2 internals.
    """
    nonebot.init(
        log_level=settings.log_level,
        host=settings.bot_ws_host,
        port=settings.bot_ws_port,
        superusers=set(),
        command_start=["."],
        command_sep=[],
        onebot_access_token=settings.onebot_access_token,
    )

    driver = nonebot.get_driver()
    driver.register_adapter(OneBotV11Adapter)

    for module_path in _PLUGIN_MODULES:
        nonebot.load_plugin(module_path)
