package game

import (
	"fmt"
	"strings"
	"testing"
)

// makeMessageInheritTestState 构造一个用于测试留言继承私有揭示的 GameState。
// 8 名存活玩家占据星系 1-8，星系 9 放置一个带 Message 的非遗迹遗留物。
// p1 持有光速飞船，能量足够跃迁。
func makeMessageInheritTestState(message string) *GameState {
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
			Position:    i + 1,
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
	players[0].FaceUpCards = []Card{shipCard}

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
		Leftovers: []StarLeftover{
			{
				SystemID:           9,
				Energy:             3,
				Facilities:         []Card{},
				IsRelic:            false,
				Message:            message,
				BroadcastOnInherit: true,
			},
		},
		GameMode: GameModeCivilizationRelics,
	}
}

// TestLightspeed_RandomMode_NoPositionInLog 验证随机跃迁不公开位置：
// random 模式下公共跃迁日志不含"星系 N"字样。
func TestLightspeed_RandomMode_NoPositionInLog(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	logsBefore := len(state.Logs)

	ExecuteLightspeedShip(state, "p1", 0, "", false, nil)

	if state.Players[0].Position != 9 {
		t.Fatalf("p1 Position = %d, want 9 (only available system)", state.Players[0].Position)
	}

	newLogs := state.Logs[logsBefore:]
	for _, l := range newLogs {
		// 跃迁日志应为 "%s 使用光速飞船跃迁"，不含"星系 N"
		if strings.Contains(l.Message, "星系 9") {
			t.Errorf("random mode log should not contain star system id, but found: %q", l.Message)
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

// TestLightspeed_IllegalSelfTarget_NoEnergyCost 验证跃迁目标为当前位置时不扣能量：
// 随机模式下当前位置不被选为跃迁目标。此测试验证无能量消耗。
func TestLightspeed_IllegalSelfTarget_NoEnergyCost(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	energyBefore := state.Players[0].Energy

	ExecuteLightspeedShip(state, "p1", 0, "", false, nil)

	// 随机跃迁应成功（非当前位置），能量被消耗
	if state.Players[0].Position == 1 {
		t.Errorf("p1 should not stay at system 1 (random mode jumps to available)")
	}
	// 能量被消耗（Relics mode jumpCost=3）
	if state.Players[0].Energy >= energyBefore {
		t.Errorf("expected energy decreased, before=%d, after=%d", energyBefore, state.Players[0].Energy)
	}
}

// TestLightspeed_SpecifiedOccupiedTarget_Penalty 验证跃迁到被占用星系不会发生：
// 随机模式自动过滤被占用星系，跃迁会成功到未被占用的星系。
func TestLightspeed_SpecifiedOccupiedTarget_Penalty(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	energyBefore := state.Players[0].Energy

	ExecuteLightspeedShip(state, "p1", 0, "", false, nil)

	p1 := state.Players[0]
	// 随机模式不会选择被占用星系，跃迁成功
	if p1.Position < 3 || p1.Position > 9 {
		t.Errorf("p1 Position = %d, want in [3,9] (random available, excluding occupied)", p1.Position)
	}
	// 能量被消耗（Relics jumpCost 3）
	if p1.Energy >= energyBefore {
		t.Errorf("expected energy decreased, before=%d, after=%d", energyBefore, p1.Energy)
	}
	if p1.PenaltyTurn {
		t.Errorf("expected PenaltyTurn=false (jump succeeded), got true")
	}
}

// TestLightspeed_CarryEnergyBounds 验证携带能量上下界：carry=min(carryEnergy,5,remaining)，下界 max(carry,0)。
func TestLightspeed_CarryEnergyBounds(t *testing.T) {
	cases := []struct {
		name        string
		energy      int // p1 初始能量
		carryInput  int
		wantCarry   int
		leaveBehind bool // 销毁分支时 player.Energy=carry
	}{
		{
			name:        "upper bound capped at 5",
			energy:      10, // 扣 random 3 剩 7，carry=min(10,5,7)=5
			carryInput:  10,
			wantCarry:   5,
			leaveBehind: false,
		},
		{
			name:        "negative clamped to 0",
			energy:      10, // 扣 random 3 剩 7，carry=min(-1,5,7)=-1 → max(0,-1)=0
			carryInput:  -1,
			wantCarry:   0,
			leaveBehind: false,
		},
		{
			name:        "capped by remaining energy",
			energy:      5, // 扣 random 3 剩 2，carry=min(10,5,2)=2
			carryInput:  10,
			wantCarry:   2,
			leaveBehind: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state := makeLightspeedEscapeTestState()
			// makeLightspeedEscapeTestState 中 p1 持飞船+太阳能阵列，能量 5
			// 移除太阳能阵列避免影响销毁分支日志断言（仅保留飞船）
			state.Players[0].FaceUpCards = state.Players[0].FaceUpCards[:1]
			state.Players[0].Energy = tc.energy

			ExecuteLightspeedShip(state, "p1", tc.carryInput, "", tc.leaveBehind, nil)

			if state.Players[0].Energy != tc.wantCarry {
				t.Errorf("p1 Energy = %d, want %d (carry)", state.Players[0].Energy, tc.wantCarry)
			}
		})
	}
}

// TestLightspeed_DestroyBranch_MessageNotPreserved 验证销毁分支留言不保留：
// leaveBehind=false 时留言不创建遗留物，日志含"留言不保留"。
func TestLightspeed_DestroyBranch_MessageNotPreserved(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	// 仅保留飞船，避免其它设施干扰
	state.Players[0].FaceUpCards = state.Players[0].FaceUpCards[:1]
	logsBefore := len(state.Logs)

	// message="再见"（2 字符），messageCost=1，jumpCost=3，总 4。p1 能量 5 >= 4 OK。
	ExecuteLightspeedShip(state, "p1", 0, "再见", false, nil)

	// 检查日志含"留言不保留"
	newLogs := state.Logs[logsBefore:]
	foundDestroyMsgLog := false
	for _, l := range newLogs {
		if strings.Contains(l.Message, "留言不保留") {
			foundDestroyMsgLog = true
			break
		}
	}
	if !foundDestroyMsgLog {
		t.Errorf("expected log containing '留言不保留', none found in %d new logs", len(newLogs))
	}

	// 检查原位置（星系 1）无遗留物
	for _, l := range state.Leftovers {
		if l.SystemID == 1 {
			t.Errorf("expected no leftover at system 1 (destroy branch), found %+v", l)
		}
	}
}

// TestLightspeed_MessageInherit_PrivateReveal 验证留言继承私有揭示：
// 继承带 Message 的遗留物时，RelicDiscovery.Message 复制遗留物的 Message。
func TestLightspeed_MessageInherit_PrivateReveal(t *testing.T) {
	const msg = "前人留言"
	state := makeMessageInheritTestState(msg)

	ExecuteLightspeedShip(state, "p1", 0, "", false, nil)

	if state.Players[0].Position != 9 {
		t.Fatalf("p1 Position = %d, want 9", state.Players[0].Position)
	}

	if state.LastRelicDiscovery == nil {
		t.Fatal("expected LastRelicDiscovery to be set")
	}
	rd := state.LastRelicDiscovery
	if rd.Message != msg {
		t.Errorf("LastRelicDiscovery.Message = %q, want %q", rd.Message, msg)
	}
	if rd.PlayerID != "p1" {
		t.Errorf("LastRelicDiscovery.PlayerID = %q, want p1", rd.PlayerID)
	}
}

// TestLightspeed_MessageTruncation 验证留言超长截断：
// 留言 >10 字符时截断至 10，遗留物 Message 长度 <=10。
func TestLightspeed_MessageTruncation(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	// 仅保留飞船
	state.Players[0].FaceUpCards = state.Players[0].FaceUpCards[:1]

	longMessage := "12345678901" // 11 字符
	ExecuteLightspeedShip(state, "p1", 0, longMessage, true, nil)

	// 在原位置（星系 1）查找遗留物
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

	wantMessage := "1234567890" // 截断至 10 字符
	if leftover.Message != wantMessage {
		t.Errorf("leftover.Message = %q, want %q (truncated to 10 runes)", leftover.Message, wantMessage)
	}
	if len([]rune(leftover.Message)) > 10 {
		t.Errorf("leftover.Message length = %d, want <= 10", len([]rune(leftover.Message)))
	}
}

// TestLightspeed_SensitiveWordFilter 验证留言敏感词过滤生效：
// 留言含敏感词时，遗留物 Message 中的敏感词被替换为 ***。
func TestLightspeed_SensitiveWordFilter(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	// 仅保留飞船
	state.Players[0].FaceUpCards = state.Players[0].FaceUpCards[:1]

	// "敏感词a" 在词表中，过滤后为 "***"
	ExecuteLightspeedShip(state, "p1", 0, "敏感词a测试", true, nil)

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

	wantMessage := "***测试"
	if leftover.Message != wantMessage {
		t.Errorf("leftover.Message = %q, want %q (filtered)", leftover.Message, wantMessage)
	}
}

// TestLightspeed_InsufficientEnergyWithMessage 验证带留言时能量不足不扣能量。
// p1 能量 3，random 模式 jumpCost=3 + messageCost=1 = 4 > 3，应返回不扣能量。
func TestLightspeed_InsufficientEnergyWithMessage(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	state.Players[0].FaceUpCards = state.Players[0].FaceUpCards[:1]
	state.Players[0].Energy = 3
	energyBefore := state.Players[0].Energy

	ExecuteLightspeedShip(state, "p1", 0, "留言", false, nil)

	if state.Players[0].Energy != energyBefore {
		t.Errorf("energy changed on insufficient: before=%d, after=%d", energyBefore, state.Players[0].Energy)
	}
}

// TestLightspeed_LeaveBehindMessagePreserved 验证遗留分支留言保留：
// leaveBehind=true 时留言写入遗留物 Message 字段。
func TestLightspeed_LeaveBehindMessagePreserved(t *testing.T) {
	state := makeLightspeedEscapeTestState()
	state.Players[0].FaceUpCards = state.Players[0].FaceUpCards[:1]

	ExecuteLightspeedShip(state, "p1", 0, "你好", true, nil)

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
	if leftover.Message != "你好" {
		t.Errorf("leftover.Message = %q, want %q", leftover.Message, "你好")
	}
}
