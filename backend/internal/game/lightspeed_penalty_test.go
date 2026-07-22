package game

import (
	"strings"
	"testing"
)

// makeDefenseCard 构造一张防御牌（指定 ProtectionLevel）。
func makeDefenseCard(uid string, name string, protectionLevel int) Card {
	return Card{
		UID:             uid,
		DefID:           "defense_test",
		Name:            name,
		Type:            CardTypeDefense,
		ProtectionLevel: &protectionLevel,
	}
}

// makeLightspeedShipCard 构造一张光速飞船牌。
func makeLightspeedShipCard(uid string) Card {
	escapeAbility := "escape"
	return Card{
		UID:     uid,
		DefID:   "facility_lightspeed_ship",
		Name:    "光速飞船",
		Type:    CardTypeFacility,
		Energy:  10,
		Ability: &escapeAbility,
	}
}

// =============================================================================
// 光速飞船跃迁失败惩罚测试（occupied 星系 / 降维锁定星系）
// =============================================================================

// TestLightspeedClassic_SpecifiedOccupied_Penalty 验证 Classic 模式指定跃迁到被占用星系：
// 扣 13 点能量（CombinedActionCostSpecified）、飞船保留手牌、位置不变、PenaltyTurn=true。
func TestLightspeedClassic_SpecifiedOccupied_Penalty(t *testing.T) {
	state := makeLightspeedClassicTestState()
	// p1 能量 20，指定 targetSystem=2（p2 占据）
	state.Players[0].Energy = 20

	ExecuteLightspeedShip(state, "p1", "specified", 2, 0, "", false, nil)

	p1 := state.Players[0]
	if p1.Energy != 7 {
		t.Errorf("p1 Energy = %d, want 7 (20 - 13)", p1.Energy)
	}
	if p1.Position != 1 {
		t.Errorf("p1 Position = %d, want 1 (unchanged)", p1.Position)
	}
	if len(p1.Hand) != 1 || p1.Hand[0].UID != "ship-1" {
		t.Errorf("expected ship-1 to remain in Hand, got %+v", p1.Hand)
	}
	if len(state.DiscardPile) != 0 {
		t.Errorf("expected empty DiscardPile (ship not discarded), got %+v", state.DiscardPile)
	}
	if !p1.PenaltyTurn {
		t.Errorf("expected p1.PenaltyTurn=true, got false")
	}
}

// TestLightspeedRelics_SpecifiedOccupied_Penalty 验证 Relics 模式指定跃迁到被占用星系：
// 扣 5 点能量（JumpCostSpecified）、飞船保留 FaceUpCards、位置不变、PenaltyTurn=true。
func TestLightspeedRelics_SpecifiedOccupied_Penalty(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	// p1 能量 20，指定 targetSystem=2（p2 占据）
	state.Players[0].Energy = 20

	ExecuteLightspeedShip(state, "p1", "specified", 2, 0, "", false, nil)

	p1 := state.Players[0]
	if p1.Energy != 15 {
		t.Errorf("p1 Energy = %d, want 15 (20 - 5 jumpCost)", p1.Energy)
	}
	if p1.Position != 1 {
		t.Errorf("p1 Position = %d, want 1 (unchanged)", p1.Position)
	}
	// 飞船应保留在 FaceUpCards（Relics 模式飞船是设施牌）
	foundShip := false
	for _, c := range p1.FaceUpCards {
		if c.UID == "ship-1" {
			foundShip = true
			break
		}
	}
	if !foundShip {
		t.Errorf("expected ship-1 to remain in FaceUpCards, got %+v", p1.FaceUpCards)
	}
	if !p1.PenaltyTurn {
		t.Errorf("expected p1.PenaltyTurn=true, got false")
	}
}

// =============================================================================
// PenaltyTurn 消耗测试
// =============================================================================

// TestLightspeed_PenaltyTurn_ConsumedOnStartTurn 验证 PenaltyTurn=true 的玩家
// 在 StartTurn 时标志被消耗为 false，但不会跳过回合（CurrentPlayerID 仍为 p1），
// 日志含"受跃迁惩罚影响"和"只能弃牌或直接结束回合"。
func TestLightspeed_PenaltyTurn_ConsumedOnStartTurn(t *testing.T) {
	state := makeLightspeedClassicTestState()
	state.Players[0].PenaltyTurn = true
	logsBefore := len(state.Logs)

	StartTurn(state)

	p1 := state.Players[0]
	if p1.PenaltyTurn {
		t.Errorf("expected p1.PenaltyTurn=false (consumed), got true")
	}
	if state.CurrentPlayerID != "p1" {
		t.Errorf("expected CurrentPlayerID == p1 (not advanced), got %s", state.CurrentPlayerID)
	}
	// 日志含"受跃迁惩罚影响"
	newLogs := state.Logs[logsBefore:]
	foundPenaltyLog := false
	for _, l := range newLogs {
		if strings.Contains(l.Message, "受跃迁惩罚影响") {
			foundPenaltyLog = true
			break
		}
	}
	if !foundPenaltyLog {
		t.Errorf("expected log containing '受跃迁惩罚影响', none found in %d new logs", len(newLogs))
	}
}

