"""
ActionValidator 和 GameState 单元测试
====================================
测试 ActionValidator 的操作验证功能和 GameState 的状态管理功能
"""

import pytest
from darkforest_ai.state import GameState
from darkforest_ai.validator import ActionValidator


def test_game_state_initialization():
    """测试 GameState 初始化"""
    state = GameState()
    assert state.my_player_id is None
    assert state.room_id is None
    assert state.turn_number == 0
    assert state.turn_phase == "turnBegin"
    assert state.current_player_id is None
    assert state.my_position == -1
    assert state.my_energy == 0
    assert state.my_hand == []
    assert state.my_face_up == []
    assert state.opponents == []
    assert state.flying_strikes == []
    assert state.broadcast_state is None
    assert state.pending_action is None
    assert state.recent_logs == []


def test_game_state_update_from_viewstate():
    """测试 GameState 从 view_state 更新"""
    state = GameState()
    state.my_player_id = "player1"
    
    view_state = {
        "totalTurn": 5,
        "turnPhase": "actionPhase",
        "currentPlayerId": "player1",
        "players": [
            {
                "id": "player1",
                "position": 3,
                "energy": 10,
                "hand": [
                    {"uid": "card1", "defId": "br_001", "name": "宇宙广播", "type": "broadcast"},
                    {"uid": "card2", "defId": "st_001", "name": "打击", "type": "strike"}
                ],
                "faceUpCards": [
                    {"uid": "card3", "defId": "df_001", "name": "防御", "type": "defense"}
                ]
            },
            {
                "id": "player2",
                "name": "Player 2",
                "position": 5,
                "energy": 8,
                "hand": ["card4"],
                "eliminated": False
            }
        ],
        "flyingStrikes": [
            {
                "uid": "strike1",
                "ownerId": "player1",
                "position": 3,
                "targetSystem": 5,
                "level": 2,
                "speed": 1,
                "arrived": False
            }
        ],
        "broadcast": {
            "active": True,
            "broadcasterId": "player2",
            "targetSystem": 5,
            "range": 2,
            "subtype": "normal",
            "phase": "voting"
        },
        "pendingAction": {
            "type": "broadcastResponse",
            "validMoves": []
        },
        "logs": [
            {"message": "Player 2 发起了广播"},
            {"message": "Player 1 打出了宇宙广播"}
        ]
    }
    
    state.update_from_viewstate(view_state)
    
    assert state.turn_number == 5
    assert state.turn_phase == "actionPhase"
    assert state.current_player_id == "player1"
    assert state.my_position == 3
    assert state.my_energy == 10
    assert len(state.my_hand) == 2
    assert len(state.my_face_up) == 1
    assert len(state.opponents) == 1
    assert state.opponents[0]["id"] == "player2"
    assert state.opponents[0]["name"] == "Player 2"
    assert len(state.flying_strikes) == 1
    assert state.broadcast_state is not None
    assert state.broadcast_state["active"] is True
    assert state.pending_action is not None
    assert state.pending_action["type"] == "broadcastResponse"
    assert len(state.recent_logs) == 2


def test_game_state_is_my_turn():
    """测试 GameState.is_my_turn() 方法"""
    state = GameState()
    state.my_player_id = "player1"
    state.current_player_id = "player1"
    state.turn_phase = "actionPhase"
    assert state.is_my_turn() is True
    
    state.current_player_id = "player2"
    assert state.is_my_turn() is False
    
    state.current_player_id = "player1"
    state.turn_phase = "turnBegin"
    assert state.is_my_turn() is False


def test_game_state_has_pending_request():
    """测试 GameState.has_pending_request() 方法"""
    state = GameState()
    assert state.has_pending_request() is False
    
    state.pending_action = {"type": "broadcastResponse"}
    assert state.has_pending_request() is True


