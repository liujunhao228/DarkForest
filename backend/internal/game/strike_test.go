package game

import (
	"fmt"
	"strings"
	"testing"
)

// makeStrikeTestState 构造打击测试用 GameState。
// playerCount 个玩家占据星系 1-playerCount，p1 能量充足（20）。
// gameMode 决定 StrikeOrigin 与 StrikeMissBehavior 配置。
// 各测试自行向 p1.Hand 添加所需的打击牌。
func makeStrikeTestState(gameMode GameMode, playerCount int) *GameState {
	players := make([]Player, playerCount)
	for i := 0; i < playerCount; i++ {
		id := fmt.Sprintf("p%d", i+1)
		players[i] = Player{
			ID:               id,
			Name:             id,
			Color:            playerColors[i%len(playerColors)],
			Position:         i + 1,
			Energy:           5,
			Hand:             []Card{},
			FaceUpCards:      []Card{},
			Eliminated:       false,
			BroadcastHistory: []struct{ SystemID int; Turn int }{},
		}
	}
	// p1 能量充足，可发动任意打击牌
	players[0].Energy = 20

	return &GameState{
		Phase:              GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        playerCount,
		Players:            players,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:    "p1",
		LocalPlayerID:      "p1",
		DrawPile:           []Card{},
		DiscardPile:        []Card{},
		FlyingStrikes:      []FlyingStrike{},
		TurnPhase:          TurnPhaseActionPhase,
		Logs: []LogEntry{
			{ID: "log-init", Turn: 0, Phase: "system", Message: "游戏开始！", Type: LogEntryTypeSystem},
		},
		Leftovers: []StarLeftover{},
		GameMode:  gameMode,
	}
}

// makeStrikeCard 构造通用打击牌。
func makeStrikeCard(uid, defID, name string, energy, level, speed int) Card {
	return Card{
		UID:    uid,
		DefID:  defID,
		Name:   name,
		Type:   CardTypeStrike,
		Energy: energy,
		Level:  &level,
		Speed:  &speed,
	}
}

// makeTechLockStrikeCard 构造科技锁死打击牌（effect=discard_hand）。
func makeTechLockStrikeCard(uid string) Card {
	level := 4
	speed := 1
	effect := "discard_hand"
	return Card{
		UID:    uid,
		DefID:  "strike_tech_lock",
		Name:   "科技锁死",
		Type:   CardTypeStrike,
		Energy: 4,
		Level:  &level,
		Speed:  &speed,
		Effect: &effect,
	}
}

// makeFlyingStrike 构造通用 FlyingStrike（默认 Arrived=true）。
func makeFlyingStrike(uid, defID, ownerID, name string, position, targetSystem, level int, missed bool) FlyingStrike {
	return FlyingStrike{
		UID:            uid,
		DefID:          defID,
		OwnerID:        ownerID,
		Position:       position,
		TargetSystem:   targetSystem,
		Level:          level,
		Speed:          1,
		RemainingMoves: 1,
		StrikeName:     name,
		Arrived:        true,
		Missed:         missed,
	}
}

// =============================================================================
// PlayStrikeCard 测试（通过 GetModeRules 查表，仅 Classic/Relics 配置）
// =============================================================================

