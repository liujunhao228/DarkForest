package replay

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/darkforest/backend/internal/game"
)

// newTestGameState 构造一个用于测试的 3 人初始 GameState。
func newTestGameState() *game.GameState {
	return game.NewGame(game.InitConfig{
		PlayerCount: 3,
		PlayerSeeds: []game.PlayerSeed{
			{ID: "p1", Name: "Alice"},
			{ID: "p2", Name: "Bob"},
			{ID: "p3", Name: "Carol"},
		},
	})
}

// TestGenerateStateSnapshots_NilInitialState 验证 nil 初始状态返回 nil, nil。
func TestGenerateStateSnapshots_NilInitialState(t *testing.T) {
	snapshots, err := GenerateStateSnapshots(nil, nil)
	if err != nil {
		t.Fatalf("expected nil error for nil initialState, got %v", err)
	}
	if snapshots != nil {
		t.Fatalf("expected nil snapshots, got %v", snapshots)
	}
}

// TestGenerateStateSnapshots_NoActions 验证无动作时只有初始快照。
func TestGenerateStateSnapshots_NoActions(t *testing.T) {
	state := newTestGameState()
	snapshots, err := GenerateStateSnapshots(state, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snapshots))
	}
	if snapshots[0] == nil {
		t.Fatal("snapshot[0] should not be nil")
	}
}

// TestGenerateStateSnapshots_SnapshotCount 验证快照数量 = len(actions)+1。
func TestGenerateStateSnapshots_SnapshotCount(t *testing.T) {
	state := newTestGameState()
	actions := []ActionRecord{
		{PlayerID: "p1", Action: "playCard", Data: json.RawMessage(`{"cardUid":"nonexistent"}`), Turn: 1},
		{PlayerID: "p1", Action: "endTurn", Data: json.RawMessage(`{}`), Turn: 1},
		{PlayerID: "p2", Action: "endTurn", Data: json.RawMessage(`{}`), Turn: 2},
	}
	snapshots, err := GenerateStateSnapshots(state, actions)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(snapshots) != len(actions)+1 {
		t.Fatalf("expected %d snapshots, got %d", len(actions)+1, len(snapshots))
	}
}

// TestGenerateStateSnapshots_DoesNotMutateInput 验证生成快照不修改输入的 initialState。
func TestGenerateStateSnapshots_DoesNotMutateInput(t *testing.T) {
	state := newTestGameState()
	originalTurn := state.TotalTurn
	originalPlayerIdx := state.CurrentPlayerIndex

	actions := []ActionRecord{
		{PlayerID: "p1", Action: "endTurn", Data: json.RawMessage(`{}`), Turn: 1},
	}
	_, err := GenerateStateSnapshots(state, actions)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// 输入的 initialState 不应被修改
	if state.TotalTurn != originalTurn {
		t.Errorf("input initialState was mutated: TotalTurn %d -> %d", originalTurn, state.TotalTurn)
	}
	if state.CurrentPlayerIndex != originalPlayerIdx {
		t.Errorf("input initialState was mutated: CurrentPlayerIndex %d -> %d", originalPlayerIdx, state.CurrentPlayerIndex)
	}
}

// TestApplyActionToState_EndTurn_NoDoubleAdvance 验证 Fix #1：
// endTurn 动作只调用 game.EndTurn，不会重复推进玩家。
// 调用前当前玩家是 p1 (index 0)，endTurn 后应推进到 p2 (index 1)，
// 而非 p3 (index 2，即双重推进的结果)。
func TestApplyActionToState_EndTurn_NoDoubleAdvance(t *testing.T) {
	state := newTestGameState()
	// 确保初始玩家是 p1
	if state.CurrentPlayerID != "p1" {
		t.Fatalf("expected initial player p1, got %s", state.CurrentPlayerID)
	}

	action := ActionRecord{
		PlayerID: "p1",
		Action:   "endTurn",
		Data:     json.RawMessage(`{"discardCards":[],"publicDiscard":false}`),
		Turn:     1,
	}
	applyActionToState(state, action)

	// 一次 endTurn 应只推进到下一个玩家 p2
	if state.CurrentPlayerID != "p2" {
		t.Errorf("expected current player p2 after single endTurn, got %s (double advance bug?)",
			state.CurrentPlayerID)
	}
}

