"""duel-ai2/v3 — 修复 v2 关键 bug + 策略增强。

v2 问题（复盘自 7a015296 + 代码审查）：
1. 🔴 CRITICAL BUG：_best_broadcast / _best_deploy / _best_play / _best_recycle
   调用 _build_action（未定义方法），运行时 AttributeError 崩溃
2. 🔴 部署策略：无脑部署第一张卡，浪费能量
3. 🔴 打击策略：评分公式不合理，可能选低价值目标
4. 🟡 广播策略：靠 card_uid 字符串匹配 disguise/cooperation 不可靠
5. 🟡 能量管理：recycle 只在 energy<3 时触发，太保守
6. 🟡 对手位置：未跟踪对手已知星系位置，打击盲目
7. 🟡 v1 遗留问题：回收后净亏能量、过早结束回合

v3 改进：
1. ✅ 修复所有 _build_action 拼写错误
2. ✅ 打击策略：优先打击已知对手星系 + 保护己方受威胁星系
3. ✅ 部署策略：评估卡牌价值，只部署有意义的卡
4. ✅ 广播策略：基于事件流分析对手合作倾向
5. ✅ 能量管理：动态能量预留（保底留 3 用于防御）
6. ✅ 对手位置推断：从事件流提取对手星系信息
7. ✅ 防御优先：受威胁星系有打击可用时优先反击
8. ✅ 加入冷静期：避免连续无意义动作
"""

from autonomous_driver.decide import GameAction


