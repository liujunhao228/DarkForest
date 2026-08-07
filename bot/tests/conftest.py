"""pytest conftest — initialize nonebot2 before test collection.

nonebot2's on_command() decorator calls get_driver() at module import time,
which requires nonebot.init() to have been called. This conftest initializes
nonebot2 with minimal test config so that plugin modules can be imported.

An autouse fixture calls ``init_state()`` before each test and
``reset_state()`` after, so any code path that touches the singleton getters
(e.g. ``match.py``'s ``_start_game_session`` → ``get_game_session_store()``)
works without each test having to set up state manually.
"""

from __future__ import annotations

from collections.abc import Iterator

import nonebot
import pytest

from darkforest_bot.state import init_state, reset_state

# Initialize once before any test module imports darkforest_bot.commands.*.
nonebot.init(
    command_start=["."],
    command_sep=[],
    superusers=set(),
    host="127.0.0.1",
    port=18081,  # Use a non-default port to avoid conflicts.
    log_level="WARNING",
)


@pytest.fixture(autouse=True)
def _init_and_reset_state() -> Iterator[None]:
    """Ensure singletons (Settings, SessionManager, GameSessionStore) exist.

    Tests that pass their own instances to handlers (e.g. ``handle_match_request``
    receives ``pool=...``, ``session_manager=...``) don't read the singletons
    for those, but ``match.py``'s ``_start_game_session`` calls
    ``get_game_session_store()`` which reads the singleton. Initializing state
    before each test keeps those code paths working without per-test boilerplate.
    """
    init_state()
    yield
    reset_state()
