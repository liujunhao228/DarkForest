"""
黑暗森林 AI Agent - Mock 测试套件
===================================
使用 unittest.mock 模拟 LLM 调用，测试游戏服务器交互逻辑。

测试分组：
1. LLMEngine 单元测试 - Mock OpenAI client
2. ActionValidator 单元测试 - 纯逻辑测试，无需 Mock
3. AIAgent 集成测试 - Mock LLMEngine.think

用法：
  pytest test_agent_mock.py -v
"""

import json
import sys
import os
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

# 添加父目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from darkforest_ai.state import GameState
from darkforest_ai.llm import LLMEngine
from darkforest_ai.validator import ActionValidator
from darkforest_ai.agent import AIAgent
from darkforest_ai.prompt import PromptBuilder


# ============================
# 1. LLMEngine 单元测试
# ============================


class TestLLMEngine:
    """测试 LLMEngine 与 nanobot 的交互逻辑"""

    @pytest.fixture
    def mock_openai_client(self):
        """创建 Mock 的 OpenAI client"""
        client = MagicMock()
        return client

    @pytest.fixture
    def llm_engine(self, mock_openai_client):
        """创建使用 Mock client 的 LLMEngine"""
        with patch("darkforest_ai.llm.OpenAI", return_value=mock_openai_client):
            engine = LLMEngine(
                base_url="http://mock:8900/v1",
                api_key="test-key",
                model="test-model",
            )
            engine.client = mock_openai_client
            return engine

    def test_think_returns_valid_json(self, llm_engine):
        """Mock 返回合法 JSON → 正确解析"""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content='{"action": "play_card", "card_uid": "br_001"}'))
        ]
        llm_engine.client.chat.completions.create.return_value = mock_response

        result = llm_engine.think("测试 prompt")

        assert result is not None
        assert result["action"] == "play_card"
        assert result["card_uid"] == "br_001"
        llm_engine.client.chat.completions.create.assert_called_once()

    def test_think_returns_valid_json_with_code_block(self, llm_engine):
        """Mock 返回 JSON 代码块格式 → 正确解析"""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content='```\n{"action": "end_turn"}\n```'
                )
            )
        ]
        llm_engine.client.chat.completions.create.return_value = mock_response

        result = llm_engine.think("测试 prompt")

        assert result is not None
        assert result["action"] == "end_turn"

    def test_think_returns_valid_json_with_json_block(self, llm_engine):
        """Mock 返回 ```json 代码块 → 正确解析"""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content='```json\n{"action": "move_strike", "strike_uid": "st_001", "target_system": 5}\n```'
                )
            )
        ]
        llm_engine.client.chat.completions.create.return_value = mock_response

        result = llm_engine.think("测试 prompt")

        assert result is not None
        assert result["action"] == "move_strike"
        assert result["target_system"] == 5

    def test_think_retry_on_invalid_json(self, llm_engine):
        """Mock 返回非法 JSON → 自动重试，最终放弃"""
        # 前两次返回非法内容，第三次返回合法 JSON
        mock_response_invalid = MagicMock()
        mock_response_invalid.choices = [
            MagicMock(message=MagicMock(content="这不是 JSON"))
        ]
        mock_response_valid = MagicMock()
        mock_response_valid.choices = [
            MagicMock(message=MagicMock(content='{"action": "end_turn"}'))
        ]

        llm_engine.client.chat.completions.create.side_effect = [
            mock_response_invalid,
            mock_response_invalid,
            mock_response_valid,
        ]

        result = llm_engine.think("测试 prompt", max_retries=3)

        assert result is not None
        assert result["action"] == "end_turn"
        # 应该调用了 3 次（前两次失败会追加提示重试）
        assert llm_engine.client.chat.completions.create.call_count == 3

    def test_think_give_up_after_max_retries(self, llm_engine):
        """Mock 始终返回非法内容 → 超过最大重试后返回 None"""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="乱码内容"))
        ]
        llm_engine.client.chat.completions.create.return_value = mock_response

        result = llm_engine.think("测试 prompt", max_retries=3)

        assert result is None
        # 应该调用了 3 次
        assert llm_engine.client.chat.completions.create.call_count == 3

    def test_think_retry_on_empty_content(self, llm_engine):
        """Mock 返回空内容 → 重试"""
        mock_response_empty = MagicMock()
        mock_response_empty.choices = [MagicMock(message=MagicMock(content=None))]
        mock_response_valid = MagicMock()
        mock_response_valid.choices = [
            MagicMock(message=MagicMock(content='{"action": "skip_announce", "strike_uid": "st_001"}'))
        ]

        llm_engine.client.chat.completions.create.side_effect = [
            mock_response_empty,
            mock_response_valid,
        ]

        result = llm_engine.think("测试 prompt", max_retries=3)

        assert result is not None
        assert result["action"] == "skip_announce"
        assert llm_engine.client.chat.completions.create.call_count == 2

    def test_think_network_error_retry(self, llm_engine):
        """Mock 抛出网络异常 → 重试后成功"""
        mock_response_valid = MagicMock()
        mock_response_valid.choices = [
            MagicMock(message=MagicMock(content='{"action": "respond_broadcast", "agreed": true}'))
        ]

        # 第一次抛异常，第二次成功
        llm_engine.client.chat.completions.create.side_effect = [
            Exception("Connection timeout"),
            mock_response_valid,
        ]

        result = llm_engine.think("测试 prompt", max_retries=3)

        assert result is not None
        assert result["action"] == "respond_broadcast"
        assert result["agreed"] is True
        assert llm_engine.client.chat.completions.create.call_count == 2

    def test_think_all_retries_fail_with_exception(self, llm_engine):
        """Mock 始终抛异常 → 最终返回 None"""
        llm_engine.client.chat.completions.create.side_effect = Exception("Network error")

        result = llm_engine.think("测试 prompt", max_retries=2)

        assert result is None
        assert llm_engine.client.chat.completions.create.call_count == 2