// TestStrike_ClassicDirect_Hit 验证 Classic 模式（Direct+Discard）命中目标：
// PlayStrikeCard 即刻 ResolveStrike，打击进弃牌堆，不创建 FlyingStrike，目标被淘汰。
func TestStrike_ClassicDirect_Hit(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// p1 持有降维打击（level=4 无视防御），目标星系 2（p2 所在）
	state.Players[0].Hand = []Card{makeStrikeCard("strike-1", "strike_dimensional", "降维打击", 10, 4, 1)}
	// 给 p2 一些手牌，验证淘汰时被回收到弃牌堆
	state.Players[1].Hand = []Card{makeStrikeCard("p2-card", "strike_thermal", "热核打击", 4, 1, 1)}

	ok := PlayStrikeCard(state, "p1", "strike-1", 2, nil)
	if !ok {
		t.Fatal("PlayStrikeCard returned false")
	}

	// p2 被淘汰
	if !state.Players[1].Eliminated {
		t.Errorf("p2 should be eliminated, got Eliminated=%v", state.Players[1].Eliminated)
	}
	// 不创建 FlyingStrike
	if len(state.FlyingStrikes) != 0 {
		t.Errorf("expected no FlyingStrikes, got %d: %+v", len(state.FlyingStrikes), state.FlyingStrikes)
	}
	// 打击牌进弃牌堆
	found := false
	for _, c := range state.DiscardPile {
		if c.UID == "strike-1" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected strike-1 in DiscardPile, got %+v", state.DiscardPile)
	}
	// StrikeCount 递增
	if state.Players[0].StrikeCount != 1 {
		t.Errorf("p1 StrikeCount = %d, want 1", state.Players[0].StrikeCount)
	}
	// 能量扣除：20 - 10(降维打击) + 6(淘汰奖励: 2 存活 × 3) = 16
	if state.Players[0].Energy != 16 {
		t.Errorf("p1 Energy = %d, want 16 (20 - 10 + 6 elimination bonus)", state.Players[0].Energy)
	}
	// PendingAction 被清除
	if state.PendingAction != nil {
		t.Errorf("expected nil PendingAction, got %+v", state.PendingAction)
	}
}

// TestStrike_ClassicDirect_MissDiscard 验证 Classic 模式落空（Direct+Discard）：
// targetSystem 无目标，打击进弃牌堆，不创建 FlyingStrike。
func TestStrike_ClassicDirect_MissDiscard(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// p1 持有热核打击，目标星系 9（无玩家）
	state.Players[0].Hand = []Card{makeStrikeCard("strike-1", "strike_thermal", "热核打击", 4, 1, 1)}

	ok := PlayStrikeCard(state, "p1", "strike-1", 9, nil)
	if !ok {
		t.Fatal("PlayStrikeCard returned false")
	}

	// 不创建 FlyingStrike
	if len(state.FlyingStrikes) != 0 {
		t.Errorf("expected no FlyingStrikes, got %d: %+v", len(state.FlyingStrikes), state.FlyingStrikes)
	}
	// 打击牌进弃牌堆
	found := false
	for _, c := range state.DiscardPile {
		if c.UID == "strike-1" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected strike-1 in DiscardPile, got %+v", state.DiscardPile)
	}
	// StrikeCount 递增
	if state.Players[0].StrikeCount != 1 {
		t.Errorf("p1 StrikeCount = %d, want 1", state.Players[0].StrikeCount)
	}
	// 能量扣除：20 - 4 = 16
	if state.Players[0].Energy != 16 {
		t.Errorf("p1 Energy = %d, want 16 (20 - 4)", state.Players[0].Energy)
	}
	// PendingAction 被清除
	if state.PendingAction != nil {
		t.Errorf("expected nil PendingAction, got %+v", state.PendingAction)
	}
}

// TestStrike_RelicOwnerPlanet_CreateFlyingStrike 验证 Relics 模式（OwnerPlanet+Discard）：
// PlayStrikeCard 创建 FlyingStrike 从 player.Position 出发。
func TestStrike_RelicOwnerPlanet_CreateFlyingStrike(t *testing.T) {
	state := makeStrikeTestState(GameModeCivilizationRelics, 3)
	// p1 持有热核打击，目标星系 2（p2 所在，但 OwnerPlanet 模式不即刻判定）
	state.Players[0].Hand = []Card{makeStrikeCard("strike-1", "strike_thermal", "热核打击", 4, 1, 1)}

	ok := PlayStrikeCard(state, "p1", "strike-1", 2, nil)
	if !ok {
		t.Fatal("PlayStrikeCard returned false")
	}

	// 创建 FlyingStrike，Position 为 p1 的位置（1）
	if len(state.FlyingStrikes) != 1 {
		t.Fatalf("expected 1 FlyingStrike, got %d", len(state.FlyingStrikes))
	}
	fs := state.FlyingStrikes[0]
	if fs.UID != "strike-1" {
		t.Errorf("FlyingStrike.UID = %q, want strike-1", fs.UID)
	}
	if fs.Position != 1 {
		t.Errorf("FlyingStrike.Position = %d, want 1 (p1's position)", fs.Position)
	}
	if fs.TargetSystem != 2 {
		t.Errorf("FlyingStrike.TargetSystem = %d, want 2", fs.TargetSystem)
	}
	if fs.OwnerID != "p1" {
		t.Errorf("FlyingStrike.OwnerID = %q, want p1", fs.OwnerID)
	}
	if fs.Arrived {
		t.Errorf("FlyingStrike.Arrived = true, want false (still flying)")
	}
	if fs.Missed {
		t.Errorf("FlyingStrike.Missed = true, want false")
	}
	// StrikeCount 递增
	if state.Players[0].StrikeCount != 1 {
		t.Errorf("p1 StrikeCount = %d, want 1", state.Players[0].StrikeCount)
	}
	// 能量扣除：20 - 4 = 16
	if state.Players[0].Energy != 16 {
		t.Errorf("p1 Energy = %d, want 16 (20 - 4)", state.Players[0].Energy)
	}
}

