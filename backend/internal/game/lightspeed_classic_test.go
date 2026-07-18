package game

import (
	"fmt"
	"strings"
	"testing"
)

// makeLightspeedClassicTestState 构造一个用于测试 Classic 模式光速飞船的 GameState。
// 8 名存活玩家占据星系 1-8，星系 9 为唯一可跃迁目标（无遗迹，避免继承干扰）。
// p1 手牌持有光速飞船（Classic 模式飞船在手牌，不在 FaceUpCards），能量 20
// （足够 specified 13 与 random 10），FaceUpCards 默认为空。
func makeLightspeedClassicTestState() *GameState {
	escapeAbility := "escape"
	shipCard := Card{
		UID:     "ship-1",
		DefID:   "facility_lightspeed_ship",
		Name:    "光速飞船",
		Type:    CardTypeFacility,
		Energy:  10,
		Ability: &escapeAbility,
	}

	players := make([]Player, 8)
	for i := 0; i < 8; i++ {
		id := fmt.Sprintf("p%d", i+1)
		players[i] = Player{
			ID:          id,
			Name:        id,
			Color:       playerColors[i%len(playerColors)],
			Position:    i + 1, // 占据星系 1-8
			Energy:      5,
			Hand:        []Card{},
			FaceUpCards: []Card{},
			Eliminated:  false,
			BroadcastHistory: []struct {
				SystemID int
				Turn     int
			}{},
		}
	}
	// p1 手牌持有光速飞船，能量 20（足够 specified 13 与 random 10）
	players[0].Hand = []Card{shipCard}
	players[0].Energy = 20

	return &GameState{
		Phase:              GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        8,
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
		Leftovers: []StarLeftover{}, // 无遗迹，避免继承干扰
		GameMode:  GameModeClassic,
	}
}

// TestLightspeedClassic_RandomMode_Cost10_NoPositionInLog 验证 Classic 随机跃迁：
// 扣 10 点能量（通过遗留物 Energy = 初始 - 10 验证），位置不公开（日志不含"星系 9"），飞船从手牌进弃牌堆。
// 使用 leaveBehind=true 以便通过遗留物 Energy 直接验证成本。
func TestLightspeedClassic_RandomMode_Cost10_NoPositionInLog(t *testing.T) {
	state := makeLightspeedClassicTestState()
	state.Players[0].Energy = 15 // random cost 10 后剩 5（遗留物 Energy=5）
	logsBefore := len(state.Logs)

	ExecuteLightspeedShip(state, "p1", "random", 0, 0, "", true, nil)

	if state.Players[0].Position != 9 {
		t.Fatalf("p1 Position = %d, want 9 (only available system)", state.Players[0].Position)
	}
	// 飞船进弃牌堆
	if len(state.DiscardPile) != 1 || state.DiscardPile[0].UID != "ship-1" {
		t.Errorf("expected ship in DiscardPile, got %+v", state.DiscardPile)
	}
	// 手牌不再含飞船
	if len(state.Players[0].Hand) != 0 {
		t.Errorf("expected empty Hand, got %+v", state.Players[0].Hand)
	}
	// 验证扣 10 点能量：原位置遗留物 Energy = 15 - 10 = 5
	var leftover *StarLeftover
	for i := range state.Leftovers {
		if state.Leftovers[i].SystemID == 1 {
			leftover = &state.Leftovers[i]
			break
		}
	}
	if leftover == nil {
		t.Fatal("expected leftover at system 1, found none")
	}
	if leftover.Energy != 5 {
		t.Errorf("leftover.Energy = %d, want 5 (cost 10, initial 15)", leftover.Energy)
	}
	// random 模式日志不含"星系 9"（位置保密）
	newLogs := state.Logs[logsBefore:]
	for _, l := range newLogs {
		if strings.Contains(l.Message, "星系 9") {
			t.Errorf("random mode log should not contain target star system id, found: %q", l.Message)
		}
	}
	// 至少应有一条跃迁日志
	foundJumpLog := false
	for _, l := range newLogs {
		if strings.Contains(l.Message, "使用光速飞船跃迁") {
			foundJumpLog = true
			break
		}
	}
	if !foundJumpLog {
		t.Errorf("expected a jump log, none found in %d new logs", len(newLogs))
	}
}

