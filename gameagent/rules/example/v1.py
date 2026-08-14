"""example/v1 — 位置博弈型策略（经典模式）。

设计原则（全部基于源码事实，非猜测）：
- 打击即打即判（StrikeOrigin=direct，cards_actions.go:248）：打空星系 = 落空弃牌。
  → 只在有位置线索时才出手，打击是 4-10 费的稀缺资源。
- 对手位置在玩家视角恒为 -1（view_state.go:144-148），权威揭示（PositionKnown）实际
  不会出现；唯一可用线索 = 对手广播（广播日志公开携带目标星系 + 卡牌 defId → range）。
  → 用「广播目标 ± range」维护对手候选星系集，收缩到 1 个才精准打击；
    目标新鲜（≤2 回合）时可直接打击最新广播目标（自目标广播是 +1 能量套利的常见打
    法，广播到自身所在星系）。
- 含位置信息的日志（PositionOwnerID）对对手脱敏（SystemID 置 nil + 星系号变 ???），
  部署/跃迁不会泄露位置 → 保持隐蔽可行，隐蔽本身就是最强防御。
- 广播 = 唯一暴露自己的途径：位置未公开前绝不广播；已公开后才用 0 费恒星广播套利
  （无人回应 / 取消均 +1 能量，broadcast.go:118-131, 393-396）。
- 广播活动期 TurnPhase=interrupted，end_turn 必被拒（action_validator.go endTurn 不含
  interrupted）；广播者 waiting 期唯一合法推进 = cancel_broadcast → 目标选不好就取消止损。
- 淘汰判定（strike.go:405-439）：降维(Lv4 非弃手牌)无视防御淘汰；科技锁死只弃手牌；
  其余 打击等级 > 目标星系防御等级 才淘汰。防御等级从对手场上明牌（faceUpCards，
  可见）解析：掩体星环=2、量子幽灵=3。
- classic legalActions 无 play_card；lightspeed_ship 不在 driver 动作表 → 均不使用。
- 内嵌默认星图拓扑（backend/internal/game/starmap.go 的 14 条边镜像）用于 range 计算；
  快速匹配默认使用该图，自定义图会降级（候选集偏大，仍安全）。

打击即探测（观点 1，源码验证）：
- classic 无遗留物（StrikeCanDestroyRelic=false，mode_rules.go:224）→ 落空 = 星系无玩家。
- "宣布…生效"日志（strike.go:289）PlayerIDs = [打击者] + [玩家层目标]：
  · 仅打击者 = 星系层命中（光粒/湮灭/降维打空星系）→ 排除该星系
  · 含对手 = 玩家层命中 → 位置权威确认
  → 所有打击都是排除型：打空排除、命中确认/淘汰，双向收敛。
- 落空日志"【X】打击落空"（strike.go:602）只覆盖热核/科技锁死打空，公开携带星系号。
- 星系级卡打空有独立战略价值（探测选卡按此排序，非最低成本）：
  · 降维 = 永久封锁（星系移出对手跃迁 available，turn.go:426）
  · 湮灭 = 毁星 + 余波跃迁干扰（打空也触发，strike.go:320）
  · 光粒 = 毁星
- classic 飞船 = 一次性牌，10 费随机跃迁至无文明星球（位置不公开，turn.go:369-375）
  → 对手跃迁 = 排除集/候选集全部作废（随机落点可能在被排除星系）。
- 后期能量充裕 + 位置未知 → 主动探测打击：命中 = 淘汰/弃手牌/确认位置，落空 = 排除收敛。

隐蔽期弃广播牌（观点 2，源码验证）：
- BroadcastResponse 的 canRespond = 位置在广播目标 range 内 **且手中有广播牌且能量足够**
  （broadcast.go:67-84）；responses 列表（PlayerID/CanRespond/Responded/Agreed）无条件
  对全体玩家公开（view_state.go:322-338，仅 ResponseCard 按阶段门控）→
  隐蔽期手留广播牌 = 对手广播扫到你时，你的位置出现在公开列表 → 位置泄露。
  → 位置未公开前，手牌中的广播牌一律弃掉（**无条件**：0 费也弃；手牌数对手始终
  可见（foes[].handCount），弃广播只暴露"隐蔽流"战略——而隐蔽流无有效反制；
  弃多张 → 下回合 DrawPhase 补更多牌（cardsNeeded = 4 - len(hand)））。
- 死锁预防：DrawPhase 只在手牌 <4 时补牌（turn.go:237）→ 手牌满 4 后永不抽新牌。
  隐蔽期无条件弃广播牌 = 手牌必然 <4 → 必补牌；此外**任何时期手牌 ≥4 且无正收益
  动作时，按价值补弃到 <_HAND_LIMIT-1**（广播 > 饱和防御 > 恒星已毁太阳能/热核 >
  其他打击 > 未饱和设施/防御）——饱和防御（已有 ≥ 同等级，防御取最高不叠加）、
  恒星已毁的太阳能（停摆）、热核等都是"现在打不出去"的牌，弃掉无损且换新牌。
  设施**无数量上限**（DeployCard 仅戴森球按星系唯一），未停摆设施应部署而非弃。
  位置未公开时强制弃广播会把"非广播计数"
  压到 <4，原补弃循环（len(hand)-len(discards) >= _HAND_LIMIT）会漏触发，故终局
  另加 9c 兜底：本回合无正向动作且手上仍有死牌时，强制再弃 1 张死牌，保证死牌每
  回合收缩。任何牌型都不许卡手死锁（回放 dacd6dc3：AgentSeven 39 能量全被动即此
  死锁；[打击×3 + 广播] 即原漏网牌型，由 9c 修复）。

优先级（己方 actionPhase）：
  击杀打击 > 暴露后防御 > 产能设施 > 隐蔽期防御保险 > 科技锁死 > 最新广播目标赌博
  > 后期探测打击 > 0 费广播套利 > 回收 > 结束回合（隐蔽期弃广播牌 + 超手牌补弃）
"""

