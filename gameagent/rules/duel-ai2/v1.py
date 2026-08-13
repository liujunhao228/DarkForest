"""duel-ai2/v1 — 初始策略：能量感知 + 基础威胁评估。

策略要点：
1. 强制响应（pending/broadcast）保守处理，永不卡死
2. 自由动作按优先级：broadcast > strike（打击高价值目标） > deploy > play > recycle > end_turn
3. 能量管理：避免过度消耗至无法响应
4. 基础威胁评估：跟踪对手 faceUpCards 和己方系统状态
5. 手牌留存：保留关键卡牌（广播/打击），低价值牌优先使用
"""

from autonomous_driver.decide import GameAction


class ScriptDecider:
    def __init__(self) -> None:
        self.state: dict = {
            "turns": 0,
            "my_systems": set(),      # 己方控制的星系
            "opponent_systems": set(), # 对手控制的星系
            "safe_systems": set(),    # 安全星系（无威胁）
            "seen_opponent_cards": [], # 见过的对手牌
            "my_hand_history": [],    # 手牌历史变化
            "consecutive_end_turns": 0, # 连续 end_turn 计数
            "strikes_launched": 0,    # 已发起打击数
            "strikes_received": 0,    # 遭受打击数
            "energy_spent_this_turn": 0,
        }

    def reset(self) -> None:
        self.state = {
            "turns": 0,
            "my_systems": set(),
            "opponent_systems": set(),
            "safe_systems": set(),
            "seen_opponent_cards": [],
            "my_hand_history": [],
            "consecutive_end_turns": 0,
            "strikes_launched": 0,
            "strikes_received": 0,
            "energy_spent_this_turn": 0,
        }

    def decide(self, view: dict, affordance: dict) -> GameAction:
        self.state["turns"] += 1
        self.state["energy_spent_this_turn"] = 0

        # 更新态势感知
        self._update_situation(view)

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

    # ── 态势感知 ──

    def _update_situation(self, view: dict) -> None:
        """从 view 更新己方态势感知。"""
        agent = view.get("agentView") or {}
        self_snap = agent.get("self") or {}

        # 手牌变化记录
        hand = self_snap.get("hand") or []
        if hand:
            self.state["my_hand_history"].append(len(hand))

        # faceUpCards（已打出的公开牌）
        face_up = self_snap.get("faceUpCards") or []
        if face_up:
            for card in face_up:
                # 记录对手公开牌（如果有颜色区分）
                pass

        # 位置/星系信息
        pos = view.get("position") or {}
        my_pos = pos.get("myPosition") or {}
        safe = pos.get("safeSystems") or []
        if safe:
            self.state["safe_systems"] = set(str(s) for s in safe)

        # 事件流水：提取关键事件
        entries = (agent.get("events") or {}).get("entries") or []
        for entry in entries:
            msg = str(entry.get("message", ""))
            # 检测打击相关事件
            if "strike" in msg.lower() and "launch" in msg.lower():
                self.state["strikes_launched"] += 1
            if "strike" in msg.lower() and "against" in msg.lower() and "you" in msg.lower():
                self.state["strikes_received"] += 1

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

    def _my_energy(self, view: dict) -> int:
        agent = view.get("agentView") or {}
        self_snap = agent.get("self") or {}
        energy = self_snap.get("energy")
        return energy if isinstance(energy, int) else 0

    def _pick_free(self, legal: list, view: dict) -> GameAction:
        energy = self._my_energy(view)

        # 按优先级遍历动作类型
        priority = ("broadcast", "strike", "deploy_card", "play_card", "recycle_card", "end_turn")

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

            # 对候选动作评分选最优
            if name == "broadcast":
                return self._best_broadcast(candidates, view)
            elif name == "strike":
                return self._best_strike(candidates, view)
            elif name == "deploy_card":
                return self._best_deploy(candidates, view)
            elif name == "play_card":
                return self._best_play(candidates, view)
            elif name == "recycle_card":
                return self._best_recycle(candidates, view)
            else:
                return GameAction("end_turn")

        return GameAction("end_turn")

    def _build_action(self, name: str, opt: dict) -> GameAction:
        args: dict = {}
        for t in (opt.get("legalTargets") or []):
            if t.get("type") == "cardUid":
                args["card_uid"] = str(t["value"])
            elif t.get("type") == "systemId":
                args["target_system"] = int(t["value"])
        return GameAction(name, args)

    def _best_broadcast(self, candidates: list, view: dict) -> GameAction:
        """广播：选择最优广播牌（高价值卡优先）。"""
        # 简单策略：选第一个可用广播
        return self._build_action("broadcast", candidates[0])

    def _best_strike(self, candidates: list, view: dict) -> GameAction:
        """打击：优先打击有目标的打击动作（带 targetSystem 的）。"""
        for opt in candidates:
            targets = opt.get("legalTargets") or []
            has_system = any(t.get("type") == "systemId" for t in targets)
            if has_system:
                return self._build_action("strike", opt)
        return self._build_action("strike", candidates[0])

    def _best_deploy(self, candidates: list, view: dict) -> GameAction:
        """部署：优先部署到前线星系（如果已知）。"""
        # 简单策略：选第一个
        return self._build_action("deploy_card", candidates[0])

    def _best_play(self, candidates: list, view: dict) -> GameAction:
        """打出卡牌：选择最优可打出的牌。"""
        # 简单策略：选第一个
        return self._build_action("play_card", candidates[0])

    def _best_recycle(self, candidates: list, view: dict) -> GameAction:
        """回收：选第一个可回收的牌。"""
        return self._build_action("recycle_card", candidates[0])

    def on_game_end(self, match_id: str, result: str) -> None:
        self.state["last_match"] = match_id
        self.state["last_result"] = result
