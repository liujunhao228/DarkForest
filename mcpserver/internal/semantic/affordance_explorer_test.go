package semantic

import (
	"encoding/json"
	"strings"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// assertAffordanceTextClean 断言 Affordance 中所有人话字段
// （Description/Precondition/ExpectedEffect/RiskNote）均不含 strikeForbiddenWords。
func assertAffordanceTextClean(t *testing.T, aff Affordance) {
	t.Helper()
	if aff.PendingAction != nil {
		assertNoForbiddenWords(t, aff.PendingAction.Description)
	}
	for i := range aff.LegalActions {
		a := &aff.LegalActions[i]
		assertNoForbiddenWords(t, a.Description)
		assertNoForbiddenWords(t, a.Precondition)
		assertNoForbiddenWords(t, a.ExpectedEffect)
		assertNoForbiddenWords(t, a.RiskNote)
	}
}

// findActionByType 在 LegalActions 中查找指定 Action 的第一个条目，找不到返回 nil。
func findActionByType(actions []ActionOption, action string) *ActionOption {
	for i := range actions {
		if actions[i].Action == action {
			return &actions[i]
		}
	}
	return nil
}

// makeHandCard 测试辅助：构造一张手牌。
func makeHandCard(uid, defID, name, cardType string, energy int, extra ...func(*gamesdk.Card)) gamesdk.Card {
	c := gamesdk.Card{
		UID:    uid,
		DefID:  defID,
		Name:   name,
		Type:   cardType,
		Energy: energy,
	}
	for _, fn := range extra {
		fn(&c)
	}
	return c
}

// withRange 测试辅助：设置卡牌 Range。
func withRange(r int) func(*gamesdk.Card) {
	return func(c *gamesdk.Card) { c.Range = r }
}

// withLevel 测试辅助：设置卡牌 Level。
func withLevel(l int) func(*gamesdk.Card) {
	return func(c *gamesdk.Card) { c.Level = l }
}

// withAbility 测试辅助：设置卡牌 Ability。
func withAbility(a string) func(*gamesdk.Card) {
	return func(c *gamesdk.Card) { c.Ability = a }
}

// withEffect 测试辅助：设置卡牌 Effect。
func withEffect(e string) func(*gamesdk.Card) {
	return func(c *gamesdk.Card) { c.Effect = e }
}

// withProtection 测试辅助：设置卡牌 ProtectionLevel。
func withProtection(p int) func(*gamesdk.Card) {
	return func(c *gamesdk.Card) { c.ProtectionLevel = p }
}

// TestExploreAffordance_NoPendingActionPhase 验证无 PendingAction 且 TurnPhase=actionPhase
// 时，自由动作集正确推导出 play_card/strike/deploy_card/lightspeed_ship/recycle_card/end_turn。
func TestExploreAffordance_NoPendingActionPhase(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				Energy:   10,
				Hand: []gamesdk.Card{
					makeHandCard("h-bc", "broadcast_test", "测试广播", "broadcast", 2, withRange(2)),
					makeHandCard("h-sk", "strike_thermal", "热核打击", "strike", 3, withLevel(1)),
					makeHandCard("h-fc", "facility_energy", "产能站", "facility", 2),
					makeHandCard("h-df", "defense_shield", "掩体星环", "defense", 1, withProtection(2)),
					makeHandCard("h-es", "lightspeed_ship", "光速飞船", "facility", 0, withAbility("escape")),
				},
				FaceUpCards: []gamesdk.Card{
					{UID: "f-1", DefID: "facility_solar", Name: "太阳能站", Type: "facility", Energy: 4},
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction != nil {
		t.Fatalf("PendingAction = %+v, want nil", aff.PendingAction)
	}
	if len(aff.LegalActions) == 0 {
		t.Fatal("LegalActions empty, want non-empty")
	}

	// play_card（广播牌）：self 在 3，range=2，候选 = [3,1,2,4,5,6,7]，
	// 过滤 self.Position=3 与不含其他玩家的星系，仅 5（p2 所在）应保留。
	pc := findActionByType(aff.LegalActions, "play_card")
	if pc == nil {
		t.Fatal("play_card action not found")
	}
	if pc.Cost.Energy != 2 {
		t.Errorf("play_card Cost.Energy = %d, want 2", pc.Cost.Energy)
	}
	if len(pc.LegalTargets) != 1 || pc.LegalTargets[0].Type != "systemId" || pc.LegalTargets[0].Value != "5" {
		t.Errorf("play_card LegalTargets = %+v, want [{systemId 5}]", pc.LegalTargets)
	}
	if pc.ExpectedEffect != "向目标星系发起广播" {
		t.Errorf("play_card ExpectedEffect = %q, want %q", pc.ExpectedEffect, "向目标星系发起广播")
	}

	// strike（打击牌）：所有未摧毁星系（1-9）
	sk := findActionByType(aff.LegalActions, "strike")
	if sk == nil {
		t.Fatal("strike action not found")
	}
	if sk.Cost.Energy != 3 {
		t.Errorf("strike Cost.Energy = %d, want 3", sk.Cost.Energy)
	}
	if len(sk.LegalTargets) != 9 {
		t.Errorf("strike LegalTargets len = %d, want 9 (all systems 1-9)", len(sk.LegalTargets))
	}
	if sk.ExpectedEffect != "热核打击(Lv1) 将抵达目标星系" {
		t.Errorf("strike ExpectedEffect = %q, want %q",
			sk.ExpectedEffect, "热核打击(Lv1) 将抵达目标星系")
	}

	// deploy_card（Classic 模式下 escape 牌不可部署 → 仅产能站 + 掩体星环 2 个）：
	// Classic 后端 cards_actions.go:55 拒绝部署 escape 牌，affordance 不应暴露该路径。
	var deploys []ActionOption
	for _, a := range aff.LegalActions {
		if a.Action == "deploy_card" {
			deploys = append(deploys, a)
		}
	}
	if len(deploys) != 2 {
		t.Fatalf("deploy_card count = %d, want 2 (facility + defense; escape facility excluded in Classic)", len(deploys))
	}
	for _, d := range deploys {
		if d.LegalTargets[0].Value == "h-es" {
			t.Errorf("escape card should not produce deploy_card in Classic mode: %+v", d)
		}
	}

	// lightspeed_ship：escape 牌在手牌 → 应出现，reachable 排除 3（self）与 5（p2 占用）
	ls := findActionByType(aff.LegalActions, "lightspeed_ship")
	if ls == nil {
		t.Fatal("lightspeed_ship action not found")
	}
	// Classic 模式成本下限 = 10（LightspeedCombinedActionCost）
	if ls.Cost.Energy != 10 {
		t.Errorf("lightspeed_ship Cost.Energy = %d, want 10 (Classic random cost)", ls.Cost.Energy)
	}
	// reachable = [1,2,4,6,7,8,9]（不含 3 与 5）
	if len(ls.LegalTargets) != 7 {
		t.Errorf("lightspeed_ship LegalTargets len = %d, want 7", len(ls.LegalTargets))
	}
	for _, tgt := range ls.LegalTargets {
		if tgt.Value == "3" || tgt.Value == "5" {
			t.Errorf("lightspeed_ship LegalTargets contains %q (should be excluded)", tgt.Value)
		}
	}

	// recycle_card：FaceUpCards 中 1 张 → 1 个 recycle 选项
	rc := findActionByType(aff.LegalActions, "recycle_card")
	if rc == nil {
		t.Fatal("recycle_card action not found")
	}
	if rc.Cost.Energy != -2 { // 4/2 = 2，负数表示返还
		t.Errorf("recycle_card Cost.Energy = %d, want -2", rc.Cost.Energy)
	}
	if len(rc.LegalTargets) != 1 || rc.LegalTargets[0].Type != "cardUid" || rc.LegalTargets[0].Value != "f-1" {
		t.Errorf("recycle_card LegalTargets = %+v, want [{cardUid f-1}]", rc.LegalTargets)
	}

	// end_turn：始终存在
	et := findActionByType(aff.LegalActions, "end_turn")
	if et == nil {
		t.Fatal("end_turn action not found")
	}
	if et.Description != "结束当前回合" {
		t.Errorf("end_turn Description = %q, want %q", et.Description, "结束当前回合")
	}

	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_StrikeSelectPending 验证 strikeSelect PendingAction 投影。
func TestExploreAffordance_StrikeSelectPending(t *testing.T) {
	pa := mustMarshal(t, map[string]any{
		"type":       "strikeSelect",
		"strikeUids": []string{"s1", "s2"},
	})
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
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction == nil {
		t.Fatal("PendingAction nil, want non-nil")
	}
	if aff.PendingAction.Type != "strikeSelect" {
		t.Errorf("PendingAction.Type = %q, want strikeSelect", aff.PendingAction.Type)
	}
	if aff.PendingAction.Description != "存在多个待处理打击需选择" {
		t.Errorf("PendingAction.Description = %q, want %q",
			aff.PendingAction.Description, "存在多个待处理打击需选择")
	}
	if len(aff.PendingAction.LegalTargets) != 2 {
		t.Fatalf("PendingAction.LegalTargets len = %d, want 2", len(aff.PendingAction.LegalTargets))
	}
	for i, want := range []string{"s1", "s2"} {
		if aff.PendingAction.LegalTargets[i].Type != "strikeUid" {
			t.Errorf("LegalTargets[%d].Type = %q, want strikeUid", i, aff.PendingAction.LegalTargets[i].Type)
		}
		if aff.PendingAction.LegalTargets[i].Value != want {
			t.Errorf("LegalTargets[%d].Value = %q, want %q", i, aff.PendingAction.LegalTargets[i].Value, want)
		}
	}
	if len(aff.LegalActions) != 0 {
		t.Errorf("LegalActions len = %d, want 0 (pending forces empty)", len(aff.LegalActions))
	}
	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_StrikeMovePending 验证 strikeMove PendingAction 投影。
func TestExploreAffordance_StrikeMovePending(t *testing.T) {
	pa := mustMarshal(t, map[string]any{
		"type":       "strikeMove",
		"validMoves": []int{2, 3},
	})
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
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction == nil {
		t.Fatal("PendingAction nil, want non-nil")
	}
	if aff.PendingAction.Type != "strikeMove" {
		t.Errorf("PendingAction.Type = %q, want strikeMove", aff.PendingAction.Type)
	}
	if aff.PendingAction.Description != "打击需移动" {
		t.Errorf("PendingAction.Description = %q, want %q",
			aff.PendingAction.Description, "打击需移动")
	}
	if len(aff.PendingAction.LegalTargets) != 2 {
		t.Fatalf("PendingAction.LegalTargets len = %d, want 2", len(aff.PendingAction.LegalTargets))
	}
	wantVals := []string{"2", "3"}
	for i, want := range wantVals {
		if aff.PendingAction.LegalTargets[i].Type != "systemId" {
			t.Errorf("LegalTargets[%d].Type = %q, want systemId", i, aff.PendingAction.LegalTargets[i].Type)
		}
		if aff.PendingAction.LegalTargets[i].Value != want {
			t.Errorf("LegalTargets[%d].Value = %q, want %q", i, aff.PendingAction.LegalTargets[i].Value, want)
		}
	}
	if len(aff.LegalActions) != 0 {
		t.Errorf("LegalActions len = %d, want 0", len(aff.LegalActions))
	}
	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_AnnounceStrikePending 验证 announceStrike PendingAction 投影。
// 同时验证 StrikeUIDs（plural）为空时回退到 StrikeUID（singular）。
func TestExploreAffordance_AnnounceStrikePending(t *testing.T) {
	t.Run("singular strikeUid", func(t *testing.T) {
		pa := mustMarshal(t, map[string]any{
			"type":      "announceStrike",
			"strikeUid": "s-out-1",
		})
		state := &gamesdk.ViewState{
			Phase:           "playing",
			CurrentPlayerID: "p1",
			LocalPlayerID:   "p1",
			TurnPhase:       "interrupted",
			PendingAction:   pa,
			Players: []gamesdk.ViewPlayer{
				{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
			},
		}

		aff := ExploreAffordance(state, "p1", "classic")
		if aff.PendingAction == nil {
			t.Fatal("PendingAction nil")
		}
		if aff.PendingAction.Description != "打击已抵达需宣布生效" {
			t.Errorf("Description = %q", aff.PendingAction.Description)
		}
		if len(aff.PendingAction.LegalTargets) != 1 ||
			aff.PendingAction.LegalTargets[0].Type != "strikeUid" ||
			aff.PendingAction.LegalTargets[0].Value != "s-out-1" {
			t.Errorf("LegalTargets = %+v, want [{strikeUid s-out-1}]", aff.PendingAction.LegalTargets)
		}
		assertAffordanceTextClean(t, aff)
	})

	t.Run("plural strikeUids", func(t *testing.T) {
		pa := mustMarshal(t, map[string]any{
			"type":       "announceStrike",
			"strikeUids": []string{"s1", "s2"},
		})
		state := &gamesdk.ViewState{
			Phase:           "playing",
			CurrentPlayerID: "p1",
			LocalPlayerID:   "p1",
			TurnPhase:       "interrupted",
			PendingAction:   pa,
			Players: []gamesdk.ViewPlayer{
				{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
			},
		}

		aff := ExploreAffordance(state, "p1", "classic")
		if len(aff.PendingAction.LegalTargets) != 2 {
			t.Fatalf("LegalTargets len = %d, want 2", len(aff.PendingAction.LegalTargets))
		}
		assertAffordanceTextClean(t, aff)
	})
}

// TestExploreAffordance_RespondBroadcastPending 验证 respondBroadcast PendingAction 投影。
func TestExploreAffordance_RespondBroadcastPending(t *testing.T) {
	pa := mustMarshal(t, map[string]any{
		"type": "respondBroadcast",
	})
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "interrupted",
		PendingAction:   pa,
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction == nil {
		t.Fatal("PendingAction nil")
	}
	if aff.PendingAction.Description != "广播需回应" {
		t.Errorf("Description = %q, want %q", aff.PendingAction.Description, "广播需回应")
	}
	if len(aff.PendingAction.LegalOptions) != 2 {
		t.Fatalf("LegalOptions len = %d, want 2", len(aff.PendingAction.LegalOptions))
	}
	wantOpts := []string{"agree", "refuse"}
	for i, want := range wantOpts {
		if aff.PendingAction.LegalOptions[i] != want {
			t.Errorf("LegalOptions[%d] = %q, want %q", i, aff.PendingAction.LegalOptions[i], want)
		}
	}
	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_SelectBroadcastResponderPending 验证 selectBroadcastResponder PendingAction 投影。
func TestExploreAffordance_SelectBroadcastResponderPending(t *testing.T) {
	pa := mustMarshal(t, map[string]any{
		"type":       "selectBroadcastResponder",
		"responders": []string{"p2", "p3"},
	})
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "interrupted",
		PendingAction:   pa,
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
			{ID: "p3", Name: "Carol", Position: 7, Energy: 4, HandCount: 1},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction == nil {
		t.Fatal("PendingAction nil")
	}
	if aff.PendingAction.Description != "需选择广播回应者" {
		t.Errorf("Description = %q, want %q", aff.PendingAction.Description, "需选择广播回应者")
	}
	if len(aff.PendingAction.LegalTargets) != 2 {
		t.Fatalf("LegalTargets len = %d, want 2", len(aff.PendingAction.LegalTargets))
	}
	wantVals := []string{"p2", "p3"}
	for i, want := range wantVals {
		if aff.PendingAction.LegalTargets[i].Type != "playerId" {
			t.Errorf("LegalTargets[%d].Type = %q, want playerId", i, aff.PendingAction.LegalTargets[i].Type)
		}
		if aff.PendingAction.LegalTargets[i].Value != want {
			t.Errorf("LegalTargets[%d].Value = %q, want %q", i, aff.PendingAction.LegalTargets[i].Value, want)
		}
	}
	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_StrikeMissedPending 验证 strikeMissed* PendingAction 投影。
func TestExploreAffordance_StrikeMissedPending(t *testing.T) {
	cases := []struct {
		name   string
		paType string
	}{
		{"strikeMissedFree", "strikeMissedFree"},
		{"strikeMissedRequireTarget", "strikeMissedRequireTarget"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pa := mustMarshal(t, map[string]any{
				"type":       tc.paType,
				"strikeUids": []string{"s1"},
			})
			state := &gamesdk.ViewState{
				Phase:           "playing",
				CurrentPlayerID: "p1",
				LocalPlayerID:   "p1",
				TurnPhase:       "interrupted",
				PendingAction:   pa,
				Players: []gamesdk.ViewPlayer{
					{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
				},
				FlyingStrikes: []gamesdk.FlyingStrike{
					makeStrike("s1", "strike_thermal", "p1", 4, 5, 1, 1, false),
				},
			}

			aff := ExploreAffordance(state, "p1", "classic")
			if aff.PendingAction == nil {
				t.Fatal("PendingAction nil")
			}
			if aff.PendingAction.Description != "打击落空，可重定向/跳过/废弃" {
				t.Errorf("Description = %q, want %q",
					aff.PendingAction.Description, "打击落空，可重定向/跳过/废弃")
			}
			wantOpts := []string{"retarget", "skip", "discard"}
			if len(aff.PendingAction.LegalOptions) != len(wantOpts) {
				t.Fatalf("LegalOptions len = %d, want %d",
					len(aff.PendingAction.LegalOptions), len(wantOpts))
			}
			for i, want := range wantOpts {
				if aff.PendingAction.LegalOptions[i] != want {
					t.Errorf("LegalOptions[%d] = %q, want %q",
						i, aff.PendingAction.LegalOptions[i], want)
				}
			}
			assertAffordanceTextClean(t, aff)
		})
	}
}

// TestExploreAffordance_NotMyTurn 验证非自己回合时 LegalActions 为空。
func TestExploreAffordance_NotMyTurn(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p2", // 不是 p1
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				Energy:   10,
				Hand: []gamesdk.Card{
					makeHandCard("h-bc", "broadcast_test", "测试广播", "broadcast", 2, withRange(2)),
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction != nil {
		t.Errorf("PendingAction = %+v, want nil", aff.PendingAction)
	}
	if len(aff.LegalActions) != 0 {
		t.Errorf("LegalActions len = %d, want 0 (not my turn)", len(aff.LegalActions))
	}
}

// TestExploreAffordance_InsufficientEnergy 验证能量不足时 play_card/strike/deploy_card 不出现。
func TestExploreAffordance_InsufficientEnergy(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				Energy:   1, // 能量不足
				Hand: []gamesdk.Card{
					// 三张牌都需要 5 能量，self.Energy=1，均不应出现
					makeHandCard("h-bc", "broadcast_test", "测试广播", "broadcast", 5, withRange(2)),
					makeHandCard("h-sk", "strike_thermal", "热核打击", "strike", 5, withLevel(1)),
					makeHandCard("h-fc", "facility_energy", "产能站", "facility", 5),
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction != nil {
		t.Errorf("PendingAction = %+v, want nil", aff.PendingAction)
	}

	// 三个高能耗牌均不应出现
	if findActionByType(aff.LegalActions, "play_card") != nil {
		t.Error("play_card should not appear (insufficient energy)")
	}
	if findActionByType(aff.LegalActions, "strike") != nil {
		t.Error("strike should not appear (insufficient energy)")
	}
	if findActionByType(aff.LegalActions, "deploy_card") != nil {
		t.Error("deploy_card should not appear (insufficient energy)")
	}

	// end_turn 始终可选
	et := findActionByType(aff.LegalActions, "end_turn")
	if et == nil {
		t.Fatal("end_turn should still appear")
	}

	// 无 lightspeed_ship（手牌无 escape 牌）
	if findActionByType(aff.LegalActions, "lightspeed_ship") != nil {
		t.Error("lightspeed_ship should not appear (no escape card)")
	}

	// 无 recycle_card（无 FaceUpCards）
	if findActionByType(aff.LegalActions, "recycle_card") != nil {
		t.Error("recycle_card should not appear (no FaceUpCards)")
	}

	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_NilState 验证 nil state 返回零值。
func TestExploreAffordance_NilState(t *testing.T) {
	aff := ExploreAffordance(nil, "p1", "classic")
	if aff.PendingAction != nil {
		t.Errorf("PendingAction = %+v, want nil", aff.PendingAction)
	}
	if len(aff.LegalActions) != 0 {
		t.Errorf("LegalActions len = %d, want 0", len(aff.LegalActions))
	}
}

// TestExploreAffordance_NullPendingAction 验证 "null" PendingAction 视为无 pending。
func TestExploreAffordance_NullPendingAction(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		PendingAction:   json.RawMessage("null"),
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")
	if aff.PendingAction != nil {
		t.Errorf("PendingAction = %+v, want nil for null raw", aff.PendingAction)
	}
	// 仍应推导 end_turn（无手牌/设施，仅 end_turn）
	et := findActionByType(aff.LegalActions, "end_turn")
	if et == nil {
		t.Error("end_turn should appear when pending is null")
	}
}

// TestExploreAffordance_StrikeCardExpectedEffect 验证打击牌 ExpectedEffect 模板分支。
// 复用 strike_view.go buildStrikeExplain 的模板逻辑，但替换 systemN 为"目标星系"。
func TestExploreAffordance_StrikeCardExpectedEffect(t *testing.T) {
	cases := []struct {
		name       string
		defID      string
		effect     string
		level      int
		wantEffect string
	}{
		{
			name:       "dimensional",
			defID:      "strike_dimensional",
			effect:     "",
			level:      4,
			wantEffect: "降维打击(Lv4) 将无视防御淘汰目标星系玩家",
		},
		{
			name:       "tech_lock",
			defID:      "strike_tech_lock",
			effect:     "discard_hand",
			level:      4,
			wantEffect: "科技锁死(Lv4) 将弃置目标玩家全部手牌",
		},
		{
			name:       "light_particle",
			defID:      "strike_light_particle",
			effect:     "",
			level:      3,
			wantEffect: "光粒打击(Lv3) 将摧毁目标星系的恒星",
		},
		{
			name:       "annihilation",
			defID:      "strike_annihilation",
			effect:     "",
			level:      3,
			wantEffect: "湮灭打击(Lv3) 将摧毁目标星系的恒星与所有设施",
		},
		{
			name:       "thermal_normal",
			defID:      "strike_thermal",
			effect:     "",
			level:      1,
			wantEffect: "热核打击(Lv1) 将抵达目标星系",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			card := makeHandCard("h-sk", tc.defID, strikeNameFor(tc.defID), "strike", 3,
				withLevel(tc.level), withEffect(tc.effect))
			state := &gamesdk.ViewState{
				Phase:           "playing",
				CurrentPlayerID: "p1",
				LocalPlayerID:   "p1",
				TurnPhase:       "actionPhase",
				Players: []gamesdk.ViewPlayer{
					{
						ID:       "p1",
						Name:     "Alice",
						Position: 3,
						Energy:   10,
						Hand:     []gamesdk.Card{card},
					},
					{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
				},
			}

			aff := ExploreAffordance(state, "p1", "classic")
			sk := findActionByType(aff.LegalActions, "strike")
			if sk == nil {
				t.Fatal("strike action not found")
			}
			if sk.ExpectedEffect != tc.wantEffect {
				t.Errorf("ExpectedEffect = %q, want %q", sk.ExpectedEffect, tc.wantEffect)
			}
			// 显式断言不含禁用词
			if strings.Contains(sk.ExpectedEffect, "需要") {
				t.Errorf("ExpectedEffect %q contains forbidden word '需要'", sk.ExpectedEffect)
			}
			assertAffordanceTextClean(t, aff)
		})
	}
}

// TestExploreAffordance_BroadcastNoTargetsFiltered 验证广播牌无合法目标时不出现 play_card。
// 场景：self 在 1，range=1（候选仅 [1,2,3]），过滤 self.Position=1 后剩 [2,3]，
// 但 p2 在 5（不在 range=1 内，1 与 5 不相邻），故无合法目标 → play_card 不应出现。
func TestExploreAffordance_BroadcastNoTargetsFiltered(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 1,
				Energy:   10,
				Hand: []gamesdk.Card{
					makeHandCard("h-bc", "broadcast_test", "测试广播", "broadcast", 2, withRange(1)),
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if findActionByType(aff.LegalActions, "play_card") != nil {
		t.Error("play_card should not appear (no legal broadcast targets in range)")
	}
	// end_turn 仍应出现
	if findActionByType(aff.LegalActions, "end_turn") == nil {
		t.Error("end_turn should still appear")
	}
	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_LightspeedFromFaceUpCards 验证 escape 牌在 FaceUpCards 时
// 也能触发 lightspeed_ship 选项（Relics 模式典型场景）。
func TestExploreAffordance_LightspeedFromFaceUpCards(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				Energy:   10,
				FaceUpCards: []gamesdk.Card{
					{
						UID:     "f-es",
						DefID:   "lightspeed_ship",
						Name:    "光速飞船",
						Type:    "facility",
						Ability: "escape",
					},
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 3, HandCount: 2},
		},
	}

	aff := ExploreAffordance(state, "p1", "civilization_relics")

	ls := findActionByType(aff.LegalActions, "lightspeed_ship")
	if ls == nil {
		t.Fatal("lightspeed_ship should appear when escape card is in FaceUpCards")
	}
	// Relics 模式成本下限 = 3（LightspeedJumpCostRandom）
	if ls.Cost.Energy != 3 {
		t.Errorf("lightspeed_ship Cost.Energy = %d, want 3 (Relics random cost)", ls.Cost.Energy)
	}
	// reachable 排除 3（self）与 5（p2 占用），应剩 7 个
	if len(ls.LegalTargets) != 7 {
		t.Errorf("lightspeed_ship LegalTargets len = %d, want 7", len(ls.LegalTargets))
	}
	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_EndTurnDiscardPending 验证 endTurnDiscard PendingAction 投影。
// LegalOptions 应为手牌 UID 列表。
func TestExploreAffordance_EndTurnDiscardPending(t *testing.T) {
	pa := mustMarshal(t, map[string]any{
		"type": "endTurnDiscard",
	})
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "interrupted",
		PendingAction:   pa,
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				Energy:   5,
				Hand: []gamesdk.Card{
					{UID: "h1", DefID: "d1", Name: "卡牌1", Type: "broadcast"},
					{UID: "h2", DefID: "d2", Name: "卡牌2", Type: "strike"},
				},
			},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction == nil {
		t.Fatal("PendingAction nil")
	}
	if aff.PendingAction.Description != "回合结束需弃牌" {
		t.Errorf("Description = %q, want %q", aff.PendingAction.Description, "回合结束需弃牌")
	}
	wantOpts := []string{"h1", "h2"}
	if len(aff.PendingAction.LegalOptions) != len(wantOpts) {
		t.Fatalf("LegalOptions len = %d, want %d",
			len(aff.PendingAction.LegalOptions), len(wantOpts))
	}
	for i, want := range wantOpts {
		if aff.PendingAction.LegalOptions[i] != want {
			t.Errorf("LegalOptions[%d] = %q, want %q",
				i, aff.PendingAction.LegalOptions[i], want)
		}
	}
	assertAffordanceTextClean(t, aff)
}

// TestExploreAffordance_UnknownPendingType 验证未知 PendingAction.Type 时
// Description 直接使用 Type，无 LegalTargets/LegalOptions。
func TestExploreAffordance_UnknownPendingType(t *testing.T) {
	pa := mustMarshal(t, map[string]any{
		"type": "customFutureAction",
	})
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "interrupted",
		PendingAction:   pa,
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	if aff.PendingAction == nil {
		t.Fatal("PendingAction nil")
	}
	if aff.PendingAction.Description != "customFutureAction" {
		t.Errorf("Description = %q, want %q", aff.PendingAction.Description, "customFutureAction")
	}
	if aff.PendingAction.LegalTargets != nil {
		t.Errorf("LegalTargets = %+v, want nil for unknown type", aff.PendingAction.LegalTargets)
	}
	if aff.PendingAction.LegalOptions != nil {
		t.Errorf("LegalOptions = %+v, want nil for unknown type", aff.PendingAction.LegalOptions)
	}
}

// TestExploreAffordance_StrikeTargetsIncludeDestroyed 验证打击目标包含已摧毁星系
// （对齐前端 validStrikeTargets=[1..9] 与后端 PlayStrikeCard 不校验摧毁状态）。
// 场景：星系 5 已摧毁，p2 移至 4，self 在 3，broadcast range=2。
// - play_card（广播）：仅 p2 所在的 4 保留（已摧毁 5 无其他玩家，被 systemHasOtherPlayer 自然过滤）
// - strike：所有星系 = [1..9]（含摧毁的 5）
func TestExploreAffordance_StrikeTargetsIncludeDestroyed(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		DestroyedStars:  []int{5},
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				Energy:   10,
				Hand: []gamesdk.Card{
					makeHandCard("h-bc", "broadcast_test", "测试广播", "broadcast", 2, withRange(2)),
					makeHandCard("h-sk", "strike_thermal", "热核打击", "strike", 3, withLevel(1)),
				},
			},
			{ID: "p2", Name: "Bob", Position: 4, Energy: 3, HandCount: 2},
		},
	}

	aff := ExploreAffordance(state, "p1", "classic")

	// play_card：候选 [1,2,4,5,6,7]（GetSystemsInRange(3,2) 不含 center），
	// 过滤 self=3、仅含其他玩家的星系 → 仅 4 保留（5 已摧毁且无其他玩家，被自然过滤）
	pc := findActionByType(aff.LegalActions, "play_card")
	if pc == nil {
		t.Fatal("play_card not found")
	}
	if len(pc.LegalTargets) != 1 || pc.LegalTargets[0].Value != "4" {
		t.Errorf("play_card LegalTargets = %+v, want [{systemId 4}]", pc.LegalTargets)
	}

	// strike：所有星系 = [1,2,3,4,5,6,7,8,9]（含摧毁的 5）
	sk := findActionByType(aff.LegalActions, "strike")
	if sk == nil {
		t.Fatal("strike not found")
	}
	if len(sk.LegalTargets) != 9 {
		t.Errorf("strike LegalTargets len = %d, want 9 (1-9, including destroyed 5)", len(sk.LegalTargets))
	}
	hasFive := false
	for _, tgt := range sk.LegalTargets {
		if tgt.Value == "5" {
			hasFive = true
		}
	}
	if !hasFive {
		t.Error("strike LegalTargets should include destroyed system 5")
	}

	assertAffordanceTextClean(t, aff)
}