// TestLightspeedClassic_SpecifiedMode_Cost13_PositionInLog 验证 Classic 指定跃迁：
// 扣 13 点能量（通过遗留物 Energy = 初始 - 13 验证），位置公开（日志含"星系 9"），飞船从手牌进弃牌堆。
// 使用 leaveBehind=true 以便通过遗留物 Energy 直接验证成本。
func TestLightspeedClassic_SpecifiedMode_Cost13_PositionInLog(t *testing.T) {
	state := makeLightspeedClassicTestState()
	state.Players[0].Energy = 20 // specified cost 13 后剩 7（遗留物 Energy=7）
	logsBefore := len(state.Logs)

	ExecuteLightspeedShip(state, "p1", "specified", 9, 0, "", true, nil)

	if state.Players[0].Position != 9 {
		t.Fatalf("p1 Position = %d, want 9 (specified target)", state.Players[0].Position)
	}
	if len(state.DiscardPile) != 1 || state.DiscardPile[0].UID != "ship-1" {
		t.Errorf("expected ship in DiscardPile, got %+v", state.DiscardPile)
	}
	if len(state.Players[0].Hand) != 0 {
		t.Errorf("expected empty Hand, got %+v", state.Players[0].Hand)
	}
	// 验证扣 13 点能量：原位置遗留物 Energy = 20 - 13 = 7
	var leftover *StarLeftover
	for i := range state.Leftovers {
		if state.Leftovers[i].SystemID == 1 {
			leftover = &state.Leftovers[i]
			break
		}
	}
	if leftover == nil {
		t.Fatal("expected leftover at system 1, found none")
	}
	if leftover.Energy != 7 {
		t.Errorf("leftover.Energy = %d, want 7 (cost 13, initial 20)", leftover.Energy)
	}
	newLogs := state.Logs[logsBefore:]
	foundPositionLog := false
	for _, l := range newLogs {
		if strings.Contains(l.Message, "星系 9") {
			foundPositionLog = true
			break
		}
	}
	if !foundPositionLog {
		t.Errorf("specified mode log should contain star system id, none found in %d new logs", len(newLogs))
	}
}

// TestLightspeedClassic_InsufficientEnergy_NoAction 验证 Classic 能量不足：
// 不扣能量、不跃迁、飞船保留在手牌、弃牌堆为空。
func TestLightspeedClassic_InsufficientEnergy_NoAction(t *testing.T) {
	state := makeLightspeedClassicTestState()
	state.Players[0].Energy = 9 // 不足 random 的 10
	energyBefore := state.Players[0].Energy
	posBefore := state.Players[0].Position

	ExecuteLightspeedShip(state, "p1", "random", 0, 0, "", false, nil)

	if state.Players[0].Energy != energyBefore {
		t.Errorf("energy changed on insufficient: before=%d, after=%d", energyBefore, state.Players[0].Energy)
	}
	if state.Players[0].Position != posBefore {
		t.Errorf("position changed on insufficient: got %d, want %d", state.Players[0].Position, posBefore)
	}
	if len(state.Players[0].Hand) != 1 || state.Players[0].Hand[0].UID != "ship-1" {
		t.Errorf("expected ship to remain in Hand, got %+v", state.Players[0].Hand)
	}
	if len(state.DiscardPile) != 0 {
		t.Errorf("expected empty DiscardPile, got %+v", state.DiscardPile)
	}
}

