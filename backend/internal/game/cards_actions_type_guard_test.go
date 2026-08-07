package game

import (
	"testing"
)

// makeTypeGuardTestState 构造类型守卫测试用 GameState。
// 单个玩家 p1 位于星系 1，能量充足（20），空手牌、空 FaceUpCards。
// 各测试自行向 p1.Hand / p1.FaceUpCards 添加所需卡牌。
func makeTypeGuardTestState() *GameState {
	players := []Player{
		{
			ID:          "p1",
			Name:        "p1",
			Color:       playerColors[0],
			Position:    1,
			Energy:      20,
			Hand:        []Card{},
			FaceUpCards: []Card{},
			Eliminated:  false,
			BroadcastHistory: []struct {
				SystemID int
				Turn     int
			}{},
		},
	}
	return &GameState{
		Phase:              GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        1,
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
		GameMode:  GameModeClassic,
	}
}

// makeFacilityCard 构造通用设施卡。
func makeFacilityCard(uid, defID, name string, energy int) Card {
	return Card{
		UID:    uid,
		DefID:  defID,
		Name:   name,
		Type:   CardTypeFacility,
		Energy: energy,
	}
}

// --- PlayCard 类型守卫 ---

func TestPlayCard_TypeGuard_RejectsStrike(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	strike := makeStrikeCard("strike_1", "strike_thermal", "热核打击", 4, 1, 1)
	player.Hand = []Card{strike}
	energyBefore := player.Energy

	got := PlayCard(state, player, "strike_1")
	if got {
		t.Fatalf("PlayCard(strike) = true, want false")
	}
	if player.Energy != energyBefore {
		t.Errorf("能量被扣除：before=%d after=%d", energyBefore, player.Energy)
	}
	if len(player.Hand) != 1 {
		t.Errorf("手牌被消耗：len=%d, want 1", len(player.Hand))
	}
}

func TestPlayCard_TypeGuard_RejectsBroadcast(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	bc := makeBroadcastCard("bc_1", BroadcastSubtypeCooperation, 1, 0)
	player.Hand = []Card{bc}

	got := PlayCard(state, player, "bc_1")
	if got {
		t.Fatalf("PlayCard(broadcast) = true, want false")
	}
	if len(player.Hand) != 1 {
		t.Errorf("手牌被消耗：len=%d, want 1", len(player.Hand))
	}
}

func TestPlayCard_TypeGuard_AcceptsFacility(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	fac := makeFacilityCard("fac_1", "facility_solar_array", "太阳能阵列", 2)
	player.Hand = []Card{fac}

	got := PlayCard(state, player, "fac_1")
	if !got {
		t.Fatalf("PlayCard(facility) = false, want true")
	}
	if len(player.Hand) != 0 {
		t.Errorf("手牌未消耗：len=%d, want 0", len(player.Hand))
	}
	if player.Energy != 20-2 {
		t.Errorf("能量未正确扣除：got=%d, want %d", player.Energy, 20-2)
	}
}

// --- DeployCard 类型守卫 ---

func TestDeployCard_TypeGuard_RejectsStrike(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	strike := makeStrikeCard("strike_1", "strike_thermal", "热核打击", 4, 1, 1)
	player.Hand = []Card{strike}
	energyBefore := player.Energy

	got := DeployCard(state, "p1", "strike_1")
	if got {
		t.Fatalf("DeployCard(strike) = true, want false")
	}
	if player.Energy != energyBefore {
		t.Errorf("能量被扣除：before=%d after=%d", energyBefore, player.Energy)
	}
	if len(player.Hand) != 1 {
		t.Errorf("手牌被消耗：len=%d, want 1", len(player.Hand))
	}
	if len(player.FaceUpCards) != 0 {
		t.Errorf("FaceUpCards 被修改：len=%d, want 0", len(player.FaceUpCards))
	}
}

func TestDeployCard_TypeGuard_RejectsBroadcast(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	bc := makeBroadcastCard("bc_1", BroadcastSubtypeCooperation, 1, 0)
	player.Hand = []Card{bc}

	got := DeployCard(state, "p1", "bc_1")
	if got {
		t.Fatalf("DeployCard(broadcast) = true, want false")
	}
	if len(player.Hand) != 1 {
		t.Errorf("手牌被消耗：len=%d, want 1", len(player.Hand))
	}
}

func TestDeployCard_TypeGuard_AcceptsFacility(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	fac := makeFacilityCard("fac_1", "facility_solar_array", "太阳能阵列", 2)
	player.Hand = []Card{fac}

	got := DeployCard(state, "p1", "fac_1")
	if !got {
		t.Fatalf("DeployCard(facility) = false, want true")
	}
	if len(player.Hand) != 0 {
		t.Errorf("手牌未消耗：len=%d, want 0", len(player.Hand))
	}
	if len(player.FaceUpCards) != 1 {
		t.Errorf("FaceUpCards 未添加：len=%d, want 1", len(player.FaceUpCards))
	}
}

// --- RecycleCard 类型守卫 ---

func TestRecycleCard_TypeGuard_RejectsStrike(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	strike := makeStrikeCard("strike_1", "strike_thermal", "热核打击", 4, 1, 1)
	// 预先放入 FaceUpCards（虽然类型不符，但用于测试守卫拦截）
	player.FaceUpCards = []Card{strike}
	energyBefore := player.Energy

	got := RecycleCard(state, "p1", "strike_1")
	if got {
		t.Fatalf("RecycleCard(strike) = true, want false")
	}
	if player.Energy != energyBefore {
		t.Errorf("能量被修改：before=%d after=%d", energyBefore, player.Energy)
	}
	if len(player.FaceUpCards) != 1 {
		t.Errorf("FaceUpCards 被消耗：len=%d, want 1", len(player.FaceUpCards))
	}
}

func TestRecycleCard_TypeGuard_RejectsBroadcast(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	bc := makeBroadcastCard("bc_1", BroadcastSubtypeCooperation, 1, 0)
	player.FaceUpCards = []Card{bc}

	got := RecycleCard(state, "p1", "bc_1")
	if got {
		t.Fatalf("RecycleCard(broadcast) = true, want false")
	}
	if len(player.FaceUpCards) != 1 {
		t.Errorf("FaceUpCards 被消耗：len=%d, want 1", len(player.FaceUpCards))
	}
}

func TestRecycleCard_TypeGuard_AcceptsFacility(t *testing.T) {
	state := makeTypeGuardTestState()
	player := &state.Players[0]
	fac := makeFacilityCard("fac_1", "facility_solar_array", "太阳能阵列", 2)
	player.FaceUpCards = []Card{fac}
	energyBefore := player.Energy

	got := RecycleCard(state, "p1", "fac_1")
	if !got {
		t.Fatalf("RecycleCard(facility) = false, want true")
	}
	if len(player.FaceUpCards) != 0 {
		t.Errorf("FaceUpCards 未消耗：len=%d, want 0", len(player.FaceUpCards))
	}
	// refund = energy / 2 = 1
	if player.Energy != energyBefore+1 {
		t.Errorf("能量未正确返还：got=%d, want %d", player.Energy, energyBefore+1)
	}
}
