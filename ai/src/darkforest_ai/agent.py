"""
AI Agent 主控制器
=================
黑暗森林 AI Agent 主程序，整合所有模块。
"""

import asyncio
import logging
import random
import signal
import sys
from typing import Optional

from socketio import AsyncClient

from darkforest_ai.base_ai import AIBase
from darkforest_ai.cli.account_manager import AccountManager
from darkforest_ai.config import (
    AI_PLAYER_NAME,
    GAME_SERVER_URL,
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    SESSION_ID,
)
from darkforest_ai.llm import LLMEngine
from darkforest_ai.protocol import (
    ClientEvents,
    ServerEvents,
    PROTOCOL_VERSION,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("darkforest-ai")


class AIAgent(AIBase):
    """AI Agent 主控制器"""

    def __init__(self):
        super().__init__()
        self.llm = LLMEngine(
            base_url=LLM_BASE_URL,
            api_key=LLM_API_KEY,
            model=LLM_MODEL,
            session_id=SESSION_ID,
        )
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5
        
        # 队列管理相关属性
        self.current_queue_id: Optional[str] = None
        self.queue_created_event = asyncio.Event()
        self.queue_joined_event = asyncio.Event()
        self.game_starting_event = asyncio.Event()
        
        # 操作统计相关属性
        self.actions_sent = 0
        self.actions_succeeded = 0
        self.game_over = False
        
        # 账号管理
        self.account_manager = AccountManager()
        self.current_account = None
        
        # 优雅退出相关
        self._shutdown_event = asyncio.Event()
        self._is_shutting_down = False
        
        self._setup_event_handlers()
        self._setup_signal_handlers()

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
            self.state.my_player_id = data.get("playerId")
            logger.info(f"🎮 登录成功! 玩家 ID: {self.state.my_player_id}")
            
            # 处理队列操作
            if hasattr(self, "_queue_config"):
                queue_config = self._queue_config
                
                if queue_config.get("create_queue"):
                    queue_name = queue_config["create_queue"]
                    min_players = queue_config.get("min_players", 4)
                    max_players = queue_config.get("max_players", 4)
                    logger.info(f"📋 准备创建队列: {queue_name} ({min_players}-{max_players}人)")
                    queue_id = await self.create_queue(queue_name, min_players, max_players)
                    if queue_id:
                        logger.info(f"✅ 创建队列成功，准备加入: {queue_id}")
                        await self.join_queue_by_id(queue_id)
                elif queue_config.get("join_queue"):
                    queue_id = queue_config["join_queue"]
                    logger.info(f"📋 准备加入队列: {queue_id}")
                    await self.join_queue_by_id(queue_id)

        @self.sio.on(ServerEvents.PLAYER_LOGIN_ERROR)
        async def on_login_error(data):
            logger.error(f"❌ 登录失败: {data.get('message')}")

        @self.sio.on(ServerEvents.MATCH_FOUND)
        async def on_match_found(data):
            self.state.room_id = data.get("roomId")
            logger.info(f"🏠 匹配成功! 房间: {self.state.room_id}")

        @self.sio.on(ServerEvents.ROOM_GAME_STARTING)
        async def on_game_starting(data):
            game_state = data.get("gameState", {})
            self.state.update_from_viewstate(game_state)
            logger.info("🚀 游戏开始!")

        @self.sio.on(ServerEvents.GAME_FULL_SYNC)
        async def on_full_sync(data):
            view_state = data.get("state", {})
            version = data.get("version")
            self.state.update_from_viewstate(view_state)
            logger.info(f"🔄 全量同步 (版本 {version})")
            if self.state.room_id and version:
                await self.sio.emit(
                    ClientEvents.GAME_ACK_STATE,
                    {"roomId": self.state.room_id, "version": version}
                )

        @self.sio.on(ServerEvents.GAME_DELTA_SYNC)
        async def on_delta_sync(data):
            version = data.get("version")
            logger.info(f"🔄 增量同步 (版本 {version})")
            if self.state.room_id and version:
                await self.sio.emit(
                    ClientEvents.GAME_ACK_STATE,
                    {"roomId": self.state.room_id, "version": version}
                )

        @self.sio.on(ServerEvents.GAME_TURN_START)
        async def on_turn_start(data):
            self.state.turn_number = data.get("turnNumber", self.state.turn_number)
            self.state.current_player_id = data.get("currentPlayerId")
            self.state.turn_phase = data.get("phase", self.state.turn_phase)
            logger.info(
                f"📍 回合 {self.state.turn_number} 开始: {self.state.current_player_id} ({self.state.turn_phase})"
            )

        @self.sio.on(ServerEvents.GAME_PHASE_CHANGE)
        async def on_phase_change(data):
            self.state.turn_phase = data.get("newPhase", self.state.turn_phase)
            logger.info(f"🔄 阶段变更: {data.get('oldPhase')} → {self.state.turn_phase}")

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
            action = data.get("action", "")
            player_id = data.get("playerId", "")
            logger.info(f"🎯 玩家 {player_id} 执行操作: {action}")
            if self.state.room_id:
                await self.sio.emit(
                    ClientEvents.GAME_REQUEST_SYNC,
                    {"roomId": self.state.room_id}
                )

        @self.sio.on(ServerEvents.GAME_ACTION_RESULT)
        async def on_action_result(data):
            if data.get("success"):
                self.actions_succeeded += 1
                logger.info(f"✅ 操作成功: {data.get('action')}")
            else:
                logger.error(f"❌ 操作失败: {data.get('error')}")

        @self.sio.on(ServerEvents.GAME_GAME_OVER)
        async def on_game_over(data):
            winner_id = data.get("winnerId")
            rankings = data.get("rankings", [])
            self.game_over = True
            logger.info(f"🏆 游戏结束! 获胜者: {winner_id}")
            for rank in rankings:
                logger.info(f"  {rank['displayName']}: 第{rank['rank']}名")
        
        # 队列管理相关事件
        @self.sio.on("match:queueCreated")
        async def on_queue_created(data):
            self.current_queue_id = data.get("queueId")
            self.queue_created_event.set()
            logger.info(
                f"📋 队列创建成功: {data.get('queueName')} "
                f"({data.get('queueId')}) - "
                f"人数: {data.get('minPlayers')}-{data.get('maxPlayers')}"
            )

        @self.sio.on("match:specificQueueJoined")
        async def on_specific_queue_joined(data):
            self.current_queue_id = data.get("queueId")
            self.queue_joined_event.set()
            logger.info(
                f"📋 已加入指定队列: {data.get('queueId')} "
                f"({data.get('queueName')}) - "
                f"位置: {data.get('position')}/{data.get('totalInQueue')}"
            )

        @self.sio.on("match:specificQueueLeft")
        async def on_specific_queue_left(data):
            self.current_queue_id = None
            logger.info(f"📋 已离开队列: {data.get('queueId')}")

        @self.sio.on("match:error")
        async def on_match_error(data):
            logger.error(f"❌ 匹配错误: {data.get('message')}")

        @self.sio.on("room:created")
        async def on_room_created(data):
            self.state.room_id = data.get("roomId")
            logger.info(
                f"🏠 房间创建成功: {data.get('roomCode')} "
                f"(ID: {data.get('roomId')})"
            )

    def _setup_signal_handlers(self):
        """设置信号处理器用于优雅退出"""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        def handle_shutdown_signal(signal_num, frame):
            try:
                signal_name = signal.Signals(signal_num).name
            except ValueError:
                signal_name = f"UNKNOWN({signal_num})"
            logger.info(f"\n📥 收到退出信号: {signal_name}")
            
            try:
                loop.call_soon_threadsafe(self._initiate_shutdown)
            except Exception:
                self._initiate_shutdown()
        
        # 注册信号处理器
        for sig in [signal.SIGINT, signal.SIGTERM]:
            try:
                signal.signal(sig, handle_shutdown_signal)
            except (ValueError, AttributeError, OSError) as e:
                logger.debug(f"无法注册信号 {sig}: {e}")
        
        # Unix-only signals
        if sys.platform != "win32":
            for sig_name in ["SIGHUP", "SIGUSR1"]:
                try:
                    sig = getattr(signal, sig_name)
                    signal.signal(sig, handle_shutdown_signal)
                except (ValueError, AttributeError, OSError) as e:
                    logger.debug(f"无法注册信号 {sig_name}: {e}")

    def _initiate_shutdown(self):
        """启动优雅关闭流程"""
        if self._is_shutting_down:
            logger.info("🔄 关闭流程已在进行中，请稍候...")
            return
        
        logger.info("🛑 启动优雅关闭流程...")
        self._is_shutting_down = True
        asyncio.create_task(self._graceful_shutdown())

    async def _graceful_shutdown(self):
        """执行优雅关闭"""
        shutdown_tasks = []
        
        # 1. 如果在匹配队列中，离开队列
        if self.current_queue_id:
            logger.info(f"📋 离开匹配队列: {self.current_queue_id}")
            shutdown_tasks.append(self._leave_queue())
        
        # 2. 如果在游戏房间中，通知服务器玩家离开
        if self.state.room_id and not self.game_over:
            logger.info(f"🏠 通知服务器离开房间: {self.state.room_id}")
            shutdown_tasks.append(self._leave_room())
        
        # 执行所有清理任务（带超时）
        if shutdown_tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*shutdown_tasks, return_exceptions=True),
                    timeout=3.0
                )
            except asyncio.TimeoutError:
                logger.warning("⏱️ 清理任务超时，继续关闭流程")
            except Exception as e:
                logger.warning(f"⚠️ 清理任务出现异常: {e}")
        
        # 3. 断开 WebSocket 连接
        if self.sio.connected:
            logger.info("🔌 断开 WebSocket 连接...")
            try:
                await asyncio.wait_for(self.sio.disconnect(), timeout=2.0)
            except Exception as e:
                logger.warning(f"⚠️ 断开连接时出现异常: {e}")
        
        # 4. 输出退出摘要
        self._print_shutdown_summary()
        
        # 5. 触发关闭事件
        self._shutdown_event.set()
        logger.info("✅ 优雅关闭完成")

    async def _leave_queue(self):
        """离开匹配队列"""
        if not self.current_queue_id:
            return
        
        try:
            await self.sio.emit("match:leaveSpecificQueue", {
                "queueId": self.current_queue_id,
            })
            await asyncio.sleep(0.5)
            logger.info("✅ 已离开匹配队列")
        except Exception as e:
            logger.warning(f"⚠️ 离开队列时出现异常: {e}")

    async def _leave_room(self):
        """离开游戏房间"""
        if not self.state.room_id:
            return
        
        try:
            await self.sio.emit("room:leave", {
                "roomId": self.state.room_id,
            })
            await asyncio.sleep(0.5)
            logger.info("✅ 已通知服务器离开房间")
        except Exception as e:
            logger.warning(f"⚠️ 离开房间时出现异常: {e}")

    def _print_shutdown_summary(self):
        """打印关闭摘要"""
        logger.info("=" * 50)
        logger.info("📊 AI Agent 运行摘要")
        logger.info("=" * 50)
        logger.info(f"  发送操作数: {self.actions_sent}")
        logger.info(f"  成功操作数: {self.actions_succeeded}")
        if self.actions_sent > 0:
            success_rate = (self.actions_succeeded / self.actions_sent) * 100
            logger.info(f"  成功率: {success_rate:.1f}%")
        logger.info(f"  游戏状态: {'已结束' if self.game_over else '进行中/未开始'}")
        if self.state.room_id:
            logger.info(f"  最后房间 ID: {self.state.room_id}")
        if self.current_queue_id:
            logger.info(f"  最后队列 ID: {self.current_queue_id}")
        logger.info("=" * 50)

    async def _refresh_token(self):
        """尝试重新登录以刷新 token"""
        if not self.current_account:
            logger.error("❌ 没有可用账号，无法刷新 token")
            return False
        
        try:
            logger.info(f"🔄 尝试重新登录刷新 token: {self.current_account.displayName}")
            new_account = await self.account_manager.login_account(
                self.current_account.displayName,
                self.current_account.password
            )
            if new_account:
                # 更新当前账号
                self.current_account = new_account
                
                # 更新 account_manager 中的账号列表
                for i, acc in enumerate(self.account_manager.accounts):
                    if acc.displayName == new_account.displayName:
                        self.account_manager.accounts[i] = new_account
                        break
                
                # 保存更新后的账号信息
                self.account_manager._save_accounts()
                logger.info("✅ Token 刷新成功")
                return True
            else:
                logger.error("❌ Token 刷新失败: 登录失败")
                return False
        except Exception as e:
            logger.error(f"❌ Token 刷新异常: {e}")
            return False

    async def _handle_reconnect(self):
        """处理重连逻辑"""
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            logger.error("❌ 达到最大重连次数，放弃重连")
            return

        self.reconnect_attempts += 1
        logger.info(f"🔄 尝试重连 ({self.reconnect_attempts}/{self.max_reconnect_attempts})...")

        try:
            await asyncio.sleep(5)
            token = self.current_account.token if self.current_account else ""
            logger.info(f"🔑 使用 token 连接: {token[:20]}...")
            await self.sio.connect(
                GAME_SERVER_URL,
                auth={"token": token}
            )
            logger.info("✅ 重连成功")
        except Exception as e:
            logger.error(f"❌ 重连失败: {e}")
            logger.error(f"❌ 错误类型: {type(e).__name__}")
            logger.error(f"❌ 错误详情: {str(e)}")
            
            # 尝试刷新 token 后重新连接
            if self.current_account:
                logger.info("🔄 尝试刷新 token...")
                if await self._refresh_token():
                    # 刷新成功后再次尝试连接
                    try:
                        logger.info(f"🔑 使用新 token 连接: {self.current_account.token[:20]}...")
                        await self.sio.connect(
                            GAME_SERVER_URL,
                            auth={"token": self.current_account.token}
                        )
                        logger.info("✅ 刷新 token 后重连成功")
                        return
                    except Exception as e2:
                        logger.error(f"❌ 刷新 token 后重连失败: {e2}")
            await self._handle_reconnect()

    async def _get_llm_decision(self):
        """调用 LLM 获取决策"""
        from darkforest_ai.prompt import PromptBuilder

        prompt = PromptBuilder.build(self.state)
        result = self.llm.think(prompt)
        if not result:
            logger.error("❌ LLM 未能产生有效决策")
            return None

        action = result.get("action")
        if not action:
            logger.error(f"❌ LLM 返回的内容缺少 action 字段: {result}")
            return None

        logger.info(f"🎯 AI 决策: {action}({result})")
        return result

    def _log_info(self, msg: str):
        logger.info(msg)

    def _log_warning(self, msg: str):
        logger.warning(msg)

    def _log_error(self, msg: str):
        logger.error(msg)

    async def _send_action(self, action_type: str, payload: dict):
        """发送游戏操作（带统计）"""
        self.actions_sent += 1
        if not self.state.room_id:
            self._log_error("房间 ID 未设置，无法发送操作")
            return

        await self.sio.emit(
            "game:action",
            {
                "roomId": self.state.room_id,
                "action": action_type,
                "payload": payload
            },
        )
        self._log_info(f"发送操作: {action_type}({payload})")

    async def create_queue(self, queue_name: str, min_players: int = 4, max_players: int = 4) -> Optional[str]:
        """创建自定义队列"""
        if not self.state.my_player_id:
            self._log_error("未登录，无法创建队列")
            return None

        try:
            self.queue_created_event.clear()

            await self.sio.emit("match:createQueue", {
                "queueName": queue_name,
                "minPlayers": min_players,
                "maxPlayers": max_players,
            })
            self._log_info(f"📤 请求创建队列: {queue_name} ({min_players}-{max_players}人)")

            try:
                await asyncio.wait_for(self.queue_created_event.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._log_error("❌ 等待队列创建响应超时")
                return None

            if self.current_queue_id:
                self._log_info(f"✅ 队列创建成功: {queue_name} ({self.current_queue_id})")
                return self.current_queue_id
            else:
                self._log_error("❌ 队列创建失败：未收到 queueId")
                return None
        except Exception as e:
            self._log_error(f"❌ 队列创建异常: {e}")
            return None

    async def join_queue_by_id(self, queue_id: str) -> bool:
        """加入指定队列"""
        if not self.state.my_player_id:
            self._log_error("未登录，无法加入队列")
            return False

        try:
            self.queue_joined_event.clear()

            await self.sio.emit("match:joinSpecificQueue", {
                "queueId": queue_id,
                "playerCount": 4,
            })
            self._log_info(f"📤 请求加入队列: {queue_id}")

            try:
                await asyncio.wait_for(self.queue_joined_event.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._log_error("❌ 等待加入队列响应超时")
                return False

            if self.current_queue_id:
                self._log_info(f"✅ 已加入队列: {queue_id}")
                return True
            else:
                self._log_error(f"❌ 加入队列失败: 未收到成功响应")
                return False
        except Exception as e:
            self._log_error(f"❌ 加入队列异常: {e}")
            return False

    async def join_queue(self, player_count: int = 4, quick_match: bool = True):
        """加入匹配队列（旧版 WebSocket API，已废弃）"""
        self._log_warning("⚠️ 快速匹配 API 已废弃，请使用 create_queue + join_queue_by_id")
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
        import time
        start = time.time()
        while not self.game_over and (time.time() - start) < timeout:
            await asyncio.sleep(0.5)

    async def run(self, create_queue: Optional[str] = None, join_queue: Optional[str] = None, min_players: int = 4, max_players: int = 4, invite_code: str = ""):
        """运行 AI Agent"""
        logger.info(f"🌌 黑暗森林 AI Agent 启动")
        logger.info(f"  游戏服务器: {GAME_SERVER_URL}")
        logger.info(f"  LLM 服务: {LLM_BASE_URL}")
        logger.info(f"  LLM 模型: {self.llm.model or '(自动发现)'}")
        logger.info(f"  AI 玩家名称: {AI_PLAYER_NAME}")
        logger.info(f"  协议版本: {PROTOCOL_VERSION}")
        
        # 队列操作配置
        self._queue_config = {
            "create_queue": create_queue,
            "join_queue": join_queue,
            "min_players": min_players,
            "max_players": max_players
        }

        # 确保有可用的账号
        try:
            if invite_code:
                logger.info(f"📝 使用邀请码注册账号: {invite_code}")
                accounts = self.account_manager.ensure_accounts(1, [invite_code])
                self.current_account = accounts[0]
            else:
                # 尝试使用现有账号
                try:
                    self.current_account = self.account_manager.get_account(0)
                    logger.info(f"✅ 使用现有账号: {self.current_account.displayName}")
                except IndexError:
                    logger.error("❌ 没有可用的账号，请提供邀请码")
                    return
        except Exception as e:
            logger.error(f"❌ 账号管理失败: {e}")
            return

        try:
            token = self.current_account.token
            logger.info(f"🔑 使用 token 连接: {token[:20]}...")
            await self.sio.connect(
                GAME_SERVER_URL,
                auth={"token": token}
            )
            logger.info("✅ 连接成功")
        except Exception as e:
            logger.error(f"❌ 连接失败: {e}")
            # 尝试刷新 token 后重新连接
            if self.current_account:
                logger.info("🔄 尝试刷新 token...")
                if await self._refresh_token():
                    try:
                        logger.info(f"🔑 使用新 token 连接: {self.current_account.token[:20]}...")
                        await self.sio.connect(
                            GAME_SERVER_URL,
                            auth={"token": self.current_account.token}
                        )
                        logger.info("✅ 刷新 token 后连接成功")
                    except Exception as e2:
                        logger.error(f"❌ 刷新 token 后连接失败: {e2}")
                        return
            return

        user_id = f"ai_{random.randint(1000, 9999)}"
        await self.sio.emit(
            ClientEvents.PLAYER_LOGIN,
            {"userId": user_id, "displayName": AI_PLAYER_NAME},
        )
        logger.info(f"🔑 尝试登录: {AI_PLAYER_NAME} ({user_id})")
        logger.info("💡 按 Ctrl+C 优雅退出 AI Agent")

        # 等待关闭事件或socket断开
        done, pending = await asyncio.wait(
            [
                asyncio.create_task(self._shutdown_event.wait()),
                asyncio.create_task(self.sio.wait())
            ],
            return_when=asyncio.FIRST_COMPLETED
        )

        # 取消未完成的任务
        for task in pending:
            task.cancel()

        # 如果是 socket 断开触发的退出，确保执行清理
        if not self._is_shutting_down:
            logger.info("🔌 Socket 连接已断开，执行清理")
            await self._graceful_shutdown()

        logger.info("👋 AI Agent 已退出")


import argparse


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="黑暗森林 AI Agent")
    
    # 队列相关参数
    queue_group = parser.add_mutually_exclusive_group()
    queue_group.add_argument(
        "--create-queue",
        type=str,
        metavar="QUEUE_NAME",
        help="创建自定义队列"
    )
    queue_group.add_argument(
        "--join-queue",
        type=str,
        metavar="QUEUE_ID",
        help="加入指定队列"
    )
    
    # 队列配置参数
    parser.add_argument(
        "--min-players",
        type=int,
        default=4,
        help="最小玩家数 (默认: 4)"
    )
    parser.add_argument(
        "--max-players",
        type=int,
        default=4,
        help="最大玩家数 (默认: 4)"
    )
    
    # 账号相关参数
    parser.add_argument(
        "--invite-code",
        type=str,
        metavar="INVITE_CODE",
        help="邀请码 (用于注册新账号)"
    )
    
    return parser.parse_args()


async def _main_async():
    """异步入口函数"""
    args = parse_args()
    agent = AIAgent()
    await agent.run(
        create_queue=args.create_queue,
        join_queue=args.join_queue,
        min_players=args.min_players,
        max_players=args.max_players,
        invite_code=args.invite_code
    )


def main():
    """入口函数"""
    asyncio.run(_main_async())


if __name__ == "__main__":
    main()
