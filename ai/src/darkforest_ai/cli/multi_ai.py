"""
多 AI 对战辅助工具
==================
同时启动多个 AI 玩家，让它们互相匹配对战。
用于在没有真人玩家的情况下测试游戏服务器。

用法：
  # 启动 4 个 AI 玩家（默认）
  uv run darkforest-multi-ai

  # 指定 AI 数量
  uv run darkforest-multi-ai --count 3

  # 加入指定的队列
  uv run darkforest-multi-ai --count 4 --queue-id a3f8k9x2

  # 使用 Mock LLM（不调用 nanobot，快速测试游戏流程）
  uv run darkforest-multi-ai --count 4 --mock-llm

  # 自定义游戏服务器地址
  uv run darkforest-multi-ai --count 4 --server http://localhost:3003
"""

import argparse
import asyncio
import json
import logging
import os
import time
from typing import Optional

import httpx
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

# 导入核心模块
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from darkforest_ai.state import GameState
from darkforest_ai.prompt import PromptBuilder
from darkforest_ai.validator import ActionValidator
from darkforest_ai.llm import LLMEngine
from darkforest_ai.cli.account_manager import AccountManager, Account

# 环境变量配置
API_SERVER_URL = os.getenv("API_SERVER_URL", "http://localhost:3000")
GAME_SERVER_URL = os.getenv("GAME_SERVER_URL", "http://localhost:3003")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://127.0.0.1:8900/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "dummy")
LLM_MODEL = os.getenv("LLM_MODEL", "")


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

    def __init__(self, account: Account, use_mock_llm: bool = True, server_url: str = GAME_SERVER_URL, api_url: str = API_SERVER_URL):
        self.account = account
        self.index = int(''.join(filter(str.isdigit, account.displayName)) or '0') - 1
        self.name = account.displayName
        self.state = GameState()
        self.sio = AsyncClient()
        self.server_url = server_url
        self.api_url = api_url
        self.use_mock_llm = use_mock_llm
        self.logger = logging.getLogger(f"AI-{self.name}")
        self.actions_sent = 0
        self.actions_succeeded = 0
        self.game_over = False

        # 创建 HTTP 客户端用于 REST API 调用（认证、匹配等）
        self.http_client = httpx.AsyncClient(base_url=api_url, headers={
            "Authorization": f"Bearer {account.token}",
        })
        
        # player_id 从账号信息中获取
        self.player_id = account.playerId

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
            self.logger.debug(f"🔍 登录事件原始数据: {data}")
            # 服务端可能直接发送 payload，也可能包装在 { payload: ... } 中
            if "payload" in data:
                payload = data["payload"]
            else:
                payload = data
            self.state.my_player_id = payload.get("playerId")
            # player_id 已从账号信息中获取，这里只做同步
            self.logger.info(f"🎮 登录成功: {payload.get('displayName')} (ID: {self.player_id})")

        @self.sio.on("match:found")
        async def on_match(data):
            payload = data.get("payload", {})
            self.state.room_id = payload.get("roomId")
            self.logger.info(f"🏠 匹配成功: {payload.get('roomCode')}")

        @self.sio.on("match:specificQueueJoined")
        async def on_specific_queue_joined(data):
            payload = data.get("payload", {})
            self.logger.info(
                f"📋 已加入指定队列: {payload.get('queueId')} "
                f"({payload.get('queueName')}) - "
                f"位置: {payload.get('position')}/{payload.get('totalInQueue')}"
            )

        @self.sio.on("queue:playerJoined")
        async def on_queue_player_joined(data):
            payload = data.get("payload", {})
            self.logger.info(
                f"👥 队列玩家更新: {payload.get('queueId')} - "
                f"当前人数: {payload.get('currentPlayers')}/{payload.get('maxPlayers')}"
            )

        @self.sio.on("queue:full")
        async def on_queue_full(data):
            payload = data.get("payload", {})
            self.logger.info(
                f"🎯 队列已满: {payload.get('queueId')} - "
                f"正在创建房间..."
            )

        @self.sio.on("room:created")
        async def on_room_created(data):
            payload = data.get("payload", {})
            self.state.room_id = payload.get("roomId")
            self.logger.info(
                f"🏠 房间创建成功: {payload.get('roomCode')} "
                f"(ID: {payload.get('roomId')})"
            )

        @self.sio.on("room:gameStarting")
        async def on_game_start(data):
            payload = data.get("payload", {})
            game_state = payload.get("gameState", {})
            self.state.update_from_viewstate(game_state)
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
        """连接并使用 JWT token 认证"""
        # Socket.IO 认证需要在连接时通过 auth 参数传递 token
        await self.sio.connect(server_url, auth={"token": self.account.token}, wait_timeout=10)
        # 使用 JWT token 认证，不需要发送 player:login
        # playerId 已从 token 中获取
        self.logger.info(f"✅ 已连接并认证: {self.account.displayName} (ID: {self.player_id})")

    async def create_queue(self, queue_name: str, min_players: int = 4, max_players: int = 4) -> Optional[str]:
        """创建自定义队列（REST API + WebSocket 事件）"""
        if not self.player_id:
            self.logger.error("❌ 未登录，无法创建队列")
            return None
        try:
            response = await self.http_client.post("/api/match/queue/create", json={
                "creatorId": self.player_id,
                "queueName": queue_name,
                "minPlayers": min_players,
                "maxPlayers": max_players,
            })
            result = response.json()
            if result.get("success"):
                queue_id = result.get("queueId")
                # 发送 WebSocket 事件将创建者添加到内存队列
                await self.sio.emit("match:joinSpecificQueue", {
                    "queueId": queue_id,
                    "playerCount": max_players,
                })
                self.logger.info(f"✅ 队列创建成功: {queue_name} ({queue_id})")
                return queue_id
            else:
                self.logger.error(f"❌ 队列创建失败: {result.get('error')}")
                return None
        except Exception as e:
            self.logger.error(f"❌ 队列创建异常: {e}")
            return None

    async def join_queue_by_id(self, queue_id: str) -> bool:
        """加入指定队列（REST API + WebSocket 事件）"""
        if not self.player_id:
            self.logger.error("❌ 未登录，无法加入队列")
            return False
        try:
            response = await self.http_client.post("/api/match/queue/join-specific", json={
                "playerId": self.player_id,
                "queueId": queue_id,
            })
            result = response.json()
            if result.get("success"):
                # 重要：发送 WebSocket 事件通知服务器更新内存队列
                # 这样 tryMatchCustomQueueInternal 才能正确检查玩家在线状态
                await self.sio.emit("match:joinSpecificQueue", {
                    "queueId": queue_id,
                    "playerCount": 4,
                })
                self.logger.info(f"✅ 已加入队列: {queue_id}")
                return True
            else:
                self.logger.error(f"❌ 加入队列失败: {result.get('error')}")
                return False
        except Exception as e:
            self.logger.error(f"❌ 加入队列异常: {e}")
            return False

    async def join_queue(self, player_count: int = 4, quick_match: bool = True):
        """加入匹配队列（旧版 WebSocket API，已废弃）"""
        self.logger.warning("⚠️ 快速匹配 API 已废弃，请使用 create_queue + join_queue_by_id")
        await self.sio.emit("match:joinQueue", {
            "playerCount": player_count,
            "quickMatch": quick_match,
        })

    async def join_specific_queue(self, queue_id: str, player_count: int = 4):
        """加入指定的队列"""
        await self.sio.emit("match:joinSpecificQueue", {
            "queueId": queue_id,
            "playerCount": player_count,
        })

    async def wait_for_game_over(self, timeout: float = 300):
        """等待游戏结束"""
        start = time.time()
        while not self.game_over and (time.time() - start) < timeout:
            await asyncio.sleep(0.5)

    async def disconnect(self):
        await self.sio.disconnect()