class TestJSONParser:
    """专门测试 JSON 解析器的鲁棒性"""

    def test_parse_direct_json(self):
        """直接 JSON 字符串"""
        content = '{"action": "play_card", "card_uid": "br_001"}'
        result = LLMEngine._parse_json(content)
        assert result == {"action": "play_card", "card_uid": "br_001"}

    def test_parse_json_code_block(self):
        """代码块格式"""
        content = '```\n{"action": "end_turn"}\n```'
        result = LLMEngine._parse_json(content)
        assert result == {"action": "end_turn"}

    def test_parse_json_block_with_language(self):
        """```json 代码块"""
        content = '```json\n{"action": "move_strike", "strike_uid": "st_001"}\n```'
        result = LLMEngine._parse_json(content)
        assert result == {"action": "move_strike", "strike_uid": "st_001"}

    def test_parse_json_with_prefix_text(self):
        """带有前缀文字的 JSON"""
        content = '好的，这是你的操作指令：\n{"action": "end_turn"}'
        result = LLMEngine._parse_json(content)
        assert result == {"action": "end_turn"}

    def test_parse_json_with_suffix_text(self):
        """带有后缀文字的 JSON"""
        content = '{"action": "play_card"}\n\n祝你好运！'
        result = LLMEngine._parse_json(content)
        assert result == {"action": "play_card"}

    def test_parse_json_complex(self):
        """复杂嵌套 JSON"""
        content = json.dumps({
            "action": "play_card",
            "card_uid": "br_001",
            "extra": {"target": 5, "players": ["p1", "p2"]},
        })
        result = LLMEngine._parse_json(content)
        assert result["action"] == "play_card"
        assert result["extra"]["target"] == 5

    def test_parse_invalid_json_returns_none(self):
        """完全无效的输入 → 返回 None"""
        assert LLMEngine._parse_json("") is None
        assert LLMEngine._parse_json("这不是 JSON") is None
        assert LLMEngine._parse_json("{invalid}") is None
        assert LLMEngine._parse_json("abc{def") is None


# ============================
# 2. ActionValidator 单元测试
# ============================


