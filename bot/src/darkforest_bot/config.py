"""Application configuration via pydantic-settings.

All runtime settings are loaded from environment variables or a ``.env`` file.
The Settings instance is created once via ``load_settings()`` and shared
across the application (see ``state.py`` for the singleton holder).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Bot configuration loaded from environment / .env file.

    Attributes:
        backend_ws_url: Backend WS endpoint (LOCAL_TRUST_MODE handler).
        bot_ws_host: Host for nonebot2's reverse WS server (SnowLuma connects here).
        bot_ws_port: Port for nonebot2's reverse WS server.
        onebot_access_token: Access token for OneBot 11 protocol auth.
        log_level: Loguru/nonebot2 log level.
        default_match_count: Default player count for .match command.
        default_match_mode: Default game mode for .match command.
        match_count_min: Minimum allowed player count.
        match_count_max: Maximum allowed player count.
    """

    backend_ws_url: str = "ws://127.0.0.1:8080/ws"
    bot_ws_host: str = "0.0.0.0"
    bot_ws_port: int = 8081
    onebot_access_token: str = ""
    log_level: str = "INFO"
    default_match_count: int = 4
    default_match_mode: str = "classic"
    match_count_min: int = 3
    match_count_max: int = 5

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="forbid",
    )


@lru_cache(maxsize=1)
def load_settings() -> Settings:
    """Return the singleton Settings instance.

    Uses lru_cache so the .env file is only parsed once per process.
    Call ``load_settings.cache_clear()`` to force a reload (tests only).
    """
    return Settings()
