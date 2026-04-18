"""
AIBase 基础类测试
=================
测试 AIAgent 和 AIPlayer 共享的 AIBase 基类功能。
"""

import sys
import os
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from darkforest_ai.base_ai import AIBase



class MockAIPlayer(AIBase):
    """AIBase 的测试用实现"""

    def __init__(self):
        super().__init__()
        self.llm_decision = None
        self.log_messages = {"info": [], "warning": [], "error": []}

    async def _get_llm_decision(self):
        return self.llm_decision

    def _log_info(self, msg: str):
        self.log_messages["info"].append(msg)

    def _log_warning(self, msg: str):
        self.log_messages["warning"].append(msg)

    def _log_error(self, msg: str):
        self.log_messages["error"].append(msg)


class TestAIBaseActionMapping:
    """测试 ACTION_MAP 和 PARAM_MAP 配置"""

    def test_action_map_has_all_required_actions(self):
        """验证 ACTION_MAP 包含所有必需的操作"""
        required_actions = [
            "play_card", "move_strike", "respond_broadcast",
            "announce_strike", "skip_announce", "recycle_card",
            "use_lightspeed_ship", "end_turn"
        ]
        for action in required_actions:
            assert action in AIBase.ACTION_MAP, f"Missing action: {action}"

    def test_action_map_values_are_strings(self):
        """验证 ACTION_MAP 的值是有效的字符串"""
        for action_key, action_type in AIBase.ACTION_MAP.items():
            assert isinstance(action_type, str), f"Action type should be string for {action_key}: {action_type}"
            assert action_type in [
                "playCard", "moveStrike", "respondBroadcast", "announceStrike",
                "skipAnnounceStrike", "recycleCard", "useLightspeedShip", "endTurn"
            ], f"Invalid action type for {action_key}: {action_type}"

    def test_param_map_for_play_card(self):
        """验证 play_card 参数映射"""
        param_map = AIBase.PARAM_MAP.get("play_card", {})
        assert param_map.get("card_uid") == "cardUid"
        assert param_map.get("target_system") == "targetSystem"
        assert param_map.get("target_player_id") == "targetPlayerId"

    def test_param_map_for_end_turn(self):
        """验证 end_turn 参数映射为空"""
        param_map = AIBase.PARAM_MAP.get("end_turn", {})
        assert param_map == {}


class TestAIBaseMapParams:
    """测试 _map_params 方法"""

    @pytest.fixture
    def ai_player(self):
        return MockAIPlayer()

    def test_map_params_play_card(self, ai_player):
        """测试 play_card 参数映射"""
        result = ai_player._map_params("play_card", {
            "card_uid": "br_001",
            "target_system": 5,
            "target_player_id": "player_123"
        })
        assert result == {
            "cardUid": "br_001",
            "targetSystem": 5,
            "targetPlayerId": "player_123"
        }

    def test_map_params_move_strike(self, ai_player):
        """测试 move_strike 参数映射"""
        result = ai_player._map_params("move_strike", {
            "strike_uid": "st_001",
            "target_system": 7
        })
        assert result == {
            "strikeUid": "st_001",
            "targetSystem": 7
        }

    def test_map_params_end_turn(self, ai_player):
        """测试 end_turn 参数映射为空"""
        result = ai_player._map_params("end_turn", {})
        assert result == {}

    def test_map_params_unknown_action(self, ai_player):
        """测试未知操作的参数映射"""
        result = ai_player._map_params("unknown_action", {"key": "value"})
        assert result == {}

    def test_map_params_partial_params(self, ai_player):
        """测试部分参数映射"""
        result = ai_player._map_params("play_card", {
            "card_uid": "br_001"
        })
        assert result == {"cardUid": "br_001"}


class TestAIBaseSendAction:
    """测试 _send_action 方法"""

    @pytest.fixture
    def ai_player(self):
        player = MockAIPlayer()
        player.sio = AsyncMock()
        player.state.room_id = "room_123"
        return player

    @pytest.mark.asyncio
    async def test_send_action_success(self, ai_player):
        """测试发送操作成功"""
        await ai_player._send_action("playCard", {"cardUid": "br_001"})

        ai_player.sio.emit.assert_called_once_with(
            "game:action",
            {
                "roomId": "room_123",
                "action": "playCard",
                "payload": {"cardUid": "br_001"}
            }
        )

    @pytest.mark.asyncio
    async def test_send_action_no_room_id(self, ai_player):
        """测试房间 ID 未设置时不发送操作"""
        ai_player.state.room_id = None

        await ai_player._send_action("endTurn", {})

        ai_player.sio.emit.assert_not_called()
        assert len(ai_player.log_messages["error"]) == 1


