"""DarkForest 脚本参考骨架（rules/templates/basic.py，只读模板）。

子 Agent 写 v1 脚本时**基于本骨架改造**，不要凭空写。把它复制为
``rules/<name>/v1.py``（或直接参考）再改策略。本文件不参与运行。

协议要点（详见设计文档 §4.3 ScriptDecider 协议注记）：
- 必须定义 ``ScriptDecider`` 类并实现 ``decide(view, affordance) -> GameAction``
- decide 在"可动作时机"被循环调用：自己回合每一步 + 非己方回合的强制响应
  （broadcastAction / pendingAction 非空时也要处理，不能只等自己回合）
- 返回 ``end_turn`` 或无可动动作才停止本轮；动作一律以 affordance 为准
- 动作参数键必须 snake_case（card_uid / target_system / strike_uid / agreed /
  responder_player_id / option / discard_cards）；未知键会被拒绝
- 可选钩子：``reset()``（局前重置 self.state）/ ``on_game_end(match_id, result)``
- 发布前跑 L1 校验门：``python -m autonomous_driver validate --script <path>``

可用信息来源（get_agent_view 返回的 view）：
- view["agentView"]["cursor"]  -> {"isMyTurn", "totalTurn", "turnPhase"}
- view["agentView"]["self"]    -> {"energy", "hand"(列表), "faceUpCards", "color"}
- view["agentView"]["events"]["entries"] -> [{type, message}, ...] 事件流水
- view.get("position")         -> {"myPosition": {"isPublic", "system", ...}, "safeSystems"}
- view.get("broadcast")        -> {"phase", "myRole", "history"}

动作参数（get_affordances 返回的 affordance）：
- affordance["pendingAction"]   -> 强制挂起动作（legalOptions / legalTargets）
- affordance["broadcastAction"] -> 广播待处理（agreeOrRefuse / selectResponder / cancel）
- affordance["legalActions"]    -> 自由动作集（action / cost / legalTargets）
"""

from autonomous_driver.decide import GameAction


class ScriptDecider:
    """你的策略脚本：在 decide 里基于 view/affordance 做决策。"""

    def __init__(self) -> None:
        # 跨回合/跨局状态；局前 driver 会调 reset() 重置
        self.state: dict = {"turns": 0}

    def reset(self) -> None:
        """局前重置（driver 每局开始调用，可选钩子）。"""
        self.state = {"turns": 0}

    def decide(self, view: dict, affordance: dict) -> GameAction:
        self.state["turns"] += 1

        # 1) 强制挂起动作优先（打击选择/移动/宣布/落空处理）——必须先处理
        pending = affordance.get("pendingAction")
        if pending:
            return self._resolve_pending(pending)

        # 2) 广播待处理（非己方回合也要回应，否则回合被卡住）
        broadcast = affordance.get("broadcastAction")
        if broadcast:
            return self._resolve_broadcast(broadcast)

        # 3) 自由动作：按你的策略从 legalActions 选择
        return self._pick_free(affordance.get("legalActions") or [], view)

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

    # --- 自由动作（示例策略：优先广播/打击，end_turn 兜底） ---

    def _pick_free(self, legal: list, view: dict) -> GameAction:
        energy = _my_energy(view)
        # 示例优先级：broadcast > strike > deploy > play > recycle > end_turn
        for name in ("broadcast", "strike", "deploy_card", "play_card", "recycle_card"):
            for opt in legal:
                if opt.get("action") != name:
                    continue
                cost = (opt.get("cost") or {}).get("energy", 0)
                if isinstance(cost, int) and cost > energy:
                    continue
                args: dict = {}
                for t in (opt.get("legalTargets") or []):
                    if t.get("type") == "cardUid":
                        args["card_uid"] = str(t["value"])
                    elif t.get("type") == "systemId":
                        args["target_system"] = int(t["value"])
                return GameAction(name, args)
        # end_turn 永远可用（若连它都缺失，仍返回它防卡死）
        return GameAction("end_turn")

    def on_game_end(self, match_id: str, result: str) -> None:
        """局终钩子（可选）：记录本局结果，供复盘分析。"""
        self.state["last_match"] = match_id
        self.state["last_result"] = result


def _my_energy(view: dict) -> int:
    """从 view 提取自身能量（agentView.self.energy，缺失视为 0）。"""
    agent = view.get("agentView") or {}
    self_snap = agent.get("self") or {}
    energy = self_snap.get("energy")
    if isinstance(energy, int):
        return energy
    return 0
