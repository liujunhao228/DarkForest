"""
AI Agent 主控制器
=================
黑暗森林 AI Agent 主程序，整合所有模块。
"""

import asyncio
import json
import logging
import random
import time

from socketio import AsyncClient

from darkforest_ai.config import (
    AI_PLAYER_NAME,
    GAME_SERVER_URL,
    JWT_TOKEN,
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    SESSION_ID,
)
from darkforest_ai.llm import LLMEngine
from darkforest_ai.prompt import PromptBuilder
from darkforest_ai.protocol import (
    ClientEvents,
    ServerEvents,
    ActionType,
    PROTOCOL_VERSION,
)
from darkforest_ai.state import GameState
from darkforest_ai.validator import ActionValidator

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("darkforest-ai")


class AIAgent:
    """AI Agent 主控制器"""

    # 操作名映射到 ActionType
    ACTION_MAP = {
        "play_card": ActionType.PLAY_CARD,
        "move_strike": ActionType.MOVE_STRIKE,
        "respond_broadcast": ActionType.RESPOND_BROADCAST,
        "announce_strike": ActionType.ANNOUNCE_STRIKE,
        "skip_announce": ActionType.SKIP_ANNOUNCE_STRIKE,
        "recycle_card": ActionType.RECYCLE_CARD,
        "use_lightspeed_ship": ActionType.USE_LIGHTSPEED_SHIP,
        "end_turn": ActionType.END_TURN,
    }

    # 参数名映射
    PARAM_MAP = {
        "play_card": {"card_uid": "cardUid", "target_system": "targetSystem", "target_player_id": "targetPlayerId"},
        "move_strike": {"strike_uid": "strikeUid", "target_system": "targetSystem"},
        "respond_broadcast": {"agreed": "agreed", "card_uid": "cardUid"},
        "announce_strike": {"strike_uid": "strikeUid"},
        "skip_announce": {"strike_uid": "strikeUid"},
        "recycle_card": {"card_uid": "cardUid"},
        "use_lightspeed_ship": {"target_system": "targetSystem"},
        "end_turn": {},
    }

    def __init__(self):
        self.state = GameState()
        self.llm = LLMEngine(
            base_url=LLM_BASE_URL,
            api_key=LLM_API_KEY,
            model=LLM_MODEL,
            session_id=SESSION_ID,
        )
        self.validator = ActionValidator(self.state)
        self.sio = AsyncClient()
        self._setup_event_handlers()
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5

    def _setup_event_handlers(self):
        """设置 Socket.IO 事件处理器"""

        @self.sio.on("connect")
        async def on_connect():
            logger.info("✅ 已连接到游戏服务器")
            self.reconnect_attempts = 0

        @self.sio.on("disconnect")
        async def on_disconnect():
            logger.warning("⚠️ 与游戏服务器断开连接")
            await self._handle_reconnect()

        @self.sio.on("connect_error")
        async def on_connect_error(error):
            logger.error(f"❌ 连接错误: {error}")
            await self._handle_reconnect()

        @self.sio.on(ServerEvents.PLAYER_LOGIN_SUCCESS)
        async def on_login_success(data):
            payload = data.get("payload", {})
            self.state.my_player_id = payload.get("playerId")
            logger.info(f"🎮 登录成功! 玩家 ID: {self.state.my_player_id}")

        @self.sio.on(ServerEvents.PLAYER_LOGIN_ERROR)
        async def on_login_error(data):
            payload = data.get("payload", {})
            logger.error(f"❌ 登录失败: {payload.get('message')}")

        @self.sio.on(ServerEvents.MATCH_FOUND)
        async def on_match_found(data):
            payload = data.get("payload", {})
            self.state.room_id = payload.get("roomId")
            logger.info(f"🏠 匹配成功! 房间: {self.state.room_id}")

        @self.sio.on(ServerEvents.ROOM_GAME_STARTING)
        async def on_game_starting(data):
            payload = data.get("payload", {})
            game_state = payload.get("gameState", {})
            self.state.update_from_viewstate(game_state)
            logger.info("🚀 游戏开始!")

        @self.sio.on(ServerEvents.GAME_FULL_SYNC)
        async def on_full_sync(data):
            payload = data.get("payload", {})
            view_state = payload.get("state", {})
            version = payload.get("version")
            self.state.update_from_viewstate(view_state)
            logger.info(f"🔄 全量同步 (版本 {version})")
            # 发送状态确认
            if self.state.room_id and version:
                await self.sio.emit(
                    ClientEvents.GAME_ACK_STATE,
                    {"roomId": self.state.room_id, "version": version}
                )

        @self.sio.on(ServerEvents.GAME_DELTA_SYNC)
        async def on_delta_sync(data):
            payload = data.get("payload", {})
            version = payload.get("version")
            logger.info(f"🔄 增量同步 (版本 {version})")
            # 发送状态确认
            if self.state.room_id and version:
                await self.sio.emit(
                    ClientEvents.GAME_ACK_STATE,
                    {"roomId": self.state.room_id, "version": version}
                )

        @self.sio.on(ServerEvents.GAME_TURN_START)
        async def on_turn_start(data):
            payload = data.get("payload", {})
            self.state.turn_number = payload.get("turnNumber", self.state.turn_number)
            self.state.current_player_id = payload.get("currentPlayerId")
            self.state.turn_phase = payload.get("phase", self.state.turn_phase)
            logger.info(
                f"📍 回合 {self.state.turn_number} 开始: {self.state.current_player_id} ({self.state.turn_phase})"
            )

        @self.sio.on(ServerEvents.GAME_PHASE_CHANGE)
        async def on_phase_change(data):
            payload = data.get("payload", {})
            self.state.turn_phase = payload.get("newPhase", self.state.turn_phase)
            logger.info(f"🔄 阶段变更: {payload.get('oldPhase')} → {self.state.turn_phase}")

            if self.state.is_my_turn() and self.state.turn_phase == "actionPhase":
                await self.think_and_act()

        @self.sio.on(ServerEvents.GAME_BROADCAST_REQUEST)
        async def on_broadcast_request(data):
            logger.info("📡 收到广播请求!")
            if self.state.room_id:
                await self.sio.emit(
                    ClientEvents.GAME_REQUEST_SYNC,
                    {"roomId": self.state.room_id}
                )
            await self.think_and_act()

        @self.sio.on(ServerEvents.GAME_STRIKE_MOVE_REQUEST)
        async def on_strike_move_request(data):
            logger.info("🚀 收到打击移动请求!")
            if self.state.room_id:
                await self.sio.emit(
                    ClientEvents.GAME_REQUEST_SYNC,
                    {"roomId": self.state.room_id}
                )
            await self.think_and_act()

        @self.sio.on(ServerEvents.GAME_PLAYER_ACTION)
        async def on_player_action(data):
            payload = data.get("payload", {})
            action = payload.get("action", "")
            player_id = payload.get("playerId", "")
            logger.info(f"🎯 玩家 {player_id} 执行操作: {action}")
            if self.state.room_id:
                await self.sio.emit(
                    ClientEvents.GAME_REQUEST_SYNC,
                    {"roomId": self.state.room_id}
                )

        @self.sio.on(ServerEvents.GAME_ACTION_RESULT)
        async def on_action_result(data):
            payload = data.get("payload", {})
            if payload.get("success"):
                logger.info(f"✅ 操作成功: {payload.get('action')}")
            else:
                logger.error(f"❌ 操作失败: {payload.get('error')}")

        @self.sio.on(ServerEvents.GAME_GAME_OVER)
        async def on_game_over(data):
            payload = data.get("payload", {})
            winner_id = payload.get("winnerId")
            rankings = payload.get("rankings", [])
            logger.info(f"🏆 游戏结束! 获胜者: {winner_id}")
            for rank in rankings:
                logger.info(f"  {rank['displayName']}: 第{rank['rank']}名")

    async def _handle_reconnect(self):
        """处理重连逻辑"""
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            logger.error("❌ 达到最大重连次数，放弃重连")
            return

        self.reconnect_attempts += 1
        logger.info(f"🔄 尝试重连 ({self.reconnect_attempts}/{self.max_reconnect_attempts})...")
        
        try:
            # 等待一段时间后重连
            await asyncio.sleep(5)
            await self.sio.connect(
                GAME_SERVER_URL,
                auth={"token": JWT_TOKEN}
            )
            logger.info("✅ 重连成功")
        except Exception as e:
            logger.error(f"❌ 重连失败: {e}")
            await self._handle_reconnect()

    async def think_and_act(self):
        """AI 思考并执行操作"""
        if not self.state.is_my_turn() and not self.state.has_pending_request():
            logger.debug("当前不需要操作")
            return

        logger.info("🤖 AI 正在思考...")

        # 构建 Prompt
        prompt = PromptBuilder.build(self.state)

        # 调用 LLM
        result = self.llm.think(prompt)
        if not result:
            logger.error("❌ LLM 未能产生有效决策")
            await self._send_action(ActionType.END_TURN, {})
            return

        action = result.get("action")
        if not action:
            logger.error(f"❌ LLM 返回的内容缺少 action 字段: {result}")
            await self._send_action(ActionType.END_TURN, {})
            return

        # 预校验
        is_valid, error_msg = self.validator.validate(action, result)
        if not is_valid:
            logger.warning(f"⚠️ AI 操作被拦截: {error_msg}")
            await self._send_action(ActionType.END_TURN, {})
            return

        # 映射到游戏操作
        action_type = self.ACTION_MAP.get(action)
        if not action_type:
            logger.error(f"❌ 未知操作: {action}")
            await self._send_action(ActionType.END_TURN, {})
            return

        payload = self._map_params(action, result)

        logger.info(f"🎯 AI 决策: {action}({json.dumps(result, ensure_ascii=False)})")
        await self._send_action(action_type, payload)

    def _map_params(self, action: str, result: dict) -> dict:
        """将 AI 参数映射到游戏操作 payload"""
        param_map = self.PARAM_MAP.get(action, {})
        payload = {}
        for src_key, dst_key in param_map.items():
            if src_key in result:
                payload[dst_key] = result[src_key]
        return payload

    async def _send_action(self, action_type: str, payload: dict):
        """发送游戏操作"""
        if not self.state.room_id:
            logger.error("❌ 房间 ID 未设置，无法发送操作")
            return

        await self.sio.emit(
            ClientEvents.GAME_ACTION,
            {
                "roomId": self.state.room_id,
                "action": action_type,
                "payload": payload
            },
        )
        logger.info(f"📤 发送操作: {action_type}({payload})")

    async def run(self):
        """运行 AI Agent"""
        logger.info(f"🌌 黑暗森林 AI Agent 启动")
        logger.info(f"  游戏服务器: {GAME_SERVER_URL}")
        logger.info(f"  LLM 服务: {LLM_BASE_URL}")
        logger.info(f"  LLM 模型: {self.llm.model or '(自动发现)'}")
        logger.info(f"  AI 玩家名称: {AI_PLAYER_NAME}")
        logger.info(f"  协议版本: {PROTOCOL_VERSION}")

        # 连接服务器
        try:
            await self.sio.connect(
                GAME_SERVER_URL,
                auth={"token": JWT_TOKEN}
            )
            logger.info("✅ 连接成功")
        except Exception as e:
            logger.error(f"❌ 连接失败: {e}")
            return

        # 登录
        user_id = f"ai_{random.randint(1000, 9999)}"
        await self.sio.emit(
            ClientEvents.PLAYER_LOGIN,
            {"userId": user_id, "displayName": AI_PLAYER_NAME},
        )
        logger.info(f"🔑 尝试登录: {AI_PLAYER_NAME} ({user_id})")

        # 保持连接
        try:
            await self.sio.wait()
        except KeyboardInterrupt:
            logger.info("👋 AI Agent 退出")
            await self.sio.disconnect()
        except Exception as e:
            logger.error(f"❌ 运行错误: {e}")
            await self.sio.disconnect()


async def main():
    """入口函数"""
    agent = AIAgent()
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