class TestActionValidator:
    """测试操作验证逻辑"""

    @pytest.fixture
    def state(self):
        """创建基础游戏状态"""
        s = GameState()
        s.my_player_id = "player_ai"
        s.my_position = 3
        s.my_energy = 5
        s.my_hand = [
            {"uid": "br_001", "name": "宇宙广播", "type": "broadcast", "energy": 1},
            {"uid": "st_005", "name": "等级2打击", "type": "strike", "energy": 2},
            {"uid": "df_002", "name": "3级防御", "type": "defense", "energy": 0},
        ]
        s.my_face_up = [
            {"uid": "fa_001", "name": "信号塔", "type": "facility"},
        ]
        s.flying_strikes = [
            {
                "uid": "strike_fly_001",
                "ownerId": "player_ai",
                "position": 3,
                "targetSystem": 5,
                "level": 2,
                "speed": 1,
                "arrived": False,
            },
            {
                "uid": "strike_fly_002",
                "ownerId": "player_ai",
                "position": 3,
                "targetSystem": 7,
                "level": 1,
                "speed": 2,
                "arrived": True,  # 已到达
            },
        ]
        s.opponents = [
            {"id": "player_1", "name": "玩家1", "handCount": 3, "position": 5, "energy": 4, "eliminated": False},
        ]
        s.broadcast_state = {
            "active": True,
            "broadcasterId": "player_1",
            "targetSystem": 4,
            "range": 2,
            "subtype": "cooperate",
            "phase": "voting",
        }
        s.pending_action = None
        s.turn_phase = "actionPhase"
        s.current_player_id = "player_ai"
        return s

    @pytest.fixture
    def validator(self, state):
        return ActionValidator(state)

    # --- play_card ---

    def test_validate_play_card_valid(self, validator, state):
        """合法出牌：手牌中存在指定牌"""
        is_valid, error = validator.validate("play_card", {"card_uid": "br_001"})
        assert is_valid is True
        assert error is None

    def test_validate_play_card_not_in_hand(self, validator):
        """非法出牌：手牌中不存在指定牌"""
        is_valid, error = validator.validate("play_card", {"card_uid": "fake_uid"})
        assert is_valid is False
        assert "你的手牌中没有" in error

    def test_validate_play_card_missing_param(self, validator):
        """非法出牌：缺少 card_uid 参数"""
        is_valid, error = validator.validate("play_card", {})
        assert is_valid is False
        assert "缺少 card_uid" in error

    # --- move_strike ---

    def test_validate_move_strike_valid(self, validator):
        """合法移动打击：拥有该打击牌且指定目标"""
        is_valid, error = validator.validate("move_strike", {"strike_uid": "strike_fly_001", "target_system": 6})
        assert is_valid is True
        assert error is None

    def test_validate_move_strike_not_owned(self, validator):
        """非法移动打击：不拥有该打击牌"""
        is_valid, error = validator.validate("move_strike", {"strike_uid": "strike_enemy", "target_system": 6})
        assert is_valid is False
        assert "你没有名为" in error

    def test_validate_move_strike_missing_target(self, validator):
        """非法移动打击：缺少目标星系"""
        is_valid, error = validator.validate("move_strike", {"strike_uid": "strike_fly_001"})
        assert is_valid is False
        assert "缺少 target_system" in error

    def test_validate_move_strike_missing_uid(self, validator):
        """非法移动打击：缺少打击牌 UID"""
        is_valid, error = validator.validate("move_strike", {"target_system": 6})
        assert is_valid is False
        assert "缺少 strike_uid" in error

    # --- respond_broadcast ---

    def test_validate_respond_broadcast_agree(self, validator):
        """合法回应广播：同意"""
        is_valid, error = validator.validate("respond_broadcast", {"agreed": True})
        assert is_valid is True

    def test_validate_respond_broadcast_decline(self, validator):
        """合法回应广播：拒绝"""
        is_valid, error = validator.validate("respond_broadcast", {"agreed": False})
        assert is_valid is True

    def test_validate_respond_broadcast_missing_agreed(self, validator):
        """非法回应广播：缺少 agreed 参数"""
        is_valid, error = validator.validate("respond_broadcast", {})
        assert is_valid is False
        assert "缺少 agreed" in error

    def test_validate_respond_broadcast_no_active_broadcast(self, state):
        """非法回应广播：当前没有活跃广播"""
        state.broadcast_state = None
        validator = ActionValidator(state)
        is_valid, error = validator.validate("respond_broadcast", {"agreed": True})
        assert is_valid is False
        assert "当前没有活跃的广播" in error

    # --- announce_strike ---

    def test_validate_announce_strike_arrived(self, validator):
        """合法宣布打击：打击已到达"""
        is_valid, error = validator.validate("announce_strike", {"strike_uid": "strike_fly_002"})
        assert is_valid is True

    def test_validate_announce_strike_not_arrived(self, validator):
        """非法宣布打击：打击未到达"""
        is_valid, error = validator.validate("announce_strike", {"strike_uid": "strike_fly_001"})
        assert is_valid is False
        assert "尚未到达" in error

    def test_validate_announce_strike_missing_uid(self, validator):
        """非法宣布打击：缺少 strike_uid"""
        is_valid, error = validator.validate("announce_strike", {})
        assert is_valid is False
        assert "缺少 strike_uid" in error

    def test_validate_announce_strike_not_exist(self, validator):
        """非法宣布打击：打击牌不存在"""
        is_valid, error = validator.validate("announce_strike", {"strike_uid": "fake_strike"})
        assert is_valid is False
        assert "找不到打击牌" in error

    # --- skip_announce ---

    def test_validate_skip_announce_valid(self, validator):
        """合法跳过宣布"""
        is_valid, error = validator.validate("skip_announce", {"strike_uid": "strike_fly_002"})
        assert is_valid is True

    def test_validate_skip_announce_missing_uid(self, validator):
        """非法跳过宣布：缺少 strike_uid"""
        is_valid, error = validator.validate("skip_announce", {})
        assert is_valid is False
        assert "缺少 strike_uid" in error

    # --- recycle_card ---

    def test_validate_recycle_card_valid(self, validator):
        """合法回收：场上有该牌"""
        is_valid, error = validator.validate("recycle_card", {"card_uid": "fa_001"})
        assert is_valid is True

    def test_validate_recycle_card_not_on_field(self, validator):
        """非法回收：场上没有该牌"""
        is_valid, error = validator.validate("recycle_card", {"card_uid": "br_001"})
        assert is_valid is False
        assert "你的场上没有" in error

    def test_validate_recycle_card_missing_uid(self, validator):
        """非法回收：缺少 card_uid"""
        is_valid, error = validator.validate("recycle_card", {})
        assert is_valid is False
        assert "缺少 card_uid" in error

    # --- use_lightspeed_ship ---

    def test_validate_lightspeed_valid(self, validator):
        """合法光速逃逸：目标星系在 1-9 范围内"""
        is_valid, error = validator.validate("use_lightspeed_ship", {"target_system": 5})
        assert is_valid is True

    def test_validate_lightspeed_invalid_range_low(self, validator):
        """非法光速逃逸：目标星系 < 1"""
        is_valid, error = validator.validate("use_lightspeed_ship", {"target_system": 0})
        assert is_valid is False
        assert "无效" in error

    def test_validate_lightspeed_invalid_range_high(self, validator):
        """非法光速逃逸：目标星系 > 9"""
        is_valid, error = validator.validate("use_lightspeed_ship", {"target_system": 10})
        assert is_valid is False
        assert "无效" in error

    def test_validate_lightspeed_missing_target(self, validator):
        """非法光速逃逸：缺少目标星系"""
        is_valid, error = validator.validate("use_lightspeed_ship", {})
        assert is_valid is False
        assert "缺少 target_system" in error

    # --- end_turn ---

    def test_validate_end_turn_always_valid(self, validator):
        """结束回合：总是合法"""
        is_valid, error = validator.validate("end_turn", {})
        assert is_valid is True

    # --- unknown action ---

    def test_validate_unknown_action(self, validator):
        """未知操作：返回错误"""
        is_valid, error = validator.validate("fake_action", {})
        assert is_valid is False
        assert "未知操作" in error


