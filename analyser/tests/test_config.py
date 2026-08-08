"""Settings 配置单测：环境变量加载与默认值。

注意：analyser/.env 存在真实 LLM 配置（ANALYSE_LLM_MODEL 等），pydantic-settings
相对 cwd 读 .env 会覆盖默认值。测试用 ``Settings(_env_file=None)`` 隔离 .env，
仅验证默认值与显式环境变量注入。

另注意：crewai.llm 在模块导入期会 ``load_dotenv()`` 把 .env 的 ANALYSE_*
注入 os.environ，同样会污染 ``_env_file=None`` 的前提——该隔离统一由
conftest.py 的 autouse fixture 处理。
"""

from __future__ import annotations

from darkforest_analyser.config import Settings, load_settings


def test_defaults() -> None:
    settings = Settings(_env_file=None)
    assert settings.analyse_mcp_url == "http://localhost:9090/mcp"
    assert settings.analyse_llm_model == "deepseek-chat"
    assert settings.analyse_llm_base_url == ""
    assert settings.analyse_llm_api_key == ""


def test_env_overrides(monkeypatch) -> None:
    monkeypatch.setenv("ANALYSE_MCP_URL", "http://127.0.0.1:9999/mcp")
    monkeypatch.setenv("ANALYSE_LLM_MODEL", "local-model")
    monkeypatch.setenv("ANALYSE_LLM_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setenv("ANALYSE_LLM_API_KEY", "secret-key")
    load_settings.cache_clear()
    try:
        settings = load_settings()
        assert settings.analyse_mcp_url == "http://127.0.0.1:9999/mcp"
        assert settings.analyse_llm_model == "local-model"
        assert settings.analyse_llm_base_url == "http://127.0.0.1:11434/v1"
        assert settings.analyse_llm_api_key == "secret-key"
    finally:
        load_settings.cache_clear()


def test_env_partial_override(monkeypatch) -> None:
    monkeypatch.setenv("ANALYSE_MCP_URL", "http://custom:8080/mcp")
    settings = Settings(_env_file=None)
    assert settings.analyse_mcp_url == "http://custom:8080/mcp"
    assert settings.analyse_llm_model == "deepseek-chat"
    assert settings.analyse_llm_base_url == ""
    assert settings.analyse_llm_api_key == ""
