"""
游戏状态管理
============
维护 AI 玩家视角的本地状态缓存。
"""

from typing import Optional


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
