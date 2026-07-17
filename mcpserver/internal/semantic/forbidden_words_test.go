package semantic

import (
	"encoding/json"
	"strings"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// forbidden_words_test.go 是 Task 16 加固的统一禁用词断言入口。
//
// 背景:Spec 阶段用户原话——"一句话解释"中不要包含"建议"等行动指导词。
// MCP 不是 Agent 赢游戏的"外挂",辅助水平应与前端客户端相当。
//
// 禁用词完整列表(9 项):建议 / 应当 / 推荐 / 可以 / 不妨 / 最好 / 应该 /
// 需要 / 务必。
//
// 本文件汇总所有 explain / Description / Narrative 等字段生成路径的禁用词
// 断言,作为 Task 16 全局审查的单测加固入口。各 explain 生成路径已有分散
// 的断言(strike_view_test.go / state_delta_test.go /
// affordance_explorer_test.go / static_resources_test.go),本文件作为
// 聚合校验,确保任意路径回归时都被捕获。
//
// 与现有 strikeForbiddenWords / deltaForbiddenWords / promptForbiddenWords
// 保持同一份词表(均镜像自 Spec 约束)。

// forbiddenWords 是 explain / Description / Narrative 等字段禁用的行动指导词列表。
// 与 strikeForbiddenWords(strike_view.go)、deltaForbiddenWords(state_delta.go)、
// promptForbiddenWords(server/prompts.go)保持同一份 9 项词表。
var forbiddenWords = []string{
	"建议", "应当", "推荐", "可以", "不妨", "最好", "应该", "需要", "务必",
}

// assertTextHasNoForbiddenWord 断言 text 不含任何禁用词。
// context 用于失败时标注字段来源,便于定位回归点。
func assertTextHasNoForbiddenWord(t *testing.T, text string, context string) {
	t.Helper()
	for _, w := range forbiddenWords {
		if strings.Contains(text, w) {
			t.Errorf("%s 含禁用词 %q(完整文本: %s)", context, w, text)
		}
	}
}

// TestForbiddenWords_AggregatedExplainPaths 聚合校验所有 explain 生成路径
// 不含禁用词。覆盖以下 5 类路径,每路径至少 1 个测试用例:
//  1. StrikeView.explain(InboundStrike.Explain / StrikeResolve.Explain)
//  2. StateDelta(Changes[].Narrative + Highlights)
//  3. Affordance(PendingActionOption.Description + ActionOption 各字段)
//  4. ModeRules.Description
//  5. MechanismRule(4 个机制文本)
func TestForbiddenWords_AggregatedExplainPaths(t *testing.T) {
	t.Run("StrikeView", testForbiddenWords_StrikeView)
	t.Run("StateDelta", testForbiddenWords_StateDelta)
	t.Run("Affordance", testForbiddenWords_Affordance)
	t.Run("ModeRules", testForbiddenWords_ModeRules)
	t.Run("MechanismRule", testForbiddenWords_MechanismRule)
}

// testForbiddenWords_StrikeView 覆盖 InboundStrike.Explain 与 StrikeResolve.Explain
// 两条路径,包含 5 类打击卡(热核/光粒/湮灭/降维/科技锁死)与防御判定分支。
func testForbiddenWords_StrikeView(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				Energy:   10,
				FaceUpCards: []gamesdk.Card{
					{UID: "f-d", DefID: "defense_shield_ring", Name: "掩体星环", Type: "defense", ProtectionLevel: 2},
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 10},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-1", "strike_thermal", "p2", 5, 3, 1, 1, false),
			makeStrike("s-2", "strike_light_particle", "p2", 5, 3, 2, 1, false),
			makeStrike("s-3", "strike_annihilation", "p2", 5, 3, 3, 1, false),
			makeStrike("s-4", "strike_dimensional", "p2", 5, 3, 4, 1, false),
			makeStrike("s-5", "strike_tech_lock", "p2", 5, 3, 4, 1, false),
		},
		PendingAction: json.RawMessage(`{"type":"announceStrike","strikeUids":["s-1","s-2","s-3","s-4","s-5"]}`),
	}
	view := ProjectStrike(state, "p1", 3)

	if len(view.Inbound) == 0 {
		t.Fatal("Inbound 为空,测试用例未覆盖到 explain 生成路径")
	}
	for i := range view.Inbound {
		assertTextHasNoForbiddenWord(t, view.Inbound[i].Explain, "InboundStrike.Explain")
	}

	if len(view.ResolvesThisTurn) == 0 {
		t.Fatal("ResolvesThisTurn 为空,测试用例未覆盖到 explain 生成路径")
	}
	for i := range view.ResolvesThisTurn {
		assertTextHasNoForbiddenWord(t, view.ResolvesThisTurn[i].Explain, "StrikeResolve.Explain")
	}
}

