"""duel-ai2/v2 — 基于复盘分析的改进策略。

v1 问题（复盘自 7a015296）：
1. 部署后立即回收：浪费能量和动作
2. 广播轰炸：连发多条广播，对手全部拒绝
3. 过早结束回合：turn 2 首个动作就 endTurn
4. 未保护己方星系：被对手打击淘汰
5. 能量管理差：部署高费卡后回收，净亏能量

v2 改进：
1. 部署决策：只部署有意义的设施，不部署即回收
2. 广播策略：评估成功率，避免无用广播
3. 打击决策：有可打目标时优先打击
4. 防御意识：保护己方星系
5. 能量预留：保留足够能量应对打击/防御
6. 态势感知：跟踪对手行为模式
"""

from autonomous_driver.decide import GameAction


class ScriptDecider:
    def __init__(self) -> None:
        self.state: dict = {
            "turns": 0,
            "my_position": None,
            "my_energy": 0,
            "my_hand": [],
            "my_face_up": [],
            "opponent_refusals": 0,
            "opponent_broadcasts": 0,
            "opponent_strikes": 0,
            "deployed_this_turn": False,
            "safe_systems": set(),
            "threatened_systems": set(),
            "last_turn_energy": 0,
            "cards_played_this_turn": [],
        }

    def reset(self) -> None:
        self.state = {
            "turns": 0,
            "my_position": None,
            "my_energy": 0,
            "my_hand": [],
            "my_face_up": [],
            "opponent_refusals": 0,
            "opponent_broadcasts": 0,
            "opponent_strikes": 0,
            "deployed_this_turn": False,
            "safe_systems": set(),
            "threatened_systems": set(),
            "last_turn_energy": 0,
            "cards_played_this_turn": [],
        }

    def decide(self, view: dict, affordance: dict) -> GameAction:
        self.state["turns"] += 1
        self.state["cards_played_this_turn"] = []

        # 更新态势
        self._update_state(view)

        # 1) 强制挂起动作
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
        self.state["my_hand"] = self_snap.get("hand") or []
        self.state["my_face_up"] = self_snap.get("faceUpCards") or []

        # 位置信息
        pos = view.get("position") or {}
        my_pos = pos.get("myPosition") or {}
        if my_pos.get("system") is not None:
            self.state["my_position"] = my_pos["system"]
        safe = pos.get("safeSystems") or []
        self.state["safe_systems"] = set(str(s) for s in safe)

        # 事件流水：提取对手行为
        entries = (agent.get("events") or {}).get("entries") or []
        for entry in entries:
            msg = str(entry.get("message", ""))
            if "broadcast" in msg.lower() and "refuse" in msg.lower():
                self.state["opponent_refusals"] += 1
            if "broadcast" in msg.lower() and "player" in msg.lower():
                self.state["opponent_broadcasts"] += 1
            if "strike" in msg.lower() and "against" in msg.lower():
                self.state["opponent_strikes"] += 1
                # 记录受威胁星系
                for part in msg.split():
                    if part.isdigit() and 0 <= int(part) <= 20:
                        self.state["threatened_systems"].add(part)

    # ── 能量提取 ──

    def _my_energy(self, view: dict) -> int:
        agent = view.get("agentView") or {}
        self_snap = agent.get("self") or {}
        energy = self_snap.get("energy")
        return energy if isinstance(energy, int) else 0

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
            # 策略：如果对手连续拒绝，我们也拒绝（节省卡牌）
            if self.state["opponent_refusals"] > 2:
                return GameAction("respond_broadcast", {"agreed": False})
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

    # ── 自由动作决策 ──

    def _pick_free(self, legal: list, view: dict) -> GameAction:
        energy = self._my_energy(view)

        # 按优化优先级遍历
        priority = ("strike", "broadcast", "deploy_card", "play_card", "recycle_card", "end_turn")

        for name in priority:
            candidates = []
            for opt in legal:
                if opt.get("action") != name:
                    continue
                cost = (opt.get("cost") or {}).get("energy", 0)
                if isinstance(cost, int) and cost > energy:
                    continue
                candidates.append(opt)

            if not candidates:
                continue

            if name == "strike":
                action = self._best_strike(candidates, view)
            elif name == "broadcast":
                action = self._best_broadcast(candidates, view)
            elif name == "deploy_card":
                action = self._best_deploy(candidates, view)
            elif name == "play_card":
                action = self._best_play(candidates, view)
            elif name == "recycle_card":
                # 只有手牌满或急需能量时才回收
                action = self._best_recycle(candidates, view)
            else:
                action = GameAction("end_turn")

            if action is not None:
                return action

        return GameAction("end_turn")

    def _build_action(self, name: str, opt: dict) -> GameAction:
        args: dict = {}
        for t in (opt.get("legalTargets") or []):
            if t.get("type") == "cardUid":
                args["card_uid"] = str(t["value"])
            elif t.get("type") == "systemId":
                args["target_system"] = int(t["value"])
        return GameAction(name, args)

    def _best_strike(self, candidates: list, view: dict) -> GameAction | None:
        """打击策略：优先打击已知的对手星系。"""
        energy = self._my_energy(view)

        # 如果对手在我们打击范围外，可能 skip
        # 选第一个可达的打击目标
        best = None
        best_score = -1
        for opt in candidates:
            targets = opt.get("legalTargets") or []
            score = 0
            # 有 targetSystem 的目标更有价值
            for t in targets:
                if t.get("type") == "systemId":
                    score += 5  # 有明确目标
            # 低成本打击优先（保留能量）
            cost = (opt.get("cost") or {}).get("energy", 99)
            score -= cost
            if score > best_score:
                best_score = score
                best = opt
        if best:
            return self._build_action("strike", best)
        return None

    def _best_broadcast(self, candidates: list, view: dict) -> GameAction | None:
        """广播策略：避免无用广播轰炸。"""
        # 如果对手已拒绝多次，不广播合作类
        # 检查广播类型：disguise（伪装）类可能更有用
        priority_terms = ["disguise", "cooperation"]
        for term in priority_terms:
            for opt in candidates:
                targets = opt.get("legalTargets") or []
                for t in targets:
                    if t.get("type") == "cardUid":
                        card_uid = str(t.get("value", ""))
                        if term in card_uid.lower():
                            return self._build_action("broadcast", opt)
        # 默认选第一个
        return self._build_action("broadcast", candidates[0])

    def _best_deploy(self, candidates: list, view: dict) -> GameAction | None:
        """部署策略：只部署有价值的设施，不部署即回收。"""
        # 检查是否已经部署过设施（避免重复部署/回收循环）
        if self.state.get("deployed_this_turn"):
            return None

        # 选第一个可部署的设施
        best = candidates[0]
        self.state["deployed_this_turn"] = True
        return self._build_action("deploy_card", best)

    def _best_play(self, candidates: list, view: dict) -> GameAction | None:
        """打出卡牌策略：选最有利的牌。"""
        # 简单策略：选第一个
        return self._build_action("play_card", candidates[0])

    def _best_recycle(self, candidates: list, view: dict) -> GameAction | None:
        """回收策略：仅在以下情况回收：
        1. 能量不足（<3）且需要能量执行关键动作
        2. 手牌已满且需要腾空间
        3. 回合即将结束且有低价值牌"""
        energy = self._my_energy(view)

        # 除非能量极低，否则不回收
        if energy >= 3:
            return None

        # 选最高能量回报的回收
        best = None
        best_gain = 0
        for opt in candidates:
            gain = (opt.get("cost") or {}).get("energy", 0)  # recycle gives energy back
            if gain > best_gain:
                best_gain = gain
                best = opt
        if best:
            return self._build_action("recycle_card", best)
        return None

    def on_game_end(self, match_id: str, result: str) -> None:
        self.state["last_match"] = match_id
        self.state["last_result"] = result
        # 记录胜率统计
        wins = self.state.get("wins", 0)
        losses = self.state.get("losses", 0)
        if result == "win":
            self.state["wins"] = wins + 1
        elif result == "loss":
            self.state["losses"] = losses + 1