// TestApplyActionToState_EndTurn_Sequence 验证连续 endTurn 轮转所有玩家。
// p1 -> p2 -> p3 -> p1（完整一轮后 TotalTurn 应 +1）。
func TestApplyActionToState_EndTurn_Sequence(t *testing.T) {
	state := newTestGameState()
	initialTurn := state.TotalTurn

	endTurnAction := func(playerID string, turn int) ActionRecord {
		return ActionRecord{
			PlayerID: playerID,
			Action:   "endTurn",
			Data:     json.RawMessage(`{"discardCards":[],"publicDiscard":false}`),
			Turn:     turn,
		}
	}

	// p1 -> p2
	applyActionToState(state, endTurnAction("p1", 1))
	if state.CurrentPlayerID != "p2" {
		t.Fatalf("after p1 endTurn, expected p2, got %s", state.CurrentPlayerID)
	}
	// p2 -> p3
	applyActionToState(state, endTurnAction("p2", 1))
	if state.CurrentPlayerID != "p3" {
		t.Fatalf("after p2 endTurn, expected p3, got %s", state.CurrentPlayerID)
	}
	// p3 -> p1（完整一轮，TotalTurn 应 +1）
	applyActionToState(state, endTurnAction("p3", 1))
	if state.CurrentPlayerID != "p1" {
		t.Fatalf("after p3 endTurn, expected p1, got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn+1 {
		t.Errorf("after full round, expected TotalTurn %d, got %d", initialTurn+1, state.TotalTurn)
	}
}

// TestApplyActionToState_UnknownAction 验证未知 action 不 panic、不修改状态。
func TestApplyActionToState_UnknownAction(t *testing.T) {
	state := newTestGameState()
	before := *state

	action := ActionRecord{
		PlayerID: "p1",
		Action:   "totallyUnknownAction",
		Data:     json.RawMessage(`{}`),
		Turn:     1,
	}
	// 不应 panic
	applyActionToState(state, action)

	// 状态应未改变（CurrentPlayerID 等关键字段）
	if state.CurrentPlayerID != before.CurrentPlayerID {
		t.Errorf("unknown action should not change CurrentPlayerID: %s -> %s",
			before.CurrentPlayerID, state.CurrentPlayerID)
	}
}

// TestApplyActionToState_MalformedData 验证损坏的 data 不 panic、记录日志后跳过。
func TestApplyActionToState_MalformedData(t *testing.T) {
	state := newTestGameState()

	cases := []string{
		"playCard", "deployCard", "strike", "broadcast",
		"respondBroadcast", "selectBroadcastResponder",
		"recycleCard", "moveStrike", "retargetStrike", "selectStrike",
	}
	for _, actionName := range cases {
		action := ActionRecord{
			PlayerID: "p1",
			Action:   actionName,
			Data:     json.RawMessage(`{invalid json`), // 损坏的 JSON
			Turn:     1,
		}
		// 不应 panic
		applyActionToState(state, action)
	}
}

// TestApplyActionToState_NoPayloadActions 验证无参数的 action case 不 panic。
func TestApplyActionToState_NoPayloadActions(t *testing.T) {
	state := newTestGameState()

	cases := []string{
		"cancelBroadcast",
		"announceStrike",
		"skipAnnounceStrike",
		"skipStrikeSelect",
	}
	for _, actionName := range cases {
		action := ActionRecord{
			PlayerID: "p1",
			Action:   actionName,
			Data:     json.RawMessage(`{}`),
			Turn:     1,
		}
		// 不应 panic
		applyActionToState(state, action)
	}
}

// TestApplyActionToState_LightspeedShip 验证 lightspeedShip 携带新跃迁模式字段
// 载荷时不 panic（随机模式 / leaveBehind true/false 均覆盖）。
func TestApplyActionToState_LightspeedShip(t *testing.T) {
	payloads := []json.RawMessage{
		json.RawMessage(`{"mode":"random","targetSystem":0,"carryEnergy":0,"message":"","leaveBehind":true}`),
		json.RawMessage(`{"mode":"random","targetSystem":0,"carryEnergy":0,"message":"","leaveBehind":false}`),
	}
	for _, payload := range payloads {
		state := newTestGameState()
		action := ActionRecord{
			PlayerID: "p1",
			Action:   "lightspeedShip",
			Data:     payload,
			Turn:     1,
		}
		// 不应 panic(玩家无飞船/能量不足/模式非法时函数应安全返回)
		applyActionToState(state, action)
	}
}

// newClassicLightspeedReplayState 构造一个用于测试 Classic 模式光速飞船回放的 GameState。
// 8 名存活玩家占据星系 1-8，星系 9 为唯一可跃迁目标（无遗迹，避免继承干扰）。
// p1 手牌持有光速飞船（Classic 模式飞船在手牌，不在 FaceUpCards），能量由调用方指定。
//
// 该 helper 直接构造 GameState 而不调用 NewGame，以便精确控制 GameMode=GameModeClassic
// 与手牌内容，模拟回放记录恢复后的状态——验证 applyActionToState 调用
// ExecuteLightspeedShip 时会按 state.GameMode 自动分派到 executeLightspeedShipClassic。
func newClassicLightspeedReplayState(initialEnergy int) *game.GameState {
	escapeAbility := "escape"
	shipCard := game.Card{
		UID:     "ship-1",
		DefID:   "facility_lightspeed_ship",
		Name:    "光速飞船",
		Type:    game.CardTypeFacility,
		Energy:  10,
		Ability: &escapeAbility,
	}

	colors := []game.PlayerColor{
		game.PlayerColorRed, game.PlayerColorBlue, game.PlayerColorGreen,
		game.PlayerColorAmber, game.PlayerColorPurple,
	}
	players := make([]game.Player, 8)
	for i := 0; i < 8; i++ {
		id := fmt.Sprintf("p%d", i+1)
		players[i] = game.Player{
			ID:          id,
			Name:        id,
			Color:       colors[i%len(colors)],
			Position:    i + 1, // 占据星系 1-8
			Energy:      5,
			Hand:        []game.Card{},
			FaceUpCards: []game.Card{},
			Eliminated:  false,
			BroadcastHistory: []struct {
				SystemID int
				Turn     int
			}{},
		}
	}
	// p1 手牌持有光速飞船，能量由调用方指定
	players[0].Hand = []game.Card{shipCard}
	players[0].Energy = initialEnergy

	return &game.GameState{
		Phase:              game.GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        8,
		Players:            players,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:    "p1",
		LocalPlayerID:      "p1",
		DrawPile:           []game.Card{},
		DiscardPile:        []game.Card{},
		FlyingStrikes:      []game.FlyingStrike{},
		TurnPhase:          game.TurnPhaseActionPhase,
		Logs: []game.LogEntry{
			{ID: "log-init", Turn: 0, Phase: "system", Message: "游戏开始！", Type: game.LogEntryTypeSystem},
		},
		Leftovers: []game.StarLeftover{}, // 无遗迹，避免继承干扰
		GameMode:  game.GameModeClassic,
	}
}

// TestApplyActionToState_LightspeedShip_Classic 验证回放 lightspeedShip action 时
// 通过 ExecuteLightspeedShip 按 state.GameMode 自动分派到 executeLightspeedShipClassic。
// 回放引擎本身不含模式判断，分派完全由 GameState.GameMode 决定（从回放记录恢复）。
//
// 覆盖点：
//   - 飞船从手牌移至 DiscardPile（Classic 一次性合并动作）
//   - random 模式扣 10 能量（通过遗留物 Energy 间接验证成本）
//   - 玩家位置变更到星系 9（唯一可用目标）
//   - message 字段被忽略（不额外扣能量）
func TestApplyActionToState_LightspeedShip_Classic(t *testing.T) {
	t.Run("Random_Cost10_ShipToDiscard_PositionChanged", func(t *testing.T) {
		// 初始能量 15，random cost 10 后剩 5（leaveBehind=true 通过遗留物 Energy 直接验证成本）
		state := newClassicLightspeedReplayState(15)
		action := ActionRecord{
			PlayerID: "p1",
			Action:   "lightspeedShip",
			Data:     json.RawMessage(`{"mode":"random","targetSystem":0,"carryEnergy":0,"message":"","leaveBehind":true}`),
			Turn:     1,
		}

		applyActionToState(state, action)

		// 飞船从手牌移至 DiscardPile
		if len(state.Players[0].Hand) != 0 {
			t.Errorf("expected empty Hand, got %+v", state.Players[0].Hand)
		}
		if len(state.DiscardPile) != 1 || state.DiscardPile[0].UID != "ship-1" {
			t.Errorf("expected ship in DiscardPile, got %+v", state.DiscardPile)
		}
		// 扣 10 能量：原位置（星系 1）遗留物 Energy = 15 - 10 = 5
		var leftover *game.StarLeftover
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
		// 玩家位置变更到星系 9（唯一可用目标）
		if state.Players[0].Position != 9 {
			t.Errorf("p1 Position = %d, want 9 (only available system)", state.Players[0].Position)
		}
	})

	t.Run("MessageIgnored_NoExtraCost", func(t *testing.T) {
		// 能量刚好够 random 10；若 message 被错误计费则能量不足会提前返回，飞船保留手牌。
		// 走销毁分支（leaveBehind=false）后玩家能量归零（Classic carry cap=0）。
		state := newClassicLightspeedReplayState(10)
		action := ActionRecord{
			PlayerID: "p1",
			Action:   "lightspeedShip",
			Data:     json.RawMessage(`{"mode":"random","targetSystem":0,"carryEnergy":0,"message":"应该被忽略的留言","leaveBehind":false}`),
			Turn:     1,
		}

		applyActionToState(state, action)

		// message 被忽略：扣 10 能量后归零（carry cap=0, destroy branch）
		if state.Players[0].Energy != 0 {
			t.Errorf("p1 Energy = %d, want 0 (message should not add cost)", state.Players[0].Energy)
		}
		// 飞船应已进弃牌堆（若 message 被计费则能量不足会保留）
		if len(state.Players[0].Hand) != 0 {
			t.Errorf("expected ship removed from Hand, got %+v", state.Players[0].Hand)
		}
		if len(state.DiscardPile) != 1 {
			t.Errorf("expected ship in DiscardPile, got %+v", state.DiscardPile)
		}
		// 玩家位置变更
		if state.Players[0].Position != 9 {
			t.Errorf("p1 Position = %d, want 9", state.Players[0].Position)
		}
	})
}

// TestCloneGameState_Nil 验证 cloneGameState(nil) 返回 nil。
func TestCloneGameState_Nil(t *testing.T) {
	if got := cloneGameState(nil); got != nil {
		t.Errorf("expected nil, got %v", got)
	}
}

// TestCloneGameState_DeepCopy 验证 clone 是深拷贝：修改 clone 不影响原状态。
func TestCloneGameState_DeepCopy(t *testing.T) {
	original := newTestGameState()
	cloned := cloneGameState(original)
	if cloned == nil {
		t.Fatal("expected non-nil clone")
	}

	// 修改 clone，原状态不应受影响
	cloned.TotalTurn = 999
	cloned.Players[0].Energy = 999
	if original.TotalTurn == 999 {
		t.Error("clone leaked: TotalTurn modified in original")
	}
	if original.Players[0].Energy == 999 {
		t.Error("clone leaked: Players[0].Energy modified in original")
	}
}

// newClassicStrikeReplayState 构造一个用于测试 Classic 模式打击回放的 GameState。
// 3 名存活玩家占据星系 1-3，p1 手牌持有降维打击（level=4 无视防御），能量充足（20）。
// 该 helper 直接构造 GameState 而不调用 NewGame，以便精确控制 GameMode=GameModeClassic
// 与手牌内容，验证 applyActionToState 调用 game.PlayStrikeCard 时按 state.GameMode
// 自动走 Direct 分支（即刻判定，不创建长期飞行的 FlyingStrike）。
func newClassicStrikeReplayState() *game.GameState {
	level := 4
	speed := 1
	strikeCard := game.Card{
		UID:    "strike-1",
		DefID:  "strike_dimensional",
		Name:   "降维打击",
		Type:   game.CardTypeStrike,
		Energy: 10,
		Level:  &level,
		Speed:  &speed,
	}

	colors := []game.PlayerColor{
		game.PlayerColorRed, game.PlayerColorBlue, game.PlayerColorGreen,
	}
	players := make([]game.Player, 3)
	for i := 0; i < 3; i++ {
		id := fmt.Sprintf("p%d", i+1)
		players[i] = game.Player{
			ID:          id,
			Name:        id,
			Color:       colors[i%len(colors)],
			Position:    i + 1,
			Energy:      5,
			Hand:        []game.Card{},
			FaceUpCards: []game.Card{},
			Eliminated:  false,
			BroadcastHistory: []struct {
				SystemID int
				Turn     int
			}{},
		}
	}
	// p1 手牌持有降维打击，能量充足（20）足以发动（cost=10）
	players[0].Hand = []game.Card{strikeCard}
	players[0].Energy = 20

	return &game.GameState{
		Phase:              game.GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        3,
		Players:            players,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:    "p1",
		LocalPlayerID:      "p1",
		DrawPile:           []game.Card{},
		DiscardPile:        []game.Card{},
		FlyingStrikes:      []game.FlyingStrike{},
		TurnPhase:          game.TurnPhaseActionPhase,
		Logs: []game.LogEntry{
			{ID: "log-init", Turn: 0, Phase: "system", Message: "游戏开始！", Type: game.LogEntryTypeSystem},
		},
		Leftovers: []game.StarLeftover{},
		GameMode:  game.GameModeClassic,
	}
}

// TestGenerateStateSnapshots_ClassicStrikeDirect 验证 Classic 模式（Direct+Discard）下
// 打击 action 的回放：
//   - DirectHit_SnapshotCountAndState: strike action 命中目标，快照数量正确，
//     最终快照 FlyingStrikes 为空、DiscardPile 含打击牌、p2 被淘汰、输入未被修改
//   - MissedFieldSerialization_Preserved: cloneGameState (JSON 序列化/反序列化) 后
//     FlyingStrike.Missed 字段保持正确（omitempty 兼容性：true 与 false 均不丢失）
func TestGenerateStateSnapshots_ClassicStrikeDirect(t *testing.T) {
	t.Run("DirectHit_SnapshotCountAndState", func(t *testing.T) {
		state := newClassicStrikeReplayState()
		actions := []ActionRecord{
			{
				PlayerID: "p1",
				Action:   "strike",
				Data:     json.RawMessage(`{"cardUid":"strike-1","targetSystem":2}`),
				Turn:     1,
			},
		}

		snapshots, err := GenerateStateSnapshots(state, actions)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// 快照数量 = len(actions) + 1 = 2
		if len(snapshots) != 2 {
			t.Fatalf("expected 2 snapshots, got %d", len(snapshots))
		}
		if snapshots[0] == nil || snapshots[1] == nil {
			t.Fatal("snapshots should not be nil")
		}

		final := snapshots[1]

		// 最终快照 FlyingStrikes 为空（Direct 命中不创建 FlyingStrike）
		if len(final.FlyingStrikes) != 0 {
			t.Errorf("expected empty FlyingStrikes, got %d: %+v", len(final.FlyingStrikes), final.FlyingStrikes)
		}
		// 最终快照 DiscardPile 含打击牌 strike-1
		found := false
		for _, c := range final.DiscardPile {
			if c.UID == "strike-1" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected strike-1 in DiscardPile, got %+v", final.DiscardPile)
		}
		// p2 被淘汰（降维打击 level=4 无视防御）
		if !final.Players[1].Eliminated {
			t.Errorf("p2 should be eliminated, got Eliminated=%v", final.Players[1].Eliminated)
		}
		// p1 能量 = 20 - 10(降维打击) + 6(淘汰奖励: 2 存活 × 3) = 16
		if final.Players[0].Energy != 16 {
			t.Errorf("p1 Energy = %d, want 16 (20 - 10 + 6)", final.Players[0].Energy)
		}
		// p1 StrikeCount 递增
		if final.Players[0].StrikeCount != 1 {
			t.Errorf("p1 StrikeCount = %d, want 1", final.Players[0].StrikeCount)
		}
		// 输入 initialState 不应被修改（GenerateStateSnapshots 内部 clone）
		if state.Players[0].StrikeCount != 0 {
			t.Errorf("input state was mutated: p1 StrikeCount = %d (should be 0)", state.Players[0].StrikeCount)
		}
		if state.Players[1].Eliminated {
			t.Errorf("input state was mutated: p2 should not be eliminated in original")
		}
		if len(state.DiscardPile) != 0 {
			t.Errorf("input state was mutated: DiscardPile should be empty, got %d", len(state.DiscardPile))
		}
	})

	t.Run("MissedFieldSerialization_Preserved", func(t *testing.T) {
		// 构造含 Missed=true 与 Missed=false 两个 FlyingStrike 的状态，
		// 验证 cloneGameState (JSON marshal/unmarshal) 后 Missed 字段保持正确。
		// FlyingStrike.Missed 的 json tag 为 "missed,omitempty"：
		//   - Missed=true  → JSON 含 "missed":true → unmarshal 后 Missed=true
		//   - Missed=false → JSON 省略字段 → unmarshal 后 Missed=false（零值）
		missedStrike := game.FlyingStrike{
			UID:          "strike-missed",
			DefID:        "strike_thermal",
			OwnerID:      "p1",
			Position:     9,
			TargetSystem: 9,
			Level:        1,
			Speed:        1,
			StrikeName:   "热核打击",
			Arrived:      true,
			Missed:       true,
		}
		notMissedStrike := game.FlyingStrike{
			UID:          "strike-not-missed",
			DefID:        "strike_thermal",
			OwnerID:      "p1",
			Position:     2,
			TargetSystem: 2,
			Level:        1,
			Speed:        1,
			StrikeName:   "热核打击",
			Arrived:      true,
			Missed:       false,
		}

		colors := []game.PlayerColor{
			game.PlayerColorRed, game.PlayerColorBlue,
		}
		players := make([]game.Player, 2)
		for i := 0; i < 2; i++ {
			id := fmt.Sprintf("p%d", i+1)
			players[i] = game.Player{
				ID:          id,
				Name:        id,
				Color:       colors[i%len(colors)],
				Position:    i + 1,
				Energy:      5,
				Hand:        []game.Card{},
				FaceUpCards: []game.Card{},
				Eliminated:  false,
				BroadcastHistory: []struct {
					SystemID int
					Turn     int
				}{},
			}
		}

		state := &game.GameState{
			Phase:              game.GamePhasePlaying,
			TotalTurn:          1,
			PlayerCount:        2,
			Players:            players,
			CurrentPlayerIndex: 0,
			CurrentPlayerID:    "p1",
			LocalPlayerID:      "p1",
			DrawPile:           []game.Card{},
			DiscardPile:        []game.Card{},
			FlyingStrikes:      []game.FlyingStrike{missedStrike, notMissedStrike},
			TurnPhase:          game.TurnPhaseActionPhase,
			Logs: []game.LogEntry{
				{ID: "log-init", Turn: 0, Phase: "system", Message: "游戏开始！", Type: game.LogEntryTypeSystem},
			},
			Leftovers: []game.StarLeftover{},
			GameMode:  game.GameModeClassic,
		}

		// 无 actions，仅做一次 clone（cloneGameState 走 JSON marshal/unmarshal）
		snapshots, err := GenerateStateSnapshots(state, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(snapshots) != 1 {
			t.Fatalf("expected 1 snapshot, got %d", len(snapshots))
		}

		cloned := snapshots[0]
		if len(cloned.FlyingStrikes) != 2 {
			t.Fatalf("expected 2 FlyingStrikes, got %d", len(cloned.FlyingStrikes))
		}

		// 定位两个打击并断言 Missed 字段保持正确
		var clonedMissed, clonedNotMissed *game.FlyingStrike
		for i := range cloned.FlyingStrikes {
			switch cloned.FlyingStrikes[i].UID {
			case "strike-missed":
				clonedMissed = &cloned.FlyingStrikes[i]
			case "strike-not-missed":
				clonedNotMissed = &cloned.FlyingStrikes[i]
			}
		}
		if clonedMissed == nil {
			t.Fatal("strike-missed not found in cloned FlyingStrikes")
		}
		if !clonedMissed.Missed {
			t.Errorf("strike-missed.Missed = false after clone, want true (omitempty should preserve true)")
		}
		if clonedNotMissed == nil {
			t.Fatal("strike-not-missed not found in cloned FlyingStrikes")
		}
		if clonedNotMissed.Missed {
			t.Errorf("strike-not-missed.Missed = true after clone, want false (omitempty zero value)")
		}
	})
}