// testForbiddenWords_StateDelta 覆盖能量/手牌/位置/淘汰/打击/恒星/广播/胜负
// 8 类 Change 与 Highlights 提取路径。
func testForbiddenWords_StateDelta(t *testing.T) {
	before := &gamesdk.ViewState{
		TotalTurn:       3,
		Phase:           "playing",
		TurnPhase:       "actionPhase",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 3, Energy: 5, HandCount: 2},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 10, HandCount: 3, Eliminated: false},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{},
	}
	after := &gamesdk.ViewState{
		TotalTurn:       4,
		Phase:           "playing",
		TurnPhase:       "actionPhase",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Position: 4, Energy: 8, HandCount: 1},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 10, HandCount: 3, Eliminated: true},
		},
		FlyingStrikes: []gamesdk.FlyingStrike{
			makeStrike("s-1", "strike_thermal", "p1", 3, 5, 1, 1, false),
		},
		DestroyedStars: []int{6},
		Winner:         "p1",
	}
	delta := ComputeDelta(before, after, "p1")

	if len(delta.Changes) == 0 {
		t.Fatal("Changes 为空,测试用例未覆盖到 Narrative 生成路径")
	}
	for i := range delta.Changes {
		assertTextHasNoForbiddenWord(t, delta.Changes[i].Narrative, "Change.Narrative")
	}
	for _, h := range delta.Highlights {
		assertTextHasNoForbiddenWord(t, h, "Highlights")
	}
}

// testForbiddenWords_Affordance 覆盖 PendingActionOption.Description 与
// ActionOption(Description / Precondition / ExpectedEffect / RiskNote)两条路径。
//
// 自由动作集覆盖 play_card / strike / deploy_card / lightspeed_ship /
// recycle_card / end_turn 6 类;PendingAction 覆盖 7 个 Type 分支。
func testForbiddenWords_Affordance(t *testing.T) {
	// --- 自由动作集:覆盖 6 类 ActionOption ---
	freeState := &gamesdk.ViewState{
		Phase:           "playing",
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Position: 3,
				Energy:   20,
				Hand: []gamesdk.Card{
					makeHandCard("h-bc", "broadcast_star_cooperation", "恒星广播", "broadcast", 0, withRange(1)),
					makeHandCard("h-sk", "strike_thermal", "热核打击", "strike", 4, withLevel(1)),
					makeHandCard("h-fc", "facility_solar_array", "太阳能阵列", "facility", 2),
				},
				FaceUpCards: []gamesdk.Card{
					{UID: "f-es", DefID: "facility_lightspeed_ship", Name: "光速飞船", Type: "facility", Ability: "escape"},
					{UID: "f-sa", DefID: "facility_solar_array", Name: "太阳能阵列", Type: "facility", Energy: 2},
				},
			},
			{ID: "p2", Name: "Bob", Position: 5, Energy: 10, HandCount: 3},
		},
	}
	aff := ExploreAffordance(freeState, "p1", "classic")
	if aff.PendingAction != nil {
		assertTextHasNoForbiddenWord(t, aff.PendingAction.Description, "PendingAction.Description[freeState]")
	}
	if len(aff.LegalActions) == 0 {
		t.Fatal("LegalActions 为空,测试用例未覆盖到 ActionOption 生成路径")
	}
	for i := range aff.LegalActions {
		a := aff.LegalActions[i]
		assertTextHasNoForbiddenWord(t, a.Description, "ActionOption.Description["+a.Action+"]")
		assertTextHasNoForbiddenWord(t, a.Precondition, "ActionOption.Precondition["+a.Action+"]")
		assertTextHasNoForbiddenWord(t, a.ExpectedEffect, "ActionOption.ExpectedEffect["+a.Action+"]")
		assertTextHasNoForbiddenWord(t, a.RiskNote, "ActionOption.RiskNote["+a.Action+"]")
	}

	// --- PendingAction 路径:覆盖 8 个 Type 分支 ---
	pendingTypes := []string{
		"announceStrike", "strikeMissedFree", "strikeMissedRequireTarget",
		"respondBroadcast", "selectBroadcastResponder", "endTurnDiscard",
		"strikeSelect", "strikeMove",
	}
	for _, paType := range pendingTypes {
		pa := mustMarshal(t, map[string]any{"type": paType})
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
					},
				},
			},
		}
		aff := ExploreAffordance(state, "p1", "classic")
		if aff.PendingAction == nil {
			t.Errorf("PendingAction nil for type %q", paType)
			continue
		}
		assertTextHasNoForbiddenWord(t, aff.PendingAction.Description, "PendingAction.Description["+paType+"]")
	}
}

// testForbiddenWords_ModeRules 覆盖 Classic / Civilization Relics 两套
// ModeRules.Description 路径。
func testForbiddenWords_ModeRules(t *testing.T) {
	for _, mode := range []string{ModeClassic, ModeCivilizationRelics} {
		rules, ok := GetModeRules(mode)
		if !ok {
			t.Errorf("GetModeRules(%q) 未找到", mode)
			continue
		}
		assertTextHasNoForbiddenWord(t, rules.Description, "ModeRules.Description["+mode+"]")
	}
}

// testForbiddenWords_MechanismRule 覆盖 strike / broadcast / lightspeed /
// relic 4 个机制文本路径。
func testForbiddenWords_MechanismRule(t *testing.T) {
	for _, name := range ListMechanismNames() {
		text, ok := GetMechanismRule(name)
		if !ok {
			t.Errorf("GetMechanismRule(%q) 未找到", name)
			continue
		}
		if len(text) == 0 {
			t.Errorf("GetMechanismRule(%q) 返回空文本", name)
			continue
		}
		assertTextHasNoForbiddenWord(t, text, "MechanismRule["+name+"]")
	}
}
