package game

import (
	"fmt"
	"strings"
	"testing"
)

// boolPtr 返回指向 b 的指针，用于 *bool 参数（如 ExecuteLightspeedShip 的 broadcastOnInherit）。
func boolPtr(b bool) *bool {
	return &b
}

// TestRelicCombos_ByStrength 验证 CombosByStrength 与 PickComboByStrength 的契约：
//   - 弱/中/强三档返回非空且所有组合的 Strength 与档位匹配
//   - "空"档返回空切片
//   - PickComboByStrength 对非空档返回 Strength 匹配的组合；对"空"档返回零值（ID=="")
func TestRelicCombos_ByStrength(t *testing.T) {
	tiers := []struct {
		name      string
		strength  int
		expectNonEmpty bool
	}{
		{"empty", RelicStrengthEmpty, false},
		{"weak", RelicStrengthWeak, true},
		{"medium", RelicStrengthMedium, true},
		{"strong", RelicStrengthStrong, true},
	}

	for _, tier := range tiers {
		t.Run(tier.name, func(t *testing.T) {
			combos := CombosByStrength(tier.strength)
			if tier.expectNonEmpty {
				if len(combos) == 0 {
					t.Errorf("CombosByStrength(%s) returned empty, expected non-empty", tier.name)
				}
			} else {
				if len(combos) > 0 {
					t.Errorf("CombosByStrength(%s) returned %d combos, expected empty", tier.name, len(combos))
				}
			}
			// 每个返回的组合 Strength 必须与请求档位匹配
			for _, c := range combos {
				if c.Strength != tier.strength {
					t.Errorf("combo %q has Strength %d, want %d", c.ID, c.Strength, tier.strength)
				}
			}
		})
	}

	// PickComboByStrength 对非空档返回 Strength 匹配的组合
	for _, strength := range []int{RelicStrengthWeak, RelicStrengthMedium, RelicStrengthStrong} {
		combo := PickComboByStrength(strength)
		if combo.ID == "" {
			t.Errorf("PickComboByStrength(%d) returned zero-value combo, expected non-empty", strength)
		}
		if combo.Strength != strength {
			t.Errorf("PickComboByStrength(%d) returned combo with Strength %d, want %d", strength, combo.Strength, strength)
		}
	}

	// PickComboByStrength(RelicStrengthEmpty) 返回零值
	emptyCombo := PickComboByStrength(RelicStrengthEmpty)
	if emptyCombo.ID != "" {
		t.Errorf("PickComboByStrength(RelicStrengthEmpty) returned non-zero combo: %+v", emptyCombo)
	}
}