import re

from autonomous_driver.decide import GameAction

# --- 默认星图邻接（镜像 backend/internal/game/starmap.go StarEdges）---
_ADJ: dict[int, set[int]] = {
    1: {2, 3},
    2: {1, 3, 4},
    3: {1, 2, 4, 5},
    4: {2, 3, 5, 6},
    5: {3, 4, 6, 7},
    6: {4, 5, 7, 8},
    7: {5, 6, 8},
    8: {6, 7, 9},
    9: {8},
}

# --- 卡牌常量（镜像 mcpserver/internal/semantic/card_library.go）---
# 防御卡 defId → 防御等级
_DEFENSE_LEVELS: dict[str, int] = {
    "defense_shield_ring": 2,
    "defense_quantum_ghost": 3,
}
# 产能设施（每回合 +能量；cards.go 各卡 energy_per_turn）：
#   facility_solar_array 太阳能阵列 2费 +1（依赖恒星，恒星已毁停摆 settlement.go:15-32）
#   facility_fusion_reactor 聚变反应堆 3费 +1（不依赖恒星）
#   facility_antimatter_engine 反物质引擎 6费 +2（不依赖恒星）
# 注意：DeployCard（cards_actions.go:35-111）**无设施数量上限**（仅戴森球按星系唯一），
# 产能设施可无限部署，不存在"2 座上限"；戴森球（依赖恒星+同星系唯一）与监听基地
# （无产能）不在此列。
_ENERGY_FACILITIES: frozenset[str] = frozenset(
    {"facility_solar_array", "facility_fusion_reactor", "facility_antimatter_engine"}
)
# 0 费广播（恒星广播）——套利专用
_STAR_BROADCASTS: frozenset[str] = frozenset(
    {"broadcast_star_cooperation", "broadcast_star_disguise"}
)
# 广播卡 defId → range
_BROADCAST_RANGES: dict[str, int] = {
    "broadcast_star_cooperation": 1,
    "broadcast_star_disguise": 1,
    "broadcast_cosmic_cooperation": 2,
    "broadcast_cosmic_disguise": 2,
    "broadcast_ultra_cooperation": 1000,
    "broadcast_ultra_disguise": 1000,
}

_HAND_LIMIT = 4  # 回合结束手牌上限（rules_descriptions.go:135）


def _systems_within(center: int, radius: int) -> set[int]:
    """默认星图上图距离 <= radius 的星系集合（含自身；radius 极大 = 全部 1-9）。"""
    if radius >= 8:
        return set(range(1, 10))
    seen = {center}
    frontier = {center}
    for _ in range(radius):
        nxt: set[int] = set()
        for s in frontier:
            nxt |= _ADJ.get(s, set())
        frontier = nxt - seen
        seen |= nxt
    return seen


def _defense_level(cards) -> int:
    """从明牌列表（SimpleCard/完整卡 dict）解析最高防御等级。"""
    best = 0
    for c in cards or []:
        if not isinstance(c, dict):
            continue
        lvl = _DEFENSE_LEVELS.get(str(c.get("defId") or ""), 0)
        best = max(best, lvl)
    return best