// TestLightspeedClassic_NoCarryEnergy 验证 Classic 不可携带能量：
// 跃迁后玩家能量归零（carry cap=0），原剩余能量按销毁分支流失。
func TestLightspeedClassic_NoCarryEnergy(t *testing.T) {
	state := makeLightspeedClassicTestState()
	// p1 能量 20，random cost 10，剩 10 → 销毁后归零
	ExecuteLightspeedShip(state, "p1", "random", 0, 0, "", false, nil)

	if state.Players[0].Energy != 0 {
		t.Errorf("p1 Energy = %d, want 0 (carry cap=0, destroy branch)", state.Players[0].Energy)
	}
	if state.Players[0].Position != 9 {
		t.Errorf("p1 Position = %d, want 9", state.Players[0].Position)
	}
}

// TestLightspeedClassic_MessageIgnored 验证 Classic 留言被忽略：
// 传入非空 message，不附加留言、不额外扣能量。
// p1 能量刚好 10（够 random 10），若 message 被错误计费（cost=11），能量不足会返回，飞船保留手牌。
func TestLightspeedClassic_MessageIgnored(t *testing.T) {
	state := makeLightspeedClassicTestState()
	state.Players[0].Energy = 10 // 刚好够 random 10，若 message 被计费则不足

	ExecuteLightspeedShip(state, "p1", "random", 0, 0, "你好", false, nil)

	if state.Players[0].Energy != 0 {
		t.Errorf("p1 Energy = %d, want 0 (message should not add cost)", state.Players[0].Energy)
	}
	if len(state.Players[0].Hand) != 0 {
		t.Errorf("expected ship removed from Hand, got %+v", state.Players[0].Hand)
	}
	if len(state.DiscardPile) != 1 {
		t.Errorf("expected ship in DiscardPile, got %+v", state.DiscardPile)
	}
}

// TestLightspeedClassic_LeaveBehind_CreatesLeftoverNoMessage 验证 Classic 选择遗留：
// 创建遗留物（无留言），飞船进弃牌堆，玩家能量归零，FaceUpCards 清空。
func TestLightspeedClassic_LeaveBehind_CreatesLeftoverNoMessage(t *testing.T) {
	state := makeLightspeedClassicTestState()
	otherFacility := cardByID("facility_solar_array")
	state.Players[0].FaceUpCards = []Card{otherFacility}
	state.Players[0].Energy = 15 // random 10 后剩 5

	// 传入非空 message 验证 Classic 不附加留言
	ExecuteLightspeedShip(state, "p1", "random", 0, 0, "测试留言", true, nil)

	// 飞船进弃牌堆
	if len(state.DiscardPile) != 1 || state.DiscardPile[0].UID != "ship-1" {
		t.Errorf("expected ship in DiscardPile, got %+v", state.DiscardPile)
	}
	// 玩家能量归零（carry=0）
	if state.Players[0].Energy != 0 {
		t.Errorf("p1 Energy = %d, want 0", state.Players[0].Energy)
	}
	// FaceUpCards 清空
	if len(state.Players[0].FaceUpCards) != 0 {
		t.Errorf("expected empty FaceUpCards, got %+v", state.Players[0].FaceUpCards)
	}
	// 原位置（星系 1）有遗留物
	var leftover *StarLeftover
	for i := range state.Leftovers {
		if state.Leftovers[i].SystemID == 1 {
			leftover = &state.Leftovers[i]
			break
		}
	}
	if leftover == nil {
		t.Fatal("expected leftover at system 1, found none")
	}
	if leftover.Energy != 5 {
		t.Errorf("leftover.Energy = %d, want 5", leftover.Energy)
	}
	if len(leftover.Facilities) != 1 {
		t.Errorf("leftover.Facilities count = %d, want 1", len(leftover.Facilities))
	}
	if leftover.Message != "" {
		t.Errorf("leftover.Message = %q, want empty (Classic mode has no message)", leftover.Message)
	}
}

