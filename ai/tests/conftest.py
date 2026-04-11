"""
Pytest 配置和共享 Fixtures
==========================
为所有测试提供通用的测试辅助和 fixture。
"""

import pytest
import sys
import os

# 确保可以导入 src 目录的模块
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from darkforest_ai.state import GameState
from darkforest_ai.validator import ActionValidator
from darkforest_ai.prompt import PromptBuilder


@pytest.fixture
def game_state():
    """提供一个初始化的 GameState 实例"""
    return GameState()


@pytest.fixture
def game_state_with_hand(game_state):
    """提供一个带有模拟手牌的 GameState"""
    game_state.my_player_id = "test_player"
    game_state.my_hand = [
        {"uid": "br_001", "name": "宇宙广播", "type": "broadcast", "energy": 1},
        {"uid": "st_005", "name": "等级2打击", "type": "strike", "energy": 2},
        {"uid": "df_002", "name": "3级防御", "type": "defense", "energy": 3},
    ]
    game_state.turn_phase = "actionPhase"
    game_state.current_player_id = "test_player"
    return game_state


@pytest.fixture
def validator(game_state):
    """提供一个 ActionValidator 实例"""
    return ActionValidator(game_state)


@pytest.fixture
def prompt_builder():
    """提供 PromptBuilder 类（静态方法，直接返回类）"""
    return PromptBuilder


@pytest.fixture
def mock_view_state():
    """提供一个模拟的 ViewState 数据"""
    return {
        "totalTurn": 5,
        "turnPhase": "actionPhase",
        "currentPlayerId": "test_player",
        "players": [
            {
                "id": "test_player",
                "name": "Test Player",
                "position": 3,
                "energy": 10,
                "hand": [
                    {"uid": "br_001", "name": "宇宙广播", "type": "broadcast"},
                    {"uid": "st_005", "name": "等级2打击", "type": "strike"},
                ],
                "faceUpCards": [],
            },
            {
                "id": "opponent_1",
                "name": "Opponent 1",
                "position": 5,
                "energy": 8,
                "hand": [
                    {"uid": "fa_008", "name": "能量设施", "type": "facility"},
                ],
                "faceUpCards": [],
            },
        ],
        "flyingStrikes": [],
        "broadcast": None,
        "pendingAction": None,
        "logs": [
            {"message": "游戏开始"},
            {"message": "回合 1 开始"},
        ],
    }
