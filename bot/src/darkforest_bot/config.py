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
        group_require_at_mention: 群聊中是否要求@机器人才响应命令。默认 True。
            SnowLuma @ 解析异常时可设为 false 回退到旧行为（直接 ``.`` 前缀触发）。
        analyse_mcp_url: ``.analyse`` 命令 subprocess 调 ``analyser`` CLI 时
            传入的 mcpserver Streamable HTTP MCP 端点。
        analyse_bin: ``.analyse`` 命令调用的 analyser 可执行文件路径
            （analyser/ 包 console script），默认取 PATH 中的 ``analyser``。
        analyse_cwd: ``.analyse`` 命令启动 analyser 子进程的工作目录。
            必须指向 analyser 包根目录（其 Settings 相对 cwd 读 ``.env`` 的
            LLM 配置）；留空则继承 bot 进程 cwd（可能读不到 LLM 配置）。
        analyse_timeout: ``.analyse`` 命令等待 analyser CLI 完成的超时（秒）。
            一次分析含 3 阶段并行 + 汇总共多次 LLM 调用，默认 600s（10 分钟）。
        agent_manager_url: ``.playai`` 命令调用的 gameagent Agent 管理器
            HTTP API 基址（POST /api/spawn-agent、GET /api/agents/:childId、
            DELETE /api/agents/:childId）。
        agent_manager_timeout: ``.playai`` 命令后台轮询子 Agent 进入对局的
            总超时（秒），超时后判定 AI 对手未进入对局并清理。
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
    group_require_at_mention: bool = True
    analyse_mcp_url: str = "http://localhost:9090/mcp"
    analyse_bin: str = "analyser"
    analyse_cwd: str = ""
    analyse_timeout: float = 600.0
    agent_manager_url: str = "http://localhost:9091"
    agent_manager_timeout: float = 300.0

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
