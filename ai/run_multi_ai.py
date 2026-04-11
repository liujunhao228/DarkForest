"""
黑暗森林 - 多 AI 对战辅助脚本
================================
同时启动多个 AI 玩家，让它们互相匹配对战。
用于在没有真人玩家的情况下测试游戏服务器。

用法：
  # 启动 4 个 AI 玩家（默认）
  uv run run_multi_ai.py

  # 指定 AI 数量
  uv run run_multi_ai.py --count 3

  # 使用 Mock LLM（不调用 nanobot，快速测试游戏流程）
  uv run run_multi_ai.py --count 4 --mock-llm

  # 自定义游戏服务器地址
  uv run run_multi_ai.py --count 4 --server http://localhost:3003
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from typing import Optional

from dotenv import load_dotenv
from socketio import AsyncClient

load_dotenv()

GAME_SERVER_URL = os.getenv("GAME_SERVER_URL", "http://localhost:3003")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://127.0.0.1:8900/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "dummy")
LLM_MODEL = os.getenv("LLM_MODEL", "")

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)

# 添加父目录以导入 ai_agent
sys.path.insert(0, os.path.dirname(__file__))
from ai_agent import GameState, PromptBuilder, ActionValidator, LLMEngine


class AIPlayer:
    """单个 AI 玩家"""

    ACTION_MAP = {
        "play_card": "playCard",
        "move_strike": "moveStrike",
        "respond_broadcast": "respondBroadcast",
        "announce_strike": "announceStrike",
        "skip_announce": "skipAnnounceStrike",
        "recycle_card": "recycleCard",
        "use_lightspeed_ship": "useLightspeedShip",
        "end_turn": "endTurn",
    }
    PARAM_MAP = {
        "play_card": {"card_uid": "cardUid", "target_system": "targetSystem", "target_player_id": "targetPlayerId"},
        "move_strike": {"strike_uid": "strikeUid", "target_system": "targetSystem"},
        "respond_broadcast": {"agreed": "agreed", "card_uid": "cardUid"},
        "announce_strike": {"strike_uid": "strikeUid"},
        "skip_announce": {"strike_uid": "strikeUid"},
        "recycle_card": {"card_uid": "cardUid"},
        "use_lightspeed_ship": {"target_system": "targetSystem"},
    }

    def __init__(self, index: int, use_mock_llm: bool = True):
        self.index = index
        self.name = f"AI-{index+1}"
        self.state = GameState()
        self.sio = AsyncClient()
        self.use_mock_llm = use_mock_llm
        self.logger = logging.getLogger(f"AI-{index+1}")
        self.actions_sent = 0
        self.actions_succeeded = 0
        self.game_over = False

        if use_mock_llm:
            self.llm = None  # 使用简单策略
        else:
            self.llm = LLMEngine(
                base_url=LLM_BASE_URL,
                api_key=LLM_API_KEY,
                model=LLM_MODEL,
            )

        self._setup_handlers()

    def _setup_handlers(self):
        @self.sio.on("connect")
        async def on_connect():
            self.logger.info("✅ 已连接")

        @self.sio.on("disconnect")
        async def on_disconnect():
            self.logger.warning("⚠️ 断开连接")

        @self.sio.on("player:loginSuccess")
        async def on_login(data):
            payload = data.get("payload", {})
            self.state.my_player_id = payload.get("playerId")
            self.logger.info(f"🎮 登录成功: {payload.get('displayName')} (ID: {self.state.my_player_id})")

        @self.sio.on("match:found")
        async def on_match(data):
            payload = data.get("payload", {})
            self.state.room_id = payload.get("roomId")
            self.logger.info(f"🏠 匹配成功: {payload.get('roomCode')}")

        @self.sio.on("room:gameStarting")
        async def on_game_start(data):
            payload = data.get("payload", {})
            self.state.update_from_viewstate(payload.get("gameState", {}))
            self.logger.info("🚀 游戏开始!")

        @self.sio.on("game:fullSync")
        async def on_sync(data):
            payload = data.get("payload", {})
            self.state.update_from_viewstate(payload.get("state", {}))

        @self.sio.on("game:turnStart")
        async def on_turn(data):
            payload = data.get("payload", {})
            self.state.turn_number = payload.get("turnNumber", self.state.turn_number)
            self.state.current_player_id = payload.get("currentPlayerId")
            self.state.turn_phase = payload.get("phase", self.state.turn_phase)

        @self.sio.on("game:phaseChange")
        async def on_phase(data):
            payload = data.get("payload", {})
            self.state.turn_phase = payload.get("newPhase", self.state.turn_phase)
            if self.state.is_my_turn() and self.state.turn_phase == "actionPhase":
                await self.think_and_act()

        @self.sio.on("game:broadcastRequest")
        async def on_broadcast(data):
            await self.sio.emit("game:requestSync")
            await self.think_and_act()

        @self.sio.on("game:strikeMoveRequest")
        async def on_strike_move(data):
            await self.sio.emit("game:requestSync")
            await self.think_and_act()

        @self.sio.on("game:playerAction")
        async def on_player_action(data):
            await self.sio.emit("game:requestSync")

        @self.sio.on("game:actionResult")
        async def on_action_result(data):
            payload = data.get("payload", {})
            if payload.get("success"):
                self.actions_succeeded += 1
            else:
                self.logger.error(f"❌ 操作失败: {payload.get('error')}")

        @self.sio.on("game:gameOver")
        async def on_game_over(data):
            self.game_over = True
            payload = data.get("payload", {})
            rankings = payload.get("rankings", [])
            self.logger.info("🏆 游戏结束!")
            for rank in rankings:
                self.logger.info(
                    f"  {rank['displayName']}: 第{rank['rank']}名 "
                    f"{'(已淘汰)' if rank['eliminated'] else ''}"
                )

    async def think_and_act(self):
        """AI 决策并发送操作"""
        if not self.state.is_my_turn() and not self.state.has_pending_request():
            return

        if self.use_mock_llm:
            decision = self._mock_decision()
        else:
            prompt = PromptBuilder.build(self.state)
            decision = self.llm.think(prompt)

        if not decision:
            self.logger.warning("LLM 无有效决策，发送 endTurn")
            await self._send_action("endTurn", {})
            return

        action = decision.get("action")
        if not action:
            self.logger.warning("LLM 缺少 action 字段，发送 endTurn")
            await self._send_action("endTurn", {})
            return

        # 验证
        validator = ActionValidator(self.state)
        is_valid, error = validator.validate(action, decision)
        if not is_valid:
            self.logger.warning(f"操作被拦截: {error}，发送 endTurn")
            await self._send_action("endTurn", {})
            return

        action_type = self.ACTION_MAP.get(action)
        if not action_type:
            self.logger.warning(f"未知操作: {action}，发送 endTurn")
            await self._send_action("endTurn", {})
            return

        param_map = self.PARAM_MAP.get(action, {})
        payload = {}
        for src_key, dst_key in param_map.items():
            if src_key in decision:
                payload[dst_key] = decision[src_key]

        self.logger.info(f"🎯 {action}({json.dumps(decision, ensure_ascii=False)})")
        await self._send_action(action_type, payload)

    def _mock_decision(self) -> dict:
        """简单 Mock 策略：有牌就出，否则结束回合"""
        if self.state.my_hand:
            card = self.state.my_hand[0]
            return {"action": "play_card", "card_uid": card["uid"]}
        return {"action": "end_turn"}

    async def _send_action(self, action_type: str, payload: dict):
        self.actions_sent += 1
        await self.sio.emit("game:action", {"action": action_type, "payload": payload})

    async def connect_and_login(self, server_url: str):
        """连接并登录"""
        await self.sio.connect(server_url, wait_timeout=10)
        user_id = f"multi_ai_{self.index}_{int(time.time())}"
        await self.sio.emit("player:login", {"userId": user_id, "displayName": self.name})

    async def join_queue(self, player_count: int = 4, quick_match: bool = True):
        """加入匹配队列"""
        await self.sio.emit("match:joinQueue", {
            "playerCount": player_count,
            "quickMatch": quick_match,
        })

    async def wait_for_game_over(self, timeout: float = 300):
        """等待游戏结束"""
        start = time.time()
        while not self.game_over and (time.time() - start) < timeout:
            await asyncio.sleep(0.5)

    async def disconnect(self):
        await self.sio.disconnect()


async def run_multi_ai(count: int = 4, use_mock_llm: bool = True, server_url: str = GAME_SERVER_URL):
    """运行多个 AI 玩家"""
    logger = logging.getLogger("multi-ai")
    logger.info(f"🌌 启动 {count} 个 AI 玩家")
    logger.info(f"游戏服务器: {server_url}")
    logger.info(f"LLM 模式: {'Mock（简单策略）' if use_mock_llm else '真实 LLM'}")

    # 创建 AI 玩家
    players = [AIPlayer(i, use_mock_llm=use_mock_llm) for i in range(count)]

    try:
        # 连接 + 登录
        for p in players:
            await p.connect_and_login(server_url)
        logger.info(f"✅ {count} 个 AI 已连接")

        # 等待登录完成
        await asyncio.sleep(2)

        # 加入匹配队列
        for p in players:
            await p.join_queue(player_count=count, quick_match=True)
        logger.info(f"✅ {count} 个 AI 已加入匹配队列")

        # 等待匹配和游戏结束
        logger.info("等待匹配和游戏开始...")
        tasks = [asyncio.create_task(p.wait_for_game_over(timeout=300)) for p in players]
        await asyncio.gather(*tasks, return_exceptions=True)

        # 输出统计
        logger.info("=" * 60)
        logger.info("游戏结束统计")
        logger.info("=" * 60)
        for p in players:
            logger.info(
                f"  {p.name}: 发送 {p.actions_sent} 次操作, "
                f"成功 {p.actions_succeeded} 次"
            )

    except KeyboardInterrupt:
        logger.info("👋 用户中断")
    except Exception as e:
        logger.error(f"❌ 异常: {e}")
    finally:
        for p in players:
            await p.disconnect()
        logger.info("所有 AI 已断开")


def main():
    parser = argparse.ArgumentParser(description="黑暗森林 - 多 AI 对战辅助")
    parser.add_argument("--count", type=int, default=4, help="AI 玩家数量（默认 4）")
    parser.add_argument("--mock-llm", action="store_true", help="使用 Mock LLM（不调用 nanobot）")
    parser.add_argument("--server", type=str, default=None, help="游戏服务器地址")
    args = parser.parse_args()

    server = args.server or GAME_SERVER_URL
    asyncio.run(run_multi_ai(
        count=args.count,
        use_mock_llm=args.mock_llm,
        server_url=server,
    ))


if __name__ == "__main__":
    main()
