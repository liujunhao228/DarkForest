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
        render_canvas_size: Square canvas size (pixels) for starmap PNG rendering.
        render_font_path: Path to a TrueType font that supports Chinese glyphs
            for starmap rendering. Defaults to Microsoft YaHei on Windows.
        log_default_limit: Default number of log entries ``.log`` returns
            when no count argument is provided.
        log_max_limit: Hard upper bound on the ``.log`` count argument
            (prevents the bot from sending a wall of text).
        state_request_timeout: Seconds to wait for a ``game:fullSync`` reply
            when ``.state`` is invoked with an empty cache before timing out.
        action_error_timeout: Seconds to wait for a ``game:error`` reply after
            sending a ``game:action`` before assuming success. P4 game action
            commands use this to give immediate feedback on invalid actions.
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
    render_canvas_size: int = 900
    render_font_path: str = "C:\\Windows\\Fonts\\msyh.ttc"
    log_default_limit: int = 10
    log_max_limit: int = 50
    state_request_timeout: float = 10.0
    action_error_timeout: float = 2.0

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
