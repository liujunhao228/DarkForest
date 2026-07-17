package gamesdk

import (
	"encoding/json"
	"testing"
)

// TestGameSession_GameMode_Default 验证未设置 gameMode 时 GetGameMode 返回 "classic"。
func TestGameSession_GameMode_Default(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost:8080/ws", 1)
	if got := s.GetGameMode(); got != "classic" {
		t.Errorf("GetGameMode() = %q, want %q", got, "classic")
	}
}

// TestGameSession_GameMode_SetGet 验证 SetGameMode 后 GetGameMode 返回新值。
func TestGameSession_GameMode_SetGet(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost:8080/ws", 1)
	s.SetGameMode("civilization_relics")
	if got := s.GetGameMode(); got != "civilization_relics" {
		t.Errorf("GetGameMode() = %q, want %q", got, "civilization_relics")
	}
}

// TestGameSession_GameMode_EmptyString 验证显式设置为空串后回退到 "classic"。
func TestGameSession_GameMode_EmptyString(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost:8080/ws", 1)
	s.SetGameMode("civilization_relics")
	s.SetGameMode("")
	if got := s.GetGameMode(); got != "classic" {
		t.Errorf("GetGameMode() after empty set = %q, want %q", got, "classic")
	}
}

// TestGameSession_PrevState_InitialNil 验证初始 GetPrevState 返回 nil。
func TestGameSession_PrevState_InitialNil(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost:8080/ws", 1)
	if got := s.GetPrevState(); got != nil {
		t.Errorf("GetPrevState() = %v, want nil", got)
	}
}

// TestGameSession_HandleFullSync_PrevStateSaved 验证 handleFullSync 调用后,
// prevGameState 保存了上一次的快照,gameState 更新为新值。
func TestGameSession_HandleFullSync_PrevStateSaved(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost:8080/ws", 1)

	// 第一次 fullSync:gameState 被填充,prevGameState 仍为 nil(初始 nil 被挪过去)
	firstState := &ViewState{
		Kind:          "view",
		Phase:         "playing",
		TotalTurn:     1,
		LocalPlayerID: "p1",
	}
	firstPayload := buildFullSyncPayload(t, firstState)
	s.handleFullSync(firstPayload)

	if got := s.GetState(); got == nil || got.TotalTurn != 1 {
		t.Fatalf("after first fullSync: GetState() = %v, want TotalTurn=1", got)
	}
	if got := s.GetPrevState(); got != nil {
		t.Errorf("after first fullSync: GetPrevState() = %v, want nil", got)
	}

	// 第二次 fullSync:prevGameState 应保存第一次的快照,gameState 更新为第二次
	secondState := &ViewState{
		Kind:          "view",
		Phase:         "playing",
		TotalTurn:     2,
		LocalPlayerID: "p1",
	}
	secondPayload := buildFullSyncPayload(t, secondState)
	s.handleFullSync(secondPayload)

	if got := s.GetState(); got == nil || got.TotalTurn != 2 {
		t.Fatalf("after second fullSync: GetState() = %v, want TotalTurn=2", got)
	}
	prev := s.GetPrevState()
	if prev == nil {
		t.Fatalf("after second fullSync: GetPrevState() = nil, want non-nil")
	}
	if prev.TotalTurn != 1 {
		t.Errorf("after second fullSync: GetPrevState().TotalTurn = %d, want 1", prev.TotalTurn)
	}

	// 第三次 fullSync:prevGameState 应更新为第二次的快照(TotalTurn=2)
	thirdState := &ViewState{
		Kind:          "view",
		Phase:         "playing",
		TotalTurn:     3,
		LocalPlayerID: "p1",
	}
	thirdPayload := buildFullSyncPayload(t, thirdState)
	s.handleFullSync(thirdPayload)

	if got := s.GetState(); got == nil || got.TotalTurn != 3 {
		t.Fatalf("after third fullSync: GetState() = %v, want TotalTurn=3", got)
	}
	prev3 := s.GetPrevState()
	if prev3 == nil {
		t.Fatalf("after third fullSync: GetPrevState() = nil, want non-nil")
	}
	if prev3.TotalTurn != 2 {
		t.Errorf("after third fullSync: GetPrevState().TotalTurn = %d, want 2", prev3.TotalTurn)
	}
}

// TestGameSession_PrevState_GetReturnsCopy 验证 GetPrevState 返回的是拷贝,
// 修改返回值不影响 session 内部状态。
func TestGameSession_PrevState_GetReturnsCopy(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost:8080/ws", 1)

	firstState := &ViewState{
		Kind:          "view",
		Phase:         "playing",
		TotalTurn:     1,
		LocalPlayerID: "p1",
	}
	s.handleFullSync(buildFullSyncPayload(t, firstState))

	secondState := &ViewState{
		Kind:          "view",
		Phase:         "playing",
		TotalTurn:     2,
		LocalPlayerID: "p1",
	}
	s.handleFullSync(buildFullSyncPayload(t, secondState))

	prev := s.GetPrevState()
	if prev == nil {
		t.Fatal("GetPrevState() = nil, want non-nil")
	}
	prev.TotalTurn = 999 // 修改返回值

	// 再次调用 GetPrevState 应仍返回原始值
	if got := s.GetPrevState(); got.TotalTurn != 1 {
		t.Errorf("GetPrevState().TotalTurn after external mutation = %d, want 1 (GetPrevState should return copy)", got.TotalTurn)
	}
}

// buildFullSyncPayload 构造一个 FullSyncPayload 的 JSON,用于测试 handleFullSync。
func buildFullSyncPayload(t *testing.T, state *ViewState) json.RawMessage {
	t.Helper()
	stateBytes, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal state: %v", err)
	}
	payload := FullSyncPayload{
		State:     stateBytes,
		Version:   1,
		Timestamp: 0,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return payloadBytes
}
