package replay

import (
	"encoding/json"
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
		"lightspeedShip",
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
