package semantic

import (
	"encoding/json"
	"strings"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// assertNoForbiddenWords 断言 explain 不含 strikeForbiddenWords 中的任何词。
func assertNoForbiddenWords(t *testing.T, explain string) {
	t.Helper()
	for _, w := range strikeForbiddenWords {
		if strings.Contains(explain, w) {
			t.Errorf("explain %q 包含禁用词 %q", explain, w)
		}
	}
}

// assertAllExplainsClean 检查 StrikeView 中所有 explain 字段均不含禁用词。
func assertAllExplainsClean(t *testing.T, v StrikeView) {
	t.Helper()
	for i := range v.Inbound {
		assertNoForbiddenWords(t, v.Inbound[i].Explain)
	}
	for i := range v.ResolvesThisTurn {
		assertNoForbiddenWords(t, v.ResolvesThisTurn[i].Explain)
	}
}

// makeStrike 构造一个 FlyingStrike 测试桩。
func makeStrike(uid, defID, ownerID string, position, target, level, speed int, arrived bool) gamesdk.FlyingStrike {
	return gamesdk.FlyingStrike{
		UID:          uid,
		DefID:        defID,
		OwnerID:      ownerID,
		Position:     position,
		TargetSystem: target,
		Level:        level,
		Speed:        speed,
		StrikeName:   strikeNameFor(defID),
		Arrived:      arrived,
		Effect:       strikeEffectFor(defID),
	}
}

// strikeNameFor 测试辅助：按 defID 给出后端实际卡名（对齐 backend/internal/game/cards.go）。
func strikeNameFor(defID string) string {
	switch defID {
	case "strike_thermal":
		return "热核打击"
	case "strike_light_particle":
		return "光粒打击"
	case "strike_annihilation":
		return "湮灭打击"
	case "strike_dimensional":
		return "降维打击"
	case "strike_tech_lock":
		return "科技锁死"
	}
	return "未命名打击"
}

// strikeEffectFor 测试辅助：仅 strike_tech_lock 带 discard_hand effect。
func strikeEffectFor(defID string) string {
	if defID == "strike_tech_lock" {
		return "discard_hand"
	}
	return ""
}

// TestProjectStrike_Classification 验证 Inbound/Outbound/ThirdParty 三分类规则。
//
// 场景：p1 在星系 3。
//   - strike-i: TargetSystem=3, OwnerID=p2 → Inbound
//   - strike-o: OwnerID=p1, TargetSystem=5 → Outbound
//   - strike-t: TargetSystem=7, OwnerID=p3 → ThirdParty
func TestProjectStrike_Classification(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "strikeMovement",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
			{ID: "p3", Name: "Carol", Position: 7, Energy: 4, HandCount: 1},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-i", "strike_thermal", "p2", 2, 3, 1, 1, false),
			makeStrike("s-o", "strike_thermal", "p1", 4, 5, 1, 1, false),
			makeStrike("s-t", "strike_thermal", "p3", 6, 7, 1, 1, false),
		},
	}

	view := ProjectStrike(state, "p1", 3)

	if len(view.Inbound) != 1 {
		t.Fatalf("Inbound len = %d, want 1", len(view.Inbound))
	}
	if view.Inbound[0].UID != "s-i" {
		t.Errorf("Inbound[0].UID = %q, want s-i", view.Inbound[0].UID)
	}
	if view.Inbound[0].OwnerID != "p2" {
		t.Errorf("Inbound[0].OwnerID = %q, want p2", view.Inbound[0].OwnerID)
	}

	if len(view.Outbound) != 1 {
		t.Fatalf("Outbound len = %d, want 1", len(view.Outbound))
	}
	if view.Outbound[0].UID != "s-o" {
		t.Errorf("Outbound[0].UID = %q, want s-o", view.Outbound[0].UID)
	}
	// Outbound 目标星系 5 上有 p2 → TargetPlayerIDs=[p2]
	if len(view.Outbound[0].TargetPlayerIDs) != 1 || view.Outbound[0].TargetPlayerIDs[0] != "p2" {
		t.Errorf("Outbound[0].TargetPlayerIDs = %v, want [p2]", view.Outbound[0].TargetPlayerIDs)
	}

	if len(view.ThirdParty) != 1 {
		t.Fatalf("ThirdParty len = %d, want 1", len(view.ThirdParty))
	}
	if view.ThirdParty[0].UID != "s-t" {
		t.Errorf("ThirdParty[0].UID = %q, want s-t", view.ThirdParty[0].UID)
	}

	assertAllExplainsClean(t, view)
}

