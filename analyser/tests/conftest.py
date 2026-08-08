"""pytest 全局配置：隔离 crewai/litellm 导入期注入 .env 的副作用。"""

from __future__ import annotations

import os

import pytest

_ANALYSE_ENV_PREFIX = "ANALYSE_"


@pytest.fixture(autouse=True)
def _clean_analyse_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """每个测试前剔除 ANALYSE_* 环境变量。

    ``crewai.llm`` 模块导入期即 ``load_dotenv()``，把 analyser/.env 的
    ANALYSE_LLM_MODEL 等注入 os.environ（仅当未设置时）。这会破坏
    ``Settings(_env_file=None)`` 模拟的"生产环境显式注入"前提，使默认值断言
    读到 step-3.7-flash 等真实 .env 值。此处按前缀剔除并经由 monkeypatch
    在测试结束后还原。
    """
    for key in [k for k in os.environ if k.startswith(_ANALYSE_ENV_PREFIX)]:
        monkeypatch.delenv(key, raising=False)
