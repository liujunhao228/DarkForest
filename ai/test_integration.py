"""
黑暗森林 AI Agent - 与游戏服务器联调测试
==========================================
分阶段验证 AI Agent 与游戏服务器的交互。

阶段 1：连接与登录
阶段 2：匹配系统
阶段 3：完整游戏流程（Mock LLM）
阶段 4：真实 LLM 对局

用法：
  uv run test_integration.py --stage 1    # 仅连接登录
  uv run test_integration.py --stage 2    # 连接 + 匹配
  uv run test_integration.py --stage 3    # 完整游戏（Mock LLM）
  uv run test_integration.py --stage 4    # 真实 LLM 对局
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
SESSION_ID = os.getenv("SESSION_ID", "integration-test")

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("integration-test")

# 添加父目录以导入 ai_agent
sys.path.insert(0, os.path.dirname(__file__))
from ai_agent import GameState, PromptBuilder, ActionValidator, LLMEngine

# ============================
# 测试辅助类
# ============================


class TestResult:
    """记录测试结果"""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.logs: list[str] = []

    def ok(self, msg: str):
        self.passed += 1
        self.logs.append(f"  ✅ {msg}")
        logger.info(f"✅ {msg}")

    def fail(self, msg: str):
        self.failed += 1
        self.logs.append(f"  ❌ {msg}")
        logger.error(f"❌ {msg}")

    def info(self, msg: str):
        self.logs.append(f"  ℹ️  {msg}")
        logger.info(f"ℹ️  {msg}")

    def summary(self) -> str:
        total = self.passed + self.failed
        lines = [
            f"\n{'=' * 60}",
            f"测试结果: {self.passed}/{total} 通过",
        ]
        if self.failed > 0:
            lines.append(f"失败用例:")
            for log in self.logs:
                if "❌" in log:
                    lines.append(log)
        lines.append(f"{'=' * 60}")
        return "\n".join(lines)


class EventWaiter:
    """等待特定事件的工具"""

    def __init__(self, sio: AsyncClient, event_name: str, timeout: float = 30.0):
        self.sio = sio
        self.event_name = event_name
        self.timeout = timeout
        self.future: asyncio.Future = asyncio.Future()
        self.data = None

        @sio.on(event_name)
        async def handler(data):
            self.data = data
            if not self.future.done():
                self.future.set_result(data)

    async def wait(self) -> Optional[dict]:
        try:
            await asyncio.wait_for(self.future, timeout=self.timeout)
            return self.data
        except asyncio.TimeoutError:
            return None


# ============================
# 阶段 1：连接与登录
# ============================


async def stage1_connect_login(result: TestResult):
    """测试连接和登录"""
    logger.info("=" * 60)
    logger.info("阶段 1：连接与登录")
    logger.info("=" * 60)

    sio = AsyncClient()
    connected = False

    @sio.on("connect")
    async def on_connect():
        nonlocal connected
        connected = True

    @sio.on("disconnect")
    async def on_disconnect():
        logger.warning("⚠️ 断开连接")

    try:
        # 1.1 连接
        logger.info(f"正在连接游戏服务器: {GAME_SERVER_URL}")
        await sio.connect(GAME_SERVER_URL, wait_timeout=10)

        if connected:
            result.ok("成功连接到游戏服务器")
        else:
            result.fail("连接失败：未触发 connect 事件")
            return

        # 1.2 登录
        ai_name = "AI-联调-1"
        user_id = f"int_test_{int(time.time())}"

        login_waiter = EventWaiter(sio, "player:loginSuccess", timeout=10)
        error_waiter = EventWaiter(sio, "player:loginError", timeout=10)

        await sio.emit("player:login", {"userId": user_id, "displayName": ai_name})
        logger.info(f"发送登录请求: {ai_name} ({user_id})")

        login_data = await login_waiter.wait()
        error_data = await error_waiter.wait()

        if error_data:
            result.fail(f"登录失败: {error_data.get('message')}")
            return

        if login_data:
            # 尝试多种可能的数据结构
            payload = login_data
            if isinstance(login_data, dict):
                if "payload" in login_data:
                    payload = login_data["payload"]
                elif "data" in login_data:
                    payload = login_data["data"]

            player_id = payload.get("playerId") or payload.get("id") or "未知"
            display_name = payload.get("displayName") or payload.get("name") or "未知"
            result.ok(f"登录成功: {display_name} (ID: {player_id})")
            result.info(f"完整响应: {json.dumps(login_data, ensure_ascii=False, indent=2)[:200]}")
        else:
            result.fail("登录超时：未收到 loginSuccess 事件")

    except Exception as e:
        result.fail(f"连接异常: {e}")
    finally:
        await sio.disconnect()


# ============================
# 阶段 2：匹配系统
# ============================


async def stage2_matchmaking(result: TestResult):
    """测试匹配系统"""
    logger.info("=" * 60)
    logger.info("阶段 2：匹配系统")
    logger.info("=" * 60)
    logger.info("⚠️  注意：此阶段需要其他玩家（或另一个 AI）同时在线")
    logger.info("   提示：可另开终端运行 run_multi_ai.py 启动多个 AI")

    sio = AsyncClient()
    connected = False
    player_id = None

    @sio.on("connect")
    async def on_connect():
        nonlocal connected
        connected = True

    try:
        # 2.1 连接 + 登录
        logger.info(f"正在连接游戏服务器: {GAME_SERVER_URL}")
        await sio.connect(GAME_SERVER_URL, wait_timeout=10)

        if not connected:
            result.fail("连接失败")
            return

        result.ok("成功连接到游戏服务器")

        # 登录
        ai_name = "AI-匹配测试"
        user_id = f"match_test_{int(time.time())}"

        login_waiter = EventWaiter(sio, "player:loginSuccess", timeout=10)
        await sio.emit("player:login", {"userId": user_id, "displayName": ai_name})

        login_data = await login_waiter.wait()
        if not login_data:
            result.fail("登录超时")
            return

        payload = login_data.get("payload", {})
        player_id = payload.get("playerId")
        result.ok(f"登录成功: {payload.get('displayName')} (ID: {player_id})")

        # 2.2 加入匹配队列
        logger.info("正在加入匹配队列（4 人快速匹配）...")

        queue_waiter = EventWaiter(sio, "match:queueJoined", timeout=10)
        await sio.emit("match:joinQueue", {"playerCount": 4, "quickMatch": True})

        queue_data = await queue_waiter.wait()
        if queue_data:
            q_payload = queue_data.get("payload", {})
            result.ok(
                f"成功加入匹配队列: 位置 {q_payload.get('position')}, "
                f"队列人数 {q_payload.get('totalInQueue')}"
            )
        else:
            result.fail("加入匹配队列超时")
            return

        # 2.3 等待匹配成功
        logger.info("等待匹配成功（超时 60 秒）...")
        logger.info("💡 如果没有其他玩家，可另开终端运行: uv run run_multi_ai.py")

        match_waiter = EventWaiter(sio, "match:found", timeout=60)
        match_data = await match_waiter.wait()

        if match_data:
            m_payload = match_data.get("payload", {})
            room_id = m_payload.get("roomId")
            room_code = m_payload.get("roomCode")
            players = m_payload.get("players", [])
            player_names = ", ".join(p.get("displayName", "?") for p in players)
            result.ok(f"匹配成功! 房间: {room_code} (ID: {room_id})")
            result.info(f"玩家: {player_names}")
        else:
            result.fail("匹配超时（60 秒）：未收到 match:found 事件")
            logger.info("提示：确保有其他玩家/AI 同时在线并加入匹配队列")

    except Exception as e:
        result.fail(f"匹配异常: {e}")
    finally:
        await sio.disconnect()


# ============================
# 阶段 3：完整游戏流程（Mock LLM）
# ============================


class MockLLMForIntegration:
    """为集成测试设计的 Mock LLM，返回预设的策略"""

    def __init__(self, state: GameState):
        self.state = state
        self.call_count = 0

    def think(self, prompt: str, max_retries: int = 3) -> Optional[dict]:
        self.call_count += 1
        logger.info(f"🤖 [Mock LLM] 第 {self.call_count} 次调用")
        logger.info(f"📝 Prompt 长度: {len(prompt)} 字符")

        # 简单策略：优先出牌，否则结束回合
        if self.state.my_hand:
            card = self.state.my_hand[0]
            action = {"action": "play_card", "card_uid": card["uid"]}
            logger.info(f"🎯 Mock 决策: play_card({card['uid']})")
            return action
        else:
            logger.info("🎯 Mock 决策: end_turn")
            return {"action": "end_turn"}


async def stage3_full_game(result: TestResult):
    """完整游戏流程测试（Mock LLM）"""
    logger.info("=" * 60)
    logger.info("阶段 3：完整游戏流程（Mock LLM）")
    logger.info("=" * 60)
    logger.info("⚠️  注意：此阶段需要其他玩家（或另一个 AI）同时在线")

    sio = AsyncClient()
    state = GameState()
    connected = False
    game_started = False
    game_ended = False
    actions_sent = 0
    actions_succeeded = 0

    # Mock LLM
    mock_llm = MockLLMForIntegration(state)
    validator = ActionValidator(state)

    # 操作映射
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

    async def think_and_act():
        """AI 思考并执行操作"""
        nonlocal actions_sent, actions_succeeded

        if not state.is_my_turn() and not state.has_pending_request():
            logger.debug("当前不需要操作")
            return

        logger.info("🤖 AI 正在思考...")

        # 构建 Prompt
        prompt = PromptBuilder.build(state)

        # 调用 Mock LLM
        decision = mock_llm.think(prompt)
        if not decision:
            logger.error("❌ Mock LLM 未能产生有效决策")
            await sio.emit("game:action", {"action": "endTurn", "payload": {}})
            actions_sent += 1
            return

        action = decision.get("action")
        if not action:
            logger.error(f"❌ Mock LLM 返回的内容缺少 action 字段")
            await sio.emit("game:action", {"action": "endTurn", "payload": {}})
            actions_sent += 1
            return

        # 预校验
        is_valid, error_msg = validator.validate(action, decision)
        if not is_valid:
            logger.warning(f"⚠️ AI 操作被拦截: {error_msg}")
            await sio.emit("game:action", {"action": "endTurn", "payload": {}})
            actions_sent += 1
            return

        # 映射到游戏操作
        action_type = ACTION_MAP.get(action)
        if not action_type:
            logger.error(f"❌ 未知操作: {action}")
            await sio.emit("game:action", {"action": "endTurn", "payload": {}})
            actions_sent += 1
            return

        param_map = PARAM_MAP.get(action, {})
        payload = {}
        for src_key, dst_key in param_map.items():
            if src_key in decision:
                payload[dst_key] = decision[src_key]

        logger.info(f"🎯 AI 决策: {action}({json.dumps(decision, ensure_ascii=False)})")
        await sio.emit("game:action", {"action": action_type, "payload": payload})
        actions_sent += 1

    @sio.on("connect")
    async def on_connect():
        nonlocal connected
        connected = True

    @sio.on("player:loginSuccess")
    async def on_login(data):
        payload = data.get("payload", {})
        state.my_player_id = payload.get("playerId")
        result.ok(f"登录成功: {payload.get('displayName')} (ID: {state.my_player_id})")

    @sio.on("match:found")
    async def on_match(data):
        payload = data.get("payload", {})
        state.room_id = payload.get("roomId")
        players = payload.get("players", [])
        player_names = ", ".join(p.get("displayName", "?") for p in players)
        result.ok(f"匹配成功! 玩家: {player_names}")

    @sio.on("room:gameStarting")
    async def on_game_start(data):
        nonlocal game_started
        payload = data.get("payload", {})
        game_state = payload.get("gameState", {})
        state.update_from_viewstate(game_state)
        game_started = True
        result.ok(f"游戏开始! 玩家数: {len(game_state.get('players', []))}")
        result.info(f"初始回合: {game_state.get('totalTurn', 0)}")

    @sio.on("game:fullSync")
    async def on_sync(data):
        payload = data.get("payload", {})
        view_state = payload.get("state", {})
        state.update_from_viewstate(view_state)
        logger.info(f"🔄 状态同步 (版本 {payload.get('version')})")

    @sio.on("game:turnStart")
    async def on_turn(data):
        payload = data.get("payload", {})
        state.turn_number = payload.get("turnNumber", state.turn_number)
        state.current_player_id = payload.get("currentPlayerId")
        state.turn_phase = payload.get("phase", state.turn_phase)
        logger.info(f"📍 回合 {state.turn_number}: {state.current_player_id} ({state.turn_phase})")

    @sio.on("game:phaseChange")
    async def on_phase(data):
        payload = data.get("payload", {})
        state.turn_phase = payload.get("newPhase", state.turn_phase)
        logger.info(f"🔄 阶段变更: {payload.get('oldPhase')} → {state.turn_phase}")

        if state.is_my_turn() and state.turn_phase == "actionPhase":
            await think_and_act()

    @sio.on("game:broadcastRequest")
    async def on_broadcast(data):
        logger.info("📡 收到广播请求!")
        await sio.emit("game:requestSync")
        await think_and_act()

    @sio.on("game:strikeMoveRequest")
    async def on_strike_move(data):
        logger.info("🚀 收到打击移动请求!")
        await sio.emit("game:requestSync")
        await think_and_act()

    @sio.on("game:playerAction")
    async def on_player_action(data):
        payload = data.get("payload", {})
        logger.info(f"🎯 玩家 {payload.get('playerId')} 执行: {payload.get('action')}")
        await sio.emit("game:requestSync")

    @sio.on("game:actionResult")
    async def on_action_result(data):
        nonlocal actions_succeeded
        payload = data.get("payload", {})
        if payload.get("success"):
            actions_succeeded += 1
            logger.info(f"✅ 操作成功: {payload.get('action')}")
        else:
            logger.error(f"❌ 操作失败: {payload.get('error')}")

    @sio.on("game:gameOver")
    async def on_game_over(data):
        nonlocal game_ended
        payload = data.get("payload", {})
        rankings = payload.get("rankings", [])
        game_ended = True

        result.ok("游戏结束!")
        for rank in rankings:
            result.info(
                f"  {rank['displayName']}: 第{rank['rank']}名 "
                f"{'(已淘汰)' if rank['eliminated'] else ''}"
            )

    try:
        # 3.1 连接
        logger.info(f"正在连接游戏服务器: {GAME_SERVER_URL}")
        await sio.connect(GAME_SERVER_URL, wait_timeout=10)

        if not connected:
            result.fail("连接失败")
            return

        result.ok("成功连接到游戏服务器")

        # 3.2 登录
        ai_name = "AI-集成测试"
        user_id = f"integration_{int(time.time())}"
        await sio.emit("player:login", {"userId": user_id, "displayName": ai_name})

        # 3.3 加入匹配
        queue_waiter = EventWaiter(sio, "match:queueJoined", timeout=10)
        await sio.emit("match:joinQueue", {"playerCount": 4, "quickMatch": True})
        await queue_waiter.wait()

        logger.info("等待匹配和游戏开始...")

        # 3.4 等待游戏结束或超时
        max_wait = 300  # 5 分钟
        start_time = time.time()

        while not game_ended and (time.time() - start_time) < max_wait:
            await asyncio.sleep(1)

        if not game_ended:
            result.fail(f"游戏未在 {max_wait} 秒内结束")
        else:
            result.ok(f"完整游戏流程完成! 共发送 {actions_sent} 次操作, {actions_succeeded} 次成功")

    except Exception as e:
        result.fail(f"游戏异常: {e}")
    finally:
        await sio.disconnect()


# ============================
# 阶段 4：真实 LLM 对局
# ============================


async def stage4_real_llm(result: TestResult):
    """使用真实 LLM 跑完整对局"""
    logger.info("=" * 60)
    logger.info("阶段 4：真实 LLM 对局")
    logger.info("=" * 60)
    logger.info(f"LLM 服务: {LLM_BASE_URL}")
    logger.info(f"LLM 模型: {LLM_MODEL or '(自动发现)'}")

    sio = AsyncClient()
    state = GameState()
    connected = False
    game_started = False
    game_ended = False
    actions_sent = 0
    actions_succeeded = 0
    llm_total_time = 0.0
    llm_call_count = 0

    # 真实 LLM 引擎
    llm_engine = LLMEngine(
        base_url=LLM_BASE_URL,
        api_key=LLM_API_KEY,
        model=LLM_MODEL,
    )
    validator = ActionValidator(state)

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

    async def think_and_act():
        nonlocal actions_sent, llm_total_time, llm_call_count

        if not state.is_my_turn() and not state.has_pending_request():
            return

        logger.info("🤖 AI 正在思考...")
        prompt = PromptBuilder.build(state)

        llm_start = time.time()
        decision = llm_engine.think(prompt)
        llm_elapsed = time.time() - llm_start
        llm_total_time += llm_elapsed
        llm_call_count += 1

        logger.info(f"⏱️  LLM 响应时间: {llm_elapsed:.2f}秒")

        if not decision:
            logger.error("❌ LLM 未能产生有效决策")
            await sio.emit("game:action", {"action": "endTurn", "payload": {}})
            actions_sent += 1
            return

        action = decision.get("action")
        if not action:
            logger.error(f"❌ LLM 返回的内容缺少 action 字段")
            await sio.emit("game:action", {"action": "endTurn", "payload": {}})
            actions_sent += 1
            return

        is_valid, error_msg = validator.validate(action, decision)
        if not is_valid:
            logger.warning(f"⚠️ AI 操作被拦截: {error_msg}")
            await sio.emit("game:action", {"action": "endTurn", "payload": {}})
            actions_sent += 1
            return

        action_type = ACTION_MAP.get(action)
        if not action_type:
            logger.error(f"❌ 未知操作: {action}")
            await sio.emit("game:action", {"action": "endTurn", "payload": {}})
            actions_sent += 1
            return

        param_map = PARAM_MAP.get(action, {})
        payload = {}
        for src_key, dst_key in param_map.items():
            if src_key in decision:
                payload[dst_key] = decision[src_key]

        logger.info(f"🎯 AI 决策: {action}({json.dumps(decision, ensure_ascii=False)})")
        await sio.emit("game:action", {"action": action_type, "payload": payload})
        actions_sent += 1

    @sio.on("connect")
    async def on_connect():
        nonlocal connected
        connected = True

    @sio.on("player:loginSuccess")
    async def on_login(data):
        payload = data.get("payload", {})
        state.my_player_id = payload.get("playerId")
        result.ok(f"登录成功: {payload.get('displayName')} (ID: {state.my_player_id})")

    @sio.on("match:found")
    async def on_match(data):
        payload = data.get("payload", {})
        state.room_id = payload.get("roomId")
        result.ok(f"匹配成功! 房间: {payload.get('roomCode')}")

    @sio.on("room:gameStarting")
    async def on_game_start(data):
        nonlocal game_started
        payload = data.get("payload", {})
        state.update_from_viewstate(payload.get("gameState", {}))
        game_started = True
        result.ok("游戏开始!")

    @sio.on("game:fullSync")
    async def on_sync(data):
        payload = data.get("payload", {})
        state.update_from_viewstate(payload.get("state", {}))

    @sio.on("game:turnStart")
    async def on_turn(data):
        payload = data.get("payload", {})
        state.turn_number = payload.get("turnNumber", state.turn_number)
        state.current_player_id = payload.get("currentPlayerId")
        state.turn_phase = payload.get("phase", state.turn_phase)
        logger.info(f"📍 回合 {state.turn_number}: {state.current_player_id} ({state.turn_phase})")

    @sio.on("game:phaseChange")
    async def on_phase(data):
        payload = data.get("payload", {})
        state.turn_phase = payload.get("newPhase", state.turn_phase)
        if state.is_my_turn() and state.turn_phase == "actionPhase":
            await think_and_act()

    @sio.on("game:broadcastRequest")
    async def on_broadcast(data):
        await sio.emit("game:requestSync")
        await think_and_act()

    @sio.on("game:strikeMoveRequest")
    async def on_strike_move(data):
        await sio.emit("game:requestSync")
        await think_and_act()

    @sio.on("game:playerAction")
    async def on_player_action(data):
        await sio.emit("game:requestSync")

    @sio.on("game:actionResult")
    async def on_action_result(data):
        nonlocal actions_succeeded
        payload = data.get("payload", {})
        if payload.get("success"):
            actions_succeeded += 1
        else:
            logger.error(f"❌ 操作失败: {payload.get('error')}")

    @sio.on("game:gameOver")
    async def on_game_over(data):
        nonlocal game_ended
        payload = data.get("payload", {})
        rankings = payload.get("rankings", [])
        game_ended = True
        result.ok("游戏结束!")
        for rank in rankings:
            result.info(f"  {rank['displayName']}: 第{rank['rank']}名")

    try:
        await sio.connect(GAME_SERVER_URL, wait_timeout=10)
        if not connected:
            result.fail("连接失败")
            return

        ai_name = os.getenv("AI_PLAYER_NAME", "AI-文明")
        user_id = f"ai_real_{int(time.time())}"
        await sio.emit("player:login", {"userId": user_id, "displayName": ai_name})

        queue_waiter = EventWaiter(sio, "match:queueJoined", timeout=10)
        await sio.emit("match:joinQueue", {"playerCount": 4, "quickMatch": True})
        await queue_waiter.wait()

        logger.info("等待匹配和游戏开始...")
        max_wait = 600  # 10 分钟
        start_time = time.time()

        while not game_ended and (time.time() - start_time) < max_wait:
            await asyncio.sleep(1)

        if not game_ended:
            result.fail(f"游戏未在 {max_wait} 秒内结束")
        else:
            result.ok(f"完整对局完成! 发送 {actions_sent} 次操作, {actions_succeeded} 次成功")
            if llm_call_count > 0:
                avg_time = llm_total_time / llm_call_count
                result.info(f"LLM 统计: {llm_call_count} 次调用, 总耗时 {llm_total_time:.1f}s, 平均 {avg_time:.2f}s")

    except Exception as e:
        result.fail(f"对局异常: {e}")
    finally:
        await sio.disconnect()


# ============================
# 入口
# ============================


def main():
    parser = argparse.ArgumentParser(description="黑暗森林 AI Agent 联调测试")
    parser.add_argument(
        "--stage",
        type=int,
        choices=[1, 2, 3, 4],
        default=1,
        help="测试阶段: 1=连接登录, 2=匹配系统, 3=完整游戏(Mock LLM), 4=真实LLM对局",
    )
    args = parser.parse_args()

    result = TestResult()

    logger.info(f"🌌 黑暗森林联调测试 - 阶段 {args.stage}")
    logger.info(f"游戏服务器: {GAME_SERVER_URL}")

    if args.stage == 1:
        asyncio.run(stage1_connect_login(result))
    elif args.stage == 2:
        asyncio.run(stage2_matchmaking(result))
    elif args.stage == 3:
        asyncio.run(stage3_full_game(result))
    elif args.stage == 4:
        asyncio.run(stage4_real_llm(result))

    print(result.summary())
    sys.exit(1 if result.failed > 0 else 0)


if __name__ == "__main__":
    main()