def test_action_validator_validate_play_card():
    """测试 ActionValidator.validate() 方法 - play_card"""
    state = GameState()
    state.my_player_id = "player1"
    state.my_hand = [
        {"uid": "card1", "defId": "br_001", "name": "宇宙广播", "type": "broadcast"},
        {"uid": "card2", "defId": "st_001", "name": "打击", "type": "strike"}
    ]
    validator = ActionValidator(state)
    
    # 测试有效操作
    is_valid, error_msg = validator.validate("play_card", {"card_uid": "card1"})
    assert is_valid is True
    assert error_msg is None
    
    # 测试缺少 card_uid
    is_valid, error_msg = validator.validate("play_card", {})
    assert is_valid is False
    assert error_msg == "缺少 card_uid 参数"
    
    # 测试不存在的卡牌
    is_valid, error_msg = validator.validate("play_card", {"card_uid": "card3"})
    assert is_valid is False
    assert "你的手牌中没有 card3" in error_msg


def test_action_validator_validate_move_strike():
    """测试 ActionValidator.validate() 方法 - move_strike"""
    state = GameState()
    state.my_player_id = "player1"
    state.flying_strikes = [
        {
            "uid": "strike1",
            "ownerId": "player1",
            "position": 3,
            "targetSystem": 5,
            "level": 2,
            "speed": 1,
            "arrived": False
        },
        {
            "uid": "strike2",
            "ownerId": "player2",
            "position": 4,
            "targetSystem": 3,
            "level": 1,
            "speed": 1,
            "arrived": False
        }
    ]
    validator = ActionValidator(state)
    
    # 测试有效操作
    is_valid, error_msg = validator.validate("move_strike", {"strike_uid": "strike1", "target_system": 6})
    assert is_valid is True
    assert error_msg is None
    
    # 测试缺少 strike_uid
    is_valid, error_msg = validator.validate("move_strike", {"target_system": 6})
    assert is_valid is False
    assert error_msg == "缺少 strike_uid 参数"
    
    # 测试不是自己的打击
    is_valid, error_msg = validator.validate("move_strike", {"strike_uid": "strike2", "target_system": 6})
    assert is_valid is False
    assert "你没有名为 strike2 的飞行打击牌" in error_msg
    
    # 测试缺少 target_system
    is_valid, error_msg = validator.validate("move_strike", {"strike_uid": "strike1"})
    assert is_valid is False
    assert error_msg == "缺少 target_system 参数"


def test_action_validator_validate_respond_broadcast():
    """测试 ActionValidator.validate() 方法 - respond_broadcast"""
    state = GameState()
    validator = ActionValidator(state)
    
    # 测试没有活跃广播
    is_valid, error_msg = validator.validate("respond_broadcast", {"agreed": True})
    assert is_valid is False
    assert error_msg == "当前没有活跃的广播需要回应"
    
    # 测试缺少 agreed 参数
    state.broadcast_state = {"active": True}
    is_valid, error_msg = validator.validate("respond_broadcast", {})
    assert is_valid is False
    assert error_msg == "缺少 agreed 参数"
    
    # 测试有效操作
    is_valid, error_msg = validator.validate("respond_broadcast", {"agreed": True})
    assert is_valid is True
    assert error_msg is None


def test_action_validator_validate_announce_strike():
    """测试 ActionValidator.validate() 方法 - announce_strike"""
    state = GameState()
    state.flying_strikes = [
        {
            "uid": "strike1",
            "ownerId": "player1",
            "position": 3,
            "targetSystem": 5,
            "level": 2,
            "speed": 1,
            "arrived": True
        },
        {
            "uid": "strike2",
            "ownerId": "player1",
            "position": 4,
            "targetSystem": 3,
            "level": 1,
            "speed": 1,
            "arrived": False
        }
    ]
    validator = ActionValidator(state)
    
    # 测试有效操作
    is_valid, error_msg = validator.validate("announce_strike", {"strike_uid": "strike1"})
    assert is_valid is True
    assert error_msg is None
    
    # 测试缺少 strike_uid
    is_valid, error_msg = validator.validate("announce_strike", {})
    assert is_valid is False
    assert error_msg == "缺少 strike_uid 参数"
    
    # 测试不存在的打击
    is_valid, error_msg = validator.validate("announce_strike", {"strike_uid": "strike3"})
    assert is_valid is False
    assert "找不到打击牌 strike3" in error_msg
    
    # 测试打击尚未到达
    is_valid, error_msg = validator.validate("announce_strike", {"strike_uid": "strike2"})
    assert is_valid is False
    assert "打击牌 strike2 尚未到达目标" in error_msg