// TestNewGame_CivilizationRelics_Distribution 验证「文明遗迹」模式下的初始化分布契约：
//   - 遗迹只出现在非起始星系
//   - 每个遗迹字段合法（IsRelic/Name/Lore/Energy/Facilities）
//   - 多轮迭代后强度档分布大致符合 {空50%/弱30%/中15%/强5%}（±0.15 容差）
//   - BroadcastOnInherit 在多轮中同时出现 true 与 false
//   - 至少出现一个非空遗迹
func TestNewGame_CivilizationRelics_Distribution(t *testing.T) {
	const iterations = 200
	const playerCount = 4
	const totalSystems = 9
	const nonStartingSlotsPerGame = totalSystems - playerCount // 5

	seeds := make([]PlayerSeed, playerCount)
	for i := 0; i < playerCount; i++ {
		seeds[i] = PlayerSeed{ID: playerName(i), Name: playerName(i)}
	}

	totalSlots := 0
	strengthCounts := map[int]int{
		RelicStrengthWeak:   0,
		RelicStrengthMedium: 0,
		RelicStrengthStrong: 0,
	}
	broadcastTrue := 0
	broadcastFalse := 0
	nonEmptyRelics := 0

	for i := 0; i < iterations; i++ {
		state := NewGame(InitConfig{
			PlayerCount: playerCount,
			PlayerSeeds: seeds,
			GameMode:    GameModeCivilizationRelics,
		})

		startingPositions := make(map[int]bool, playerCount)
		for _, p := range state.Players {
			startingPositions[p.Position] = true
		}

		totalSlots += nonStartingSlotsPerGame

		for _, l := range state.Leftovers {
			// 遗迹不得位于起始星系
			if startingPositions[l.SystemID] {
				t.Errorf("relic placed on starting position %d", l.SystemID)
			}
			// 字段合法性
			if !l.IsRelic {
				t.Errorf("leftover at system %d is not a relic (IsRelic=false)", l.SystemID)
			}
			if l.Name == "" {
				t.Errorf("leftover at system %d has empty Name", l.SystemID)
			}
			if l.Lore == "" {
				t.Errorf("leftover at system %d has empty Lore", l.SystemID)
			}
			if l.Energy <= 0 {
				t.Errorf("leftover at system %d has non-positive Energy %d", l.SystemID, l.Energy)
			}
			if len(l.Facilities) == 0 {
				t.Errorf("leftover at system %d has empty Facilities", l.SystemID)
			}

			// 按 Energy 区间分类强度档（弱 1-2 / 中 3-5 / 强 8-12，区间不重叠）
			switch {
			case l.Energy >= 1 && l.Energy <= 2:
				strengthCounts[RelicStrengthWeak]++
			case l.Energy >= 3 && l.Energy <= 5:
				strengthCounts[RelicStrengthMedium]++
			case l.Energy >= 8:
				strengthCounts[RelicStrengthStrong]++
			default:
				t.Errorf("leftover at system %d has unexpected Energy %d (cannot classify)", l.SystemID, l.Energy)
			}

			nonEmptyRelics++
			if l.BroadcastOnInherit {
				broadcastTrue++
			} else {
				broadcastFalse++
			}
		}
	}

	// 至少一个非空遗迹
	if nonEmptyRelics == 0 {
		t.Error("expected at least one non-empty relic over 200 runs, got 0")
	}

	// 分布大致匹配（±0.15 容差避免统计 flakiness）
	emptyCount := totalSlots - nonEmptyRelics
	tol := 0.15
	assertFraction := func(label string, got, want float64) {
		t.Helper()
		if got < want-tol || got > want+tol {
			t.Errorf("%s fraction = %.3f, want %.3f (±%.2f)", label, got, want, tol)
		}
	}
	assertFraction("empty", float64(emptyCount)/float64(totalSlots), 0.50)
	assertFraction("weak", float64(strengthCounts[RelicStrengthWeak])/float64(totalSlots), 0.30)
	assertFraction("medium", float64(strengthCounts[RelicStrengthMedium])/float64(totalSlots), 0.15)
	assertFraction("strong", float64(strengthCounts[RelicStrengthStrong])/float64(totalSlots), 0.05)

	// BroadcastOnInherit 在多轮中同时出现 true 与 false
	if broadcastTrue == 0 {
		t.Error("expected at least one BroadcastOnInherit=true over 200 runs, got 0")
	}
	if broadcastFalse == 0 {
		t.Error("expected at least one BroadcastOnInherit=false over 200 runs, got 0")
	}
}

// TestNewGame_Classic_NoRelics 回归测试：经典模式（GameMode 省略或显式 classic）
// 不执行遗迹分布，Leftovers 为空，GameMode 不是 civilization_relics。
func TestNewGame_Classic_NoRelics(t *testing.T) {
	cases := []struct {
		name string
		mode GameMode
	}{
		{"omitted", ""},
		{"explicit classic", GameModeClassic},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			seeds := make([]PlayerSeed, 4)
			for i := 0; i < 4; i++ {
				seeds[i] = PlayerSeed{ID: playerName(i), Name: playerName(i)}
			}
			state := NewGame(InitConfig{
				PlayerCount: 4,
				PlayerSeeds: seeds,
				GameMode:    tc.mode,
			})

			if len(state.Leftovers) != 0 {
				t.Errorf("expected empty Leftovers in classic mode, got %d leftovers", len(state.Leftovers))
			}
			if state.GameMode.IsCivilizationRelics() {
				t.Errorf("expected non-civilization-relics GameMode, got %s", state.GameMode)
			}
		})
	}
}

// makeInheritTestState 构造一个用于测试继承路径的 GameState。
// 8 名存活玩家占据星系 1-8，使得星系 9 成为唯一可跃迁目标。
// 在星系 9 放置一个预设遗迹（BroadcastOnInherit 由参数决定）。
// p1 拥有一张光速飞船牌、3 点能量（恰好够跃迁），无其它设施。
// leaveBehind=false 时不会产生额外日志，便于断言继承日志。
func makeInheritTestState(broadcastOnInherit bool) *GameState {
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
			ID:               id,
			Name:             id,
			Color:            playerColors[i%len(playerColors)],
			Position:         i + 1, // 占据星系 1-8
			Energy:           3,
			Hand:             []Card{},
			FaceUpCards:      []Card{},
			Eliminated:       false,
			BroadcastHistory: []struct{ SystemID int; Turn int }{},
		}
	}
	// p1 持有光速飞船
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
				Energy:             8,
				Facilities:         []Card{cardByID("facility_dyson_sphere")},
				IsRelic:            true,
				Name:               "戴森之墓",
				Lore:               "一颗戴森球笼罩着早已熄灭的恒星。",
				BroadcastOnInherit: broadcastOnInherit,
			},
		},
		GameMode: GameModeCivilizationRelics,
	}
}

