package semantic

import (
	"strings"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// --- 测试辅助函数 ---

// assertDeltaNarrativeClean 断言 Narrative 不含 deltaForbiddenWords 中的任何词。
func assertDeltaNarrativeClean(t *testing.T, narrative string) {
	t.Helper()
	for _, w := range deltaForbiddenWords {
		if strings.Contains(narrative, w) {
			t.Errorf("Narrative %q 包含禁用词 %q", narrative, w)
		}
	}
}

// assertAllDeltaNarrativesClean 检查 StateDelta 中所有 Narrative 与 Highlights 均不含禁用词。
func assertAllDeltaNarrativesClean(t *testing.T, d StateDelta) {
	t.Helper()
	for _, c := range d.Changes {
		assertDeltaNarrativeClean(t, c.Narrative)
	}
	for _, h := range d.Highlights {
		assertDeltaNarrativeClean(t, h)
	}
}

// deltaPlayer 构造一个最小 ViewPlayer 测试桩。
func deltaPlayer(id, name string, energy, position int, hand []gamesdk.Card, handCount int, eliminated bool) gamesdk.ViewPlayer {
	return gamesdk.ViewPlayer{
		ID:         id,
		Name:       name,
		Energy:     energy,
		Position:   position,
		Hand:       hand,
		HandCount:  handCount,
		Eliminated: eliminated,
	}
}

// findDeltaChangeByType 返回第一个匹配 type 的 Change 指针，未找到返回 nil。
func findDeltaChangeByType(changes []Change, typ string) *Change {
	for i := range changes {
		if changes[i].Type == typ {
			return &changes[i]
		}
	}
	return nil
}

// findDeltaChangeByTypeAndActor 返回第一个匹配 type 与 actor 的 Change 指针。
func findDeltaChangeByTypeAndActor(changes []Change, typ, actor string) *Change {
	for i := range changes {
		if changes[i].Type == typ && changes[i].Actor == actor {
			return &changes[i]
		}
	}
	return nil
}

// countDeltaChangesByType 统计匹配 type 的 Change 数量。
func countDeltaChangesByType(changes []Change, typ string) int {
	n := 0
	for _, c := range changes {
		if c.Type == typ {
			n++
		}
	}
	return n
}

// deltaCard 构造一个最小卡牌测试桩（仅 UID + Name）。
func deltaCard(uid, name string) gamesdk.Card {
	return gamesdk.Card{UID: uid, Name: name}
}

// --- 测试用例 ---

// TestComputeDelta_NilBefore 验证 before==nil 时返回"游戏开始"初始状态 delta。
func TestComputeDelta_NilBefore(t *testing.T) {
	after := &gamesdk.ViewState{
		Phase:      "playing",
		TotalTurn:  1,
		TurnPhase:  "actionPhase",
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Energy: 5, Position: 3},
		},
	}

	delta := ComputeDelta(nil, after, "p1")

	if delta.Turn != 1 {
		t.Errorf("Turn = %d, want 1", delta.Turn)
	}
	if delta.Phase != "actionPhase" {
		t.Errorf("Phase = %q, want actionPhase", delta.Phase)
	}
	if len(delta.Changes) != 0 {
		t.Errorf("Changes len = %d, want 0 (initial state has no diff)", len(delta.Changes))
	}
	if len(delta.Highlights) != 1 || delta.Highlights[0] != "游戏开始" {
		t.Errorf("Highlights = %v, want [游戏开始]", delta.Highlights)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_NilAfter 验证 after==nil 时返回零值 StateDelta（防御性）。
func TestComputeDelta_NilAfter(t *testing.T) {
	before := &gamesdk.ViewState{TotalTurn: 5, TurnPhase: "actionPhase"}
	delta := ComputeDelta(before, nil, "p1")

	if delta.Turn != 0 {
		t.Errorf("Turn = %d, want 0", delta.Turn)
	}
	if len(delta.Changes) != 0 {
		t.Errorf("Changes len = %d, want 0", len(delta.Changes))
	}
	if len(delta.Highlights) != 0 {
		t.Errorf("Highlights len = %d, want 0", len(delta.Highlights))
	}
}

// TestComputeDelta_EnergyChange 验证能量变化检测。
func TestComputeDelta_EnergyChange(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 8, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeEnergy)
	if c == nil {
		t.Fatal("未找到 energy change")
	}
	if c.Actor != "p1" {
		t.Errorf("Actor = %q, want p1", c.Actor)
	}
	if c.Before != "5" || c.After != "8" {
		t.Errorf("Before/After = %q/%q, want 5/8", c.Before, c.After)
	}
	wantNarrative := "Alice 能量 5→8"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	// p2 能量未变，不应有 energy change
	if countDeltaChangesByType(delta.Changes, ChangeTypeEnergy) != 1 {
		t.Errorf("energy change count = %d, want 1", countDeltaChangesByType(delta.Changes, ChangeTypeEnergy))
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_HandChange_Self 验证观察者本人手牌变化（用 Hand 长度）。
func TestComputeDelta_HandChange_Self(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, []gamesdk.Card{
				deltaCard("h1", "卡1"), deltaCard("h2", "卡2"), deltaCard("h3", "卡3"),
			}, 0, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, []gamesdk.Card{
				deltaCard("h1", "卡1"),
			}, 0, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeHand)
	if c == nil {
		t.Fatal("未找到 hand change")
	}
	if c.Before != "3" || c.After != "1" {
		t.Errorf("Before/After = %q/%q, want 3/1", c.Before, c.After)
	}
	wantNarrative := "Alice 手牌 3→1"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_HandChange_Foe 验证对手手牌变化（用 HandCount）。
func TestComputeDelta_HandChange_Foe(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 4, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypeHand, "p2")
	if c == nil {
		t.Fatal("未找到 p2 的 hand change")
	}
	if c.Before != "4" || c.After != "2" {
		t.Errorf("Before/After = %q/%q, want 4/2", c.Before, c.After)
	}
	wantNarrative := "Bob 手牌 4→2"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_PositionChange 验证位置变化（光速飞船跃迁）。
// after.Position > 0 才报告；after.Position <= 0（未知）不报告。
func TestComputeDelta_PositionChange(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, -1, nil, 2, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 7, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	// p1: 3→7
	c1 := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypePosition, "p1")
	if c1 == nil {
		t.Fatal("未找到 p1 的 position change")
	}
	if c1.Before != "3" || c1.After != "7" {
		t.Errorf("p1 Before/After = %q/%q, want 3/7", c1.Before, c1.After)
	}
	wantNarrative1 := "Alice 位置 3→7"
	if c1.Narrative != wantNarrative1 {
		t.Errorf("p1 Narrative = %q, want %q", c1.Narrative, wantNarrative1)
	}

	// p2: -1→5（从未知到已知，after.Position=5>0 应报告）
	c2 := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypePosition, "p2")
	if c2 == nil {
		t.Fatal("未找到 p2 的 position change")
	}
	if c2.Before != "-1" || c2.After != "5" {
		t.Errorf("p2 Before/After = %q/%q, want -1/5", c2.Before, c2.After)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_PositionChange_ToUnknown 验证 after.Position<=0（未知）时不报告位置变化。
func TestComputeDelta_PositionChange_ToUnknown(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, -1, nil, 0, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	if c := findDeltaChangeByType(delta.Changes, ChangeTypePosition); c != nil {
		t.Errorf("不应产出 position change（after.Position=-1<=0），got %+v", c)
	}
}

// TestComputeDelta_Elimination 验证淘汰检测。
func TestComputeDelta_Elimination(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 0, 5, nil, 0, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 0, 5, nil, 0, true),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeElimination)
	if c == nil {
		t.Fatal("未找到 elimination change")
	}
	if c.Actor != "p2" {
		t.Errorf("Actor = %q, want p2", c.Actor)
	}
	wantNarrative := "Bob 被淘汰"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	// 已淘汰→已淘汰不应再次报告
	if countDeltaChangesByType(delta.Changes, ChangeTypeElimination) != 1 {
		t.Errorf("elimination count = %d, want 1", countDeltaChangesByType(delta.Changes, ChangeTypeElimination))
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_FlyingStrikeAdded 验证新增飞行打击检测。
func TestComputeDelta_FlyingStrikeAdded(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-new", "strike_thermal", "p2", 4, 3, 1, 1, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeFlyingStrike)
	if c == nil {
		t.Fatal("未找到 flying_strike change")
	}
	if c.Actor != "p2" {
		t.Errorf("Actor = %q, want p2", c.Actor)
	}
	if c.Before != "" {
		t.Errorf("Before = %q, want empty (新增)", c.Before)
	}
	if c.After != "热核打击" {
		t.Errorf("After = %q, want 热核打击", c.After)
	}
	wantNarrative := "Bob 发射 热核打击 指向星系 3"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_FlyingStrikeRemoved 验证消失飞行打击（已结算）检测。
func TestComputeDelta_FlyingStrikeRemoved(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-old", "strike_light_particle", "p2", 4, 3, 2, 1, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeFlyingStrike)
	if c == nil {
		t.Fatal("未找到 flying_strike change")
	}
	if c.Actor != "p2" {
		t.Errorf("Actor = %q, want p2", c.Actor)
	}
	if c.Before != "光粒打击" {
		t.Errorf("Before = %q, want 光粒打击", c.Before)
	}
	if c.After != "" {
		t.Errorf("After = %q, want empty (消失)", c.After)
	}
	wantNarrative := "光粒打击 已结算"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_DestroyedStarAdded 验证恒星被摧毁检测。
func TestComputeDelta_DestroyedStarAdded(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
		DestroyedStars: []int{2},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
		DestroyedStars: []int{2, 7},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeDestroyedStar)
	if c == nil {
		t.Fatal("未找到 destroyed_star change")
	}
	if c.After != "7" {
		t.Errorf("After = %q, want 7", c.After)
	}
	wantNarrative := "星系 7 的恒星被摧毁"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	// 2 已存在于 before，不应重复报告
	if countDeltaChangesByType(delta.Changes, ChangeTypeDestroyedStar) != 1 {
		t.Errorf("destroyed_star count = %d, want 1", countDeltaChangesByType(delta.Changes, ChangeTypeDestroyedStar))
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_BroadcastStart 验证广播发起检测。
func TestComputeDelta_BroadcastStart(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
		Broadcast: &gamesdk.BroadcastStateView{
			BroadcasterID: "p2",
			TargetSystem:  3,
			Phase:         gamesdk.BroadcastPhaseWaiting,
		},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeBroadcast)
	if c == nil {
		t.Fatal("未找到 broadcast change")
	}
	if c.Actor != "p2" {
		t.Errorf("Actor = %q, want p2", c.Actor)
	}
	wantNarrative := "Bob 在星系 3 发起广播"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_BroadcastEnd 验证广播结束检测。
func TestComputeDelta_BroadcastEnd(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
		Broadcast: &gamesdk.BroadcastStateView{
			BroadcasterID: "p1",
			TargetSystem:  5,
			Phase:         gamesdk.BroadcastPhaseReveal,
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeBroadcast)
	if c == nil {
		t.Fatal("未找到 broadcast change")
	}
	if c.Actor != "" {
		t.Errorf("Actor = %q, want empty (广播结束无 Actor)", c.Actor)
	}
	wantNarrative := "广播会话结束"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_Winner 验证胜负判定检测。
func TestComputeDelta_Winner(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 10, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 0, 5, nil, 0, true),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 11, TurnPhase: "gameOver",
		Phase: "gameOver",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 0, 5, nil, 0, true),
		},
		Winner: "p1",
	}

	delta := ComputeDelta(before, after, "p1")

	c := findDeltaChangeByType(delta.Changes, ChangeTypeWinner)
	if c == nil {
		t.Fatal("未找到 winner change")
	}
	if c.After != "p1" {
		t.Errorf("After = %q, want p1", c.After)
	}
	wantNarrative := "游戏结束，胜者：Alice"
	if c.Narrative != wantNarrative {
		t.Errorf("Narrative = %q, want %q", c.Narrative, wantNarrative)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_Trend 验证 Trend 计算（能量/手牌/入站打击数）。
//
// 场景：p1 在星系 3。
//   - 能量：5→8（delta=+3）
//   - 手牌：3→2（delta=-1）
//   - 入站打击：before 1 个指向星系 3，after 2 个指向星系 3（delta=+1）
func TestComputeDelta_Trend(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, []gamesdk.Card{
				deltaCard("h1", "卡1"), deltaCard("h2", "卡2"), deltaCard("h3", "卡3"),
			}, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-in-1", "strike_thermal", "p2", 4, 3, 1, 1, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 8, 3, []gamesdk.Card{
				deltaCard("h1", "卡1"), deltaCard("h2", "卡2"),
			}, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-in-1", "strike_thermal", "p2", 4, 3, 1, 1, false),
			makeStrike("s-in-2", "strike_light_particle", "p3", 6, 3, 2, 1, false),
			makeStrike("s-out", "strike_thermal", "p1", 3, 7, 1, 1, false), // 出站，不计入入站
		},
	}

	delta := ComputeDelta(before, after, "p1")

	if delta.Trend.MyEnergyDelta != 3 {
		t.Errorf("MyEnergyDelta = %d, want 3", delta.Trend.MyEnergyDelta)
	}
	if delta.Trend.MyHandDelta != -1 {
		t.Errorf("MyHandDelta = %d, want -1", delta.Trend.MyHandDelta)
	}
	if delta.Trend.ThreatLevelDelta != 1 {
		t.Errorf("ThreatLevelDelta = %d, want 1 (1→2 inbound)", delta.Trend.ThreatLevelDelta)
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_Trend_ThreatDecrease 验证入站打击减少时 ThreatLevelDelta 为负。
func TestComputeDelta_Trend_ThreatDecrease(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-in-1", "strike_thermal", "p2", 4, 3, 1, 1, false),
			makeStrike("s-in-2", "strike_thermal", "p3", 6, 3, 1, 1, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-in-1", "strike_thermal", "p2", 4, 3, 1, 1, false),
		},
	}

	delta := ComputeDelta(before, after, "p1")

	if delta.Trend.ThreatLevelDelta != -1 {
		t.Errorf("ThreatLevelDelta = %d, want -1 (2→1 inbound)", delta.Trend.ThreatLevelDelta)
	}
}

// TestComputeDelta_Highlights 验证 Highlights 提取顺序与"取最后一条"规则。
//
// 直接构造 Changes 列表测试 extractHighlights，因为单次 ComputeDelta 只能产出
// 1 条广播变更（nil→non-nil）与 1 条胜负变更，无法覆盖"多条取最后一条"场景。
//
// 场景包含：2 淘汰 + 1 摧毁恒星 + 1 胜负 + 2 发射打击 + 2 广播发起。
// 预期 Highlights（按顺序，截断到 5）：
//  1. 淘汰 narrative（Bob）
//  2. 淘汰 narrative（Carol）
//  3. 摧毁恒星 narrative
//  4. 胜负 narrative
//  5. 最后一条发射打击 narrative（截断，广播发起被丢弃）
func TestComputeDelta_Highlights(t *testing.T) {
	changes := []Change{
		{Type: ChangeTypeElimination, Actor: "p2", Narrative: "Bob 被淘汰"},
		{Type: ChangeTypeElimination, Actor: "p3", Narrative: "Carol 被淘汰"},
		{Type: ChangeTypeDestroyedStar, After: "9", Narrative: "星系 9 的恒星被摧毁"},
		{Type: ChangeTypeFlyingStrike, Actor: "p1", After: "热核打击", Narrative: "Alice 发射 热核打击 指向星系 5"},
		{Type: ChangeTypeFlyingStrike, Actor: "p1", After: "光粒打击", Narrative: "Alice 发射 光粒打击 指向星系 7"},
		{Type: ChangeTypeBroadcast, Actor: "p1", Narrative: "Alice 在星系 5 发起广播"},
		{Type: ChangeTypeBroadcast, Actor: "p1", Narrative: "Alice 在星系 7 发起广播"},
		{Type: ChangeTypeWinner, After: "p1", Narrative: "游戏结束，胜者：Alice"},
	}

	highlights := extractHighlights(changes)

	// 预期顺序：2 淘汰 + 1 摧毁恒星 + 1 胜负 + 1 最后打击 + 1 最后广播 = 6，截断到 5
	if len(highlights) != 5 {
		t.Fatalf("Highlights len = %d, want 5 (capped): %v", len(highlights), highlights)
	}
	// 前两条为淘汰事件
	if highlights[0] != "Bob 被淘汰" {
		t.Errorf("Highlights[0] = %q, want 'Bob 被淘汰'", highlights[0])
	}
	if highlights[1] != "Carol 被淘汰" {
		t.Errorf("Highlights[1] = %q, want 'Carol 被淘汰'", highlights[1])
	}
	// 第三条为摧毁恒星
	if highlights[2] != "星系 9 的恒星被摧毁" {
		t.Errorf("Highlights[2] = %q, want '星系 9 的恒星被摧毁'", highlights[2])
	}
	// 第四条为胜负判定
	if highlights[3] != "游戏结束，胜者：Alice" {
		t.Errorf("Highlights[3] = %q, want '游戏结束，胜者：Alice'", highlights[3])
	}
	// 第五条为最后一条发射打击（"取最后一条"）
	if highlights[4] != "Alice 发射 光粒打击 指向星系 7" {
		t.Errorf("Highlights[4] = %q, want 'Alice 发射 光粒打击 指向星系 7' (last strike)", highlights[4])
	}
	// 广播发起事件因截断到 5 条被丢弃
}

// TestComputeDelta_Highlights_InDelta 验证 ComputeDelta 端到端的 Highlights 提取。
// 构造一个含淘汰 + 摧毁恒星 + 胜负 + 发射打击 + 广播发起的场景。
func TestComputeDelta_Highlights_InDelta(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "gameOver",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 0, 5, nil, 0, true), // 淘汰
		},
		DestroyedStars: []int{7}, // 摧毁恒星
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-new", "strike_thermal", "p1", 3, 5, 1, 1, false), // 发射打击
		},
		Broadcast: &gamesdk.BroadcastStateView{
			BroadcasterID: "p1",
			TargetSystem:  5,
			Phase:         gamesdk.BroadcastPhaseWaiting,
		},
		Winner: "p1",
	}

	delta := ComputeDelta(before, after, "p1")

	// 预期 Highlights 含：淘汰 + 摧毁恒星 + 胜负 + 发射打击 + 广播发起 = 5 条
	if len(delta.Highlights) != 5 {
		t.Fatalf("Highlights len = %d, want 5: %v", len(delta.Highlights), delta.Highlights)
	}
	// 验证每条都来自预期类别
	expectedSet := map[string]bool{
		"Bob 被淘汰":                    true,
		"星系 7 的恒星被摧毁":              true,
		"游戏结束，胜者：Alice":            true,
		"Alice 发射 热核打击 指向星系 5": true,
		"Alice 在星系 5 发起广播":       true,
	}
	for _, h := range delta.Highlights {
		if !expectedSet[h] {
			t.Errorf("unexpected highlight %q", h)
		}
	}
	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_NoForbiddenWords 验证所有场景下 Narrative 不含禁用词。