// =============================================================================
// handleStrikeMiss 直接测试（传入自定义 rules）
// =============================================================================

// TestHandleStrikeMiss_Discard 验证 Discard 行为：
// 打击从 FlyingStrikes 移除，进 DiscardPile，无 PendingAction。
func TestHandleStrikeMiss_Discard(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 9, 9, 1, false),
	}
	// 预设一个非 nil PendingAction，验证 Discard 会清除它
	state.PendingAction = &PendingAction{Type: "announceStrike", StrikeUID: "strike-1"}
	rules := ModeRules{StrikeMissBehavior: StrikeMissDiscard}

	handleStrikeMiss(state, &state.FlyingStrikes[0], rules)

	// 打击从 FlyingStrikes 移除
	if len(state.FlyingStrikes) != 0 {
		t.Errorf("expected empty FlyingStrikes, got %d: %+v", len(state.FlyingStrikes), state.FlyingStrikes)
	}
	// 打击进弃牌堆
	if len(state.DiscardPile) != 1 || state.DiscardPile[0].UID != "strike-1" {
		t.Errorf("expected strike-1 in DiscardPile, got %+v", state.DiscardPile)
	}
	// PendingAction 被清除
	if state.PendingAction != nil {
		t.Errorf("expected nil PendingAction, got %+v", state.PendingAction)
	}
}

// TestHandleStrikeMiss_FreeControl 验证 FreeControl 行为：
// strike.Missed=true，PendingAction.type="strikeMissedFree"。
func TestHandleStrikeMiss_FreeControl(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 9, 9, 1, false),
	}
	rules := ModeRules{StrikeMissBehavior: StrikeMissFreeControl}

	handleStrikeMiss(state, &state.FlyingStrikes[0], rules)

	// 打击仍在 FlyingStrikes 中
	if len(state.FlyingStrikes) != 1 {
		t.Fatalf("expected 1 FlyingStrike, got %d", len(state.FlyingStrikes))
	}
	// strike.Missed=true
	if !state.FlyingStrikes[0].Missed {
		t.Errorf("expected strike.Missed=true, got false")
	}
	// PendingAction.type="strikeMissedFree"
	if state.PendingAction == nil {
		t.Fatal("expected non-nil PendingAction")
	}
	if state.PendingAction.Type != "strikeMissedFree" {
		t.Errorf("PendingAction.Type = %q, want strikeMissedFree", state.PendingAction.Type)
	}
	if state.PendingAction.StrikeUID != "strike-1" {
		t.Errorf("PendingAction.StrikeUID = %q, want strike-1", state.PendingAction.StrikeUID)
	}
}