// TestProjectStrike_OwnedStrikeToSelf 验证：自己发给自己星系的打击归为 Outbound 而非 Inbound。
// OwnerID == viewerID 时优先 Outbound（Inbound 要求 OwnerID != viewerID）。
func TestProjectStrike_OwnedStrikeToSelf(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-self", "strike_thermal", "p1", 2, 3, 1, 1, false),
		},
	}

	view := ProjectStrike(state, "p1", 3)

	if len(view.Inbound) != 0 {
		t.Errorf("Inbound len = %d, want 0 (self-owned strike should not be Inbound)", len(view.Inbound))
	}
	if len(view.Outbound) != 1 {
		t.Fatalf("Outbound len = %d, want 1", len(view.Outbound))
	}
	if view.Outbound[0].UID != "s-self" {
		t.Errorf("Outbound[0].UID = %q, want s-self", view.Outbound[0].UID)
	}
}

// TestProjectStrike_ETA 验证 ETA 计算。
//
// 用例：
//   - Arrived=true → ETA=0
//   - pos=1,target=2,speed=1（距离 1）→ ETA=1
//   - pos=1,target=5,speed=1（BFS 距离 2: 1→3→5）→ ETA=2
//   - pos=1,target=5,speed=2（距离 2, ceil(2/2)=1）→ ETA=1
//   - pos=1,target=9,speed=2（BFS 距离 5: 1→2→4→6→8→9, ceil(5/2)=3）→ ETA=3
//   - speed=0 → ETA=-1
func TestProjectStrike_ETA(t *testing.T) {
	// 先断言底层星图距离，确保测试假设成立。
	if d := GetDistance(1, 2); d != 1 {
		t.Fatalf("GetDistance(1,2) = %d, want 1", d)
	}
	if d := GetDistance(1, 5); d != 2 {
		t.Fatalf("GetDistance(1,5) = %d, want 2 (1→3→5)", d)
	}
	if d := GetDistance(1, 9); d != 5 {
		t.Fatalf("GetDistance(1,9) = %d, want 5 (1→2→4→6→8→9)", d)
	}

	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
			{ID: "p2", Name: "Bob", Position: 9, Energy: 3, HandCount: 2},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-arrived", "strike_thermal", "p2", 3, 3, 1, 1, true),
			makeStrike("s-d1-s1", "strike_thermal", "p2", 1, 2, 1, 1, false),
			makeStrike("s-d2-s1", "strike_thermal", "p2", 1, 5, 1, 1, false),
			makeStrike("s-d2-s2", "strike_thermal", "p2", 1, 5, 1, 2, false),
			makeStrike("s-d5-s2", "strike_thermal", "p2", 1, 9, 1, 2, false),
			makeStrike("s-zero-speed", "strike_thermal", "p2", 1, 2, 1, 0, false),
		},
	}

	view := ProjectStrike(state, "p1", 3)

	// s-arrived 的 TargetSystem=3=myPosition 且 OwnerID=p2≠p1 → Inbound。
	// 其余 5 个 TargetSystem != 3 → ThirdParty。
	if len(view.Inbound) != 1 || view.Inbound[0].UID != "s-arrived" {
		t.Fatalf("Inbound = %+v, want 1 strike s-arrived", view.Inbound)
	}
	if len(view.ThirdParty) != 5 {
		t.Fatalf("ThirdParty len = %d, want 5", len(view.ThirdParty))
	}

	wantETA := map[string]int{
		"s-arrived":    0,
		"s-d1-s1":      1,
		"s-d2-s1":      2,
		"s-d2-s2":      1,
		"s-d5-s2":      3,
		"s-zero-speed": -1,
	}
	// ThirdParty 结构无 ETATurns 字段；改用 Outbound 视角（viewerID=p2）读 ETA。
	// 所有打击的 OwnerID=p2，故在 p2 视角下全部归为 Outbound。
	view2 := ProjectStrike(state, "p2", 9)
	if len(view2.Outbound) != 6 {
		t.Fatalf("Outbound len = %d, want 6 (all strikes owned by p2)", len(view2.Outbound))
	}
	gotETA := map[string]int{}
	for _, s := range view2.Outbound {
		gotETA[s.UID] = s.ETATurns
	}
	for uid, want := range wantETA {
		if got := gotETA[uid]; got != want {
			t.Errorf("ETA[%s] = %d, want %d", uid, got, want)
		}
	}
}