// TestLightspeedClassic_Destroy_FacilitiesToDiscard 验证 Classic 选择销毁：
// 其他设施进弃牌堆、能量流失，飞船进弃牌堆。
func TestLightspeedClassic_Destroy_FacilitiesToDiscard(t *testing.T) {
	state := makeLightspeedClassicTestState()
	otherFacility := cardByID("facility_solar_array")
	state.Players[0].FaceUpCards = []Card{otherFacility}
	state.Players[0].Energy = 15 // random 10 后剩 5（销毁流失）

	ExecuteLightspeedShip(state, "p1", "random", 0, 0, "", false, nil)

	// 弃牌堆含飞船 + 太阳能阵列
	if len(state.DiscardPile) != 2 {
		t.Errorf("expected 2 cards in DiscardPile (ship + facility), got %d", len(state.DiscardPile))
	}
	foundShip := false
	foundFacility := false
	for _, c := range state.DiscardPile {
		if c.UID == "ship-1" {
			foundShip = true
		}
		if c.DefID == "facility_solar_array" {
			foundFacility = true
		}
	}
	if !foundShip {
		t.Errorf("expected ship-1 in DiscardPile, got %+v", state.DiscardPile)
	}
	if !foundFacility {
		t.Errorf("expected facility_solar_array in DiscardPile, got %+v", state.DiscardPile)
	}
	// 玩家能量归零
	if state.Players[0].Energy != 0 {
		t.Errorf("p1 Energy = %d, want 0", state.Players[0].Energy)
	}
	// FaceUpCards 清空
	if len(state.Players[0].FaceUpCards) != 0 {
		t.Errorf("expected empty FaceUpCards, got %+v", state.Players[0].FaceUpCards)
	}
	// 原位置无遗留物
	for _, l := range state.Leftovers {
		if l.SystemID == 1 {
			t.Errorf("expected no leftover at system 1 (destroy branch), found %+v", l)
		}
	}
}

// TestLightspeedClassic_InheritTargetLeftover 验证 Classic 继承目标星球遗留物：
// 目标星球有遗留物时，继承能量与设施，构造私有揭示，遗留物被消费。
func TestLightspeedClassic_InheritTargetLeftover(t *testing.T) {
	state := makeLightspeedClassicTestState()
	otherFacility := cardByID("facility_solar_array")
	// 在星系 9 放置一个遗留物（3 点能量 + 1 个设施）
	state.Leftovers = []StarLeftover{
		{
			SystemID:   9,
			Energy:     3,
			Facilities: []Card{otherFacility},
			IsRelic:    false,
		},
	}
	state.Players[0].Energy = 15 // specified 13 后剩 2（销毁流失）

	ExecuteLightspeedShip(state, "p1", "specified", 9, 0, "", false, nil)

	if state.Players[0].Position != 9 {
		t.Fatalf("p1 Position = %d, want 9", state.Players[0].Position)
	}
	// 飞船进弃牌堆
	if len(state.DiscardPile) != 1 || state.DiscardPile[0].UID != "ship-1" {
		t.Errorf("expected ship in DiscardPile, got %+v", state.DiscardPile)
	}
	// 继承后玩家能量 = 0 (carry) + 3 (inherited) = 3
	if state.Players[0].Energy != 3 {
		t.Errorf("p1 Energy = %d, want 3 (inherited 3)", state.Players[0].Energy)
	}
	// 继承后 FaceUpCards 含继承的设施
	if len(state.Players[0].FaceUpCards) != 1 {
		t.Errorf("expected 1 inherited facility, got %d", len(state.Players[0].FaceUpCards))
	}
	// 遗留物已被消费
	for _, l := range state.Leftovers {
		if l.SystemID == 9 {
			t.Errorf("expected leftover at system 9 to be consumed, found %+v", l)
		}
	}
	// 私有揭示已设置
	if state.LastRelicDiscovery == nil {
		t.Fatal("expected LastRelicDiscovery to be set")
	}
	if state.LastRelicDiscovery.Energy != 3 {
		t.Errorf("LastRelicDiscovery.Energy = %d, want 3", state.LastRelicDiscovery.Energy)
	}
	if state.LastRelicDiscovery.PlayerID != "p1" {
		t.Errorf("LastRelicDiscovery.PlayerID = %q, want p1", state.LastRelicDiscovery.PlayerID)
	}
}