// 构造一个综合场景触发所有变更类型。
func TestComputeDelta_NoForbiddenWords(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, []gamesdk.Card{
				deltaCard("h1", "卡1"), deltaCard("h2", "卡2"),
			}, 0, false),
			deltaPlayer("p2", "Bob", 4, -1, nil, 3, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-old", "strike_thermal", "p2", 4, 3, 1, 1, false),
		},
		DestroyedStars: []int{2},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 8, 7, []gamesdk.Card{deltaCard("h1", "卡1")}, 0, false),
			deltaPlayer("p2", "Bob", 0, 9, nil, 1, true), // 淘汰
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-new", "strike_light_particle", "p1", 7, 9, 2, 1, false),
		},
		DestroyedStars: []int{2, 8},
		Broadcast: &gamesdk.BroadcastStateView{
			BroadcasterID: "p1",
			TargetSystem:  9,
			Phase:         gamesdk.BroadcastPhaseWaiting,
		},
	}

	delta := ComputeDelta(before, after, "p1")

	if len(delta.Changes) == 0 {
		t.Fatal("期望至少一个 change")
	}
	// 逐条断言
	for _, c := range delta.Changes {
		assertDeltaNarrativeClean(t, c.Narrative)
	}
	for _, h := range delta.Highlights {
		assertDeltaNarrativeClean(t, h)
	}
	t.Logf("Changes: %+v", delta.Changes)
	t.Logf("Highlights: %+v", delta.Highlights)
}