# ============================
# 3. AIAgent 集成测试 (Mock LLM)
# ============================


class TestAIAgentIntegration:
    """测试 AIAgent 端到端流程，Mock LLM 响应"""

    @pytest.fixture
    def agent(self):
        """创建 AIAgent 实例，Mock Socket.IO"""
        with patch("darkforest_ai.agent.AsyncClient", return_value=MagicMock()):
            a = AIAgent()
            # Mock Socket.IO
            a.sio = AsyncMock()
            return a

    def setup_my_turn_state(self, agent):
        """设置状态为 AI 的回合"""
        agent.state.my_player_id = "player_ai"
        agent.state.current_player_id = "player_ai"
        agent.state.turn_phase = "actionPhase"
        agent.state.turn_number = 3
        agent.state.my_position = 3
        agent.state.my_energy = 5
        agent.state.my_hand = [
            {"uid": "br_001", "name": "宇宙广播", "type": "broadcast", "energy": 1},
        ]
        agent.state.my_face_up = []
        agent.state.opponents = []
        agent.state.flying_strikes = []
        agent.state.broadcast_state = None
        agent.state.pending_action = None
        agent.state.recent_logs = []

    @pytest.mark.asyncio
    async def test_think_and_act_play_card(self, agent):
        """Mock LLM 返回出牌指令 → 验证发送正确 action"""
        self.setup_my_turn_state(agent)

        # Mock LLM 返回
        with patch.object(agent.llm, "think", return_value={"action": "play_card", "card_uid": "br_001"}):
            await agent.think_and_act()

        # 验证发送了正确的操作
        agent.sio.emit.assert_called()
        call_args = agent.sio.emit.call_args
        assert call_args[0][0] == "game:action"
        payload = call_args[0][1]
        assert payload["action"] == "playCard"
        assert payload["payload"]["cardUid"] == "br_001"

    @pytest.mark.asyncio
    async def test_think_and_act_end_turn(self, agent):
        """Mock LLM 返回结束回合指令 → 验证发送 endTurn"""
        self.setup_my_turn_state(agent)

        with patch.object(agent.llm, "think", return_value={"action": "end_turn"}):
            await agent.think_and_act()

        agent.sio.emit.assert_called()
        call_args = agent.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"

    @pytest.mark.asyncio
    async def test_think_and_act_invalid_action(self, agent):
        """Mock LLM 返回非法操作（手牌中没有） → fallback 到 endTurn"""
        self.setup_my_turn_state(agent)

        # Mock LLM 返回一个不存在的牌
        with patch.object(agent.llm, "think", return_value={"action": "play_card", "card_uid": "fake_uid"}):
            await agent.think_and_act()

        # 应该 fallback 到 endTurn
        agent.sio.emit.assert_called()
        call_args = agent.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"

    @pytest.mark.asyncio
    async def test_think_and_act_unknown_action(self, agent):
        """Mock LLM 返回未知操作名 → fallback 到 endTurn"""
        self.setup_my_turn_state(agent)

        with patch.object(agent.llm, "think", return_value={"action": "fake_action"}):
            await agent.think_and_act()

        agent.sio.emit.assert_called()
        call_args = agent.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"

    @pytest.mark.asyncio
    async def test_think_and_act_llm_failure(self, agent):
        """Mock LLM 抛出异常 → fallback 到 endTurn"""
        self.setup_my_turn_state(agent)

        with patch.object(agent.llm, "think", return_value=None):
            await agent.think_and_act()

        agent.sio.emit.assert_called()
        call_args = agent.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"

    @pytest.mark.asyncio
    async def test_think_and_act_missing_action_field(self, agent):
        """Mock LLM 返回的内容缺少 action 字段 → fallback 到 endTurn"""
        self.setup_my_turn_state(agent)

        with patch.object(agent.llm, "think", return_value={"card_uid": "br_001"}):
            await agent.think_and_act()

        agent.sio.emit.assert_called()
        call_args = agent.sio.emit.call_args
        assert call_args[0][1]["action"] == "endTurn"

    @pytest.mark.asyncio
    async def test_think_and_act_not_my_turn(self, agent):
        """非己方回合 → 不发送任何操作"""
        agent.state.my_player_id = "player_ai"
        agent.state.current_player_id = "player_other"  # 别人的回合
        agent.state.turn_phase = "actionPhase"
        agent.state.my_hand = []
        agent.state.my_face_up = []
        agent.state.flying_strikes = []
        agent.state.pending_action = None

        with patch.object(agent.llm, "think", return_value={"action": "end_turn"}):
            await agent.think_and_act()

        # 不应该调用 emit
        agent.sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_think_and_act_move_strike(self, agent):
        """Mock LLM 返回移动打击指令 → 验证发送"""
        self.setup_my_turn_state(agent)
        agent.state.flying_strikes = [
            {
                "uid": "strike_fly_001",
                "ownerId": "player_ai",
                "position": 3,
                "targetSystem": 5,
                "level": 2,
                "speed": 1,
                "arrived": False,
            },
        ]

        with patch.object(
            agent.llm,
            "think",
            return_value={"action": "move_strike", "strike_uid": "strike_fly_001", "target_system": 6},
        ):
            await agent.think_and_act()

        agent.sio.emit.assert_called()
        call_args = agent.sio.emit.call_args
        assert call_args[0][1]["action"] == "moveStrike"
        assert call_args[0][1]["payload"]["strikeUid"] == "strike_fly_001"
        assert call_args[0][1]["payload"]["targetSystem"] == 6

    @pytest.mark.asyncio
    async def test_think_and_act_respond_broadcast(self, agent):
        """Mock LLM 返回回应广播指令 → 验证发送"""
        self.setup_my_turn_state(agent)
        agent.state.broadcast_state = {
            "active": True,
            "broadcasterId": "player_1",
            "targetSystem": 4,
            "range": 2,
            "subtype": "cooperate",
            "phase": "voting",
        }

        with patch.object(
            agent.llm,
            "think",
            return_value={"action": "respond_broadcast", "agreed": True},
        ):
            await agent.think_and_act()

        agent.sio.emit.assert_called()
        call_args = agent.sio.emit.call_args
        assert call_args[0][1]["action"] == "respondBroadcast"
        assert call_args[0][1]["payload"]["agreed"] is True