// TestHandleStrikeMiss_RequireTarget 验证 RequireTarget 行为：
// strike.Missed=true，PendingAction.type="strikeMissedRequireTarget"，validTargets=[1-9]。
func TestHandleStrikeMiss_RequireTarget(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 9, 9, 1, false),
	}
	rules := ModeRules{StrikeMissBehavior: StrikeMissRequireTarget}

	handleStrikeMiss(state, &state.FlyingStrikes[0], rules)

	// 打击仍在 FlyingStrikes 中
	if len(state.FlyingStrikes) != 1 {
		t.Fatalf("expected 1 FlyingStrike, got %d", len(state.FlyingStrikes))
	}
	// strike.Missed=true
	if !state.FlyingStrikes[0].Missed {
		t.Errorf("expected strike.Missed=true, got false")
	}
	// PendingAction.type="strikeMissedRequireTarget"
	if state.PendingAction == nil {
		t.Fatal("expected non-nil PendingAction")
	}
	if state.PendingAction.Type != "strikeMissedRequireTarget" {
		t.Errorf("PendingAction.Type = %q, want strikeMissedRequireTarget", state.PendingAction.Type)
	}
	if state.PendingAction.StrikeUID != "strike-1" {
		t.Errorf("PendingAction.StrikeUID = %q, want strike-1", state.PendingAction.StrikeUID)
	}
	// validTargets=[1-9]
	if len(state.PendingAction.ValidTargets) != 9 {
		t.Fatalf("len(ValidTargets) = %d, want 9", len(state.PendingAction.ValidTargets))
	}
	for i, v := range state.PendingAction.ValidTargets {
		if v != i+1 {
			t.Errorf("ValidTargets[%d] = %d, want %d", i, v, i+1)
		}
	}
}

// =============================================================================
// RetargetMissedStrike 测试
// =============================================================================

// TestRetargetMissedStrike_Direct_Hit 验证 Direct 模式重定向到有目标的星系：
// 即刻判定，打击进弃牌堆，目标被淘汰。
func TestRetargetMissedStrike_Direct_Hit(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// 构造一个 Missed 打击（降维打击 level=4），位于星系 9（无目标，故 Missed）
	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_dimensional", "p1", "降维打击", 9, 9, 4, true),
	}

	RetargetMissedStrike(state, "strike-1", 2) // 重定向到星系 2（p2 所在）

	// p2 被淘汰
	if !state.Players[1].Eliminated {
		t.Errorf("p2 should be eliminated, got Eliminated=%v", state.Players[1].Eliminated)
	}
	// 打击从 FlyingStrikes 移除
	if len(state.FlyingStrikes) != 0 {
		t.Errorf("expected empty FlyingStrikes, got %d: %+v", len(state.FlyingStrikes), state.FlyingStrikes)
	}
	// 打击进弃牌堆
	found := false
	for _, c := range state.DiscardPile {
		if c.UID == "strike-1" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected strike-1 in DiscardPile, got %+v", state.DiscardPile)
	}
}

// TestRetargetMissedStrike_Direct_MissAgain 验证 Direct 模式重定向到无目标星系：
// 再次进入 Missed 状态（使用 FreeControl rules，通过临时修改 classicModeRules 实现）。
func TestRetargetMissedStrike_Direct_MissAgain(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// 临时切换 Classic 模式的 StrikeMissBehavior 为 FreeControl，测试"再次进入 Missed 状态"
	originalBehavior := classicModeRules.StrikeMissBehavior
	classicModeRules.StrikeMissBehavior = StrikeMissFreeControl
	defer func() { classicModeRules.StrikeMissBehavior = originalBehavior }()

	// 构造一个 Missed 打击，位于星系 9
	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 9, 9, 1, true),
	}

	RetargetMissedStrike(state, "strike-1", 5) // 重定向到星系 5（无目标）

	// 打击仍在 FlyingStrikes 中（FreeControl 不移除）
	if len(state.FlyingStrikes) != 1 {
		t.Fatalf("expected 1 FlyingStrike (re-entered Missed), got %d", len(state.FlyingStrikes))
	}
	fs := state.FlyingStrikes[0]
	// strike.Missed=true（再次进入 Missed 状态）
	if !fs.Missed {
		t.Errorf("expected strike.Missed=true (re-entered Missed), got false")
	}
	// strike.Position 更新为 5
	if fs.Position != 5 {
		t.Errorf("strike.Position = %d, want 5", fs.Position)
	}
	// PendingAction.type="strikeMissedFree"
	if state.PendingAction == nil {
		t.Fatal("expected non-nil PendingAction")
	}
	if state.PendingAction.Type != "strikeMissedFree" {
		t.Errorf("PendingAction.Type = %q, want strikeMissedFree", state.PendingAction.Type)
	}
}