// =============================================================================
// 湮灭打击特殊效果测试
// =============================================================================

// TestStrike_Annihilation_TriggersStun_WhenLowDefense 验证湮灭打击在防御等级低于打击等级时
// 触发 StarEffectAnnihilationStun（Duration=5）。
// p2 防御等级 2 < 湮灭打击等级 3 → 触发跃迁干扰效果。
func TestStrike_Annihilation_TriggersStun_WhenLowDefense(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// p2 在星系 2，持有一张防御等级 2 的防御牌
	state.Players[1].FaceUpCards = []Card{makeDefenseCard("def-1", "低级护盾", 2)}

	strike := makeFlyingStrike("s1", "strike_annihilation", "p1", "湮灭打击", 1, 2, 3, false)
	ResolveStrike(state, strike, []*Player{&state.Players[1]})

	if !IsStarEffectActive(state, 2, StarEffectAnnihilationStun) {
		t.Errorf("expected StarEffectAnnihilationStun active at system 2, got inactive")
	}
	// 验证 Duration=5
	for _, e := range state.StarEffects {
		if e.SystemID == 2 && e.Type == StarEffectAnnihilationStun {
			if e.Duration != 5 {
				t.Errorf("annihilationStun Duration = %d, want 5", e.Duration)
			}
		}
	}
}

// TestStrike_Annihilation_NoStun_WhenQuantumGhost 验证湮灭打击在防御等级 ≥ 打击等级时
// 不触发 Stun（量子幽灵防御等级 3 ≥ 湮灭打击等级 3）。
func TestStrike_Annihilation_NoStun_WhenQuantumGhost(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// p2 持有量子幽灵（防御等级 3 ≥ 湮灭打击等级 3）
	state.Players[1].FaceUpCards = []Card{makeDefenseCard("def-1", "量子幽灵", 3)}

	strike := makeFlyingStrike("s1", "strike_annihilation", "p1", "湮灭打击", 1, 2, 3, false)
	ResolveStrike(state, strike, []*Player{&state.Players[1]})

	if IsStarEffectActive(state, 2, StarEffectAnnihilationStun) {
		t.Errorf("expected StarEffectAnnihilationStun NOT active (quantum ghost defends), got active")
	}
}

// =============================================================================
// 降维打击特殊效果测试
// =============================================================================

// TestStrike_Dimensional_TriggersPermanentLock 验证降维打击（Level=4 无视防御）生效后
// 触发 StarEffectDimensionalLock 永久锁定（Duration=-1），目标被淘汰。
func TestStrike_Dimensional_TriggersPermanentLock(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// p2 在星系 2，即使有防御也会被降维打击无视
	state.Players[1].FaceUpCards = []Card{makeDefenseCard("def-1", "量子幽灵", 3)}

	strike := makeFlyingStrike("s1", "strike_dimensional", "p1", "降维打击", 1, 2, 4, false)
	ResolveStrike(state, strike, []*Player{&state.Players[1]})

	if !state.Players[1].Eliminated {
		t.Errorf("expected p2 eliminated by dimensional strike, got Eliminated=false")
	}
	if !IsStarEffectActive(state, 2, StarEffectDimensionalLock) {
		t.Errorf("expected StarEffectDimensionalLock active at system 2, got inactive")
	}
	// 验证 Duration=-1（永久）
	for _, e := range state.StarEffects {
		if e.SystemID == 2 && e.Type == StarEffectDimensionalLock {
			if e.Duration != -1 {
				t.Errorf("dimensionalLock Duration = %d, want -1 (permanent)", e.Duration)
			}
		}
	}
}

// =============================================================================
// 跃迁至带效果星系的测试
// =============================================================================