class TestAIBaseThinkAndAct:
    """测试 think_and_act 方法"""

    @pytest.fixture
    def ai_player(self):
        player = MockAIPlayer()
        player.sio = AsyncMock()
        return player

    def setup_my_turn(self, ai_player):
        """设置 AI 回合状态"""
        ai_player.state.my_player_id = "player_ai"
        ai_player.state.current_player_id = "player_ai"
        ai_player.state.turn_phase = "actionPhase"
        ai_player.state.my_hand = [
            {"uid": "br_001", "name": "宇宙广播", "type": "broadcast", "energy": 1},
        ]

    @pytest.mark.asyncio
    async def test_think_and_act_not_my_turn(self, ai_player):
        """非己方回合时不执行操作"""
        ai_player.state.my_player_id = "player_ai"
        ai_player.state.current_player_id = "player_other"
        ai_player.state.turn_phase = "actionPhase"

        ai_player.llm_decision = {"action": "play_card", "card_uid": "br_001"}
        await ai_player.think_and_act()

        ai_player.sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_think_and_act_has_pending_request(self, ai_player):
        """有待处理请求时执行操作"""
        self.setup_my_turn(ai_player)
        ai_player.state.pending_action = {"type": "broadcastResponse"}

        ai_player.llm_decision = {"action": "end_turn"}
        await ai_player.think_and_act()

        ai_player.sio.emit.assert_called()

    @pytest.mark.asyncio
    async def test_think_and_act_llm_returns_none(self, ai_player):
        """LLM 返回 None 时发送 endTurn"""
        self.setup_my_turn(ai_player)
        ai_player.llm_decision = None

        await ai_player.think_and_act()

        ai_player.sio.emit.assert_called()
        call_args = ai_player.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"

    @pytest.mark.asyncio
    async def test_think_and_act_no_action_field(self, ai_player):
        """LLM 返回缺少 action 字段时发送 endTurn"""
        self.setup_my_turn(ai_player)
        ai_player.llm_decision = {"card_uid": "br_001"}

        await ai_player.think_and_act()

        ai_player.sio.emit.assert_called()
        call_args = ai_player.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"

    @pytest.mark.asyncio
    async def test_think_and_act_valid_decision(self, ai_player):
        """有效的 LLM 决策"""
        self.setup_my_turn(ai_player)
        ai_player.llm_decision = {"action": "play_card", "card_uid": "br_001"}

        await ai_player.think_and_act()

        ai_player.sio.emit.assert_called()
        call_args = ai_player.sio.emit.call_args
        assert call_args[0][1]["action"] == "playCard"
        assert call_args[0][1]["payload"]["cardUid"] == "br_001"

    @pytest.mark.asyncio
    async def test_think_and_act_unknown_action(self, ai_player):
        """未知操作类型时发送 endTurn"""
        self.setup_my_turn(ai_player)
        ai_player.llm_decision = {"action": "unknown_action"}

        await ai_player.think_and_act()

        ai_player.sio.emit.assert_called()
        call_args = ai_player.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"

    @pytest.mark.asyncio
    async def test_think_and_act_invalid_action(self, ai_player):
        """LLM 返回非法操作时发送 endTurn"""
        self.setup_my_turn(ai_player)
        ai_player.state.my_hand = []
        ai_player.llm_decision = {"action": "play_card", "card_uid": "fake_card"}

        await ai_player.think_and_act()

        ai_player.sio.emit.assert_called()
        call_args = ai_player.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"


class TestAIBaseStateManagement:
    """测试状态管理"""

    @pytest.fixture
    def ai_player(self):
        return MockAIPlayer()

    def test_initial_state(self, ai_player):
        """验证初始状态"""
        assert ai_player.state.my_player_id is None
        assert ai_player.state.room_id is None
        assert ai_player.state.turn_number == 0
        assert ai_player.state.turn_phase == "turnBegin"

    def test_validator_initialized(self, ai_player):
        """验证 ActionValidator 已初始化"""
        assert ai_player.validator is not None
        from darkforest_ai.validator import ActionValidator
        assert isinstance(ai_player.validator, ActionValidator)


class TestAIBaseInheritance:
    """测试 AIBase 继承结构"""

    def test_aibase_is_base_class(self):
        """验证 AIBase 是基类"""
        from darkforest_ai.base_ai import AIBase
        assert AIBase is not None

    def test_aibase_has_abstract_methods(self):
        """验证 AIBase 定义了抽象方法"""
        from darkforest_ai.base_ai import AIBase

        assert hasattr(AIBase, '_get_llm_decision')
        assert hasattr(AIBase, '_log_info')
        assert hasattr(AIBase, '_log_warning')
        assert hasattr(AIBase, '_log_error')

    def test_aibase_can_be_instantiated_as_mock(self):
        """验证可以通过 Mock 实现实例化"""
        player = MockAIPlayer()
        assert player is not None
        assert isinstance(player, AIBase)

    def test_socketio_initialized(self, ai_player):
        """验证 Socket.IO 客户端已初始化"""
        from socketio import AsyncClient
        assert isinstance(ai_player.sio, AsyncClient)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