class ScriptDecider:
    """位置博弈型决策器：隐蔽生存 → 产能经济 → 位置线索后精准打击。"""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        """局前重置（driver 批量模式调用）。"""
        self.state: dict = {
            "turns": 0,
            "total_turn": 0,       # 当局真实回合数（cursor.totalTurn）
            "energy": 0,
            "hand": [],            # list[dict]（真实）/ list[str]（L1 校验 fixture）
            "face_up": [],         # 自身明牌（SimpleCard dict）
            "my_position": None,   # int
            "position_public": False,
            "my_defense": 0,
            "my_facilities": 0,
            "star_destroyed": False,   # 自身所在星系恒星是否已被摧毁
            "foe_id": None,
            "foe_position": None,      # 权威/收敛线索（int|None）
            "foe_candidates": None,    # set[int]|None：广播推断的候选星系
            "excluded_systems": set(),  # set[int]：打击落空排除的星系（对手不在）
            "foe_defense": 0,
            "last_broadcast": None,    # (turn, target_system)
            "last_match": None,
            "last_result": None,
        }

    # ── 协议入口 ──

    def decide(self, view: dict, affordance: dict) -> GameAction:
        self.state["turns"] += 1
        self._update_state(view)

        pending = affordance.get("pendingAction")
        if pending:
            return self._resolve_pending(pending)

        broadcast = affordance.get("broadcastAction")
        if broadcast:
            return self._resolve_broadcast(broadcast)

        return self._pick_free(affordance.get("legalActions") or [])

    def on_game_end(self, match_id: str, result: str) -> None:
        self.state["last_match"] = match_id
        self.state["last_result"] = result

    # ── 态势更新 ──

    def _update_state(self, view: dict) -> None:
        agent = view.get("agentView") or {}
        self_snap = agent.get("self") or {}
        cursor = agent.get("cursor") or {}
        total_turn = cursor.get("totalTurn")
        self.state["total_turn"] = total_turn if isinstance(total_turn, int) else 0

        energy = self_snap.get("energy")
        self.state["energy"] = energy if isinstance(energy, int) else 0

        hand = self_snap.get("hand") or []
        self.state["hand"] = hand if isinstance(hand, list) else []
        face_up = self_snap.get("faceUpCards") or []
        self.state["face_up"] = face_up if isinstance(face_up, list) else []
        self.state["my_defense"] = _defense_level(self.state["face_up"])
        self.state["my_facilities"] = sum(
            1
            for c in self.state["face_up"]
            if isinstance(c, dict) and c.get("defId") in _ENERGY_FACILITIES
        )

        pos_view = view.get("position") or {}
        my_pos = pos_view.get("myPosition") or {}
        if isinstance(my_pos.get("system"), int) and my_pos["system"] > 0:
            self.state["my_position"] = my_pos["system"]
        self.state["position_public"] = bool(
            my_pos.get("isPublic") or self_snap.get("positionIsPublic")
        )
        destroyed = (agent.get("field") or {}).get("destroyedStars") or []
        self.state["star_destroyed"] = self.state["my_position"] in destroyed

        # 对手（1v1：foes 至多 1 个非淘汰项）
        foe_id = None
        foe_position = None
        foe_defense = 0
        for f in (agent.get("foes") or []):
            if f.get("eliminated"):
                continue
            foe_id = f.get("id")
            p = f.get("position") or {}
            if p.get("known") and isinstance(p.get("system"), int) and p["system"] > 0:
                foe_position = p["system"]
            foe_defense = _defense_level(f.get("faceUpCards"))
            break
        self.state["foe_id"] = foe_id
        if foe_position is None:
            # knownFoePositions 兜底（玩家视角恒空，防未来协议变化）
            for v in (pos_view.get("knownFoePositions") or {}).values():
                if isinstance(v, int) and v > 0:
                    foe_position = v
                    break
        self.state["foe_defense"] = foe_defense

        # 对手位置推断：扫描事件流里的对手广播（含目标星系 + 卡牌 range）
        self._infer_foe_from_events(agent)

        # 打击探测信息：落空排除 / 命中确认 / 跃迁重置（不筛 player，公开信息）
        self._update_probe_state(agent)

        # 权威/收敛位置优先；本次无新线索 → 不携带陈旧位置
        # （对手光速飞船跃迁后位置重置为未知，见 _infer_foe_from_events）
        if foe_position is not None:
            self.state["foe_position"] = foe_position
        elif self.state["foe_candidates"] and len(self.state["foe_candidates"]) == 1:
            self.state["foe_position"] = next(iter(self.state["foe_candidates"]))
        else:
            self.state["foe_position"] = None

    def _infer_foe_from_events(self, agent: dict) -> None:
        """从事件日志推断对手位置：对手广播 → 目标 ± range 候选集（交集收敛）。"""
        foe_id = self.state["foe_id"]
        if not foe_id:
            return
        entries = (agent.get("events") or {}).get("entries") or []
        if not isinstance(entries, list):
            return
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            pids = entry.get("playerIds") or []
            if not pids or foe_id not in pids:
                continue
            msg = str(entry.get("message") or "")
            # 光速飞船跃迁：classic 正常日志"X 使用光速飞船跃迁"（turn.go:538，无星系号）、
            # 余波场景"跃迁至星系 ???…"（turn.go:530，脱敏）、惩罚日志"受跃迁惩罚影响"
            # （turn.go:20）——任何跃迁事件都意味着对手位置可能改变 → 清空全部位置线索
            if "跃迁" in msg:
                self.state["foe_candidates"] = None
                self.state["foe_position"] = None
                self.state["last_broadcast"] = None
                continue
            # 广播发起日志：PlayerIDs[0] = 广播者（broadcast.go:112）
            if pids[0] != foe_id or "广播" not in msg or "发送" not in msg:
                continue
            sys_id = entry.get("systemId")
            if not isinstance(sys_id, int) or sys_id <= 0:
                continue
            card = str(entry.get("cardDefId") or "")
            radius = _BROADCAST_RANGES.get(card, 1)
            cand = _systems_within(sys_id, radius)
            old = self.state["foe_candidates"]
            if old is None:
                self.state["foe_candidates"] = cand
            else:
                merged = old & cand
                self.state["foe_candidates"] = merged if merged else cand
            turn = entry.get("turn")
            self.state["last_broadcast"] = (
                turn if isinstance(turn, int) else 0,
                sys_id,
            )

    def _update_probe_state(self, agent: dict) -> None:
        """打击探测信息（观点 1）：公开日志里读取位置事实。

        - 落空日志（任何人打空，strike.go:602，SystemID 公开）→ 排除该星系
          （classic 无遗留物，落空 = 无玩家）。
        - "宣布…生效"日志 PlayerIDs = [打击者] + [玩家层目标]（strike.go:289）：
          · 仅 1 人 = 星系层命中（光粒/湮灭/降维打空星系）→ 排除该星系
          · 含对手 = 玩家层命中 → 位置权威确认
        - 对手跃迁日志 → 排除集/候选集全清（随机落点可能在被排除星系）。
        - "成功抵御了"防御日志（PlayerIDs 含 foe）→ 位置确认 + 防御等级更新。
        """
        foe_id = self.state["foe_id"]
        entries = (agent.get("events") or {}).get("entries") or []
        if not isinstance(entries, list):
            return
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            pids = entry.get("playerIds") or []
            msg = str(entry.get("message") or "")
            sys_id = entry.get("systemId")
            sid = sys_id if isinstance(sys_id, int) and sys_id > 0 else None

            # 落空：任何玩家打空，该星系即排除（1v1 下非对手位置）
            if "打击落空" in msg and sid is not None:
                self.state["excluded_systems"].add(sid)
                continue

            # 对手跃迁（含"使用光速飞船跃迁"/"跃迁至星系 ???"/跃迁惩罚日志）：
            # 随机落点，全部位置信息作废
            if foe_id and pids and foe_id in pids and "跃迁" in msg:
                self.state["excluded_systems"].clear()
                continue

            # 星系层命中（打空）：宣布生效日志 PlayerIDs 仅打击者 → 星系无玩家
            # （光粒/湮灭/降维打空星系 = 星系层命中，不落空但无玩家层效果，
            #   strike.go:49-56, 289；classic 无遗留物，无其他目标来源）
            if (
                sid is not None
                and "宣布" in msg
                and "生效" in msg
                and pids
                and len(pids) == 1
            ):
                self.state["excluded_systems"].add(sid)
                continue

            # 命中确认：玩家层命中（打击者 + 至少一个目标玩家）
            if (
                foe_id
                and sid is not None
                and "宣布" in msg
                and "生效" in msg
                and foe_id in pids
                and len(pids) >= 2
            ):
                self.state["foe_position"] = sid
                self.state["foe_candidates"] = {sid}
                continue

            # 防御成功：位置 + 防御等级公开（strike.go:427）
            if (
                foe_id
                and sid is not None
                and "成功抵御了" in msg
                and foe_id in pids
            ):
                self.state["foe_position"] = sid
                self.state["foe_candidates"] = {sid}
                m = re.search(r"等级\s*(\d+)", msg)
                if m:
                    self.state["foe_defense"] = max(
                        self.state["foe_defense"], int(m.group(1))
                    )

    # ── 强制挂起动作 ──

    @staticmethod
    def _first_target(targets, ttype: str) -> str | None:
        for t in targets or []:
            if t.get("type") == ttype and t.get("value") is not None:
                return str(t["value"])
        return None

    def _resolve_pending(self, pending: dict) -> GameAction:
        options = [str(o) for o in (pending.get("legalOptions") or [])]
        targets = pending.get("legalTargets") or []
        ptype = str(pending.get("type") or "")
        skip = ("skip_select", "skip_move", "skip_announce", "skip_missed", "discard_missed")

        # 1) 保守跳过类优先（无需目标、不卡死）
        for opt in options:
            if opt in skip:
                if opt in ("skip_missed", "discard_missed"):
                    su = self._first_target(targets, "strikeUid")
                    if su:
                        return GameAction(
                            "resolve_strike_action", {"option": opt, "strike_uid": su}
                        )
                    # 真实落空 pending 无 legalTargets：不冒险，直接跳过回合
                    return GameAction("end_turn")
                return GameAction("resolve_strike_action", {"option": opt})

        # 2) 有选项：取第一个（move/retarget 等）
        if options:
            args: dict = {"option": options[0]}
            su = self._first_target(targets, "strikeUid")
            if su:
                args["strike_uid"] = su
            s = self._first_target(targets, "systemId")
            if s:
                args["target_system"] = int(s)
            return GameAction("resolve_strike_action", args)

        # 3) 无选项：按类型推断（经典模式正常不会出现，防御性支持）
        if ptype in ("announceStrike", "announce"):
            return GameAction("resolve_strike_action", {"option": "announce"})
        if ptype in ("strikeSelect", "select"):
            su = self._first_target(targets, "strikeUid")
            if su:
                return GameAction(
                    "resolve_strike_action", {"option": "select", "strike_uid": su}
                )
        # 未知类型：结束回合防卡死
        return GameAction("end_turn")

    # ── 广播待处理 ──

    def _card_field(self, card, key):
        """取手牌条目字段；字符串条目（L1 fixture）返回 None。"""
        if isinstance(card, dict):
            v = card.get(key)
            if v is not None:
                return v
        return None

    def _card_uid(self, card) -> str | None:
        uid = self._card_field(card, "uid")
        return str(uid) if uid is not None else None

    def _hand_card_by_uid(self, uid: str | None):
        if not uid:
            return None
        for c in self.state["hand"]:
            if self._card_uid(c) == uid:
                return c
        return None

    def _broadcast_card_uid(self) -> str | None:
        """挑一张最便宜且付得起的广播牌（回应/套利用）。"""
        best_cost = 999
        best_uid = None
        for c in self.state["hand"]:
            if self._card_field(c, "type") != "broadcast":
                continue
            uid = self._card_uid(c)
            if not uid:
                continue
            cost = self._card_field(c, "energy")
            cost = cost if isinstance(cost, int) else 0
            if cost < best_cost:
                best_cost = cost
                best_uid = uid
        if best_uid is not None and best_cost <= self.state["energy"]:
            return best_uid
        return None

    def _resolve_broadcast(self, broadcast: dict) -> GameAction:
        btype = str(broadcast.get("type") or "")
        targets = broadcast.get("legalTargets") or []
        options = [str(o) for o in (broadcast.get("legalOptions") or [])]

        if btype == "agreeOrRefuse":
            # 位置未公开：拒绝（回应 = 承认自己在广播范围内，破坏隐蔽）
            if not self.state["position_public"]:
                return GameAction("respond_broadcast", {"agreed": False})
            # 位置已公开：同意合作（+3/+5 正 EV），需要一张广播牌
            card_uid = self._first_target(targets, "cardUid")  # fixture 兼容
            if not card_uid:
                card_uid = self._broadcast_card_uid()
            if card_uid:
                return GameAction(
                    "respond_broadcast", {"agreed": True, "card_uid": card_uid}
                )
            return GameAction("respond_broadcast", {"agreed": False})

        if btype == "selectResponder":
            # 我发起的广播有人同意：必须选回应者（interrupted 阶段 end_turn 必被拒）
            pid = self._first_target(targets, "playerId")
            if not pid and options:
                pid = options[0]  # 真实投影：回应者 playerId 在 legalOptions
            if pid:
                return GameAction(
                    "select_broadcast_responder", {"responder_player_id": pid}
                )
            return GameAction("cancel_broadcast")  # 兜底：取消优于被拒

        if btype == "cancel":
            # 我发起的广播在 waiting：唯一合法推进 = 取消（+1 退款止损）
            return GameAction("cancel_broadcast")

        return GameAction("end_turn")

    # ── 自由动作 ──

    def _pick_free(self, legal: list) -> GameAction:
        energy = self.state["energy"]
        by_action: dict[str, list] = {}
        for opt in legal:
            by_action.setdefault(str(opt.get("action") or ""), []).append(opt)
        strikes = by_action.get("strike", [])
        deploys = by_action.get("deploy_card", [])
        broadcasts = by_action.get("broadcast", [])
        recycles = by_action.get("recycle_card", [])

        foe_pos = self.state["foe_position"]

        # 1) 击杀打击：位置明确且能淘汰
        if foe_pos is not None and strikes:
            pick = self._best_strike(strikes)
            if pick and pick[3]:
                _cost, opt, uid, _elim = pick
                return GameAction("strike", {"card_uid": uid, "target_system": foe_pos})

        # 2) 暴露后防御：位置已公开 → 尽快补防（量子幽灵 > 掩体星环）
        if self.state["position_public"] and deploys:
            act = self._defense_play(deploys)
            if act:
                return act

        # 3) 产能设施：太阳能/聚变（每回合 +1，前期核心引擎）
        if deploys:
            act = self._facility_play(deploys)
            if act:
                return act

        # 4) 隐蔽期防御保险：能量富余时先补防（为后续广播套利铺路）
        if deploys and energy >= 7:
            act = self._defense_play(deploys)
            if act:
                return act

        # 5) 科技锁死：位置明确但打不穿 → 弃光对手手牌（Lv4 无视防御）
        if foe_pos is not None and strikes:
            pick = self._best_strike(strikes)
            if pick and not pick[3]:
                _cost, opt, uid, _elim = pick
                return GameAction("strike", {"card_uid": uid, "target_system": foe_pos})

        # 6) 最新广播目标赌博：对手刚广播（≤2 回合）且位置未收敛 → 打最新目标
        #    （自目标广播是 +1 套利常见打法；对 v3 类对手 100% 命中）
        if strikes and self.state["last_broadcast"]:
            last_turn, last_target = self.state["last_broadcast"]
            age = self.state["total_turn"] - last_turn
            if 0 <= age <= 2:  # 防御 totalTurn 回退/陈旧事件
                uid = self._cheapest_strike_uid(strikes)
                if uid:
                    return GameAction(
                        "strike", {"card_uid": uid, "target_system": last_target}
                    )

        # 7) 后期探测打击（观点 1）：位置未知 + 能量充裕 → 打未排除星系
        #    选卡按战略价值（降维封锁 > 湮灭毁星+余波 > 光粒毁星 > 热核/科技锁死纯排除）；
        #    命中 = 淘汰/弃手牌/确认位置，打空 = 排除 / 封锁 / 毁星（下回合收敛）
        #    触发条件集中在本类 _probe_fireable（与 _unplayable_uids 共用，防阈值漂移）
        if strikes and self.state["foe_position"] is None:
            fire = self._probe_fireable(strikes)
            if fire:
                _cost, uid = fire
                target = self._probe_target()
                if target is not None:
                    return GameAction(
                        "strike", {"card_uid": uid, "target_system": target}
                    )

        # 8) 0 费恒星广播套利：位置已公开（+1 能量，无人回应/取消均退款）
        if self.state["position_public"] and broadcasts:
            act = self._broadcast_play(broadcasts)
            if act:
                return act

        # 9) 回收：场上有死牌明牌（停摆太阳能/饱和防御）→ 回收换能量。
        #    原触发条件 len(hand)>=6 在 classic 永不可达（手牌恒 ≤4，DrawPhase
        #    抽到 4 即停，turn.go:237）→ 回收形同虚设；改为按"值得回收的明牌"
        #    触发（_recyclable_face_up_uids），且绝不回收产能设施——长期产出
        #    > 一次性 0.5 返还（affordance_explorer.go:319 refund = Energy/2）。
        if recycles:
            act = self._recycle_play(recycles, self._recyclable_face_up_uids())
            if act:
                return act

        # 10) 结束回合
        #     走到这里说明本回合没有任何正向动作（打击/部署/广播/回收都没打）。
        #     死锁预防（核心）：保证终局手牌 < 上限，使 DrawPhase 必补牌；并且**主动
        #     弃掉"打不出去"的死牌**（典型：无对手位置的打击牌）——否则这些牌会长期
        #     卡手、能量空转（回放 dacd6dc3：AgentSeven 39 能量全被动即此死锁）。
        #     隐蔽期广播牌强制弃（防位置泄露，优先级最高）。
        args: dict = {}
        hand = self.state["hand"]
        discards: list = []

        # 9a) 隐蔽期：广播牌一律强制弃（0 费也弃，防位置泄露）
        if not self.state["position_public"]:
            for c in hand:
                if self._card_field(c, "type") == "broadcast":
                    uid = self._card_uid(c)
                    if uid:
                        discards.append(uid)

        # 9b) 保证周转：终局手牌 <= _HAND_LIMIT-1，使 DrawPhase 必补牌
        target = _HAND_LIMIT - 1
        for uid in self._discard_choice(len(hand)):
            if uid in discards:
                continue
            if len(hand) - len(discards) <= target:
                break
            discards.append(uid)

        # 9c) 仍卡手（广播已弃、死牌未动）→ 强制弃 1 张死牌，确保死牌每回合收缩。
        #     触发条件：存在死牌 且 discards 里还没有任何死牌（只弃了广播/补弃）。
        #     不能用 len(hand)-len(discards) 判——广播 ≥2 张时该值 < target，
        #     [死牌×2 + 广播×2] 会漏触发（2 >= 3 不成立），死牌仍长期卡手。
        unplayable = self._unplayable_uids(strikes)
        if unplayable and not any(u in discards for u in unplayable):
            for uid in unplayable:
                if uid not in discards:
                    discards.append(uid)
                    break

        if discards:
            args["discard_cards"] = discards
        return GameAction("end_turn", args)

    # ── 动作构造辅助 ──

    def _option_card_uid(self, opt) -> str | None:
        return self._first_target(opt.get("legalTargets") or [], "cardUid")

    def _best_strike(self, strikes: list) -> tuple | None:
        """选最优打击：能淘汰的最便宜优先；否则科技锁死兜底。

        返回 (cost, opt, card_uid, can_eliminate) 或 None。
        """
        elims: list = []
        tech: tuple | None = None
        for opt in strikes:
            uid = self._option_card_uid(opt)
            card = self._hand_card_by_uid(uid)
            if card is None:
                continue
            level = self._card_field(card, "level")
            cost = self._card_field(card, "energy")
            effect = str(self._card_field(card, "effect") or "")
            level = level if isinstance(level, int) else 0
            cost = cost if isinstance(cost, int) else 0
            if effect == "discard_hand":
                if tech is None or cost < tech[0]:
                    tech = (cost, opt, uid)
                continue
            can_elim = level >= 4 or level > self.state["foe_defense"]
            if can_elim:
                elims.append((cost, level, opt, uid))
        if elims:
            elims.sort(key=lambda x: (x[0], -x[1]))  # 最便宜优先，同级高级优先
            cost, _level, opt, uid = elims[0]
            return (cost, opt, uid, True)
        if tech:
            cost, opt, uid = tech
            return (cost, opt, uid, False)
        return None

    def _cheapest_strike_uid(self, strikes: list) -> str | None:
        best = None
        for opt in strikes:
            uid = self._option_card_uid(opt)
            if not uid:
                continue
            cost = (opt.get("cost") or {}).get("energy", 0)
            cost = cost if isinstance(cost, int) else 0
            if best is None or cost < best[0]:
                best = (cost, uid)
        return best[1] if best else None

    # ── 探测打击（观点 1）──

    def _probe_strike(self, strikes: list) -> tuple | None:
        """探测用卡：按战略价值优先，而非最低成本。

        星系级卡打空也有独立收益（strike.go:296-393），命中收益更强：
        - 降维（10费）：打空 = 永久封锁星系（移出对手跃迁 available，turn.go:426，
          封到 8 个后对手无法跃迁）；命中 = Lv4 无视防御淘汰。
        - 湮灭（8费）：打空 = 毁星 + 余波跃迁干扰（打空也触发，strike.go:320，
          对手跃迁踩中 = 下回合罚站）；命中 = 毁星 + 清设施/低防 + 余波。
        - 光粒（6费）：打空 = 毁星；命中 = 毁星 + 防御<2 则淘汰。
        - 热核/科技锁死（4费）：纯排除（打空落空），保底手段。
        返回 (cost, uid) 或 None。
        """
        order = {
            "strike_dimensional": 0,
            "strike_annihilation": 1,
            "strike_light_particle": 2,
            "strike_thermal": 3,
            "strike_tech_lock": 4,
        }
        best = None
        for opt in strikes:
            uid = self._option_card_uid(opt)
            card = self._hand_card_by_uid(uid)
            if card is None:
                continue
            defid = str(self._card_field(card, "defId") or "")
            prio = order.get(defid)
            if prio is None:
                continue
            cost = self._card_field(card, "energy")
            cost = cost if isinstance(cost, int) else 0
            if best is None or prio < best[0]:
                best = (prio, cost, uid)
        if best is None:
            return None
        return (best[1], best[2])

    def _probe_target(self) -> int | None:
        """探测目标：候选集内未排除星系优先，否则编号最小的未排除星系。"""
        excluded = self.state["excluded_systems"]
        cand = self.state["foe_candidates"]
        if cand:
            remain = sorted(s for s in cand if s not in excluded)
            if remain:
                return remain[0]
        for s in range(1, 10):
            if s not in excluded:
                return s
        return None

    def _defense_play(self, deploys: list) -> GameAction | None:
        """部署更高等级的防御（量子幽灵 Lv3 > 掩体星环 Lv2）。"""
        if self.state["my_defense"] >= 3:
            return None
        best = None  # (lvl, cost, opt, uid)
        for opt in deploys:
            card = self._hand_card_by_uid(self._option_card_uid(opt))
            if card is None:
                continue
            defid = str(self._card_field(card, "defId") or "")
            lvl = _DEFENSE_LEVELS.get(defid)
            if lvl is None or lvl <= self.state["my_defense"]:
                continue
            cost = self._card_field(card, "energy")
            cost = cost if isinstance(cost, int) else 0
            uid = self._card_uid(card)
            if best is None or lvl > best[0] or (lvl == best[0] and cost < best[1]):
                best = (lvl, cost, opt, uid)
        if best is None:
            return None
        _lvl, cost, _opt, uid = best
        if self.state["energy"] < cost + 1:
            return None
        return GameAction("deploy_card", {"card_uid": uid})

    def _facility_play(self, deploys: list) -> GameAction | None:
        """部署产能设施（太阳能优先，自身星系恒星已毁则避太阳能）。

        引擎对设施**无数量上限**（cards_actions.go:35-111，仅戴森球按星系唯一，
        而戴森球不在此集合）——设施越多每回合产能越高，能部署就部署。
        """
        best = None  # (cost, opt, uid)
        for opt in deploys:
            uid = self._option_card_uid(opt)
            card = self._hand_card_by_uid(uid)
            if card is None:
                # L1 fixture 手牌为字符串：信任 affordance 直接部署
                if uid:
                    return GameAction("deploy_card", {"card_uid": uid})
                continue
            defid = str(self._card_field(card, "defId") or "")
            if defid not in _ENERGY_FACILITIES:
                continue
            if defid == "facility_solar_array" and self.state["star_destroyed"]:
                continue  # 恒星已毁，太阳能阵列停摆
            cost = self._card_field(card, "energy")
            cost = cost if isinstance(cost, int) else 0
            if best is None or cost < best[0]:
                best = (cost, opt, uid)
        if best is None:
            return None
        cost, _opt, uid = best
        if self.state["energy"] < cost + 1:
            return None
        return GameAction("deploy_card", {"card_uid": uid})

    def _broadcast_play(self, broadcasts: list) -> GameAction | None:
        """0 费恒星广播套利：目标优先自身星系（必在 legalTargets 内）。"""
        best = None  # (cost, opt, uid)
        for opt in broadcasts:
            card = self._hand_card_by_uid(self._option_card_uid(opt))
            if card is None:
                continue
            defid = str(self._card_field(card, "defId") or "")
            if defid not in _STAR_BROADCASTS:
                continue
            cost = self._card_field(card, "energy")
            cost = cost if isinstance(cost, int) else 0
            if cost != 0:
                continue
            uid = self._card_uid(card)
            if best is None or cost < best[0]:
                best = (cost, opt, uid)
        if best is None:
            return None
        _cost, opt, uid = best
        target = None
        for t in (opt.get("legalTargets") or []):
            if t.get("type") == "systemId" and int(t["value"]) == self.state["my_position"]:
                target = int(t["value"])
                break
        if target is None:
            for t in (opt.get("legalTargets") or []):
                if t.get("type") == "systemId":
                    target = int(t["value"])
                    break
        if target is None:
            return None
        return GameAction("broadcast", {"card_uid": uid, "target_system": target})

    def _recyclable_face_up_uids(self) -> list:
        """场上值得回收的死牌明牌 uid（回收只该动死牌，绝不回收产能设施）。

        返还比例 0.5（affordance_explorer.go:319 refund = card.Energy/2），
        产能设施长期产出 > 一次性返还，回收即亏；只回收"现在没有收益"的明牌：
        - 恒星已毁的太阳能阵列（停摆，settlement.go:15-32）
        - 防御等级 < 场上最高防御的防御牌（回收不降 maxProtection，
          strike.go:396-403 取最高值；如场上 Lv3+掩体 Lv2，回收掩体无损）
        注意 faceUpCards 是完整 Card（view_state.go:32,157，含 uid/type/defId），
        可与 recycle opt 的 cardUid 直接匹配。
        """
        out: list = []
        for c in self.state["face_up"]:
            if not isinstance(c, dict):
                continue
            uid = c.get("uid")
            if not uid:
                continue
            defid = str(c.get("defId") or "")
            t = str(c.get("type") or "")
            if t == "facility":
                if defid == "facility_solar_array" and self.state["star_destroyed"]:
                    out.append(str(uid))
            elif t == "defense":
                lvl = _DEFENSE_LEVELS.get(defid, 0)
                if lvl and lvl < self.state["my_defense"]:
                    out.append(str(uid))
        return out

    def _recycle_play(self, recycles: list, recyclable: list) -> GameAction | None:
        """回收明牌：只回收可回收集合内的死牌，选返还能量最多的一张。"""
        allowed = set(recyclable)
        best = None  # (refund, opt, uid)
        for opt in recycles:
            uid = self._option_card_uid(opt)
            if not uid or uid not in allowed:
                continue
            cost_e = (opt.get("cost") or {}).get("energy", 0)
            refund = -cost_e if isinstance(cost_e, int) else 0
            if best is None or refund > best[0]:
                best = (refund, opt, uid)
        if best is None:
            return None
        _refund, _opt, uid = best
        return GameAction("recycle_card", {"card_uid": uid})

    def _probe_fireable(self, strikes: list) -> tuple | None:
        """探测打击是否在本回合可触发（与 _pick_free 优先级 7 完全一致）。

        返回 (cost, uid) 或 None。**唯一权威判定**：_pick_free 优先级 7 与
        _unplayable_uids 均调用本方法，禁止各自内联条件（防止阈值漂移误判死牌）。
        不触发场景（真实存在，非假设）：
        - foe_position 已知 → 走击杀/锁死分支，不打探测；
        - total_turn < 4 → 早期回合；
        - energy < 选中探测牌 cost + 6（4~10 费 → 需 10~16 能量）；
        - _probe_target() 为 None → 全部星系已被排除（对手跃迁会清空排除集）。
        """
        if self.state["foe_position"] is not None:
            return None
        pick = self._probe_strike(strikes)
        if not pick:
            return None
        cost, uid = pick
        if self.state["total_turn"] < 4:
            return None
        if self.state["energy"] < cost + 6:
            return None
        if self._probe_target() is None:
            return None
        return (cost, uid)

    def _unplayable_uids(self, strikes: list) -> list:
        """当前态势下打不出去的手牌 uid（死锁死牌）。

        用于终局兜底（9c）：本回合无任何正向动作时，确保这些牌每回合至少弃掉 1 张，
        避免长期卡手。判定保守——只有确实打不出去的牌才计入：
        - strike：无精确对手位置 且 探测本回合不可触发（_probe_fireable 权威判定）。
          位置已知时打击总能打出去（击杀或科技锁死弃手牌），不算死牌；
          探测可触发时本回合会打出 1 张，其余打击牌留着后续回合用，也不算死牌。
        - facility：仅恒星已毁的太阳能阵列停摆（settlement.go:15-32）为死牌；
          其余产能设施（聚变/反物质/未毁太阳能）**无数量上限**（cards_actions.go
          无设施上限，仅戴森球按星系唯一），随时可部署，不算死牌。
        - defense：场上已有 ≥ 同等级防御（防御等级取最高值不叠加，strike.go:396-403；
          湮灭 Lv3 只摧毁 ProtectionLevel < 3 的防御，strike.go:333-354，Lv2/Lv3
          备份均无额外收益）→ 部署不提升防御，饱和。更高级别防御（如场上 Lv2
          手上有量子幽灵 Lv3）不算死牌，会被 _defense_play 优先部署。
        广播牌由 9a 强制处理，不在此列。
        """
        out: list = []
        foe_pos = self.state["foe_position"]
        probe_fire = self._probe_fireable(strikes) if foe_pos is None else None
        for c in self.state["hand"]:
            uid = self._card_uid(c)
            if not uid:
                continue
            t = str(self._card_field(c, "type") or "")
            defid = str(self._card_field(c, "defId") or "")
            if t == "strike":
                if foe_pos is None and probe_fire is None:
                    out.append(uid)
            elif t == "facility":
                if (
                    defid == "facility_solar_array"
                    and self.state["star_destroyed"]
                ):
                    out.append(uid)
            elif t == "defense":
                if _DEFENSE_LEVELS.get(defid, 0) <= self.state["my_defense"]:
                    out.append(uid)
        return out

    def _discard_choice(self, n: int) -> list:
        """挑 n 张最低价值手牌弃掉。

        优先级（高→低）：广播 > 饱和防御 > 恒星已毁太阳能/热核 > 其他打击 > 未饱和
        设施/防御。
        饱和 = 弃了无损：
        - 防御：场上已有 ≥ 同等级明牌（防御等级取最高不叠加 strike.go:396-403，
          湮灭 Lv3 只摧毁 <3 的防御 strike.go:333-354，同等级/低级部署无收益）；
        - 设施：仅恒星已毁的太阳能阵列停摆（settlement.go:15-32）。**设施无数量
          上限**（cards_actions.go 无限制，仅戴森球按星系唯一），未停摆设施都是
          +能量资产，应部署而非弃，优先级最低；
        - 隐蔽期广播（位置泄露风险）。
        """
        ranked: list = []
        for c in self.state["hand"]:
            uid = self._card_uid(c)
            if not uid:
                continue
            t = str(self._card_field(c, "type") or "")
            defid = str(self._card_field(c, "defId") or "")
            cost = self._card_field(c, "energy")
            cost = cost if isinstance(cost, int) else 0

            if t == "broadcast":
                if self.state["position_public"]:
                    prio = 4 if cost > 0 else 1  # 公开后 0 费广播保留套利
                else:
                    # 隐蔽期：广播牌 = 位置泄露风险（responses 公开，broadcast.go:67-84）
                    # 0 费也弃——套利只在公开后有意义，留着是纯负资产
                    prio = 5
            elif t == "defense":
                # 场上已有 ≥ 同等级防御 → 饱和，弃掉无损
                lvl = _DEFENSE_LEVELS.get(defid, 0)
                prio = 4 if lvl <= self.state["my_defense"] else 0
            elif t == "facility":
                saturated = (
                    defid == "facility_solar_array"
                    and self.state["star_destroyed"]
                )
                prio = 3 if saturated else 0
            elif defid == "strike_thermal":
                prio = 3  # 热核：无特效打击，最弱
            elif t == "strike":
                prio = 2
            else:
                prio = 0  # 未饱和设施/防御最后弃
            ranked.append((prio, uid))
        ranked.sort(key=lambda x: x[0], reverse=True)
        return [uid for _prio, uid in ranked[:n]]