# ============================
# 4. GameState 辅助测试
# ============================


class TestGameState:
    """测试 GameState 辅助方法"""

    def test_is_my_turn_true(self):
        state = GameState()
        state.my_player_id = "player_ai"
        state.current_player_id = "player_ai"
        state.turn_phase = "actionPhase"
        assert state.is_my_turn() is True

    def test_is_my_turn_false_wrong_player(self):
        state = GameState()
        state.my_player_id = "player_ai"
        state.current_player_id = "player_other"
        state.turn_phase = "actionPhase"
        assert state.is_my_turn() is False

    def test_is_my_turn_false_wrong_phase(self):
        state = GameState()
        state.my_player_id = "player_ai"
        state.current_player_id = "player_ai"
        state.turn_phase = "turnBegin"
        assert state.is_my_turn() is False

    def test_has_pending_request_true(self):
        state = GameState()
        state.pending_action = {"type": "broadcastResponse"}
        assert state.has_pending_request() is True

    def test_has_pending_request_false(self):
        state = GameState()
        state.pending_action = None
        assert state.has_pending_request() is False

    def test_update_from_viewstate(self):
        state = GameState()
        state.my_player_id = "player_ai"

        view_state = {
            "totalTurn": 5,
            "turnPhase": "actionPhase",
            "currentPlayerId": "player_ai",
            "players": [
                {
                    "id": "player_ai",
                    "name": "AI-文明",
                    "position": 3,
                    "energy": 7,
                    "hand": [{"uid": "br_001", "name": "宇宙广播", "type": "broadcast"}],
                    "faceUpCards": [],
                },
                {
                    "id": "player_1",
                    "name": "玩家1",
                    "position": 5,
                    "energy": 4,
                    "hand": [{"uid": "x"}, {"uid": "y"}],
                    "faceUpCards": [],
                },
            ],
            "flyingStrikes": [],
            "broadcast": {"active": True, "broadcasterId": "player_1"},
            "pendingAction": None,
            "logs": [{"message": "回合 5 开始"}],
        }

        state.update_from_viewstate(view_state)

        assert state.turn_number == 5
        assert state.turn_phase == "actionPhase"
        assert state.my_position == 3
        assert state.my_energy == 7
        assert len(state.my_hand) == 1
        assert len(state.opponents) == 1
        assert state.opponents[0]["handCount"] == 2
        assert state.broadcast_state["active"] is True
        assert "回合 5 开始" in state.recent_logs