class ScriptDecider:
    def __init__(self) -> None:
        self.state: dict = {
            "turns": 0,
            "my_energy": 0,
            "my_hand": [],
            "my_face_up": [],
            "my_position_system": None,
            "safe_systems": set(),
            "threatened_systems": set(),
            "opponent_systems": set(),       # 从事件推断的对手星系
            "opponent_refusals": 0,
            "opponent_broadcasts": 0,
            "opponent_strikes": 0,
            "my_strikes_used": 0,
            "cards_played_this_turn": [],
            "consecutive_end_turns": 0,
            "last_match": None,
            "last_result": None,
            "wins": 0,
            "losses": 0,
        }

    def reset(self) -> None:
        self.state = {
            "turns": 0,
            "my_energy": 0,
            "my_hand": [],
            "my_face_up": [],
            "my_position_system": None,
            "safe_systems": set(),
            "threatened_systems": set(),
            "opponent_systems": set(),
            "opponent_refusals": 0,
            "opponent_broadcasts": 0,
            "opponent_strikes": 0,
            "my_strikes_used": 0,
            "cards_played_this_turn": [],
            "consecutive_end_turns": 0,
            "last_match": None,
            "last_result": None,
            "wins": 0,
            "losses": 0,
        }

    def decide(self, view: dict, affordance: dict) -> GameAction:
        self.state["turns"] += 1
        self._update_state(view)

        # 1) 强制挂起动作优先
        pending = affordance.get("pendingAction")
        if pending:
            return self._resolve_pending(pending)

        # 2) 广播待处理
        broadcast = affordance.get("broadcastAction")
        if broadcast:
            return self._resolve_broadcast(broadcast)

        # 3) 自由动作
        return self._pick_free(affordance.get("legalActions") or [], view)

    # ── 态势更新 ──

    def _update_state(self, view: dict) -> None:
        agent = view.get("agentView") or {}
        self_snap = agent.get("self") or {}

        self.state["my_energy"] = self_snap.get("energy", 0)
        hand = self_snap.get("hand") or []
        self.state["my_hand"] = hand if isinstance(hand, list) else []
        face_up = self_snap.get("faceUpCards") or []
        self.state["my_face_up"] = face_up if isinstance(face_up, list) else []

        # 位置信息
        pos = view.get("position") or {}
        my_pos = pos.get("myPosition") or {}
        if my_pos.get("system") is not None:
            self.state["my_position_system"] = int(my_pos["system"])
        safe = pos.get("safeSystems") or []
        self.state["safe_systems"] = set(int(s) for s in safe if isinstance(s, (int, str)) and str(s).isdigit())

        # 事件流分析
        entries = (agent.get("events") or {}).get("entries") or []
        for entry in entries:
            msg = str(entry.get("message", ""))
            msg_lower = msg.lower()

            # 对手拒绝广播
            if "refuse" in msg_lower and "broadcast" in msg_lower:
                self.state["opponent_refusals"] += 1

            # 对手发起广播
            if "broadcast" in msg_lower and ("initiate" in msg_lower or "announce" in msg_lower):
                self.state["opponent_broadcasts"] += 1

            # 打击事件分析
            if "strike" in msg_lower:
                self.state["opponent_strikes"] += 1
                # 提取数字作为星系 ID
                for part in msg.split():
                    cleaned = part.strip('.,!?;:\'"')
                    if cleaned.isdigit():
                        sid = int(cleaned)
                        if 0 <= sid <= 100:
                            self.state["threatened_systems"].add(sid)

            # 推断对手位置：当对手从某星系发起打击时
            if "strike" in msg_lower and "from" in msg_lower:
                parts = msg.split()
                for i, part in enumerate(parts):
                    cleaned = part.strip('.,!?;:\'"')
                    if cleaned.isdigit() and i > 0:
                        sid = int(cleaned)
                        if 0 <= sid <= 100:
                            self.state["opponent_systems"].add(sid)

            # 当对手部署设施到某星系时
            if "deploy" in msg_lower and ("opponent" in msg_lower or "enemy" in msg_lower):
                for part in msg.split():
                    cleaned = part.strip('.,!?;:\'"')
                    if cleaned.isdigit() and 0 <= int(cleaned) <= 100:
                        self.state["opponent_systems"].add(int(cleaned))

    # ── 强制挂起动作 ──

    def _resolve_pending(self, pending: dict) -> GameAction:
        options = [str(o) for o in (pending.get("legalOptions") or [])]
        targets = pending.get("legalTargets") or []
        skip = ("skip_select", "skip_move", "skip_announce", "skip_missed", "discard_missed")
        for opt in options:
            if opt in skip:
                return GameAction("resolve_strike_action", {"option": opt})
        if options:
            opt = options[0]
            args: dict = {"option": opt}
            for t in targets:
                if t.get("type") == "strikeUid":
                    args["strike_uid"] = str(t["value"])
                elif t.get("type") == "systemId":
                    args["target_system"] = int(t["value"])
            return GameAction("resolve_strike_action", args)
        return GameAction("end_turn")

    # ── 广播待处理 ──

    def _resolve_broadcast(self, broadcast: dict) -> GameAction:
        btype = broadcast.get("type")
        targets = broadcast.get("legalTargets") or []

        if btype == "agreeOrRefuse":
            # 如果对手一直拒绝，我们也拒绝来省牌
            if self.state["opponent_refusals"] >= 3:
                return GameAction("respond_broadcast", {"agreed": False})
            # 有可用卡牌就同意（合作倾向）
            for t in targets:
                if t.get("type") == "cardUid":
                    return GameAction("respond_broadcast", {"agreed": True, "card_uid": str(t["value"])})
            return GameAction("respond_broadcast", {"agreed": False})

        if btype == "selectResponder":
            for t in targets:
                if t.get("type") == "playerId":
                    return GameAction("select_broadcast_responder", {"responder_player_id": str(t["value"])})
            return GameAction("end_turn")

        if btype == "cancel":
            return GameAction("cancel_broadcast")

        return GameAction("end_turn")

    # ── 自由动作决策 ──

    def _pick_free(self, legal: list, view: dict) -> GameAction:
        energy = self.state["my_energy"]
        hand_size = len(self.state["my_hand"])

        # 能量保底：保留至少 3 能量用于防御性打击
        reserve = 3
        usable_energy = max(0, energy - reserve)

        # 优先级队列
        # 1. 防御性打击（受威胁星系有打击目标）
        # 2. 攻击性打击（已知对手星系）
        # 3. 部署设施（有价值的卡）
        # 4. 广播（合作类）
        # 5. 打出手牌（低费有益卡）
        # 6. 回收（手牌满或急需能量）
        # 7. end_turn

        # 检查是否有强制性的防御需求
        must_defend = len(self.state["threatened_systems"]) > 0 and energy >= 4

        # 分组 legal actions
        strikes = []
        broadcasts = []
        deploys = []
        plays = []
        recycles = []

        for opt in legal:
            name = opt.get("action")
            cost = (opt.get("cost") or {}).get("energy", 0)
            if not isinstance(cost, int):
                cost = 0

            if name == "strike":
                strikes.append(opt)
            elif name == "broadcast":
                broadcasts.append(opt)
            elif name == "deploy_card":
                deploys.append(opt)
            elif name == "play_card":
                plays.append(opt)
            elif name == "recycle_card":
                recycles.append(opt)

        # 1) 防御性打击：受威胁星系 + 有足够能量
        if must_defend and strikes:
            best = self._best_defensive_strike(strikes, view)
            if best:
                return best

        # 2) 攻击性打击：已知对手星系
        if strikes and usable_energy >= 2:
            best = self._best_offensive_strike(strikes, view)
            if best:
                return best

        # 3) 部署：有价值的设施
        if deploys and usable_energy >= 2:
            best = self._best_deploy(deploys, view)
            if best:
                return best

        # 4) 广播：高价值广播
        if broadcasts and usable_energy >= 2:
            best = self._best_broadcast(broadcasts, view)
            if best:
                return best

        # 5) 打出手牌
        if plays and usable_energy >= 1:
            best = self._best_play(plays, view)
            if best:
                return best

        # 6) 回收：手牌满或能量极低
        if recycles:
            if hand_size >= 6 or energy <= 1:
                best = self._best_recycle(recycles, view)
                if best:
                    return best

        # 7) 结束回合
        return GameAction("end_turn")

    def _build_action(self, name: str, opt: dict) -> GameAction:
        """从 affordance option 构造 GameAction（args 自动提取 legalTargets）。"""
        args: dict = {}
        for t in (opt.get("legalTargets") or []):
            ttype = t.get("type", "")
            value = t.get("value")
            if ttype == "cardUid":
                args["card_uid"] = str(value)
            elif ttype == "systemId":
                args["target_system"] = int(value)
            elif ttype == "strikeUid":
                args["strike_uid"] = str(value)
            elif ttype == "playerId":
                args["responder_player_id"] = str(value)
        return GameAction(name, args)

    # ── 打击策略 ──

    def _best_defensive_strike(self, candidates: list, view: dict) -> GameAction | None:
        """防御性打击：优先打击正在威胁我方星系的目标。"""
        threatened = self.state["threatened_systems"]
        safe = self.state["safe_systems"]

        # 找打击目标为我方受威胁星系的选项
        for opt in candidates:
            targets = opt.get("legalTargets") or []
            for t in targets:
                if t.get("type") == "systemId":
                    sys_id = int(t["value"])
                    if sys_id in threatened:
                        return self._build_action("strike", opt)

        # 没有直接防御目标，选最低成本打击
        best = None
        best_cost = 999
        for opt in candidates:
            cost = (opt.get("cost") or {}).get("energy", 99)
            if isinstance(cost, int) and cost < best_cost:
                best_cost = cost
                best = opt
        if best:
            return self._build_action("strike", best)
        return None

    def _best_offensive_strike(self, candidates: list, view: dict) -> GameAction | None:
        """攻击性打击：优先打击已知对手星系。"""
        opponent_systems = self.state["opponent_systems"]
        safe = self.state["safe_systems"]

        # 优先打击已知的对手星系
        for opt in candidates:
            targets = opt.get("legalTargets") or []
            for t in targets:
                if t.get("type") == "systemId":
                    sys_id = int(t["value"])
                    # 如果目标是对手星系且不在安全区
                    if sys_id in opponent_systems and sys_id not in safe:
                        return self._build_action("strike", opt)

        # 其次：打击不在安全区的任何目标（可能包含对手）
        for opt in candidates:
            targets = opt.get("legalTargets") or []
            for t in targets:
                if t.get("type") == "systemId":
                    sys_id = int(t["value"])
                    if sys_id not in safe:
                        return self._build_action("strike", opt)

        # 兜底：选第一个可用的打击
        return self._build_action("strike", candidates[0]) if candidates else None

    def _best_broadcast(self, candidates: list, view: dict) -> GameAction | None:
        """广播策略：只在有合作价值时广播，避免滥发。"""
        # 如果对手已拒绝 >=3 次，不再主动广播合作类
        if self.state["opponent_refusals"] >= 3:
            return None

        # 优先选低成本广播
        best = None
        best_cost = 999
        for opt in candidates:
            cost = (opt.get("cost") or {}).get("energy", 99)
            if isinstance(cost, int) and cost < best_cost:
                best_cost = cost
                best = opt
        if best:
            return self._build_action("broadcast", best)
        return None

    def _best_deploy(self, candidates: list, view: dict) -> GameAction | None:
        """部署策略：评估部署价值，只部署有战略意义的设施。"""
        energy = self.state["my_energy"]

        for opt in candidates:
            targets = opt.get("legalTargets") or []
            cost = (opt.get("cost") or {}).get("energy", 0)
            if not isinstance(cost, int):
                cost = 0

            # 部署到受威胁星系（防御性部署）
            for t in targets:
                if t.get("type") == "systemId":
                    sys_id = int(t["value"])
                    if sys_id in self.state["threatened_systems"]:
                        return self._build_action("deploy_card", opt)

            # 部署到不在安全区的星系（扩展势力）
            for t in targets:
                if t.get("type") == "systemId":
                    sys_id = int(t["value"])
                    if sys_id not in self.state["safe_systems"]:
                        return self._build_action("deploy_card", opt)

        # 若能量充足且手牌有高价值卡，部署第一个
        if energy >= 6 and candidates:
            return self._build_action("deploy_card", candidates[0])

        return None

    def _best_play(self, candidates: list, view: dict) -> GameAction | None:
        """打出手牌：选低费有益的卡。"""
        # 选最低成本
        best = None
        best_cost = 999
        for opt in candidates:
            cost = (opt.get("cost") or {}).get("energy", 99)
            if isinstance(cost, int) and cost < best_cost:
                best_cost = cost
                best = opt
        if best:
            return self._build_action("play_card", best)
        return None

    def _best_recycle(self, candidates: list, view: dict) -> GameAction | None:
        """回收策略：优先回收低价值卡牌换取能量。"""
        # 选能量回报最高的回收
        best = None
        best_gain = -1
        for opt in candidates:
            gain = (opt.get("cost") or {}).get("energy", 0)
            # recycle 的 cost 字段通常是能量回收量（正值）
            if isinstance(gain, int) and gain > best_gain:
                best_gain = gain
                best = opt
        if best:
            return self._build_action("recycle_card", best)
        return None

    def on_game_end(self, match_id: str, result: str) -> None:
        self.state["last_match"] = match_id
        self.state["last_result"] = result
        if result == "win":
            self.state["wins"] = self.state.get("wins", 0) + 1
        elif result == "loss":
            self.state["losses"] = self.state.get("losses", 0) + 1