// TestInherit_Relic_PrivateRevealAndBroadcast 验证继承遗迹时的私有揭示与公共广播契约。
// 通过 ExecuteLightspeedShip 真实代码路径（specified 模式）触发继承：8 名玩家占满星系 1-8，
// 星系 9 为指定跃迁目标且放置了遗迹，因此 p1 必然跃迁至星系 9 并触发继承。
//
// BroadcastOnInherit=true：玩家获得能量+设施；LastRelicDiscovery 设置（含 PlayerID/IsRelic/Name）；
// 公共日志新增含遗迹名称的条目（specified 模式 + 广播继承）。
//
// BroadcastOnInherit=false：玩家仍获得能量+设施；LastRelicDiscovery 仍设置（私有揭示）；
// 但公共日志不新增继承相关条目（specified 模式仍写跃迁日志，但不含遗迹名）。
func TestInherit_Relic_PrivateRevealAndBroadcast(t *testing.T) {
	cases := []struct {
		name              string
		broadcastOnInherit bool
		expectLogContains bool
	}{
		{"broadcast true logs", true, true},
		{"broadcast false silent", false, false},
	}

	const relicName = "戴森之墓"

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state := makeInheritTestState(tc.broadcastOnInherit)
			// specified 模式需要 5 点能量，p1 初始 3 不够，调整为 5
			state.Players[0].Energy = 5
			logsBefore := len(state.Logs)
			energyBefore := state.Players[0].Energy
			faceUpBefore := len(state.Players[0].FaceUpCards)

			// leaveBehind=false，且 p1 仅持飞船（无其它设施）、能量恰好 5（specified 跃迁后剩 0），
			// 因此不会产生"遗留"或"销毁"日志，新日志全部来自继承分支或跃迁日志。
			ExecuteLightspeedShip(state, "p1", "specified", 9, 0, "", false, nil)

			p1 := &state.Players[0]

			// 玩家位置应变为 9
			if p1.Position != 9 {
				t.Fatalf("p1 Position = %d, want 9 (specified target)", p1.Position)
			}

			// 玩家获得遗迹能量（5 - 5 + 8 = 8）
			if p1.Energy != energyBefore-5+8 {
				t.Errorf("p1 Energy = %d, want %d (gained relic energy 8)", p1.Energy, energyBefore-5+8)
			}

			// 玩家获得遗迹设施（飞船 + 戴森球 = 2）
			if len(p1.FaceUpCards) != faceUpBefore+1 {
				t.Errorf("p1 FaceUpCards len = %d, want %d (gained 1 relic facility)", len(p1.FaceUpCards), faceUpBefore+1)
			}

			// LastRelicDiscovery 必须设置（私有揭示，无论广播与否）
			if state.LastRelicDiscovery == nil {
				t.Fatal("expected LastRelicDiscovery to be set")
			}
			rd := state.LastRelicDiscovery
			if rd.PlayerID != "p1" {
				t.Errorf("LastRelicDiscovery.PlayerID = %q, want %q", rd.PlayerID, "p1")
			}
			if rd.SystemID != 9 {
				t.Errorf("LastRelicDiscovery.SystemID = %d, want 9", rd.SystemID)
			}
			if !rd.IsRelic {
				t.Error("LastRelicDiscovery.IsRelic = false, want true")
			}
			if rd.Name != relicName {
				t.Errorf("LastRelicDiscovery.Name = %q, want %q", rd.Name, relicName)
			}
			if rd.Energy != 8 {
				t.Errorf("LastRelicDiscovery.Energy = %d, want 8", rd.Energy)
			}
			if len(rd.FacilityNames) != 1 {
				t.Errorf("LastRelicDiscovery.FacilityNames len = %d, want 1", len(rd.FacilityNames))
			}

			// 公共日志门控：specified 模式下 BroadcastOnInherit=true 写继承日志（含遗迹名），
			// false 时只写跃迁日志（含星系编号但不含遗迹名）
			newLogs := state.Logs[logsBefore:]
			foundRelicLog := false
			for _, l := range newLogs {
				if strings.Contains(l.Message, relicName) {
					foundRelicLog = true
					break
				}
			}
			if tc.expectLogContains && !foundRelicLog {
				t.Errorf("expected a log containing relic name %q, but none found in %d new logs", relicName, len(newLogs))
			}
			if !tc.expectLogContains && foundRelicLog {
				t.Errorf("expected NO log containing relic name %q (BroadcastOnInherit=false), but found one", relicName)
			}
		})
	}
}

