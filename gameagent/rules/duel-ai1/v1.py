"""DarkForest 策略脚本 duel-ai1/v1：积极型侦察-打击策略。

基于 rules/templates/basic.py 骨架改造。
策略特点：
- 优先处理强制挂起动作（pendingAction）和广播（broadcastAction）
- 自由动作优先级：broadcast > strike (高能) > deploy > play > recycle > end_turn
- 感知对手颜色与手牌厚度，推测威胁
- 位置感知：利用 safeSystems 信息选择安全目标
- 能量风险管理：预留反击能量
"""

from autonomous_driver.decide import GameAction


class ScriptDecider:
    """积极型侦察-打击策略。"""

    def __init__(self) -> None:
        self.state: dict = {
            "turns": 0,
            "my_color": None,
            "my_uid": None,
            "seen_opponent_cards": {},   # card_name -> count 对手用过的卡
            "my_hand_history": [],       # 我的手牌张数历史
            "opponent_action_pattern": [],  # 对手动作类型序列
            "last_action": None,
            "energy_reserve": 2,          # 预留能量用于反击
            "aggressive_mode": False,     # 识别到优势时进入激进模式
            "position_safe": True,        # 当前位置是否安全
        }

    def reset(self) -> None:
        """局前重置（driver 每局开始调用）。"""
        self.state = {
            "turns": 0,
            "my_color": None,
            "my_uid": None,
            "seen_opponent_cards": {},
            "my_hand_history": [],
            "opponent_action_pattern": [],
            "last_action": None,
            "energy_reserve": 2,
            "aggressive_mode": False,
            "position_safe": True,
        }

    def decide(self, view: dict, affordance: dict) -> GameAction:
        self.state["turns"] += 1

        # 1) 强制挂起动作优先（打击选择/移动/宣布/落空处理）
        pending = affordance.get("pendingAction")
        if pending:
            return self._resolve_pending(pending)

        # 2) 广播待处理（非己方回合也要回应）
        broadcast = affordance.get("broadcastAction")
        if broadcast:
            return self._resolve_broadcast(broadcast)

        # 3) 更新态势感知
        self._update_situational_awareness(view)

        # 4) 自由动作：选择最优策略
        return self._pick_free(affordance.get("legalActions") or [], view)

    # ============================================================
    # 态势感知
    # ============================================================

    def _update_situational_awareness(self, view: dict) -> None:
        """更新跨回合状态：颜色、手牌、对手信息、位置安全。"""
        agent = view.get("agentView") or {}
        self_snap = agent.get("self") or {}

        # 记录己方颜色
        color = self_snap.get("color")
        if color and self.state["my_color"] is None:
            self.state["my_color"] = color

        # 记录己方 UID
        my_uid = self_snap.get("uid") or self_snap.get("id")
        if my_uid and self.state["my_uid"] is None:
            self.state["my_uid"] = str(my_uid)

        # 记录手牌数量变化
        hand = self_snap.get("hand") or []
        self.state["my_hand_history"].append(len(hand))

        # 从事件中提取对手信息
        events = agent.get("events") or {}
        entries = events.get("entries") or []
        for entry in entries:
            if isinstance(entry, dict):
                msg = str(entry.get("message", ""))
                etype = entry.get("type", "")
                # 对手使用卡牌
                if "play" in etype.lower() or "deploy" in etype.lower():
                    if "opponent" in msg.lower() or "对手" in msg:
                        # 尝试提取卡牌名
                        card_name = self._extract_card_name(msg)
                        if card_name:
                            self.state["seen_opponent_cards"][card_name] =                                 self.state["seen_opponent_cards"].get(card_name, 0) + 1
                # 记录对手动作类型
                if "opponent" in msg.lower() or "对手" in msg:
                    self.state["opponent_action_pattern"].append(etype)

        # 位置感知
        pos = view.get("position")
        if pos:
            my_pos = pos.get("myPosition") or {}
            self.state["position_safe"] = my_pos.get("isPublic", True) is False
            safe_systems = pos.get("safeSystems") or []
            if safe_systems:
                self.state["position_safe"] = True

        # 是否进入激进模式：对手手牌少 / 我能量高
        if len(hand) >= 4 and _my_energy(view) >= 5:
            self.state["aggressive_mode"] = True
        elif _my_energy(view) <= 1:
            self.state["aggressive_mode"] = False

    def _extract_card_name(self, msg: str) -> str | None:
        """简单启发式从消息提取卡牌名。"""
        import re
        # 尝试匹配引号内的卡牌名
        m = re.search(r'["\u201c]([^"\u201d]+)["\u201d]', msg)
        if m:
            return m.group(1).strip()
        # 尝试匹配常见卡牌关键词
        for kw in ["darkness", "light", "element", "sword", "shield",
                    "arrow", "cannon", "probe", "commander", "base"]:
            if kw in msg.lower():
                return kw
        return None

    # ============================================================
    # 强制挂起动作
    # ============================================================

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

    # ============================================================
    # 广播待处理
    # ============================================================

    def _resolve_broadcast(self, broadcast: dict) -> GameAction:
        btype = broadcast.get("type")
        targets = broadcast.get("legalTargets") or []
        if btype == "agreeOrRefuse":
            # 有卡才同意，否则拒绝
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

    # ============================================================
    # 自由动作策略
    # ============================================================

    def _pick_free(self, legal: list, view: dict) -> GameAction:
        energy = _my_energy(view)
        hand_size = len(view.get("agentView", {}).get("self", {}).get("hand", []))
        aggressive = self.state["aggressive_mode"]

        # --- 优先级 1: 广播（高威胁，0 能量） ---
        bcast_opt = self._find_legal(legal, "broadcast")
        if bcast_opt:
            # 激进模式或手牌多时优先广播
            if aggressive or hand_size >= 3:
                return self._build_free("broadcast", bcast_opt, view)

        # --- 优先级 2: 打击（消耗能量，直接攻击） ---
        # 预留反击能量（energy_reserve），剩余能量足够才打击
        strike_energy_threshold = 3 + self.state["energy_reserve"]
        if energy >= strike_energy_threshold:
            strike_opt = self._find_legal(legal, "strike")
            if strike_opt:
                return self._build_free("strike", strike_opt, view)

        # --- 优先级 3: 部署面朝上卡牌（消耗 2 能量） ---
        if energy >= 2 + self.state["energy_reserve"]:
            deploy_opt = self._find_legal(legal, "deploy_card")
            if deploy_opt:
                return self._build_free("deploy_card", deploy_opt, view)

        # --- 优先级 4: 出牌（消耗 1 能量） ---
        if energy >= 1 + self.state["energy_reserve"]:
            play_opt = self._find_legal(legal, "play_card")
            if play_opt:
                return self._build_free("play_card", play_opt, view)

        # --- 优先级 5: 回收（通常 0 能量） ---
        recycle_opt = self._find_legal(legal, "recycle_card")
        if recycle_opt:
            return self._build_free("recycle_card", recycle_opt, view)

        # --- 兜底：结束回合 ---
        return GameAction("end_turn")

    def _find_legal(self, legal: list, action_name: str) -> dict | None:
        """从 legalActions 中查找指定动作名的第一个可用选项。"""
        for opt in legal:
            if opt.get("action") == action_name:
                return opt
        return None

    def _build_free(self, name: str, opt: dict, view: dict) -> GameAction:
        """从 legalActions 选项构建 GameAction，智能选择目标。"""
        if name == "end_turn":
            return GameAction("end_turn")

        targets = opt.get("legalTargets") or []
        args: dict = {}

        # 收集所有可用目标
        cards = [t for t in targets if t.get("type") == "cardUid"]
        systems = [t for t in targets if t.get("type") == "systemId"]

        # 策略性选卡：优先选高价值卡
        if cards:
            selected = self._pick_best_card(cards, view)
            if selected:
                args["card_uid"] = selected

        # 策略性选目标星系
        if systems:
            selected = self._pick_best_system(systems, view)
            if selected:
                args["target_system"] = int(selected)

        return GameAction(name, args)

    def _pick_best_card(self, card_targets: list, view: dict) -> str | None:
        """从 cardUid 目标中选最佳卡牌。"""
        if not card_targets:
            return None
        # 简单策略：取第一个（或者可以按价值排序）
        # 未来可以检查手牌中卡牌属性做更优选择
        return str(card_targets[0]["value"])

    def _pick_best_system(self, system_targets: list, view: dict) -> str | None:
        """从 systemId 目标中选最佳星系。"""
        if not system_targets:
            return None
        # 位置感知：如果有位置信息，选安全星系
        pos = view.get("position")
        if pos:
            safe = pos.get("safeSystems") or []
            safe_ids = {str(s.get("id", s)) for s in safe}
            for t in system_targets:
                if str(t["value"]) in safe_ids:
                    return str(t["value"])
        # 默认第一个
        return str(system_targets[0]["value"])

    def on_game_end(self, match_id: str, result: str) -> None:
        """局终钩子：记录本局结果。"""
        self.state["last_match"] = match_id
        self.state["last_result"] = result


# ============================================================
# 辅助函数
# ============================================================

def _my_energy(view: dict) -> int:
    """从 view 提取自身能量。"""
    agent = view.get("agentView") or {}
    self_snap = agent.get("self") or {}
    energy = self_snap.get("energy")
    if isinstance(energy, int):
        return energy
    return 0