// TestProjectStrike_ThreatLevel 验证 ThreatLevel 各档判定。
//
// 用例（myMaxProtection 由 p1 的防御牌决定，构造为 2）：
//   - level=4, effect=discard_hand（科技锁死）→ Medium
//   - level=4, effect=""（降维打击）→ High
//   - level=3, myMaxProtection=2（3>2）→ High
//   - level=2, myMaxProtection=2（2==2）→ Low
//   - level=1, myMaxProtection=2（1<2）→ Low
//   - level=2, myMaxProtection=0（无防御）→ High
func TestProjectStrike_ThreatLevel(t *testing.T) {
	// case 1-5: p1 有 ProtectionLevel=2 的防御牌
	withDefense := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				FaceUpCards: []gamesdk.Card{
					{UID: "d1", DefID: "defense_shield_ring", Name: "掩体星环", Type: "defense", ProtectionLevel: 2},
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-tech-lock", "strike_tech_lock", "p2", 2, 3, 4, 1, false),
			makeStrike("s-dim", "strike_dimensional", "p2", 2, 3, 4, 1, false),
			makeStrike("s-anni", "strike_annihilation", "p2", 2, 3, 3, 1, false),
			makeStrike("s-light", "strike_light_particle", "p2", 2, 3, 2, 1, false),
			makeStrike("s-thermal", "strike_thermal", "p2", 2, 3, 1, 1, false),
		},
	}

	view := ProjectStrike(withDefense, "p1", 3)
	if len(view.Inbound) != 5 {
		t.Fatalf("Inbound len = %d, want 5", len(view.Inbound))
	}

	want := map[string]ThreatLevel{
		"s-tech-lock": ThreatLevelMedium, // Lv4 + discard_hand
		"s-dim":       ThreatLevelHigh,   // Lv4 非 discard_hand
		"s-anni":      ThreatLevelHigh,   // Lv3 > 2
		"s-light":     ThreatLevelLow,    // Lv2 == 2
		"s-thermal":   ThreatLevelLow,    // Lv1 < 2
	}
	for _, s := range view.Inbound {
		got := s.ThreatLevel
		w, ok := want[s.UID]
		if !ok {
			t.Errorf("unexpected Inbound UID %q", s.UID)
			continue
		}
		if got != w {
			t.Errorf("ThreatLevel[%s] = %q, want %q", s.UID, got, w)
		}
	}

	// case 6: p1 无防御牌 → myMaxProtection=0
	withoutDefense := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-light", "strike_light_particle", "p2", 2, 3, 2, 1, false),
		},
	}
	view2 := ProjectStrike(withoutDefense, "p1", 3)
	if len(view2.Inbound) != 1 {
		t.Fatalf("Inbound len = %d, want 1", len(view2.Inbound))
	}
	if view2.Inbound[0].ThreatLevel != ThreatLevelHigh {
		t.Errorf("ThreatLevel[s-light] with no defense = %q, want %q",
			view2.Inbound[0].ThreatLevel, ThreatLevelHigh)
	}

	assertAllExplainsClean(t, view)
	assertAllExplainsClean(t, view2)
}

// TestProjectStrike_ExplainTemplates 验证各类 explain 模板生成结果。
func TestProjectStrike_ExplainTemplates(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				FaceUpCards: []gamesdk.Card{
					{UID: "d1", DefID: "defense_shield_ring", Name: "掩体星环", Type: "defense", ProtectionLevel: 2},
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-dim", "strike_dimensional", "p2", 2, 3, 4, 1, false),
			makeStrike("s-tech-lock", "strike_tech_lock", "p2", 2, 3, 4, 1, false),
			makeStrike("s-light", "strike_light_particle", "p2", 2, 3, 2, 1, false),
			makeStrike("s-anni", "strike_annihilation", "p2", 2, 3, 3, 1, false),
			makeStrike("s-thermal-pierce", "strike_thermal", "p2", 2, 3, 3, 1, false), // Lv3 > 2 → 穿透
			makeStrike("s-thermal-block", "strike_thermal", "p2", 2, 3, 1, 1, false),  // Lv1 < 2 → 挡住
		},
	}

	view := ProjectStrike(state, "p1", 3)
	if len(view.Inbound) != 6 {
		t.Fatalf("Inbound len = %d, want 6", len(view.Inbound))
	}

	want := map[string]string{
		"s-dim":            "降维打击(Lv4) 将无视防御淘汰目标星系玩家",
		"s-tech-lock":      "科技锁死(Lv4) 将弃置目标玩家全部手牌",
		"s-light":          "光粒打击(Lv2) 将摧毁星系3的恒星",
		"s-anni":           "湮灭打击(Lv3) 将摧毁星系3的恒星与所有设施",
		"s-thermal-pierce": "热核打击(Lv3) 将抵达星系3；将穿透防御淘汰目标玩家",
		"s-thermal-block":  "热核打击(Lv1) 将抵达星系3；将被防御挡住",
	}
	got := map[string]string{}
	for _, s := range view.Inbound {
		got[s.UID] = s.Explain
	}
	for uid, w := range want {
		if g := got[uid]; g != w {
			t.Errorf("Explain[%s]\n  got:  %q\n  want: %q", uid, g, w)
		}
	}

	assertAllExplainsClean(t, view)
}

