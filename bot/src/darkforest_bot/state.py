"""Module-level singleton holders for shared application state.

This module breaks circular imports between commands/, notifications/, and
main.py. All modules import from state.py rather than from each other.

Lifecycle:
    1. ``init_state()`` creates Settings + SessionManager + GameSessionStore
       (called by main.py)
    2. ``set_pool(p)`` attaches the WSConnectionPool (called by main.py after
       creating the pool with its on_reconnect callback)
    3. Command handlers call ``get_settings()``, ``get_pool()``,
       ``get_session_manager()``, ``get_game_session_store()`` to access
       the singletons
    4. ``reset_state()`` clears everything (tests only)
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.config import Settings, load_settings
from darkforest_bot.notifications.notify_config import NotifyConfigStore
from darkforest_bot.session.manager import SessionManager

if TYPE_CHECKING:
    from darkforest_bot.backend.pool import WSConnectionPool

# Module-level singletons. None until init_state() / set_pool() is called.
settings: Settings | None = None
pool: WSConnectionPool | None = None
session_manager: SessionManager | None = None
game_session_store: GameSessionStore | None = None
notify_config_store: NotifyConfigStore | None = None


def init_state(notify_config_path: Path = Path("data/notify_settings.json")) -> None:
    """Initialize Settings, SessionManager, GameSessionStore, and NotifyConfigStore.

    Does NOT create the pool — the pool is created separately by main.py
    because it needs an on_reconnect callback that references the
    SessionManager and Bot.
    """
    global settings, session_manager, game_session_store, notify_config_store
    settings = load_settings()
    session_manager = SessionManager()
    game_session_store = GameSessionStore()
    notify_config_store = NotifyConfigStore(notify_config_path)


def set_pool(p: WSConnectionPool) -> None:
    """Attach the WSConnectionPool singleton."""
    global pool
    pool = p


def get_settings() -> Settings:
    """Return the Settings singleton. Raises if init_state() was not called."""
    assert settings is not None, "init_state() must be called first"
    return settings


def get_pool() -> WSConnectionPool:
    """Return the WSConnectionPool singleton. Raises if set_pool() was not called."""
    assert pool is not None, "set_pool() must be called first"
    return pool


def get_session_manager() -> SessionManager:
    """Return the SessionManager singleton."""
    assert session_manager is not None, "init_state() must be called first"
    return session_manager


def get_game_session_store() -> GameSessionStore:
    """Return the GameSessionStore singleton."""
    assert game_session_store is not None, "init_state() must be called first"
    return game_session_store


def get_notify_config_store() -> NotifyConfigStore:
    """Return the NotifyConfigStore singleton."""
    assert notify_config_store is not None, "init_state() must be called first"
    return notify_config_store


def reset_state() -> None:
    """Clear all singletons. Used by tests to reset state between cases."""
    global settings, pool, session_manager, game_session_store, notify_config_store
    settings = None
    pool = None
    session_manager = None
    game_session_store = None
    notify_config_store = None