// TestComputeDelta_Comprehensive 综合场景：验证多类变更同时计算。
func TestComputeDelta_Comprehensive(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 5, TurnPhase: "actionPhase",
		Phase: "playing",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, []gamesdk.Card{
				deltaCard("h1", "卡1"), deltaCard("h2", "卡2"),
			}, 0, false),
			deltaPlayer("p2", "Bob", 4, -1, nil, 3, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-old", "strike_thermal", "p2", 4, 3, 1, 1, false),
		},
		DestroyedStars: []int{2},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 6, TurnPhase: "actionPhase",
		Phase: "playing",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 8, 7, []gamesdk.Card{deltaCard("h1", "卡1")}, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false),
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-old", "strike_thermal", "p2", 4, 3, 1, 1, false), // 保留
			makeStrike("s-new", "strike_light_particle", "p1", 7, 5, 2, 1, false), // 新增
		},
		DestroyedStars: []int{2, 8}, // 新增 8
		Broadcast: &gamesdk.BroadcastStateView{
			BroadcasterID: "p2",
			TargetSystem:  7,
			Phase:         gamesdk.BroadcastPhaseWaiting,
		},
	}

	delta := ComputeDelta(before, after, "p1")

	// Turn/Phase
	if delta.Turn != 6 {
		t.Errorf("Turn = %d, want 6", delta.Turn)
	}
	if delta.Phase != "actionPhase" {
		t.Errorf("Phase = %q, want actionPhase", delta.Phase)
	}

	// 能量变化：p1 5→8, p2 4→4（无变化）
	energyC := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypeEnergy, "p1")
	if energyC == nil {
		t.Error("未找到 p1 energy change")
	} else if energyC.Before != "5" || energyC.After != "8" {
		t.Errorf("p1 energy Before/After = %q/%q, want 5/8", energyC.Before, energyC.After)
	}

	// 手牌变化：p1 2→1（Hand）, p2 3→2（HandCount）
	handP1 := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypeHand, "p1")
	if handP1 == nil {
		t.Error("未找到 p1 hand change")
	} else if handP1.Before != "2" || handP1.After != "1" {
		t.Errorf("p1 hand Before/After = %q/%q, want 2/1", handP1.Before, handP1.After)
	}
	handP2 := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypeHand, "p2")
	if handP2 == nil {
		t.Error("未找到 p2 hand change")
	} else if handP2.Before != "3" || handP2.After != "2" {
		t.Errorf("p2 hand Before/After = %q/%q, want 3/2", handP2.Before, handP2.After)
	}

	// 位置变化：p1 3→7, p2 -1→5
	posP1 := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypePosition, "p1")
	if posP1 == nil {
		t.Error("未找到 p1 position change")
	}
	posP2 := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypePosition, "p2")
	if posP2 == nil {
		t.Error("未找到 p2 position change")
	}

	// 飞行打击：新增 s-new（光粒打击），无消失
	strikeCount := countDeltaChangesByType(delta.Changes, ChangeTypeFlyingStrike)
	if strikeCount != 1 {
		t.Errorf("flying_strike count = %d, want 1 (only s-new added)", strikeCount)
	}

	// 摧毁恒星：新增 8
	starC := findDeltaChangeByType(delta.Changes, ChangeTypeDestroyedStar)
	if starC == nil {
		t.Error("未找到 destroyed_star change")
	} else if starC.After != "8" {
		t.Errorf("destroyed_star After = %q, want 8", starC.After)
	}

	// 广播：nil → non-nil（p2 在星系 7 发起广播）
	broadcastC := findDeltaChangeByType(delta.Changes, ChangeTypeBroadcast)
	if broadcastC == nil {
		t.Error("未找到 broadcast change")
	} else if broadcastC.Actor != "p2" {
		t.Errorf("broadcast Actor = %q, want p2", broadcastC.Actor)
	}

	// Trend
	if delta.Trend.MyEnergyDelta != 3 {
		t.Errorf("MyEnergyDelta = %d, want 3", delta.Trend.MyEnergyDelta)
	}
	if delta.Trend.MyHandDelta != -1 {
		t.Errorf("MyHandDelta = %d, want -1", delta.Trend.MyHandDelta)
	}
	// before: s-old 指向星系 3（p1 位置）→ 1 入站
	// after:  p1 位置变为 7，s-old 仍指向 3（不再是入站），s-new 指向 5（非 p1 位置）→ 0 入站
	if delta.Trend.ThreatLevelDelta != -1 {
		t.Errorf("ThreatLevelDelta = %d, want -1 (1→0 inbound after position change)", delta.Trend.ThreatLevelDelta)
	}

	assertAllDeltaNarrativesClean(t, delta)
}

