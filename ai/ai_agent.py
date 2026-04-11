"""
黑暗森林 AI Agent 适配器
=========================
让 AI 通过 WebSocket 接入游戏服务器，与真人玩家对战。

适配 nanobot API 限制：
- 不支持 system 角色 → 所有指令合并到单条 user 消息
- 不支持 Tool Calling → 约定 AI 返回 JSON 格式指令
- 不支持流式输出

架构：
  游戏服务器 <--Socket.IO--> AI 适配器 <--nanobot API--> nanobot
"""

import asyncio
import json
import logging
import os
import re
import time
from typing import Optional

from dotenv import load_dotenv
from openai import OpenAI
from socketio import AsyncClient

# 加载环境变量
load_dotenv()

# ============================
# 配置
# ============================

GAME_SERVER_URL = os.getenv("GAME_SERVER_URL", "http://localhost:3003")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://127.0.0.1:8900/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "dummy")
LLM_MODEL = os.getenv("LLM_MODEL", "")  # 留空则自动从 /v1/models 获取
AI_PLAYER_NAME = os.getenv("AI_PLAYER_NAME", "AI-文明")
SESSION_ID = os.getenv("SESSION_ID", "darkforest-ai")

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("darkforest-ai")

# ============================
# 本地状态缓存
# ============================


class GameState:
    """维护 AI 玩家视角的本地状态缓存"""

    def __init__(self):
        self.my_player_id: Optional[str] = None
        self.room_id: Optional[str] = None
        self.turn_number: int = 0
        self.turn_phase: str = "turnBegin"
        self.current_player_id: Optional[str] = None

        # 我的信息
        self.my_position: int = -1
        self.my_energy: int = 0
        self.my_hand: list[dict] = []       # [{uid, defId, name, type, ...}]
        self.my_face_up: list[dict] = []    # 场上明牌

        # 其他玩家（视角过滤后）
        self.opponents: list[dict] = []     # [{id, name, handCount, position, energy, eliminated}]

        # 飞行打击
        self.flying_strikes: list[dict] = []  # [{uid, ownerId, position, targetSystem, level, speed, arrived}]

        # 广播状态
        self.broadcast_state: Optional[dict] = None

        # 待处理操作
        self.pending_action: Optional[dict] = None

        # 游戏日志（最近 N 条用于上下文）
        self.recent_logs: list[str] = []

    def update_from_viewstate(self, view_state: dict):
        """从 ViewState 更新本地状态"""
        # 基础信息
        self.turn_number = view_state.get("totalTurn", self.turn_number)
        self.turn_phase = view_state.get("turnPhase", self.turn_phase)
        self.current_player_id = view_state.get("currentPlayerId")

        players = view_state.get("players", [])
        for p in players:
            if p["id"] == self.my_player_id:
                self.my_position = p.get("position", self.my_position)
                self.my_energy = p.get("energy", self.my_energy)
                self.my_hand = p.get("hand", [])
                self.my_face_up = p.get("faceUpCards", [])
            else:
                # 更新或添加对手
                existing = next((o for o in self.opponents if o["id"] == p["id"]), None)
                opp_data = {
                    "id": p["id"],
                    "name": p.get("name", "未知"),
                    "handCount": len(p.get("hand", [])),
                    "position": p.get("position", -1),
                    "energy": p.get("energy", 0),
                    "eliminated": p.get("eliminated", False),
                }
                if existing:
                    existing.update(opp_data)
                else:
                    self.opponents.append(opp_data)

        self.flying_strikes = view_state.get("flyingStrikes", [])
        self.broadcast_state = view_state.get("broadcast")
        self.pending_action = view_state.get("pendingAction")

        # 更新日志（保留最近 20 条）
        logs = view_state.get("logs", [])
        self.recent_logs = [log["message"] for log in logs[-20:]]

    def is_my_turn(self) -> bool:
        """判断是否轮到我操作"""
        return self.current_player_id == self.my_player_id and self.turn_phase == "actionPhase"

    def has_pending_request(self) -> bool:
        """是否有待响应的请求（广播回应、打击移动等）"""
        return self.pending_action is not None