// TestProjectStrike_ResolvesThisTurn 验证 PendingAction.Type=="announceStrike" 推断。
// 后端 announceStrike 使用 StrikeUID（singular）；同时验证 StrikeUIDs（plural）回退路径。
func TestProjectStrike_ResolvesThisTurn(t *testing.T) {
	// case 1: 后端典型形态 StrikeUID (singular)
	paSingular := mustMarshal(t, map[string]any{
		"type":            "announceStrike",
		"strikeUid":       "s-out-1",
		"targetSystem":    5,
		"targetPlayerIds": []string{"p2"},
	})
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "interrupted",
		PendingAction:   paSingular,
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-out-1", "strike_thermal", "p1", 5, 5, 1, 1, true),
			makeStrike("s-out-2", "strike_thermal", "p1", 6, 7, 1, 1, false),
		},
	}

	view := ProjectStrike(state, "p1", 3)
	if len(view.ResolvesThisTurn) != 1 {
		t.Fatalf("ResolvesThisTurn len = %d, want 1", len(view.ResolvesThisTurn))
	}
	r := view.ResolvesThisTurn[0]
	if r.UID != "s-out-1" {
		t.Errorf("ResolvesThisTurn[0].UID = %q, want s-out-1", r.UID)
	}
	if r.TargetSystem != 5 {
		t.Errorf("ResolvesThisTurn[0].TargetSystem = %d, want 5", r.TargetSystem)
	}
	// StrikeResolve normal strike explain 用 TargetSystem 替换 N，且不附防御后缀
	if r.Explain != "热核打击(Lv1) 将抵达星系5" {
		t.Errorf("ResolvesThisTurn[0].Explain = %q, want %q",
			r.Explain, "热核打击(Lv1) 将抵达星系5")
	}
	assertAllExplainsClean(t, view)

	// case 2: StrikeUIDs (plural) 形态
	paPlural := mustMarshal(t, map[string]any{
		"type":         "announceStrike",
		"strikeUids":   []string{"s-out-1", "s-out-2"},
		"targetSystem": 5,
	})
	state2 := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "interrupted",
		PendingAction:   paPlural,
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-out-1", "strike_thermal", "p1", 5, 5, 1, 1, true),
			makeStrike("s-out-2", "strike_annihilation", "p1", 7, 7, 3, 1, true),
		},
	}
	view2 := ProjectStrike(state2, "p1", 3)
	if len(view2.ResolvesThisTurn) != 2 {
		t.Fatalf("ResolvesThisTurn len = %d, want 2", len(view2.ResolvesThisTurn))
	}
	// 验证 s-out-2 走湮灭打击模板
	var r2 *StrikeResolve
	for i := range view2.ResolvesThisTurn {
		if view2.ResolvesThisTurn[i].UID == "s-out-2" {
			r2 = &view2.ResolvesThisTurn[i]
			break
		}
	}
	if r2 == nil {
		t.Fatal("未找到 s-out-2 in ResolvesThisTurn")
	}
	if r2.Explain != "湮灭打击(Lv3) 将摧毁星系7的恒星与所有设施" {
		t.Errorf("ResolvesThisTurn[s-out-2].Explain = %q, want %q",
			r2.Explain, "湮灭打击(Lv3) 将摧毁星系7的恒星与所有设施")
	}
	assertAllExplainsClean(t, view2)
}

