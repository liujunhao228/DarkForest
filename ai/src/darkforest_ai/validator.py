"""
操作预校验器
============
在发送给服务器前，验证 AI 的操作是否合法。
"""

from typing import Optional

from darkforest_ai.state import GameState


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