// TestLightspeed_JumpToAnnihilationStun_PenaltyTurn 验证跃迁到有湮灭余波的星系：
// 跃迁成功（位置更新）+ PenaltyTurn=true。
func TestLightspeed_JumpToAnnihilationStun_PenaltyTurn(t *testing.T) {
	state := makeLightspeedClassicTestState()
	state.Players[0].Energy = 20
	// 给星系 9 加湮灭余波效果
	AddStarEffect(state, 9, StarEffectAnnihilationStun, 5, "test-strike")
	logsBefore := len(state.Logs)

	ExecuteLightspeedShip(state, "p1", "specified", 9, 0, "", false, nil)

	p1 := state.Players[0]
	if p1.Position != 9 {
		t.Errorf("p1 Position = %d, want 9 (jump succeeded)", p1.Position)
	}
	if !p1.PenaltyTurn {
		t.Errorf("expected p1.PenaltyTurn=true (annihilation stun), got false")
	}
	// 日志含"湮灭打击余波"
	newLogs := state.Logs[logsBefore:]
	foundStunLog := false
	for _, l := range newLogs {
		if strings.Contains(l.Message, "湮灭打击余波") {
			foundStunLog = true
			break
		}
	}
	if !foundStunLog {
		t.Errorf("expected log containing '湮灭打击余波', none found in %d new logs", len(newLogs))
	}
}

// TestLightspeed_SpecifiedDimensionalLock_Penalty 验证指定跃迁到降维锁定星系：
// 扣能量 + PenaltyTurn=true + 位置不变。
func TestLightspeed_SpecifiedDimensionalLock_Penalty(t *testing.T) {
	state := makeLightspeedClassicTestState()
	state.Players[0].Energy = 20
	// 给星系 9 加降维锁定
	AddStarEffect(state, 9, StarEffectDimensionalLock, -1, "test-strike")

	ExecuteLightspeedShip(state, "p1", "specified", 9, 0, "", false, nil)

	p1 := state.Players[0]
	if p1.Position != 1 {
		t.Errorf("p1 Position = %d, want 1 (unchanged, jump failed)", p1.Position)
	}
	if !p1.PenaltyTurn {
		t.Errorf("expected p1.PenaltyTurn=true, got false")
	}
	if p1.Energy != 7 {
		t.Errorf("p1 Energy = %d, want 7 (20 - 13)", p1.Energy)
	}
}

// TestLightspeed_Random_ExcludesDimensionalLock 验证随机跃迁不会以降维锁定星系为目标。
// 3 玩家占据 1-3，星系 4-8 可用，星系 9 被降维锁定 → 跃迁结果应在 {4,5,6,7,8}。
func TestLightspeed_Random_ExcludesDimensionalLock(t *testing.T) {
	state := makeStrikeTestState(GameModeClassic, 3)
	// p1 手牌持光速飞船，能量足够 random（cost=10）
	state.Players[0].Hand = []Card{makeLightspeedShipCard("ship-1")}
	state.Players[0].Energy = 20
	// 给星系 9 加降维锁定
	AddStarEffect(state, 9, StarEffectDimensionalLock, -1, "test-strike")

	ExecuteLightspeedShip(state, "p1", "random", 0, 0, "", false, nil)

	p1 := state.Players[0]
	if p1.Position == 9 {
		t.Errorf("p1 Position = 9, should never jump to dimensionally locked system")
	}
	if p1.Position < 4 || p1.Position > 8 {
		t.Errorf("p1 Position = %d, want in range [4,8] (excluding occupied 1-3 and locked 9)", p1.Position)
	}
}

// =============================================================================
// 星系效果过期测试
// =============================================================================

// TestStarEffect_Expiry_After5Turns 验证湮灭余波在 5 回合后过期并被清理。
func TestStarEffect_Expiry_After5Turns(t *testing.T) {
	state := makeLightspeedClassicTestState()
	// TotalTurn=1，添加 Duration=5 的湮灭余波
	AddStarEffect(state, 9, StarEffectAnnihilationStun, 5, "test-strike")

	// 阶段 1：TotalTurn=1，未过期
	if !IsStarEffectActive(state, 9, StarEffectAnnihilationStun) {
		t.Errorf("at TotalTurn=1, expected annihilationStun active, got inactive")
	}

	// 阶段 2：推进到 TotalTurn=6（经过 5 回合，6-1=5 不 < 5 → 过期）
	state.TotalTurn = 6
	if IsStarEffectActive(state, 9, StarEffectAnnihilationStun) {
		t.Errorf("at TotalTurn=6, expected annihilationStun expired, got active")
	}

	// 阶段 3：PurgeExpiredStarEffects 清理后，StarEffects 不含该项
	PurgeExpiredStarEffects(state)
	for _, e := range state.StarEffects {
		if e.SystemID == 9 && e.Type == StarEffectAnnihilationStun {
			t.Errorf("after purge, found expired annihilationStun at system 9: %+v", e)
		}
	}
}