// TestInherit_ViewStateScoping 验证 LastRelicDiscovery 的视图层门控：
// 继承者本人可见，其它玩家不可见。
func TestInherit_ViewStateScoping(t *testing.T) {
	// 复用 view_state_test.go 的构造函数，注入 LastRelicDiscovery
	state := makeViewStateTestState()
	state.LastRelicDiscovery = &RelicDiscovery{
		PlayerID:      "p1",
		SystemID:      5,
		IsRelic:       true,
		Name:          "戴森之墓",
		Lore:          "一颗戴森球笼罩着早已熄灭的恒星。",
		Energy:        8,
		FacilityNames: []string{"戴森球"},
	}

	// 继承者 p1 视图应包含 LastRelicDiscovery
	vsP1 := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})
	if vsP1.LastRelicDiscovery == nil {
		t.Fatal("p1 (inheritor) view should include LastRelicDiscovery, got nil")
	}
	if vsP1.LastRelicDiscovery.PlayerID != "p1" {
		t.Errorf("p1 view LastRelicDiscovery.PlayerID = %q, want %q", vsP1.LastRelicDiscovery.PlayerID, "p1")
	}
	if vsP1.LastRelicDiscovery.Name != "戴森之墓" {
		t.Errorf("p1 view LastRelicDiscovery.Name = %q, want %q", vsP1.LastRelicDiscovery.Name, "戴森之墓")
	}

	// 其它玩家 p2 视图不应包含 LastRelicDiscovery
	vsP2 := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p2"})
	if vsP2.LastRelicDiscovery != nil {
		t.Errorf("p2 (non-inheritor) view should not include LastRelicDiscovery, got %+v", vsP2.LastRelicDiscovery)
	}
}

// makeLightspeedEscapeTestState 构造一个用于测试光速飞船逃离遗留路径的 GameState。
// 8 名存活玩家占据星系 1-8，星系 9 为唯一可跃迁目标，无遗迹（避免继承干扰）。
// p1 持有光速飞船 + 一个其它设施，5 点能量（跃迁后剩 2 > 0，触发遗留创建）。
func makeLightspeedEscapeTestState() *GameState {
	escapeAbility := "escape"
	shipCard := Card{
		UID:     "ship-1",
		DefID:   "facility_lightspeed_ship",
		Name:    "光速飞船",
		Type:    CardTypeFacility,
		Energy:  10,
		Ability: &escapeAbility,
	}
	otherFacility := cardByID("facility_solar_array") // 太阳能阵列

	players := make([]Player, 8)
	for i := 0; i < 8; i++ {
		id := fmt.Sprintf("p%d", i+1)
		players[i] = Player{
			ID:               id,
			Name:             id,
			Color:            playerColors[i%len(playerColors)],
			Position:         i + 1, // 占据星系 1-8
			Energy:           5,
			Hand:             []Card{},
			FaceUpCards:      []Card{},
			Eliminated:       false,
			BroadcastHistory: []struct{ SystemID int; Turn int }{},
		}
	}
	// p1 持有光速飞船 + 太阳能阵列
	players[0].FaceUpCards = []Card{shipCard, otherFacility}

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
		GameMode:  GameModeCivilizationRelics,
	}
}

// TestLightspeedEscape_BroadcastAttribute 验证光速飞船逃离遗留时 BroadcastOnInherit
// 属性的解析契约（resolveBroadcast）：nil→true（默认），*true→true，*false→false。
//
// 通过 ExecuteLightspeedShip 真实代码路径触发：leaveBehind=true，p1 跃迁至星系 9，
// 在原位置（星系 1）创建 StarLeftover，断言其 BroadcastOnInherit 符合预期。
func TestLightspeedEscape_BroadcastAttribute(t *testing.T) {
	cases := []struct {
		name     string
		input    *bool
		expected bool
	}{
		{"nil defaults to true", nil, true},
		{"explicit true", boolPtr(true), true},
		{"explicit false", boolPtr(false), false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state := makeLightspeedEscapeTestState()

			ExecuteLightspeedShip(state, "p1", "random", 0, 0, "", true, tc.input)

			// p1 应跃迁至星系 9
			if state.Players[0].Position != 9 {
				t.Fatalf("p1 Position = %d, want 9", state.Players[0].Position)
			}

			// 在原位置（星系 1）查找遗留物
			var leftover *StarLeftover
			for i := range state.Leftovers {
				if state.Leftovers[i].SystemID == 1 {
					leftover = &state.Leftovers[i]
					break
				}
			}
			if leftover == nil {
				t.Fatal("expected leftover at system 1 (oldPos), found none")
			}

			// 光速飞船遗留物应 IsRelic=false
			if leftover.IsRelic {
				t.Errorf("leftover.IsRelic = true, want false (lightspeed escape is not a relic)")
			}

			if leftover.BroadcastOnInherit != tc.expected {
				t.Errorf("leftover.BroadcastOnInherit = %v, want %v", leftover.BroadcastOnInherit, tc.expected)
			}
		})
	}
}