// TestRetargetMissedStrike_OwnerPlanet_Refly 验证 OwnerPlanet 模式重定向：
// 重定向后 Arrived=false, RemainingMoves--。
func TestRetargetMissedStrike_OwnerPlanet_Refly(t *testing.T) {
	state := makeStrikeTestState(GameModeCivilizationRelics, 3)
	// 构造一个 Missed 打击，RemainingMoves=2
	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 2, 2, 1, true),
	}
	state.FlyingStrikes[0].RemainingMoves = 2

	RetargetMissedStrike(state, "strike-1", 5) // 重定向到星系 5

	if len(state.FlyingStrikes) != 1 {
		t.Fatalf("expected 1 FlyingStrike, got %d", len(state.FlyingStrikes))
	}
	fs := state.FlyingStrikes[0]
	// TargetSystem 更新
	if fs.TargetSystem != 5 {
		t.Errorf("strike.TargetSystem = %d, want 5", fs.TargetSystem)
	}
	// Arrived=false
	if fs.Arrived {
		t.Errorf("strike.Arrived = true, want false (refly)")
	}
	// Missed=false
	if fs.Missed {
		t.Errorf("strike.Missed = true, want false (cleared)")
	}
	// RetargetedThisTurn=true
	if !fs.RetargetedThisTurn {
		t.Errorf("strike.RetargetedThisTurn = false, want true")
	}
	// RemainingMoves-- (2 -> 1)
	if fs.RemainingMoves != 1 {
		t.Errorf("strike.RemainingMoves = %d, want 1 (decremented from 2)", fs.RemainingMoves)
	}
}

// TestRetargetMissedStrike_NonMissed_Rejected 验证对 Missed=false 打击调用：
// 无效果。
func TestRetargetMissedStrike_NonMissed_Rejected(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// 构造一个非 Missed 打击
	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 9, 9, 1, false),
	}
	originalTargetSystem := state.FlyingStrikes[0].TargetSystem
	originalPosition := state.FlyingStrikes[0].Position

	RetargetMissedStrike(state, "strike-1", 2)

	// 打击未改变
	if len(state.FlyingStrikes) != 1 {
		t.Fatalf("expected 1 FlyingStrike (unchanged), got %d", len(state.FlyingStrikes))
	}
	fs := state.FlyingStrikes[0]
	if fs.TargetSystem != originalTargetSystem {
		t.Errorf("strike.TargetSystem = %d, want %d (unchanged)", fs.TargetSystem, originalTargetSystem)
	}
	if fs.Position != originalPosition {
		t.Errorf("strike.Position = %d, want %d (unchanged)", fs.Position, originalPosition)
	}
}

// =============================================================================
// SkipMissedStrike 测试
// =============================================================================

// TestSkipMissedStrike_FreeControl_Allowed 验证 FreeControl 模式允许跳过：
// 设 Delayed=true。
func TestSkipMissedStrike_FreeControl_Allowed(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// 临时切换 Classic 模式的 StrikeMissBehavior 为 FreeControl
	originalBehavior := classicModeRules.StrikeMissBehavior
	classicModeRules.StrikeMissBehavior = StrikeMissFreeControl
	defer func() { classicModeRules.StrikeMissBehavior = originalBehavior }()

	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 9, 9, 1, true),
	}
	state.PendingAction = &PendingAction{Type: "strikeMissedFree", StrikeUID: "strike-1"}

	SkipMissedStrike(state, "strike-1")

	if len(state.FlyingStrikes) != 1 {
		t.Fatalf("expected 1 FlyingStrike, got %d", len(state.FlyingStrikes))
	}
	// Delayed=true
	if !state.FlyingStrikes[0].Delayed {
		t.Errorf("expected strike.Delayed=true, got false")
	}
	// PendingAction 被清除
	if state.PendingAction != nil {
		t.Errorf("expected nil PendingAction, got %+v", state.PendingAction)
	}
}

