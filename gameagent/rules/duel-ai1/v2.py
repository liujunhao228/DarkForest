"""DarkForest 策略脚本 duel-ai1/v2：平衡型稳健策略。

改进自 v1（复盘教训）：
1. 修复 broadcastAction type="cancel" 处理 —— 只需 end_turn 确认，不是主动取消
2. 减少广播滥发：只在有明确目标时广播，避免 spam
3. 改善卡牌使用：部署后不立即回收，让设施发挥作用
4. 优先打击：有 strike 卡 + 足够能量时优先攻击
5. 能量管理：预留 2 能量用于应对突发广播/反击
6. 位置感知：利用 safeSystems 选择安全星系
"""

from autonomous_driver.decide import GameAction


class ScriptDecider:
    """平衡型稳健策略。"""

    def __init__(self) -> None:
        self.state: dict = {
            "turns": 0,
            "my_color": None,
            "seen_opponent_cards": {},
            "my_hand_history": [],
            "last_action": None,
            "energy_reserve": 2,
            "aggressive_mode": False,
            "broadcast_count": 0,      # 本局广播次数限制
            "max_broadcasts_per_game": 3,
            "strike_ready": False,      # 手中是否有打击卡
            "position_known": False,
        }

    def reset(self) -> None:
        self.state = {
            "turns": 0,
            "my_color": None,
            "seen_opponent_cards": {},
            "my_hand_history": [],
            "last_action": None,
            "energy_reserve": 2,
            "aggressive_mode": False,
            "broadcast_count": 0,
            "max_broadcasts_per_game": 3,
            "strike_ready": False,
            "position_known": False,
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

        # 3) 更新态势
        self._update_awareness(view, affordance)

        # 4) 自由动作策略
        return self._pick_free(affordance.get("legalActions") or [], view)

    # ============================================================
    # 态势感知
    # ============================================================

    def _update_awareness(self, view: dict, affordance: dict) -> None:
        agent = view.get("agentView") or {}
        self_snap = agent.get("self") or {}

        color = self_snap.get("color")
        if color and self.state["my_color"] is None:
            self.state["my_color"] = color

        hand = self_snap.get("hand") or []
        self.state["my_hand_history"].append(len(hand))

        # 检测手牌中是否有打击卡（通过事件推测或手牌信息）
        # 手牌内容被隐藏，但可以从 affordance 的 legalActions 推断
        legal = affordance.get("legalActions") or []
        for opt in legal:
            if opt.get("action") == "strike":
                self.state["strike_ready"] = True
                break

        # 位置感知
        pos = view.get("position")
        if pos:
            self.state["position_known"] = True

        # 激进模式判断
        energy = _my_energy(view)
        if len(hand) >= 4 and energy >= 5:
            self.state["aggressive_mode"] = True
        elif energy <= 1:
            self.state["aggressive_mode"] = False

    # ============================================================
    # 强制挂起动作
    # ============================================================

    def _resolve_pending(self, pending: dict) -> GameAction:
        options = [str(o) for o in (pending.get("legalOptions") or [])]
        targets = pending.get("legalTargets") or []
        # 保守选项优先
        skip = ("skip_select", "skip_move", "skip_announce", "skip_missed", "discard_missed")
        for opt in options:
            if opt in skip:
                return GameAction("resolve_strike_action", {"option": opt})
        if options:
            args: dict = {"option": options[0]}
            for t in targets:
                if t.get("type") == "strikeUid":
                    args["strike_uid"] = str(t["value"])
                elif t.get("type") == "systemId":
                    args["target_system"] = int(t["value"])
            return GameAction("resolve_strike_action", args)
        return GameAction("end_turn")

    # ============================================================
    # 广播待处理 —— 修复 v1 的 cancel 问题
    # ============================================================

    def _resolve_broadcast(self, broadcast: dict) -> GameAction:
        btype = broadcast.get("type")
        targets = broadcast.get("legalTargets") or []

        if btype == "agreeOrRefuse":
            # 有可用卡牌才同意，否则拒绝
            for t in targets:
                if t.get("type") == "cardUid":
                    return GameAction("respond_broadcast", {"agreed": True, "card_uid": str(t["value"])})
            return GameAction("respond_broadcast", {"agreed": False})

        if btype == "selectResponder":
            # 选择第一个合法回应者
            for t in targets:
                if t.get("type") == "playerId":
                    return GameAction("select_broadcast_responder", {"responder_player_id": str(t["value"])})
            # 无合法目标则取消
            return GameAction("end_turn")

        if btype == "cancel":
            # v1 错误：试图主动 cancel，后端拒绝（WRONG_PHASE）
            # 正确行为：广播已被取消，确认即可
            return GameAction("end_turn")

        # 未知类型，兜底
        return GameAction("end_turn")

    # ============================================================
    # 自由动作策略
    # ============================================================

    def _pick_free(self, legal: list, view: dict) -> GameAction:
        energy = _my_energy(view)
        hand_size = len(view.get("agentView", {}).get("self", {}).get("hand", []))
        aggressive = self.state["aggressive_mode"]

        # --- 优先级 1: 打击（直接攻击） ---
        # 有打击卡且能量足够时优先攻击
        if energy >= 3 + self.state["energy_reserve"]:
            strike_opt = self._find_legal(legal, "strike")
            if strike_opt:
                return self._build_free("strike", strike_opt, view)

        # --- 优先级 2: 广播（有限次数，不 spam） ---
        if self.state["broadcast_count"] < self.state["max_broadcasts_per_game"]:
            bcast_opt = self._find_legal(legal, "broadcast")
            if bcast_opt and (aggressive or hand_size >= 3):
                self.state["broadcast_count"] += 1
                return self._build_free("broadcast", bcast_opt, view)

        # --- 优先级 3: 部署面朝上卡牌 ---
        if energy >= 2 + self.state["energy_reserve"]:
            deploy_opt = self._find_legal(legal, "deploy_card")
            if deploy_opt:
                return self._build_free("deploy_card", deploy_opt, view)

        # --- 优先级 4: 出牌 ---
        if energy >= 1 + self.state["energy_reserve"]:
            play_opt = self._find_legal(legal, "play_card")
            if play_opt:
                return self._build_free("play_card", play_opt, view)

        # --- 优先级 5: 回收（只在手牌空或需要腾位时） ---
        if hand_size <= 1:
            recycle_opt = self._find_legal(legal, "recycle_card")
            if recycle_opt:
                return self._build_free("recycle_card", recycle_opt, view)

        # --- 兜底 ---
        return GameAction("end_turn")

    def _find_legal(self, legal: list, action_name: str) -> dict | None:
        for opt in legal:
            if opt.get("action") == action_name:
                return opt
        return None

    def _build_free(self, name: str, opt: dict, view: dict) -> GameAction:
        if name == "end_turn":
            return GameAction("end_turn")

        targets = opt.get("legalTargets") or []
        args: dict = {}

        cards = [t for t in targets if t.get("type") == "cardUid"]
        systems = [t for t in targets if t.get("type") == "systemId"]

        if cards:
            args["card_uid"] = str(cards[0]["value"])

        if systems:
            # 优选取 safeSystems 或第一个可用星系
            pos = view.get("position")
            if pos:
                safe = pos.get("safeSystems") or []
                safe_ids = {str(s.get("id", s)) for s in safe}
                for t in systems:
                    if str(t["value"]) in safe_ids:
                        args["target_system"] = int(t["value"])
                        break
                else:
                    args["target_system"] = int(systems[0]["value"])
            else:
                args["target_system"] = int(systems[0]["value"])

        return GameAction(name, args)

    def on_game_end(self, match_id: str, result: str) -> None:
        self.state["last_match"] = match_id
        self.state["last_result"] = result


# ============================================================
# 辅助函数
# ============================================================

def _my_energy(view: dict) -> int:
    agent = view.get("agentView") or {}
    self_snap = agent.get("self") or {}
    energy = self_snap.get("energy")
    if isinstance(energy, int):
        return energy
    return 0