# ============================
# 5. PromptBuilder 测试
# ============================


class TestPromptBuilder:
    """测试 DSL Prompt 生成器"""

    def test_build_basic_prompt(self):
        """基础 Prompt 构建"""
        state = GameState()
        state.my_player_id = "player_ai"
        state.turn_number = 3
        state.turn_phase = "actionPhase"
        state.current_player_id = "player_ai"
        state.my_position = 3
        state.my_energy = 5
        state.my_hand = [{"uid": "br_001", "name": "宇宙广播", "energy": 1}]
        state.my_face_up = []
        state.opponents = [
            {"id": "player_1", "name": "玩家1", "handCount": 3, "position": 5, "energy": 4, "eliminated": False},
        ]
        state.flying_strikes = []
        state.broadcast_state = None
        state.pending_action = None
        state.recent_logs = []

        prompt = PromptBuilder.build(state)

        # 验证关键部分存在
        assert "你是黑暗森林桌游的 AI 玩家" in prompt
        assert "回合数: 3" in prompt
        assert "当前阶段: actionPhase" in prompt
        assert "你的手牌(1张)" in prompt
        assert "br_001(宇宙广播" in prompt
        assert "玩家1: 3张牌,星系5" in prompt
        assert "play_card" in prompt
        assert "end_turn" in prompt

    def test_build_prompt_with_flying_strikes(self):
        """包含飞行打击的 Prompt"""
        state = GameState()
        state.my_player_id = "player_ai"
        state.turn_phase = "actionPhase"
        state.current_player_id = "player_ai"
        state.my_position = 3
        state.my_energy = 5
        state.my_hand = []
        state.my_face_up = []
        state.opponents = []
        state.flying_strikes = [
            {
                "uid": "strike_001",
                "ownerId": "player_ai",
                "position": 3,
                "targetSystem": 5,
                "level": 2,
                "speed": 1,
                "arrived": False,
            },
        ]
        state.broadcast_state = None
        state.pending_action = None
        state.recent_logs = []

        prompt = PromptBuilder.build(state)

        assert "飞行打击" in prompt
        assert "strike_001" in prompt
        assert "星系3→星系5" in prompt
        assert "飞行中" in prompt

    def test_build_prompt_with_pending_broadcast(self):
        """包含待响应广播的 Prompt"""
        state = GameState()
        state.my_player_id = "player_ai"
        state.turn_phase = "actionPhase"
        state.current_player_id = "player_1"  # 不是自己的回合
        state.my_position = 3
        state.my_energy = 5
        state.my_hand = []
        state.my_face_up = []
        state.opponents = []
        state.flying_strikes = []
        state.broadcast_state = {
            "active": True,
            "broadcasterId": "player_1",
            "targetSystem": 4,
            "range": 2,
            "subtype": "cooperate",
            "phase": "voting",
        }
        state.pending_action = {"type": "broadcastResponse"}
        state.recent_logs = []

        prompt = PromptBuilder.build(state)

        assert "广播中" in prompt
        assert "respond_broadcast" in prompt
