package gamesdk

import (
	"encoding/json"
	"testing"
)

// delta_test.go 覆盖 game:deltaSync 增量应用逻辑,用例语义对齐前端
// src/store/onlineGameStore/__tests__/sync.test.ts。

func TestApplyChanges_SetScalar(t *testing.T) {
	state := &ViewState{Kind: "view", TotalTurn: 4, Version: 1}
	next := applyChanges(state, []Change{{Path: "totalTurn", Value: 5, Type: "set"}})
	if next.TotalTurn != 5 {
		t.Fatalf("TotalTurn = %d, want 5", next.TotalTurn)
	}
	if next.Version != 1 {
		t.Errorf("Version should not be modified by delta")
	}
}

func TestApplyChanges_SetArrayElement(t *testing.T) {
	state := &ViewState{
		Kind:   "view",
		Players: []ViewPlayer{
			{ID: "p1", Energy: 3, Hand: []Card{{UID: "c1", DefID: "x"}}},
			{ID: "p2", Energy: 5},
		},
	}
	next := applyChanges(state, []Change{{Path: "players[1].energy", Value: 9, Type: "set"}})
	if len(next.Players) != 2 {
		t.Fatalf("players len = %d, want 2", len(next.Players))
	}
	if next.Players[1].Energy != 9 {
		t.Fatalf("players[1].Energy = %d, want 9", next.Players[1].Energy)
	}
	if next.Players[0].Energy != 3 {
		t.Errorf("players[0].Energy changed unexpectedly = %d", next.Players[0].Energy)
	}
}

// TestApplyChanges_DeleteArrayDesc 验证同数组多个 delete 按索引降序处理。
// 语义: prev=[a,b,c,d] -> next=[a,b] 产出 delete[2] 与 delete[3]。
// 降序先删[3]再删[2],最终保留 [a,b]。
func TestApplyChanges_DeleteArrayDesc(t *testing.T) {
	state := &ViewState{
		Kind:        "view",
		DestroyedStars: []int{10, 20, 30, 40},
	}
	changes := []Change{
		{Path: "destroyedStars[2]", Type: "delete"},
		{Path: "destroyedStars[3]", Type: "delete"},
	}
	next := applyChanges(state, changes)
	if len(next.DestroyedStars) != 2 {
		t.Fatalf("destroyedStars len = %d, want 2 (got %v)", len(next.DestroyedStars), next.DestroyedStars)
	}
	if next.DestroyedStars[0] != 10 || next.DestroyedStars[1] != 20 {
		t.Errorf("destroyedStars = %v, want [10 20]", next.DestroyedStars)
	}
}

func TestApplyChanges_DeleteObjectField(t *testing.T) {
	state := &ViewState{Kind: "view", Winner: "player-1"}
	next := applyChanges(state, []Change{{Path: "winner", Type: "delete"}})
	if next.Winner != "" {
		t.Fatalf("Winner = %q, want \"\"(null)", next.Winner)
	}
}

// TestApplyChanges_DoesNotMutateInput 确保 applyChanges 不修改入参 state。
func TestApplyChanges_DoesNotMutateInput(t *testing.T) {
	state := &ViewState{Kind: "view", TotalTurn: 1}
	_ = applyChanges(state, []Change{{Path: "totalTurn", Value: 99, Type: "set"}})
	if state.TotalTurn != 1 {
		t.Errorf("input state mutated: TotalTurn = %d, want 1", state.TotalTurn)
	}
}

// TestApplyChanges_NestedArrayIntoObject 覆盖中间段是数组索引的路径(如 flyingStrikes[0].targetSystem)。
func TestApplyChanges_NestedIntoObject(t *testing.T) {
	state := &ViewState{Kind: "view", FlyingStrikes: []FlyingStrike{{UID: "s1", TargetSystem: 3}}}
	next := applyChanges(state, []Change{{Path: "flyingStrikes[0].targetSystem", Value: 8, Type: "set"}})
	if len(next.FlyingStrikes) != 1 {
		t.Fatalf("flyingStrikes len = %d, want 1", len(next.FlyingStrikes))
	}
	if next.FlyingStrikes[0].TargetSystem != 8 {
		t.Errorf("targetSystem = %d, want 8", next.FlyingStrikes[0].TargetSystem)
	}
}

// TestHandleDeltaSync_NoBaselineRequestsSync 验证版本断档时 handleDeltaSync 会请求全量同步
// 而不是应用增量(该分支通过 ws.SendEvent 发请求,这里以空 conn 验证不 panic 仍返回)。
func TestHandleDeltaSync_NoBaselineRequestsSync(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost/ws", 0)
	s.mu.Lock()
	s.stateVersion = 0
	s.gameState = nil
	s.mu.Unlock()
	// 无 roomID 时不应 panic,仅入队事件
	s.handleDeltaSync(json.RawMessage(`{"changes":[{"path":"totalTurn","value":1,"type":"set"}],"version":1}`))
	if got := s.GetState(); got != nil {
		t.Fatalf("state should remain nil (no baseline)")
	}
}

// TestHandleDeltaSync_ContiguousApplies 验证版本连续时增量被应用到 gameState。
func TestHandleDeltaSync_ContiguousApplies(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost/ws", 0)
	s.mu.Lock()
	s.gameState = &ViewState{Kind: "view", TotalTurn: 4, Version: 1}
	s.stateVersion = 1
	s.mu.Unlock()

	s.handleDeltaSync(json.RawMessage(`{"changes":[{"path":"totalTurn","value":5,"type":"set"}],"version":2}`))

	got := s.GetState()
	if got == nil || got.TotalTurn != 5 {
		t.Fatalf("TotalTurn = %v, want 5 (delta applied)", got)
	}
	prev := s.GetPrevState()
	if prev == nil || prev.TotalTurn != 4 {
		t.Fatalf("prev TotalTurn = %v, want 4 (snapshot before delta)", prev)
	}
}

// TestHandleDeltaSync_VersionGapDoesNotApply 验证版本断档时 deltaSync 不被应用。
func TestHandleDeltaSync_VersionGapDoesNotApply(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost/ws", 0)
	s.mu.Lock()
	s.gameState = &ViewState{Kind: "view", TotalTurn: 1, Version: 1}
	s.stateVersion = 1
	s.mu.Unlock()

	s.handleDeltaSync(json.RawMessage(`{"changes":[{"path":"totalTurn","value":99,"type":"set"}],"version":5}`))

	got := s.GetState()
	if got.TotalTurn != 1 {
		t.Fatalf("TotalTurn = %d, want 1 (gap delta must not apply)", got.TotalTurn)
	}
}