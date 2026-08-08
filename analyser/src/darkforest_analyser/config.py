"""复盘分析的运行配置（pydantic-settings）。

所有配置项均从环境变量或 ``.env`` 文件加载，对照组为 bot 的
``darkforest_bot.config``。Settings 实例经 ``load_settings()`` 单例缓存。
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """复盘分析运行时配置。

    Attributes:
        analyse_mcp_url: mcpserver 的 Streamable HTTP MCP 端点。
        analyse_llm_model: CrewAI 所用 LLM 的模型名。
        analyse_llm_base_url: LLM 服务兼容 OpenAI 的 base URL。
        analyse_llm_api_key: LLM API 密钥。
    """

    analyse_mcp_url: str = "http://localhost:9090/mcp"
    analyse_llm_model: str = "deepseek-chat"
    analyse_llm_base_url: str = ""
    analyse_llm_api_key: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="forbid",
    )


@lru_cache(maxsize=1)
def load_settings() -> Settings:
    """返回缓存的 Settings 单例（测试中可用 ``load_settings.cache_clear()`` 重载）。"""
    return Settings()