// TestSkipMissedStrike_RequireTarget_Rejected 验证 RequireTarget 模式拒绝跳过：
// 无效果。
func TestSkipMissedStrike_RequireTarget_Rejected(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// 临时切换 Classic 模式的 StrikeMissBehavior 为 RequireTarget
	originalBehavior := classicModeRules.StrikeMissBehavior
	classicModeRules.StrikeMissBehavior = StrikeMissRequireTarget
	defer func() { classicModeRules.StrikeMissBehavior = originalBehavior }()

	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 9, 9, 1, true),
	}
	state.PendingAction = &PendingAction{Type: "strikeMissedRequireTarget", StrikeUID: "strike-1"}

	SkipMissedStrike(state, "strike-1")

	if len(state.FlyingStrikes) != 1 {
		t.Fatalf("expected 1 FlyingStrike (unchanged), got %d", len(state.FlyingStrikes))
	}
	// Delayed 仍为 false
	if state.FlyingStrikes[0].Delayed {
		t.Errorf("expected strike.Delayed=false (RequireTarget rejects skip), got true")
	}
	// PendingAction 未被清除
	if state.PendingAction == nil {
		t.Error("expected non-nil PendingAction (unchanged)")
	}
}

// =============================================================================
// DiscardMissedStrike 测试
// =============================================================================

// TestDiscardMissedStrike_Success 验证 Missed 打击废弃到弃牌堆。
func TestDiscardMissedStrike_Success(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// 预填 p1 手牌 4 张，使 DrawPhase 中 cardsToDraw = 4 - 4 = 0，
	// 避免 DiscardMissedStrike 末尾 AfterStrikeMove → advanceToStrikeMovement → DrawPhase
	// 触发 DrawCard 在 DrawPile 空 + DiscardPile 非空时重洗弃牌堆（会清空 DiscardPile）。
	state.Players[0].Hand = []Card{
		makeStrikeCard("p1-card-1", "strike_thermal", "热核打击", 4, 1, 1),
		makeStrikeCard("p1-card-2", "strike_thermal", "热核打击", 4, 1, 1),
		makeStrikeCard("p1-card-3", "strike_thermal", "热核打击", 4, 1, 1),
		makeStrikeCard("p1-card-4", "strike_thermal", "热核打击", 4, 1, 1),
	}
	state.FlyingStrikes = []FlyingStrike{
		makeFlyingStrike("strike-1", "strike_thermal", "p1", "热核打击", 9, 9, 1, true),
	}
	state.PendingAction = &PendingAction{Type: "strikeMissedFree", StrikeUID: "strike-1"}

	DiscardMissedStrike(state, "strike-1")

	// 打击从 FlyingStrikes 移除
	if len(state.FlyingStrikes) != 0 {
		t.Errorf("expected empty FlyingStrikes, got %d: %+v", len(state.FlyingStrikes), state.FlyingStrikes)
	}
	// 打击进弃牌堆
	if len(state.DiscardPile) != 1 || state.DiscardPile[0].UID != "strike-1" {
		t.Errorf("expected strike-1 in DiscardPile, got %+v", state.DiscardPile)
	}
	// PendingAction 被清除
	if state.PendingAction != nil {
		t.Errorf("expected nil PendingAction, got %+v", state.PendingAction)
	}
}

// =============================================================================
// 科技锁死不受 StrikeOrigin 影响测试
// =============================================================================

