"""nonebot2 initialization for OneBot 11 reverse-WS (SnowLuma) integration.

SnowLuma connects TO the bot's WS server (reverse WS). nonebot2 with the
default FastAPI driver provides this out of the box — the bot listens on
``bot_ws_host:bot_ws_port`` and SnowLuma establishes the WS connection.

This module sets up nonebot2 with:
- OneBot v11 adapter (for QQ protocol)
- Command prefix ``.`` (e.g. ``.match``, ``.cancel``)
- Plugin loading for match/cancel/state/log command handlers (P2/P3)
- Plugin loading for action/broadcast/strike/end/jump game-action commands (P4)

``init_nonebot()`` must be called exactly once per process, before
``nonebot.run()``.
"""

from __future__ import annotations

import nonebot
from nonebot.adapters.onebot.v11 import Adapter as OneBotV11Adapter

from darkforest_bot.config import Settings

# Plugins to load on init. These module paths must exist at runtime.
# Order matters only for log readability; commands are independent.
_PLUGIN_MODULES: tuple[str, ...] = (
    # P2/P3 base commands
    "darkforest_bot.commands.match",
    "darkforest_bot.commands.cancel",
    "darkforest_bot.commands.state",
    "darkforest_bot.commands.log",
    # P4 game action commands (17 commands across 5 modules)
    "darkforest_bot.commands.action",
    "darkforest_bot.commands.broadcast",
    "darkforest_bot.commands.strike",
    "darkforest_bot.commands.end",
    "darkforest_bot.commands.jump",
    "darkforest_bot.commands.forfeit",
    "darkforest_bot.commands.exit",
    # 无状态命令总览（独立，任何阶段可用）
    "darkforest_bot.commands.help",
    # 拉起 gameagent AI 对手对战（.playai / .cancelai，调 Agent 管理器 HTTP API）
    "darkforest_bot.commands.playai",
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