# ============================
# DSL Prompt 翻译器
# ============================


class PromptBuilder:
    """将 GameState 翻译成 DSL 格式 Prompt（单条 user 消息）"""

    @staticmethod
    def build(state: GameState) -> str:
        """构建完整的 DSL Prompt"""
        parts = []

        # === 系统指令（合并到 user 消息头部）===
        parts.append("""\
你是黑暗森林桌游的 AI 玩家。游戏基于《三体》黑暗森林理论：文明之间互相隐藏位置，通过广播、打击、防御和设施建设进行博弈。

你必须以 JSON 格式返回你的操作指令。格式如下：
{
  "action": "操作名",
  ...其他参数
}

可用操作：
- play_card: {"action": "play_card", "card_uid": "牌UID", "target_system": 星系编号(可选), "target_player_id": "玩家ID(可选)"}
- move_strike: {"action": "move_strike", "strike_uid": "打击UID", "target_system": 目标星系}
- respond_broadcast: {"action": "respond_broadcast", "agreed": true/false, "card_uid": "牌UID(可选)"}
- announce_strike: {"action": "announce_strike", "strike_uid": "打击UID"}
- skip_announce: {"action": "skip_announce", "strike_uid": "打击UID"}
- recycle_card: {"action": "recycle_card", "card_uid": "牌UID"}
- use_lightspeed_ship: {"action": "use_lightspeed_ship", "target_system": 目标星系}
- end_turn: {"action": "end_turn"}

重要规则：
1. 只能从你的手牌中出牌
2. 不要捏造不存在的牌或操作
3. 只返回 JSON，不要返回其他内容
""")

        # === 游戏状态 ===
        parts.append("[游戏状态]")
        parts.append(f"回合数: {state.turn_number}")
        parts.append(f"当前阶段: {state.turn_phase}")
        parts.append(f"当前玩家: {state.current_player_id}")
        parts.append(f"你的位置: 星系{state.my_position}")
        parts.append(f"你的能量: {state.my_energy}")

        # 手牌
        hand_desc = ", ".join(
            f"{c['uid']}({c['name']},消耗{c.get('energy', 0)})"
            for c in state.my_hand
        )
        parts.append(f"\n你的手牌({len(state.my_hand)}张): [{hand_desc}]")

        # 场上明牌
        if state.my_face_up:
            faceup_desc = ", ".join(
                f"{c['uid']}({c['name']})" for c in state.my_face_up
            )
            parts.append(f"\n你的场上明牌: [{faceup_desc}]")
        else:
            parts.append("\n你的场上明牌: []")

        # 其他玩家
        opp_parts = []
        for opp in state.opponents:
            pos_str = f"星系{opp['position']}" if opp["position"] > 0 else "位置隐藏"
            elim_str = "(已淘汰)" if opp["eliminated"] else ""
            opp_parts.append(
                f"{opp['name']}: {opp['handCount']}张牌,{pos_str},能量{opp['energy']}{elim_str}"
            )
        parts.append(f"\n其他玩家: {'; '.join(opp_parts)}")

        # 飞行打击
        if state.flying_strikes:
            strike_parts = []
            for s in state.flying_strikes:
                strike_parts.append(
                    f"{s['uid']}({s['ownerId']}发射,星系{s['position']}→星系{s['targetSystem']},"
                    f"等级{s['level']},速度{s['speed']},{'已到达' if s['arrived'] else '飞行中'})"
                )
            parts.append(f"\n飞行打击: [{', '.join(strike_parts)}]")
        else:
            parts.append("\n飞行打击: []")

        # 广播状态
        if state.broadcast_state and state.broadcast_state.get("active"):
            bs = state.broadcast_state
            parts.append(
                f"\n广播中: {bs['broadcasterId']} 在星系{bs['targetSystem']} 发起广播"
                f"(范围{bs['range']},类型{bs['subtype']},阶段{bs['phase']})"
            )

        # 最近日志
        if state.recent_logs:
            parts.append("\n[最近事件]")
            for log in state.recent_logs[-5:]:
                parts.append(f"- {log}")

        # === 可用动作（根据当前阶段动态生成）===
        parts.append("\n[可用动作]")
        if state.turn_phase == "actionPhase" and state.is_my_turn():
            parts.append("play_card - 打出手牌")
            parts.append("end_turn - 结束回合")
            if state.flying_strikes:
                parts.append("move_strike - 移动飞行打击")
        elif state.has_pending_request():
            pending = state.pending_action
            if pending:
                pending_type = pending.get("type")
                if pending_type == "broadcastResponse":
                    parts.append("respond_broadcast - 回应广播")
                elif pending_type == "strikeMove":
                    valid_moves = pending.get("validMoves", [])
                    parts.append(f"move_strike - 移动打击(可选目标: {valid_moves})")
                elif pending_type == "announceStrike":
                    parts.append("announce_strike - 宣布打击生效")
                    parts.append("skip_announce - 跳过宣布(延迟)")
                elif pending_type == "recycleCard":
                    parts.append("recycle_card - 回收门牌")
                elif pending_type == "lightspeedEscape":
                    parts.append("use_lightspeed_ship - 光速飞船逃逸")

        parts.append("\n请返回 JSON 格式的操作指令。")

        return "\n".join(parts)


