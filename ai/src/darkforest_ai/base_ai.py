"""
AI 玩家基类
===========
AIAgent 和 AIPlayer 的共享基类，封装通用的游戏逻辑。
"""

from abc import abstractmethod
from typing import Optional

from socketio import AsyncClient


from darkforest_ai.state import GameState
from darkforest_ai.validator import ActionValidator


class AIBase:
    """AI 玩家基类，封装通用的游戏逻辑和状态管理"""

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
        "end_turn": {},
    }

    def __init__(self):
        self.state = GameState()
        self.validator = ActionValidator(self.state)
        self.sio: AsyncClient = AsyncClient()

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

    async def think_and_act(self):
        """AI 思考并执行操作 - 模板方法，子类通过 _get_llm_decision 提供 LLM 决策"""
        if not self.state.is_my_turn() and not self.state.has_pending_request():
            return

        decision = await self._get_llm_decision()
        if not decision:
            self._log_warning("LLM 未能产生有效决策，发送 endTurn")
            await self._send_action("endTurn", {})
            return

        action = decision.get("action")
        if not action:
            self._log_warning("LLM 返回的内容缺少 action 字段，发送 endTurn")
            await self._send_action("endTurn", {})
            return

        is_valid, error_msg = self.validator.validate(action, decision)
        if not is_valid:
            self._log_warning(f"AI 操作被拦截: {error_msg}，发送 endTurn")
            await self._send_action("endTurn", {})
            return

        action_type = self.ACTION_MAP.get(action)
        if not action_type:
            self._log_warning(f"未知操作: {action}，发送 endTurn")
            await self._send_action("endTurn", {})
            return

        payload = self._map_params(action, decision)
        await self._send_action(action_type, payload)

    @abstractmethod
    async def _get_llm_decision(self) -> Optional[dict]:
        """获取 LLM 决策 - 子类必须实现"""
        pass

    @abstractmethod
    def _log_info(self, msg: str):
        """记录信息日志 - 子类必须实现"""
        pass

    @abstractmethod
    def _log_warning(self, msg: str):
        """记录警告日志 - 子类必须实现"""
        pass

    @abstractmethod
    def _log_error(self, msg: str):
        """记录错误日志 - 子类必须实现"""
        pass