async def run_multi_ai(
    count: int = 4,
    use_mock_llm: bool = True,
    api_url: str = API_SERVER_URL,
    server_url: str = GAME_SERVER_URL,
    queue_id: Optional[str] = None,
    invite_codes: Optional[list[str]] = None,
    config_path: str = "config/accounts.json",
):
    """运行多个 AI 玩家"""
    logger = logging.getLogger("multi-ai")
    logger.info(f"🌌 启动 {count} 个 AI 玩家")
    logger.info(f"REST API 服务器: {api_url}")
    logger.info(f"WebSocket 服务器: {server_url}")
    logger.info(f"LLM 模式: {'Mock（简单策略）' if use_mock_llm else '真实 LLM'}")
    if queue_id:
        logger.info(f"🎯 指定队列: {queue_id}")

    # 1. 初始化账号管理器（使用 REST API 地址）
    account_mgr = AccountManager(config_path=config_path, server_url=api_url)
    
    # 2. 确保有足够的账号（每个账号需要一个邀请码）
    if not invite_codes and len(account_mgr.accounts) < count:
        logger.error("❌ 账号数量不足，请提供邀请码或预先注册账号")
        logger.error("   使用 --invite-codes 参数提供多个邀请码（逗号分隔）")
        return
    
    if invite_codes:
        account_mgr.ensure_accounts(count, invite_codes)
    
    # 3. 为每个 AI 分配独立账号
    accounts = account_mgr.accounts[:count]
    players = [AIPlayer(account=acc, use_mock_llm=use_mock_llm, server_url=server_url, api_url=api_url) for acc in accounts]

    try:
        # 4. 连接 + 认证
        for p in players:
            await p.connect_and_login(server_url)
        logger.info(f"✅ {count} 个 AI 已连接并认证")

        # 5. 加入匹配队列（新版自定义队列系统）
        if queue_id:
            # 加入指定的队列
            for p in players:
                success = await p.join_queue_by_id(queue_id)
                if not success:
                    logger.warning(f"⚠️ {p.name} 加入队列失败")
            logger.info(f"✅ {count} 个 AI 已尝试加入指定队列: {queue_id}")
        else:
            # 第一个 AI 创建队列，其他 AI 加入
            queue_name = f"AI-Game-{int(time.time())}"
            created_queue_id = await players[0].create_queue(queue_name, count, count)
            if not created_queue_id:
                logger.error("❌ 队列创建失败，无法继续")
                return

            await asyncio.sleep(1)  # 等待队列创建完成

            for p in players[1:]:
                success = await p.join_queue_by_id(created_queue_id)
                if not success:
                    logger.warning(f"⚠️ {p.name} 加入队列失败")

            logger.info(f"✅ 队列 {queue_name} ({created_queue_id}) 已创建，{count} 个 AI 正在加入")

        # 6. 等待匹配和游戏结束
        logger.info("等待匹配和游戏开始...")
        tasks = [asyncio.create_task(p.wait_for_game_over(timeout=300)) for p in players]
        await asyncio.gather(*tasks, return_exceptions=True)

        # 7. 输出统计
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
            await p.http_client.aclose()
        logger.info("所有 AI 已断开")