// TestStrike_TechLock_UnaffectedByStrikeOrigin 验证 Classic 模式下打 strike_tech_lock：
// 走现有立即生效分支，不创建 FlyingStrike。
func TestStrike_TechLock_UnaffectedByStrikeOrigin(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// p1 持有科技锁死，目标玩家 p2
	state.Players[0].Hand = []Card{makeTechLockStrikeCard("strike-1")}
	// 给 p2 一些手牌，验证被弃光
	state.Players[1].Hand = []Card{
		makeStrikeCard("p2-card-1", "strike_thermal", "热核打击", 4, 1, 1),
		makeStrikeCard("p2-card-2", "strike_thermal", "热核打击", 4, 1, 1),
	}
	targetPlayerID := "p2"

	ok := PlayStrikeCard(state, "p1", "strike-1", 2, &targetPlayerID)
	if !ok {
		t.Fatal("PlayStrikeCard returned false")
	}

	// p2 手牌被弃光
	if len(state.Players[1].Hand) != 0 {
		t.Errorf("p2 Hand should be empty, got %d cards", len(state.Players[1].Hand))
	}
	// p2 未被淘汰（科技锁死只弃手牌，不淘汰）
	if state.Players[1].Eliminated {
		t.Errorf("p2 should not be eliminated by tech_lock, got Eliminated=%v", state.Players[1].Eliminated)
	}
	// 不创建 FlyingStrike
	if len(state.FlyingStrikes) != 0 {
		t.Errorf("expected no FlyingStrikes, got %d: %+v", len(state.FlyingStrikes), state.FlyingStrikes)
	}
	// 打击牌 + p2 手牌进弃牌堆（1 strike + 2 p2 cards = 3）
	if len(state.DiscardPile) != 3 {
		t.Errorf("expected 3 cards in DiscardPile (strike + 2 p2 cards), got %d: %+v", len(state.DiscardPile), state.DiscardPile)
	}
	// 验证打击牌在弃牌堆
	foundStrike := false
	for _, c := range state.DiscardPile {
		if c.UID == "strike-1" {
			foundStrike = true
			break
		}
	}
	if !foundStrike {
		t.Errorf("expected strike-1 in DiscardPile, got %+v", state.DiscardPile)
	}
	// 能量扣除：20 - 4 = 16
	if state.Players[0].Energy != 16 {
		t.Errorf("p1 Energy = %d, want 16 (20 - 4)", state.Players[0].Energy)
	}
}

// =============================================================================
// 目标规则校验测试：仅"科技锁死"支持指定玩家
// =============================================================================

// TestStrike_NonTechLock_RejectsTargetPlayerID 验证：非"科技锁死"打击传入 targetPlayerID 时，
// PlayStrikeCard 返回 false，不扣能量、不消耗手牌、不创建 FlyingStrike、不进弃牌堆。
func TestStrike_NonTechLock_RejectsTargetPlayerID(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// p1 持有热核打击（非科技锁死）
	state.Players[0].Hand = []Card{makeStrikeCard("strike-1", "strike_thermal", "热核打击", 4, 1, 1)}
	targetPlayerID := "p2"

	ok := PlayStrikeCard(state, "p1", "strike-1", 2, &targetPlayerID)
	if ok {
		t.Fatal("PlayStrikeCard should return false for non-tech-lock strike with targetPlayerID")
	}

	// 能量未扣：仍为 20
	if state.Players[0].Energy != 20 {
		t.Errorf("p1 Energy = %d, want 20 (no deduction on rejection)", state.Players[0].Energy)
	}
	// 手牌仍在：1 张
	if len(state.Players[0].Hand) != 1 {
		t.Errorf("p1 Hand should still have 1 card, got %d", len(state.Players[0].Hand))
	}
	if len(state.Players[0].Hand) > 0 && state.Players[0].Hand[0].UID != "strike-1" {
		t.Errorf("p1 Hand[0].UID = %s, want strike-1", state.Players[0].Hand[0].UID)
	}
	// 未创建 FlyingStrike
	if len(state.FlyingStrikes) != 0 {
		t.Errorf("expected no FlyingStrikes, got %d: %+v", len(state.FlyingStrikes), state.FlyingStrikes)
	}
	// 弃牌堆为空
	if len(state.DiscardPile) != 0 {
		t.Errorf("expected empty DiscardPile, got %d: %+v", len(state.DiscardPile), state.DiscardPile)
	}
	// p2 未受影响（未被淘汰、手牌未变）
	if state.Players[1].Eliminated {
		t.Errorf("p2 should not be eliminated")
	}
	// 日志包含拒绝信息
	foundRejectLog := false
	for _, log := range state.Logs {
		if log.Type == LogEntryTypeSystem && strings.Contains(log.Message, "热核打击") && strings.Contains(log.Message, "无法指定玩家") {
			foundRejectLog = true
			break
		}
	}
	if !foundRejectLog {
		t.Errorf("expected rejection log in state.Logs, got: %+v", state.Logs)
	}
}

