"""
DSL Prompt 翻译器
=================
将 GameState 翻译成 DSL 格式 Prompt（单条 user 消息）。
"""

from darkforest_ai.state import GameState


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