def main():
    """入口函数"""
    parser = argparse.ArgumentParser(
        description="黑暗森林 - 多 AI 对战辅助",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 注册 4 个新账号并启动（每个 AI 需要一个邀请码）
  uv run darkforest-multi-ai --count 4 --invite-codes ABC123,DEF456,GHI789,JKL012

  # 使用已有账号启动
  uv run darkforest-multi-ai --count 4

  # 加入指定的队列
  uv run darkforest-multi-ai --count 4 --queue-id a3f8k9x2

  # 使用 Mock LLM（不调用 nanobot，快速测试游戏流程）
  uv run darkforest-multi-ai --count 4 --mock-llm

  # 自定义服务器地址
  uv run darkforest-multi-ai --count 4 --api-server http://localhost:3000 --server http://localhost:3003

  # 自定义账号配置文件路径
  uv run darkforest-multi-ai --count 4 --config ./my-accounts.json
        """,
    )
    parser.add_argument("--count", type=int, default=4, help="AI 玩家数量（默认 4）")
    parser.add_argument("--mock-llm", action="store_true", help="使用 Mock LLM（不调用 nanobot）")
    parser.add_argument("--api-server", type=str, default=None, help="REST API 服务器地址（认证、匹配等 HTTP 接口）")
    parser.add_argument("--server", type=str, default=None, help="WebSocket 游戏服务器地址（实时游戏通信）")
    parser.add_argument("--queue-id", type=str, default=None, help="指定队列 ID（加入已创建的自定义队列）")
    parser.add_argument("--invite-codes", type=str, default=None, help="邀请码列表（逗号分隔，每个 AI 一个）")
    parser.add_argument("--config", type=str, default="config/accounts.json", help="账号配置文件路径")
    args = parser.parse_args()

    # 解析邀请码（逗号分隔）
    invite_codes = None
    if args.invite_codes:
        invite_codes = [code.strip() for code in args.invite_codes.split(",")]

    api_server = args.api_server or API_SERVER_URL
    game_server = args.server or GAME_SERVER_URL
    
    asyncio.run(run_multi_ai(
        count=args.count,
        use_mock_llm=args.mock_llm,
        api_url=api_server,
        server_url=game_server,
        queue_id=args.queue_id,
        invite_codes=invite_codes,
        config_path=args.config,
    ))


if __name__ == "__main__":
    main()
