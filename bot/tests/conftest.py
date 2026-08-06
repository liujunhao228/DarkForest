"""pytest conftest — initialize nonebot2 before test collection.

nonebot2's on_command() decorator calls get_driver() at module import time,
which requires nonebot.init() to have been called. This conftest initializes
nonebot2 with minimal test config so that plugin modules can be imported.
"""

from __future__ import annotations

import nonebot

# Initialize once before any test module imports darkforest_bot.commands.*.
nonebot.init(
    command_start=["."],
    command_sep=[],
    superusers=set(),
    host="127.0.0.1",
    port=18081,  # Use a non-default port to avoid conflicts.
    log_level="WARNING",
)
