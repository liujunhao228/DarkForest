"""
配置管理
========
集中管理所有配置项。
"""

import os

from dotenv import load_dotenv

# 加载环境变量
load_dotenv()


class Settings:
    """全局配置"""

    # 游戏服务器配置
    GAME_SERVER_URL: str = os.getenv("GAME_SERVER_URL", "http://localhost:3003")

    # LLM 配置
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "http://127.0.0.1:8900/v1")
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "dummy")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "")  # 留空则自动从 /v1/models 获取
    SESSION_ID: str = os.getenv("SESSION_ID", "darkforest-ai")

    # AI 玩家配置
    AI_PLAYER_NAME: str = os.getenv("AI_PLAYER_NAME", "AI-文明")

    # 日志配置
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")


# 向后兼容的模块级变量（保留旧代码的导入方式）
GAME_SERVER_URL = Settings.GAME_SERVER_URL
LLM_BASE_URL = Settings.LLM_BASE_URL
LLM_API_KEY = Settings.LLM_API_KEY
LLM_MODEL = Settings.LLM_MODEL
SESSION_ID = Settings.SESSION_ID
AI_PLAYER_NAME = Settings.AI_PLAYER_NAME