// TestComputeDelta_NoChange 验证两状态相同时无 Changes 产出。
func TestComputeDelta_NoChange(t *testing.T) {
	state := &gamesdk.ViewState{
		TotalTurn: 5, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
	}

	delta := ComputeDelta(state, state, "p1")

	if len(delta.Changes) != 0 {
		t.Errorf("Changes len = %d, want 0 (identical states)", len(delta.Changes))
	}
	if len(delta.Highlights) != 0 {
		t.Errorf("Highlights len = %d, want 0", len(delta.Highlights))
	}
	if delta.Trend.MyEnergyDelta != 0 || delta.Trend.MyHandDelta != 0 || delta.Trend.ThreatLevelDelta != 0 {
		t.Errorf("Trend = %+v, want all zeros", delta.Trend)
	}
}

// TestComputeDelta_PlayerNotInBefore 验证 after 中存在但 before 中不存在的玩家被跳过。
func TestComputeDelta_PlayerNotInBefore(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn: 3, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
		},
	}
	after := &gamesdk.ViewState{
		TotalTurn: 4, TurnPhase: "actionPhase",
		Players: []gamesdk.ViewPlayer{
			deltaPlayer("p1", "Alice", 5, 3, nil, 0, false),
			deltaPlayer("p2", "Bob", 4, 5, nil, 2, false), // before 中不存在
		},
	}

	delta := ComputeDelta(before, after, "p1")

	// 不应为 p2 产出任何 change（无 before 基线）
	if c := findDeltaChangeByTypeAndActor(delta.Changes, ChangeTypeEnergy, "p2"); c != nil {
		t.Errorf("不应为 before 中不存在的 p2 产出 energy change: %+v", c)
	}
}
