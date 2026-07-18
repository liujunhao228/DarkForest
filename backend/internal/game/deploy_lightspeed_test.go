package game

import (
	"fmt"
	"strings"
	"testing"
)

// makeDeployLightspeedTestState 构造用于测试 DeployCard 在不同模式下处理光速飞船的 GameState。
// p1 持有光速飞船（10 能量）并具有足够能量（20），避免能量检查分支提前返回。
// mode 指定游戏模式，用于驱动 GetModeRules 的 LightspeedOneTime 判定。
func makeDeployLightspeedTestState(mode GameMode) *GameState {
	escapeAbility := "escape"
	shipCard := Card{
		UID:     "ship-deploy-1",
		DefID:   "facility_lightspeed_ship",
		Name:    "光速飞船",
		Type:    CardTypeFacility,
		Energy:  10,
		Ability: &escapeAbility,
	}

	players := make([]Player, 2)
	for i := 0; i < 2; i++ {
		id := fmt.Sprintf("p%d", i+1)
		players[i] = Player{
			ID:          id,
			Name:        id,
			Color:       playerColors[i%len(playerColors)],
			Position:    i + 1,
			Energy:      20,
			Hand:        []Card{},
			FaceUpCards: []Card{},
			Eliminated:  false,
			BroadcastHistory: []struct {
				SystemID int
				Turn     int
			}{},
		}
	}
	// p1 手牌含光速飞船
	players[0].Hand = []Card{shipCard}

	return &GameState{
		Phase:              GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        2,
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
		GameMode:  mode,
	}
}

// TestDeployCard_ClassicMode_RejectLightspeed 验证 Classic 模式下 DeployCard 拒绝光速飞船：
// 返回 false、飞船保留在手牌、能量不扣减、未加入 FaceUpCards。
func TestDeployCard_ClassicMode_RejectLightspeed(t *testing.T) {
	state := makeDeployLightspeedTestState(GameModeClassic)
	p1 := &state.Players[0]
	energyBefore := p1.Energy
	handBefore := len(p1.Hand)
	faceUpBefore := len(p1.FaceUpCards)

	ok := DeployCard(state, p1.ID, "ship-deploy-1")

	if ok {
		t.Fatalf("DeployCard returned true in Classic mode for lightspeed ship, want false")
	}

	if len(p1.Hand) != handBefore {
		t.Errorf("p1 Hand length = %d, want %d (ship should remain in hand)", len(p1.Hand), handBefore)
	}
	if p1.Hand[0].DefID != "facility_lightspeed_ship" {
		t.Errorf("p1 Hand[0].DefID = %q, want facility_lightspeed_ship", p1.Hand[0].DefID)
	}
	if p1.Energy != energyBefore {
		t.Errorf("p1 Energy = %d, want %d (energy should not be deducted)", p1.Energy, energyBefore)
	}
	if len(p1.FaceUpCards) != faceUpBefore {
		t.Errorf("p1 FaceUpCards length = %d, want %d (ship should not be deployed)", len(p1.FaceUpCards), faceUpBefore)
	}

	// 验证日志含拒绝说明
	foundRejectLog := false
	for _, l := range state.Logs {
		if strings.Contains(l.Message, "光速飞船不可单独部署") {
			foundRejectLog = true
			break
		}
	}
	if !foundRejectLog {
		t.Errorf("expected log containing '光速飞船不可单独部署', none found in %d logs", len(state.Logs))
	}
}

// TestDeployCard_RelicMode_AllowLightspeed 验证 Relics 模式下 DeployCard 允许光速飞船部署：
// 返回 true、飞船从手牌移除、能量扣减、FaceUpCards 含飞船。回归保护，确保不破坏现有行为。
func TestDeployCard_RelicMode_AllowLightspeed(t *testing.T) {
	state := makeDeployLightspeedTestState(GameModeCivilizationRelics)
	p1 := &state.Players[0]
	energyBefore := p1.Energy
	faceUpBefore := len(p1.FaceUpCards)

	ok := DeployCard(state, p1.ID, "ship-deploy-1")

	if !ok {
		t.Fatalf("DeployCard returned false in Relics mode for lightspeed ship, want true")
	}

	if len(p1.Hand) != 0 {
		t.Errorf("p1 Hand length = %d, want 0 (ship should be removed from hand)", len(p1.Hand))
	}
	if p1.Energy != energyBefore-10 {
		t.Errorf("p1 Energy = %d, want %d (10 energy should be deducted)", p1.Energy, energyBefore-10)
	}
	if len(p1.FaceUpCards) != faceUpBefore+1 {
		t.Fatalf("p1 FaceUpCards length = %d, want %d", len(p1.FaceUpCards), faceUpBefore+1)
	}
	deployed := p1.FaceUpCards[len(p1.FaceUpCards)-1]
	if deployed.DefID != "facility_lightspeed_ship" {
		t.Errorf("deployed card DefID = %q, want facility_lightspeed_ship", deployed.DefID)
	}
}