// TestProjectStrike_MissedStrikes 验证 strikeMissed* PendingAction 推断 MissedStrikes。
func TestProjectStrike_MissedStrikes(t *testing.T) {
	cases := []struct {
		name        string
		paType      string
		wantOptions []string
		usePlural   bool // true=StrikeUIDs, false=StrikeUID
	}{
		{
			name:        "strikeMissedFree singular",
			paType:      "strikeMissedFree",
			wantOptions: []string{"retarget", "skip", "discard"},
			usePlural:   false,
		},
		{
			name:        "strikeMissedRequireTarget singular",
			paType:      "strikeMissedRequireTarget",
			wantOptions: []string{"retarget", "skip", "discard"},
			usePlural:   false,
		},
		{
			name:        "strikeMissedUnknown plural fallback",
			paType:      "strikeMissedOtherVariant",
			wantOptions: []string{"skip", "discard"},
			usePlural:   true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var pa json.RawMessage
			if tc.usePlural {
				pa = mustMarshal(t, map[string]any{
					"type":       tc.paType,
					"strikeUids": []string{"s-missed"},
				})
			} else {
				pa = mustMarshal(t, map[string]any{
					"type":      tc.paType,
					"strikeUid": "s-missed",
				})
			}

			state := &gamesdk.ViewState{
				Phase:           "playing",
				CurrentPlayerID: "p1",
				LocalPlayerID:   "p1",
				TurnPhase:       "interrupted",
				PendingAction:   pa,
				Players: []gamesdk.ViewPlayer{
					{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
					{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
				},
				FlyingStrikes: []gamesdk.FlyingStrike{
					makeStrike("s-missed", "strike_thermal", "p1", 7, 7, 1, 1, true),
				},
			}

			view := ProjectStrike(state, "p1", 3)
			if len(view.MissedStrikes) != 1 {
				t.Fatalf("MissedStrikes len = %d, want 1", len(view.MissedStrikes))
			}
			m := view.MissedStrikes[0]
			if m.UID != "s-missed" {
				t.Errorf("MissedStrikes[0].UID = %q, want s-missed", m.UID)
			}
			if m.Position != 7 {
				t.Errorf("MissedStrikes[0].Position = %d, want 7", m.Position)
			}
			if !sliceEqual(m.Options, tc.wantOptions) {
				t.Errorf("MissedStrikes[0].Options = %v, want %v", m.Options, tc.wantOptions)
			}
		})
	}
}

// TestProjectStrike_NoPendingAction 验证无 PendingAction 时
// ResolvesThisTurn 与 MissedStrikes 均为空。
func TestProjectStrike_NoPendingAction(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-1", "strike_thermal", "p2", 2, 3, 1, 1, false),
		},
	}

	view := ProjectStrike(state, "p1", 3)
	if len(view.ResolvesThisTurn) != 0 {
		t.Errorf("ResolvesThisTurn len = %d, want 0", len(view.ResolvesThisTurn))
	}
	if len(view.MissedStrikes) != 0 {
		t.Errorf("MissedStrikes len = %d, want 0", len(view.MissedStrikes))
	}
	if len(view.Inbound) != 1 {
		t.Errorf("Inbound len = %d, want 1", len(view.Inbound))
	}
	assertAllExplainsClean(t, view)
}

// TestProjectStrike_NilState 验证 nil ViewState 返回零值 StrikeView。
func TestProjectStrike_NilState(t *testing.T) {
	view := ProjectStrike(nil, "p1", 3)
	if len(view.Inbound) != 0 || len(view.Outbound) != 0 || len(view.ThirdParty) != 0 {
		t.Errorf("nil state should produce empty StrikeView, got %+v", view)
	}
	if len(view.ResolvesThisTurn) != 0 || len(view.MissedStrikes) != 0 {
		t.Errorf("nil state should produce empty StrikeView, got %+v", view)
	}
}

// TestProjectStrike_JSONMarshalSmoke 验证 StrikeView 可正确序列化为 JSON。
func TestProjectStrike_JSONMarshalSmoke(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				FaceUpCards: []gamesdk.Card{
					{UID: "d1", DefID: "defense_shield_ring", Name: "掩体星环", Type: "defense", ProtectionLevel: 2},
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-1", "strike_thermal", "p2", 2, 3, 1, 1, false),
		},
	}
	view := ProjectStrike(state, "p1", 3)
	data, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	t.Logf("StrikeView JSON: %s", data)
}

// mustMarshal 测试辅助：把 v 序列化为 json.RawMessage，失败时 t.Fatal。
func mustMarshal(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	return b
}

// sliceEqual 比较两个字符串切片是否相等（顺序敏感）。
func sliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