def test_action_validator_validate_skip_announce():
    """测试 ActionValidator.validate() 方法 - skip_announce"""
    state = GameState()
    validator = ActionValidator(state)
    
    # 测试缺少 strike_uid
    is_valid, error_msg = validator.validate("skip_announce", {})
    assert is_valid is False
    assert error_msg == "缺少 strike_uid 参数"
    
    # 测试有效操作
    is_valid, error_msg = validator.validate("skip_announce", {"strike_uid": "strike1"})
    assert is_valid is True
    assert error_msg is None


def test_action_validator_validate_recycle_card():
    """测试 ActionValidator.validate() 方法 - recycle_card"""
    state = GameState()
    state.my_face_up = [
        {"uid": "card1", "defId": "df_001", "name": "防御", "type": "defense"},
        {"uid": "card2", "defId": "fs_001", "name": "光速飞船", "type": "special"}
    ]
    validator = ActionValidator(state)
    
    # 测试有效操作
    is_valid, error_msg = validator.validate("recycle_card", {"card_uid": "card1"})
    assert is_valid is True
    assert error_msg is None
    
    # 测试缺少 card_uid
    is_valid, error_msg = validator.validate("recycle_card", {})
    assert is_valid is False
    assert error_msg == "缺少 card_uid 参数"
    
    # 测试场上没有的牌
    is_valid, error_msg = validator.validate("recycle_card", {"card_uid": "card3"})
    assert is_valid is False
    assert "你的场上没有 card3 这张牌" in error_msg


def test_action_validator_validate_use_lightspeed_ship():
    """测试 ActionValidator.validate() 方法 - use_lightspeed_ship"""
    state = GameState()
    validator = ActionValidator(state)
    
    # 测试有效操作
    is_valid, error_msg = validator.validate("use_lightspeed_ship", {"target_system": 5})
    assert is_valid is True
    assert error_msg is None
    
    # 测试缺少 target_system
    is_valid, error_msg = validator.validate("use_lightspeed_ship", {})
    assert is_valid is False
    assert error_msg == "缺少 target_system 参数"
    
    # 测试无效的目标星系
    is_valid, error_msg = validator.validate("use_lightspeed_ship", {"target_system": 0})
    assert is_valid is False
    assert "目标星系 0 无效，必须是 1-9" in error_msg
    
    is_valid, error_msg = validator.validate("use_lightspeed_ship", {"target_system": 10})
    assert is_valid is False
    assert "目标星系 10 无效，必须是 1-9" in error_msg


def test_action_validator_validate_end_turn():
    """测试 ActionValidator.validate() 方法 - end_turn"""
    state = GameState()
    validator = ActionValidator(state)
    
    # 测试有效操作
    is_valid, error_msg = validator.validate("end_turn", {})
    assert is_valid is True
    assert error_msg is None


def test_action_validator_validate_unknown_action():
    """测试 ActionValidator.validate() 方法 - 未知操作"""
    state = GameState()
    validator = ActionValidator(state)
    
    # 测试未知操作
    is_valid, error_msg = validator.validate("unknown_action", {})
    assert is_valid is False
    assert "未知操作: unknown_action" in error_msg


if __name__ == "__main__":
    pytest.main([__file__])
