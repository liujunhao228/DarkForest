"""DarkForest 策略脚本 s1/v1：保守型基准策略。

基于 rules/templates/basic.py 骨架改造。
策略特点：
- 优先处理强制挂起动作（pendingAction）和广播（broadcastAction）
- 自由动作优先级：broadcast > strike > deploy_card > play_card > recycle_card > end_turn
- 基础能量管理：不够能量则跳过该动作
- 记录跨回合状态（对手行为、已见卡牌）
"""

from autonomous_driver.decide import GameAction


class ScriptDecider:
    """保守型基准策略。"""

    def __init__(self) -> None:
        self.state: dict = {
            "turns": 0,
            "my_color": None,
            "seen_cards": {},       # card_name -> count
            "opponent_patterns": [], # list of observed opponent actions
            "last_action": None,
            "energy_history": [],
        }

    def reset(self) -> None:
        """局前重置（driver 每局开始调用）。"""
        self.state = {
            "turns": 0,
            "my_color": None,
            "seen_cards": {},
            "opponent_patterns": [],
            "last_action": None,
            "energy_history": [],
        }

    def decide(self, view: dict, affordance: dict) -> GameAction:
        self.state["turns"] += 1

        # 1) 强制挂起动作优先
        pending = affordance.get("pendingAction")
        if pending:
            return self._resolve_pending(pending)

        # 2) 广播待处理（非己方回合也要回应）
        broadcast = affordance.get("broadcastAction")
        if broadcast:
            return self._resolve_broadcast(broadcast)

        # 3) 更新状态
        self._update_state(view)

        # 4) 自由动作
        return self._pick_free(affordance.get("legalActions") or [], view)

    # --- 状态更新 ---

    def _update_state(self, view: dict) -> None:
        """从 view 提取并记录跨回合信息。"""
        agent = view.get("agentView") or {}
        self_snap = agent.get("self") or {}

        # 记录颜色
        color = self_snap.get("color")
        if color and self.state["my_color"] is None:
            self.state["my_color"] = color

        # 记录能量历史
        energy = self_snap.get("energy")
        if isinstance(energy, int):
            self.state["energy_history"].append(energy)

        # 记录手牌和面朝上卡牌
        hand = self_snap.get("hand") or []
        face_up = self_snap.get("faceUpCards") or []
        for card in hand + face_up:
            if isinstance(card, dict):
                name = card.get("name") or card.get("cardName") or str(card.get("uid", ""))
            else:
                name = str(card)
            self.state["seen_cards"][name] = self.state["seen_cards"].get(name, 0) + 1

        # 记录事件中的对手信息
        events = agent.get("events") or {}
        entries = events.get("entries") or []
        for entry in entries:
            if isinstance(entry, dict):
                msg = str(entry.get("message", ""))
                if "对手" in msg or "opponent" in msg.lower():
                    self.state["opponent_patterns"].append(msg)

    # --- 强制挂起动作 ---

    def _resolve_pending(self, pending: dict) -> GameAction:
        options = [str(o) for o in (pending.get("legalOptions") or [])]
        targets = pending.get("legalTargets") or []
        # 保守选项优先：skip/discard 类无需目标，不会卡死
        skip = ("skip_select", "skip_move", "skip_announce", "skip_missed", "discard_missed")
        for opt in options:
            if opt in skip:
                return GameAction("resolve_strike_action", {"option": opt})
        # 其余选项：move/select 等需要 strikeUid（可带 targetSystem）
        if options:
            args: dict = {"option": options[0]}
            for t in targets:
                if t.get("type") == "strikeUid":
                    args["strike_uid"] = str(t["value"])
                elif t.get("type") == "systemId":
                    args["target_system"] = int(t["value"])
            return GameAction("resolve_strike_action", args)
        # 无选项：兜底结束回合防卡死
        return GameAction("end_turn")

    # --- 广播待处理 ---

    def _resolve_broadcast(self, broadcast: dict) -> GameAction:
        btype = broadcast.get("type")
        targets = broadcast.get("legalTargets") or []
        if btype == "agreeOrRefuse":
            # agreed=True 需传自己的广播卡 card_uid；无卡则伪装拒绝
            for t in targets:
                if t.get("type") == "cardUid":
                    return GameAction("respond_broadcast", {"agreed": True, "card_uid": str(t["value"])})
            return GameAction("respond_broadcast", {"agreed": False})
        if btype == "selectResponder":
            for t in targets:
                if t.get("type") == "playerId":
                    return GameAction("select_broadcast_responder", {"responder_player_id": str(t["value"])})
        if btype == "cancel":
            return GameAction("cancel_broadcast")
        return GameAction("end_turn")

    # --- 自由动作策略 ---

    def _pick_free(self, legal: list, view: dict) -> GameAction:
        energy = _my_energy(view)

        # 策略：根据能量和手牌情况选择最优动作
        # 高能量时优先进攻（broadcast/strike），低能量时部署/出牌

        # 1) 广播：最具威胁的动作，能量允许时优先
        if energy >= 0:  # broadcast 通常 0 能量
            broadcast_opt = self._find_legal(legal, "broadcast")
            if broadcast_opt:
                return self._build_free("broadcast", broadcast_opt)

        # 2) 打击：消耗能量但能直接攻击对手
        if energy >= 3:
            strike_opt = self._find_legal(legal, "strike")
            if strike_opt:
                return self._build_free("strike", strike_opt)

        # 3) 部署：面朝上部署卡牌
        if energy >= 2:
            deploy_opt = self._find_legal(legal, "deploy_card")
            if deploy_opt:
                return self._build_free("deploy_card", deploy_opt)

        # 4) 出牌：从手牌打出
        if energy >= 1:
            play_opt = self._find_legal(legal, "play_card")
            if play_opt:
                return self._build_free("play_card", play_opt)

        # 5) 回收：回收面朝上卡牌（通常 0 能量）
        recycle_opt = self._find_legal(legal, "recycle_card")
        if recycle_opt:
            return self._build_free("recycle_card", recycle_opt)

        # 兜底：结束回合
        return GameAction("end_turn")

    def _find_legal(self, legal: list, action_name: str) -> dict | None:
        """从 legalActions 中查找指定动作名的第一个可用选项。"""
        for opt in legal:
            if opt.get("action") == action_name:
                return opt
        return None

    def _build_free(self, name: str, opt: dict) -> GameAction:
        """从 legalActions 选项构建 GameAction。"""
        if name == "end_turn":
            return GameAction("end_turn")
        targets = opt.get("legalTargets") or []
        card = _first_target(targets, "cardUid")
        system = _first_target(targets, "systemId")
        args: dict = {}
        if name in ("play_card", "deploy_card", "recycle_card"):
            if card:
                args["card_uid"] = card
            return GameAction(name, args)
        if name in ("strike", "broadcast"):
            if card:
                args["card_uid"] = card
            if system:
                args["target_system"] = int(system)
            return GameAction(name, args)
        return GameAction("end_turn")

    def on_game_end(self, match_id: str, result: str) -> None:
        """局终钩子：记录本局结果。"""
        self.state["last_match"] = match_id
        self.state["last_result"] = result


def _my_energy(view: dict) -> int:
    """从 view 提取自身能量。"""
    agent = view.get("agentView") or {}
    self_snap = agent.get("self") or {}
    energy = self_snap.get("energy")
    if isinstance(energy, int):
        return energy
    return 0


def _first_target(targets: list, ttype: str) -> str | None:
    """从 legalTargets 取第一个指定类型的值。"""
    for t in targets:
        if t.get("type") == ttype and t.get("value"):
            return str(t["value"])
    return None
