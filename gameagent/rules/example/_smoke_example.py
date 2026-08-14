# -*- coding: utf-8 -*-
"""对 example/v1 用真实 schema 形状的 view/affordance 做行为冒烟。"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location(
    "_df_smoke", r"E:\DarkForest\gameagent\rules\example\v1.py"
)
m = importlib.util.module_from_spec(spec)
sys.modules["_df_smoke"] = m
spec.loader.exec_module(m)

Decider = m.ScriptDecider


def card(uid, defid, ctype, cost, **kw):
    d = {"uid": uid, "defId": defid, "name": defid, "type": ctype, "energy": cost, "description": ""}
    d.update(kw)
    return d


SOLAR = card("c1", "facility_solar_array", "facility", 2, energyPerTurn=1)
SHIELD = card("c2", "defense_shield_ring", "defense", 6, protectionLevel=2)
THERMAL = card("c3", "strike_thermal", "strike", 4, level=1)
TECH = card("c4", "strike_tech_lock", "strike", 4, level=4, effect="discard_hand")
STARBC = card("c5", "broadcast_star_cooperation", "broadcast", 0, range=1)
GHOST = card("c6", "defense_quantum_ghost", "defense", 8, protectionLevel=3)
DIMEN = card("c8", "strike_dimensional", "strike", 10, level=4)
ANNI = card("c9", "strike_annihilation", "strike", 8, level=3)


def view(hand, energy=10, my_pos=5, public=False, foes=None, events=None, face_up=None, total_turn=1):
    return {
        "inGame": True,
        "agentView": {
            "self": {"id": "me", "energy": energy, "hand": hand, "position": my_pos,
                     "positionIsPublic": public, "faceUpCards": face_up or [], "broadcastHistory": []},
            "foes": foes if foes is not None else [{"id": "foe", "name": "敌", "color": "blue", "eliminated": False,
                "position": {"known": False, "hint": "x"}, "handCount": 4, "faceUpCards": []}],
            "field": {"destroyedStars": []},
            "events": {"entries": events or []},
            "cursor": {"turnPhase": "actionPhase", "isMyTurn": True, "totalTurn": total_turn},
        },
        "position": {"myPosition": {"system": my_pos, "isPublic": public, "isExposedByBroadcast": False},
                     "reachable": [], "safeZones": [], "dangerZones": [], "knownFoePositions": {}},
    }


def free_aff(actions):
    # 真实 driver 传入的是 get_affordances().affordance（内层 dict）
    return {"legalActions": actions}


def opt(action, cost, *targets):
    return {"action": action, "cost": {"energy": cost}, "legalTargets": list(targets)}


def known_foe(pos, face_up=None):
    return [{"id": "foe", "name": "敌", "color": "blue", "eliminated": False,
             "position": {"known": True, "system": pos, "distanceFromMe": 2, "reachableInOneJump": False},
             "handCount": 4, "faceUpCards": face_up or []}]


results = []
D = Decider()

# 1) 隐蔽期第 1 回合：能量 3，手牌太阳能 → 部署太阳能
d = D.decide(view([SOLAR], energy=3), free_aff([opt("deploy_card", 2, {"type": "cardUid", "value": "c1"}), opt("end_turn", 0)]))
results.append(("1 T1 hidden solar", d))

# 2) 有击杀打击：foe 权威位置（防 0）+ 热核 → 打 8
v2 = view([THERMAL], energy=10, foes=known_foe(8))
v2["position"]["knownFoePositions"] = {"foe": 8}
d = D.decide(v2, free_aff([opt("strike", 4, {"type": "cardUid", "value": "c3"}, {"type": "systemId", "value": "8"}), opt("end_turn", 0)]))
results.append(("2 kill strike at 8", d))

# 3) 对手防御 Lv2：热核(1)打不动、光粒(2)也打不动 → 科技锁死兜底
v3 = view([THERMAL, TECH], energy=10, foes=known_foe(8, [{"defId": "defense_shield_ring", "name": "掩体星环", "role": "defense", "output": "防御Lv.2"}]))
v3["position"]["knownFoePositions"] = {"foe": 8}
d = D.decide(v3, free_aff([opt("strike", 4, {"type": "cardUid", "value": "c3"}, {"type": "systemId", "value": "8"}),
                           opt("strike", 4, {"type": "cardUid", "value": "c4"}, {"type": "systemId", "value": "8"}),
                           opt("end_turn", 0)]))
results.append(("3 tech-lock vs shield", d))

# 4) 对手量子幽灵(Lv3)：湮灭(3<=3)打不动、降维(Lv4)能打 → 打降维
v4 = view([ANNI, DIMEN], energy=12, foes=known_foe(8, [{"defId": "defense_quantum_ghost", "name": "量子幽灵", "role": "defense", "output": "防御Lv.3"}]))
v4["position"]["knownFoePositions"] = {"foe": 8}
d = D.decide(v4, free_aff([opt("strike", 8, {"type": "cardUid", "value": "c9"}, {"type": "systemId", "value": "8"}),
                           opt("strike", 10, {"type": "cardUid", "value": "c8"}, {"type": "systemId", "value": "8"}),
                           opt("end_turn", 0)]))
results.append(("4 dimensional vs ghost", d))

# 5) 对手广播事件（目标 5 = 自身星系，star range1）→ 新鲜赌博打 5
ev5 = [{"turn": 3, "phase": "actionPhase", "type": "broadcast",
        "message": "敌 向星系 5 发送了【恒星广播】 (手牌: 4 张)",
        "systemId": 5, "cardDefId": "broadcast_star_cooperation", "playerIds": ["foe"]}]
v5 = view([THERMAL], energy=10, events=ev5, total_turn=4)
d = D.decide(v5, free_aff([opt("strike", 4, {"type": "cardUid", "value": "c3"}, {"type": "systemId", "value": "5"}), opt("end_turn", 0)]))
results.append(("5 fresh broadcast gamble 5", d))

# 6) 位置未公开时收到广播回应请求 → 拒绝
d = D.decide(view([STARBC], energy=5, public=False),
             {"broadcastAction": {"type": "agreeOrRefuse", "description": "x", "legalOptions": ["agree", "refuse"]}})
results.append(("6 hidden refuse", d))

# 7) 位置已公开 + 有广播牌 → 同意
d = D.decide(view([STARBC], energy=5, public=True),
             {"broadcastAction": {"type": "agreeOrRefuse", "description": "x", "legalOptions": ["agree", "refuse"]}})
results.append(("7 public agree", d))

# 8) selectResponder → 选 legalOptions[0]
d = D.decide(view([], energy=5, public=True),
             {"broadcastAction": {"type": "selectResponder", "description": "x", "legalOptions": ["foe"]}})
results.append(("8 selectResponder", d))

# 9) cancel → cancel_broadcast
d = D.decide(view([], energy=5, public=True),
             {"broadcastAction": {"type": "cancel", "description": "x", "legalOptions": ["cancel"]}})
results.append(("9 broadcaster cancel", d))

# 10) 位置已公开 + 0 费恒星广播 → 广播套利（目标自身星系 5）
d = D.decide(view([STARBC], energy=5, public=True),
             free_aff([opt("broadcast", 0, {"type": "cardUid", "value": "c5"}, {"type": "systemId", "value": "4"}, {"type": "systemId", "value": "5"}),
                       opt("end_turn", 0)]))
results.append(("10 star broadcast arbitrage", d))

# 11) 位置已公开 + 防御 → 部署量子幽灵（防3 > 掩体防2）
d = D.decide(view([SHIELD, GHOST], energy=9, public=True),
             free_aff([opt("deploy_card", 6, {"type": "cardUid", "value": "c2"}),
                       opt("deploy_card", 8, {"type": "cardUid", "value": "c6"}),
                       opt("end_turn", 0)]))
results.append(("11 defense quantum", d))

# 12) 手牌超限(5) → end_turn 带弃牌（弃高费广播）
hand5 = [card("h1", "broadcast_cosmic_cooperation", "broadcast", 1), card("h2", "strike_thermal", "strike", 4),
         card("h3", "facility_fusion_reactor", "facility", 3), card("h4", "strike_tech_lock", "strike", 4),
         card("h5", "strike_light_particle", "strike", 6)]
d = D.decide(view(hand5, energy=2), free_aff([opt("end_turn", 0)]))
results.append(("12 end_turn discard", d))

# 13) 对手光速飞船跃迁 → 位置线索清空；后期能量充裕 → 转为探测打击（打星系 1）
D2 = m.ScriptDecider()
v13a = view([THERMAL], energy=10, foes=known_foe(8))
v13a["position"]["knownFoePositions"] = {"foe": 8}
D2.decide(v13a, free_aff([opt("end_turn", 0)]))
ev13 = [{"turn": 6, "phase": "actionPhase", "type": "system",
         "message": "敌 跃迁至星系 ???，受到湮灭打击余波影响，下回合无法行动",
         "systemId": None, "cardDefId": None, "playerIds": ["foe"]}]
v13b = view([THERMAL], energy=10, events=ev13, total_turn=7)
d = D2.decide(v13b, free_aff([opt("strike", 4, {"type": "cardUid", "value": "c3"}, {"type": "systemId", "value": "8"}), opt("end_turn", 0)]))
results.append(("13 jump -> probe", d))

# 14) 陈旧位置不携带：上局已知 8，本局无线索 → 不盲打
v14 = view([THERMAL], energy=10, foes=[{"id": "foe", "name": "敌", "color": "blue", "eliminated": False,
    "position": {"known": False, "hint": "x"}, "handCount": 4, "faceUpCards": []}])
d = D.decide(v14, free_aff([opt("strike", 4, {"type": "cardUid", "value": "c3"}, {"type": "systemId", "value": "8"}), opt("end_turn", 0)]))
results.append(("14 no stale position", d))

# 15) 观点 1·落空排除：对手热核打星系 3 落空（公开日志）→ 排除集 = {3}
D3 = m.ScriptDecider()
ev15 = [{"turn": 5, "phase": "actionPhase", "type": "combat",
         "message": "【热核打击】打击落空，已废弃到弃牌堆。",
         "systemId": 3, "cardDefId": "strike_thermal", "playerIds": ["foe"]}]
v15 = view([THERMAL], energy=10, events=ev15, total_turn=6)
D3.decide(v15, free_aff([opt("end_turn", 0)]))
print("15 excluded:", sorted(D3.state["excluded_systems"]))

# 16) 观点 1·探测目标避开排除集：排除 {1} 后探测 → 打星系 2（最小未排除）
D4 = m.ScriptDecider()
v16 = view([THERMAL], energy=10, events=ev15, total_turn=6)
v16["agentView"]["events"] = {"entries": []}
D4._update_state(v16)
D4.state["excluded_systems"] = {1}
D4.state["foe_position"] = None
d = D4.decide(v16, free_aff([opt("strike", 4, {"type": "cardUid", "value": "c3"}, {"type": "systemId", "value": "8"}), opt("end_turn", 0)]))
results.append(("16 probe avoids excluded", d))

# 17) 观点 1·命中确认：对手防御成功日志 → 位置权威收敛到 8 + 防御等级 2
D5 = m.ScriptDecider()
ev17 = [{"turn": 6, "phase": "actionPhase", "type": "combat",
         "message": "敌 的防御（等级 2）成功抵御了【热核打击】（等级 1）",
         "systemId": 8, "cardDefId": "strike_thermal", "playerIds": ["me", "foe"]}]
v17 = view([THERMAL], energy=10, events=ev17, total_turn=7)
D5.decide(v17, free_aff([opt("end_turn", 0)]))
print("17 foe_position:", D5.state["foe_position"], "foe_defense:", D5.state["foe_defense"])

# 18) 观点 1·对手跃迁 → 排除集清空（随机落点作废全部排除）
D6 = m.ScriptDecider()
ev18 = [{"turn": 8, "phase": "actionPhase", "type": "system",
         "message": "敌 跃迁至星系 ???",
         "systemId": None, "cardDefId": None, "playerIds": ["foe"]}]
v18 = view([THERMAL], energy=10, events=ev18, total_turn=9)
D6.state["excluded_systems"] = {1, 2, 3}
D6.decide(v18, free_aff([opt("end_turn", 0)]))
print("18 excluded after jump:", sorted(D6.state["excluded_systems"]))

# 19) 观点 2·隐蔽期弃广播牌：0 费广播也最先弃（responses 公开 = 位置泄露风险）
hand19 = [card("b1", "broadcast_star_cooperation", "broadcast", 0), card("b2", "strike_thermal", "strike", 4),
          card("b3", "facility_fusion_reactor", "facility", 3), card("b4", "strike_tech_lock", "strike", 4),
          card("b5", "strike_light_particle", "strike", 6)]
d = D.decide(view(hand19, energy=2), free_aff([opt("end_turn", 0)]))
results.append(("19 hidden discards bc", d))

# 20) 观点 2·公开期保留 0 费广播：位置已公开，弃牌优先级恢复（弃高费广播）
d = D.decide(view(hand19, energy=2, public=True), free_aff([opt("end_turn", 0)]))
results.append(("20 public keeps 0cost bc", d))

# 21) 真实日志：正常跃迁"敌 使用光速飞船跃迁"（无星系字样，turn.go:538）→ 排除/候选清空
D7 = m.ScriptDecider()
ev21 = [{"turn": 8, "phase": "actionPhase", "type": "action",
         "message": "敌 使用光速飞船跃迁",
         "systemId": None, "cardDefId": None, "playerIds": ["foe"]}]
v21 = view([THERMAL], energy=10, events=ev21, total_turn=9)
D7.state["excluded_systems"] = {1, 2, 3}
D7.decide(v21, free_aff([opt("end_turn", 0)]))
print("21 excluded after real jump:", sorted(D7.state["excluded_systems"]))

# 22) 光粒打空星系（星系层命中，PlayerIDs 仅打击者）→ 不误确认对手位置
D8 = m.ScriptDecider()
ev22 = [{"turn": 7, "phase": "actionPhase", "type": "combat",
         "message": "敌 宣布【光粒打击】在星系 9 生效！",
         "systemId": 9, "cardDefId": "strike_light_particle", "playerIds": ["foe"]}]
v22 = view([THERMAL], energy=10, events=ev22, total_turn=8)
D8.decide(v22, free_aff([opt("end_turn", 0)]))
print("22 foe_position after galaxy hit:", D8.state["foe_position"])

# 23) 星系层命中 = 排除：光粒打空（宣布生效 PlayerIDs 仅打击者）→ 星系 9 排除
D9 = m.ScriptDecider()
v23 = view([THERMAL], energy=10, events=ev22, total_turn=8)
D9.decide(v23, free_aff([opt("end_turn", 0)]))
print("23 excluded after light-particle empty:", sorted(D9.state["excluded_systems"]))

# 24) 湮灭打空（余波场景，宣布生效仅打击者）→ 排除
ev24 = [{"turn": 7, "phase": "actionPhase", "type": "combat",
         "message": "敌 宣布【湮灭打击】在星系 6 生效！",
         "systemId": 6, "cardDefId": "strike_annihilation", "playerIds": ["foe"]}]
D10 = m.ScriptDecider()
D10.decide(view([THERMAL], energy=10, events=ev24, total_turn=8),
           free_aff([opt("end_turn", 0)]))
print("24 excluded after annihilation empty:", sorted(D10.state["excluded_systems"]))

# 25) 降维打空（永久锁定，宣布生效仅打击者）→ 排除
ev25 = [{"turn": 7, "phase": "actionPhase", "type": "combat",
         "message": "敌 宣布【降维打击】在星系 4 生效！",
         "systemId": 4, "cardDefId": "strike_dimensional", "playerIds": ["foe"]}]
D11 = m.ScriptDecider()
D11.decide(view([THERMAL], energy=10, events=ev25, total_turn=8),
           free_aff([opt("end_turn", 0)]))
print("25 excluded after dimensional empty:", sorted(D11.state["excluded_systems"]))

# 26) 命中确认不误排：光粒命中玩家（PlayerIDs=[me, foe]）→ 位置确认 8，8 不在排除集
D12 = m.ScriptDecider()
ev26 = [{"turn": 7, "phase": "actionPhase", "type": "combat",
         "message": "我 宣布【光粒打击】在星系 8 生效！",
         "systemId": 8, "cardDefId": "strike_light_particle", "playerIds": ["me", "foe"]}]
D12.decide(view([THERMAL], energy=10, events=ev26, total_turn=8),
           free_aff([opt("end_turn", 0)]))
print("26 hit: pos=", D12.state["foe_position"], "excluded=", sorted(D12.state["excluded_systems"]))

# 27) 探测选卡战略价值：手牌 [湮灭8, 热核4]、能量 15（≥8+6）、位置未知 → 选湮灭
ANNI_CARD = card("a1", "strike_annihilation", "strike", 8, level=3)
v27 = view([ANNI_CARD, THERMAL], energy=15, total_turn=6)
d = D.decide(v27, free_aff([opt("strike", 8, {"type": "cardUid", "value": "a1"}, {"type": "systemId", "value": "1"}),
                            opt("strike", 4, {"type": "cardUid", "value": "c3"}, {"type": "systemId", "value": "1"}),
                            opt("end_turn", 0)]))
results.append(("27 probe prefers annihilation", d))

# 28) 探测选卡战略价值：手牌 [降维10, 光粒6]、能量 17（≥10+6）→ 选降维
DIM_CARD = card("d1", "strike_dimensional", "strike", 10, level=4)
PARTICLE_CARD = card("p1", "strike_light_particle", "strike", 6, level=2)
v28 = view([DIM_CARD, PARTICLE_CARD], energy=17, total_turn=6)
d = D.decide(v28, free_aff([opt("strike", 10, {"type": "cardUid", "value": "d1"}, {"type": "systemId", "value": "1"}),
                            opt("strike", 6, {"type": "cardUid", "value": "p1"}, {"type": "systemId", "value": "1"}),
                            opt("end_turn", 0)]))
results.append(("28 probe prefers dimensional", d))

# 29) 死锁预防：手牌满 4（3 广播 + 1 热核）隐蔽期 → 主动弃广播牌（手牌<4 → 下回合补牌）
hand29 = [card("x1", "broadcast_cosmic_cooperation", "broadcast", 1),
          card("x2", "broadcast_star_cooperation", "broadcast", 0),
          card("x3", "broadcast_cosmic_disguise", "broadcast", 2),
          card("x4", "strike_thermal", "strike", 4)]
d = D.decide(view(hand29, energy=5), free_aff([opt("end_turn", 0)]))
results.append(("29 hidden discards bc (full)", d))

# 30) 死锁预防：手牌 3（2 广播 + 1 监听）隐蔽期 → 弃广播
hand30 = [card("y1", "broadcast_star_cooperation", "broadcast", 0),
          card("y2", "broadcast_cosmic_cooperation", "broadcast", 1),
          card("y3", "facility_monitoring_station", "facility", 4)]
d = D.decide(view(hand30, energy=5), free_aff([opt("end_turn", 0)]))
results.append(("30 hidden discards bc (3 cards)", d))

# 31) 死锁预防：手牌 3（1 广播 + 2 热核）隐蔽期 → 弃广播而非热核
hand31 = [card("z1", "broadcast_star_cooperation", "broadcast", 0),
          card("z2", "strike_thermal", "strike", 4),
          card("z3", "strike_thermal", "strike", 4)]
d = D.decide(view(hand31, energy=5), free_aff([opt("end_turn", 0)]))
results.append(("31 hidden discards bc not thermal", d))

# 32) 公开期手牌 3（1 广播 + 2 热核）→ 不弃（广播保留套利，手牌未满无死锁）
d = D.decide(view(hand31, energy=5, public=True), free_aff([opt("end_turn", 0)]))
results.append(("32 public keeps bc", d))

# 33) 无条件弃广播：手牌仅 2（1 广播 + 1 热核）隐蔽期 → 也弃广播（不限于 ≥3）
hand33 = [card("w1", "broadcast_star_cooperation", "broadcast", 0),
          card("w2", "strike_thermal", "strike", 4)]
d = D.decide(view(hand33, energy=5), free_aff([opt("end_turn", 0)]))
results.append(("33 hidden unconditional bc", d))

# 34) 死锁预防·补弃：手牌 5（1 广播 + 4 硬牌）隐蔽期 → 弃广播 + 按价值补弃到 <4
hand34 = [card("v1", "broadcast_cosmic_cooperation", "broadcast", 1),
          card("v2", "strike_thermal", "strike", 4),
          card("v3", "strike_thermal", "strike", 4),
          card("v4", "strike_light_particle", "strike", 6),
          card("v5", "strike_tech_lock", "strike", 4)]
d = D.decide(view(hand34, energy=5), free_aff([opt("end_turn", 0)]))
results.append(("34 hidden bc + overflow", d))

# 35) 死锁预防·饱和牌：手牌 4 无广播（2 掩体 + 2 太阳能），场上已有量子幽灵+2 设施
#     → 弃 1 张饱和防御（掩体 prio 4 > 太阳能 3）→ 手牌 3 → 下回合补牌
D14 = m.ScriptDecider()
v35 = view([card("s1", "defense_shield_ring", "defense", 6, protectionLevel=2),
            card("s2", "defense_shield_ring", "defense", 6, protectionLevel=2),
            card("s3", "facility_solar_array", "facility", 2),
            card("s4", "facility_fusion_reactor", "facility", 3)],
           energy=9)
D14.state["my_defense"] = 3     # 场上已有量子幽灵 → 掩体饱和
D14.state["my_facilities"] = 2  # 设施已满 2 → 太阳能/聚变饱和
d = D14.decide(v35, free_aff([opt("end_turn", 0)]))
results.append(("35 saturated cards -> discard", d))

# 36) 死锁预防·公开期：手牌 4（0 费广播 + 3 打击）无动作可做 → 弃 1 张打击保留广播
v36 = view([card("t1", "broadcast_star_cooperation", "broadcast", 0),
            card("t2", "strike_thermal", "strike", 4),
            card("t3", "strike_light_particle", "strike", 6),
            card("t4", "strike_tech_lock", "strike", 4)],
           energy=2, public=True, total_turn=2)
d = D.decide(v36, free_aff([opt("end_turn", 0)]))
results.append(("36 public saturated -> discard", d))

ok = True
for name, act in results:
    print(f"{name:26s} -> {act.name} {act.args}")
    if act.name == "end_turn" and not act.args:
        ok = False
print("ALL_OK" if ok else "HAS_PASSIVE_TURNS")