# ============================
# LLM 推理引擎（适配 nanobot）
# ============================


class LLMEngine:
    """与 nanobot 交互，通过 JSON 格式约定获取决策"""

    def __init__(self, base_url: str, api_key: str, model: str):
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model = model
        self._auto_discover_model()

    def _auto_discover_model(self):
        """自动查询可用模型（如果未指定）"""
        if self.model:
            return

        try:
            models = self.client.models.list()
            if models.data:
                self.model = models.data[0].id
                logger.info(f"自动选择模型: {self.model}")
            else:
                logger.error("未找到可用模型，请手动配置 LLM_MODEL")
        except Exception as e:
            logger.error(f"查询模型失败: {e}")

    def think(
        self,
        prompt: str,
        max_retries: int = 3,
    ) -> Optional[dict]:
        """
        向 nanobot 请求决策，解析返回的 JSON。
        如果格式错误，自动重试。
        """
        messages = [{"role": "user", "content": prompt}]

        for attempt in range(max_retries):
            try:
                start_time = time.time()
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    extra_body={"session_id": SESSION_ID},
                    max_tokens=1000,
                )
                elapsed = time.time() - start_time
                logger.info(f"LLM 响应时间: {elapsed:.2f}秒")

                content = response.choices[0].message.content
                if not content:
                    logger.warning(f"LLM 返回空内容 (尝试 {attempt + 1}/{max_retries})")
                    continue

                logger.debug(f"LLM 原始回复: {content[:200]}")

                # 尝试解析 JSON
                result = self._parse_json(content)
                if result:
                    return result

                # 解析失败 → 提示重试
                logger.warning(f"JSON 解析失败 (尝试 {attempt + 1}/{max_retries})")
                messages.append({"role": "user", "content": "你返回的内容不是有效的 JSON。请只返回 JSON 格式，不要返回其他内容。"})

            except Exception as e:
                logger.error(f"LLM 请求失败 (尝试 {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(1)

        return None

    @staticmethod
    def _parse_json(content: str) -> Optional[dict]:
        """从 AI 回复中提取并解析 JSON"""
        # 尝试直接解析
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 代码块
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # 尝试找到第一个 { 到最后一个 }
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1:
            try:
                return json.loads(content[start:end+1])
            except json.JSONDecodeError:
                pass

        return None


# ============================
# 预校验器
# ============================


class ActionValidator:
    """在发送给服务器前，验证 AI 的操作是否合法"""

    def __init__(self, state: GameState):
        self.state = state

    def validate(self, action: str, params: dict) -> tuple[bool, Optional[str]]:
        """
        验证操作合法性。
        返回 (是否合法, 错误信息)
        """
        if action == "play_card":
            card_uid = params.get("card_uid")
            if not card_uid:
                return False, "缺少 card_uid 参数"

            hand_uids = [c["uid"] for c in self.state.my_hand]
            if card_uid not in hand_uids:
                return False, f"你的手牌中没有 {card_uid}。你的手牌: {hand_uids}"

        elif action == "move_strike":
            strike_uid = params.get("strike_uid")
            if not strike_uid:
                return False, "缺少 strike_uid 参数"

            my_strikes = [s for s in self.state.flying_strikes if s["ownerId"] == self.state.my_player_id]
            if strike_uid not in [s["uid"] for s in my_strikes]:
                return False, f"你没有名为 {strike_uid} 的飞行打击牌"

            target = params.get("target_system")
            if target is None:
                return False, "缺少 target_system 参数"

        elif action == "respond_broadcast":
            if not self.state.broadcast_state or not self.state.broadcast_state.get("active"):
                return False, "当前没有活跃的广播需要回应"
            if "agreed" not in params:
                return False, "缺少 agreed 参数"

        elif action == "announce_strike":
            strike_uid = params.get("strike_uid")
            if not strike_uid:
                return False, "缺少 strike_uid 参数"

            strike = next((s for s in self.state.flying_strikes if s["uid"] == strike_uid), None)
            if not strike:
                return False, f"找不到打击牌 {strike_uid}"
            if not strike.get("arrived"):
                return False, f"打击牌 {strike_uid} 尚未到达目标"

        elif action == "skip_announce":
            if not params.get("strike_uid"):
                return False, "缺少 strike_uid 参数"

        elif action == "recycle_card":
            card_uid = params.get("card_uid")
            if not card_uid:
                return False, "缺少 card_uid 参数"

            faceup_uids = [c["uid"] for c in self.state.my_face_up]
            if card_uid not in faceup_uids:
                return False, f"你的场上没有 {card_uid} 这张牌"

        elif action == "use_lightspeed_ship":
            target = params.get("target_system")
            if target is None:
                return False, "缺少 target_system 参数"
            if not (1 <= target <= 9):
                return False, f"目标星系 {target} 无效，必须是 1-9"

        elif action == "end_turn":
            pass  # 结束回合总是合法

        else:
            return False, f"未知操作: {action}"

        return True, None


# ============================
# AI Agent 主类
# ============================


class AIAgent:
    """AI Agent 主控制器"""

    # 操作名映射到 ActionType
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
        )
        self.validator = ActionValidator(self.state)
        self.sio = AsyncClient()
        self._setup_event_handlers()

    def _setup_event_handlers(self):
        """设置 Socket.IO 事件处理器"""

        @self.sio.on("connect")
        async def on_connect():
            logger.info("✅ 已连接到游戏服务器")

        @self.sio.on("disconnect")
        async def on_disconnect():
            logger.warning("⚠️ 与游戏服务器断开连接")

        @self.sio.on("player:loginSuccess")
        async def on_login_success(data):
            payload = data.get("payload", {})
            self.state.my_player_id = payload.get("playerId")
            logger.info(f"🎮 登录成功! 玩家 ID: {self.state.my_player_id}")

        @self.sio.on("match:found")
        async def on_match_found(data):
            payload = data.get("payload", {})
            self.state.room_id = payload.get("roomId")
            logger.info(f"🏠 匹配成功! 房间: {self.state.room_id}")

        @self.sio.on("room:gameStarting")
        async def on_game_starting(data):
            payload = data.get("payload", {})
            game_state = payload.get("gameState", {})
            self.state.update_from_viewstate(game_state)
            logger.info("🚀 游戏开始!")

        @self.sio.on("game:fullSync")
        async def on_full_sync(data):
            payload = data.get("payload", {})
            view_state = payload.get("state", {})
            self.state.update_from_viewstate(view_state)
            logger.info(f"🔄 全量同步 (版本 {payload.get('version')})")

        @self.sio.on("game:deltaSync")
        async def on_delta_sync(data):
            logger.info("🔄 增量同步收到，请求全量同步...")
            await self.sio.emit("game:requestSync")

        @self.sio.on("game:turnStart")
        async def on_turn_start(data):
            payload = data.get("payload", {})
            self.state.turn_number = payload.get("turnNumber", self.state.turn_number)
            self.state.current_player_id = payload.get("currentPlayerId")
            self.state.turn_phase = payload.get("phase", self.state.turn_phase)
            logger.info(
                f"📍 回合 {self.state.turn_number} 开始: {self.state.current_player_id} ({self.state.turn_phase})"
            )

        @self.sio.on("game:phaseChange")
        async def on_phase_change(data):
            payload = data.get("payload", {})
            self.state.turn_phase = payload.get("newPhase", self.state.turn_phase)
            logger.info(f"🔄 阶段变更: {payload.get('oldPhase')} → {self.state.turn_phase}")

            if self.state.is_my_turn() and self.state.turn_phase == "actionPhase":
                await self.think_and_act()

        @self.sio.on("game:broadcastRequest")
        async def on_broadcast_request(data):
            logger.info("📡 收到广播请求!")
            await self.sio.emit("game:requestSync")
            await self.think_and_act()

        @self.sio.on("game:strikeMoveRequest")
        async def on_strike_move_request(data):
            logger.info("🚀 收到打击移动请求!")
            await self.sio.emit("game:requestSync")
            await self.think_and_act()

        @self.sio.on("game:playerAction")
        async def on_player_action(data):
            payload = data.get("payload", {})
            action = payload.get("action", "")
            player_id = payload.get("playerId", "")
            logger.info(f"🎯 玩家 {player_id} 执行操作: {action}")
            await self.sio.emit("game:requestSync")

        @self.sio.on("game:actionResult")
        async def on_action_result(data):
            payload = data.get("payload", {})
            if payload.get("success"):
                logger.info(f"✅ 操作成功: {payload.get('action')}")
            else:
                logger.error(f"❌ 操作失败: {payload.get('error')}")

        @self.sio.on("game:gameOver")
        async def on_game_over(data):
            payload = data.get("payload", {})
            winner_id = payload.get("winnerId")
            rankings = payload.get("rankings", [])
            logger.info(f"🏆 游戏结束! 获胜者: {winner_id}")
            for rank in rankings:
                logger.info(f"  {rank['displayName']}: 第{rank['rank']}名")

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
            await self._send_action("endTurn", {})
            return

        action = result.get("action")
        if not action:
            logger.error(f"❌ LLM 返回的内容缺少 action 字段: {result}")
            await self._send_action("endTurn", {})
            return

        # 预校验
        is_valid, error_msg = self.validator.validate(action, result)
        if not is_valid:
            logger.warning(f"⚠️ AI 操作被拦截: {error_msg}")
            await self._send_action("endTurn", {})
            return

        # 映射到游戏操作
        action_type = self.ACTION_MAP.get(action)
        if not action_type:
            logger.error(f"❌ 未知操作: {action}")
            await self._send_action("endTurn", {})
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
        await self.sio.emit(
            "game:action",
            {"action": action_type, "payload": payload},
        )
        logger.info(f"📤 发送操作: {action_type}({payload})")

    async def run(self):
        """运行 AI Agent"""
        logger.info(f"🌌 黑暗森林 AI Agent 启动")
        logger.info(f"  游戏服务器: {GAME_SERVER_URL}")
        logger.info(f"  LLM 服务: {LLM_BASE_URL}")
        logger.info(f"  LLM 模型: {self.llm.model or '(自动发现)'}")
        logger.info(f"  AI 玩家名称: {AI_PLAYER_NAME}")

        # 连接服务器
        await self.sio.connect(GAME_SERVER_URL)

        # 登录
        import random
        user_id = f"ai_{random.randint(1000, 9999)}"
        await self.sio.emit(
            "player:login",
            {"userId": user_id, "displayName": AI_PLAYER_NAME},
        )
        logger.info(f"🔑 尝试登录: {AI_PLAYER_NAME} ({user_id})")

        # 保持连接
        try:
            await self.sio.wait()
        except KeyboardInterrupt:
            logger.info("👋 AI Agent 退出")
            await self.sio.disconnect()


# ============================
# 入口
# ============================

async def main():
    agent = AIAgent()
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
