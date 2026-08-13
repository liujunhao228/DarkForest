package gamesdk

import (
	"encoding/json"
	"testing"

	"darkforest/mcpserver/internal/account"
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

// TestGameSession_HandleFullSync_SettlementViewKeepsLocalPlayerID 验证结算广播时序：
// per-player gameOver 视图先到、REPLAY 全知视角结算视图后到覆盖时,LocalPlayerID
// 用本连接的玩家身份回填,不因全知视图(localPlayerId="")而变空——否则终局投影
// ProjectGameOver(viewerID="") 对胜者也判 loss(1v1 双方皆 loss 根因,2026-08-13)。
func TestGameSession_HandleFullSync_SettlementViewKeepsLocalPlayerID(t *testing.T) {
	acc := &account.Account{ID: "pl-uuid", PlayerID: "pl-uuid"}
	s := NewGameSession(acc, nil, "ws://localhost:8080/ws", 1)

	// ① per-player 视角 gameOver 视图(正常结算广播第一份)
	playerState := &ViewState{
		Kind:          "view",
		Phase:         "gameOver",
		TotalTurn:     12,
		LocalPlayerID: "pl-uuid",
		Winner:        "pl-uuid",
		ViewMeta:      &ViewMeta{Role: "PLAYER", ViewerID: "pl-uuid"},
	}
	s.handleFullSync(buildFullSyncPayload(t, playerState))

	// ② REPLAY 全知视角结算视图(room.go broadcastGameState 补发,LocalPlayerID 空)
	settlementState := &ViewState{
		Kind:      "view",
		Phase:     "gameOver",
		TotalTurn: 12,
		Winner:    "pl-uuid",
		ReplayID:  "replay-1",
		ViewMeta:  &ViewMeta{Role: "REPLAY"},
	}
	s.handleFullSync(buildFullSyncPayload(t, settlementState))

	got := s.GetState()
	if got == nil {
		t.Fatal("GetState() = nil, want non-nil")
	}
	if got.LocalPlayerID != "pl-uuid" {
		t.Errorf("after settlement view: LocalPlayerID = %q, want %q (must backfill from Account.PlayerID)", got.LocalPlayerID, "pl-uuid")
	}
	if got.Phase != "gameOver" {
		t.Errorf("Phase = %q, want gameOver", got.Phase)
	}
	if got.Winner != "pl-uuid" {
		t.Errorf("Winner = %q, want pl-uuid", got.Winner)
	}
	if got.ReplayID != "replay-1" {
		t.Errorf("ReplayID = %q, want replay-1 (settlement view must still inject replayId)", got.ReplayID)
	}
	if s.GetLastReplayID() != "replay-1" {
		t.Errorf("GetLastReplayID() = %q, want replay-1", s.GetLastReplayID())
	}
}

// TestGameSession_HandleFullSync_SettlementViewSpectatorNoBackfill 验证观战连接
// (Account 无玩家身份)收到结算全知视图时 LocalPlayerID 保持为空——观战者看非空
// winner 即 loss 的既有语义不受影响。
func TestGameSession_HandleFullSync_SettlementViewSpectatorNoBackfill(t *testing.T) {
	s := NewGameSession(nil, nil, "ws://localhost:8080/ws", 1)

	settlementState := &ViewState{
		Kind:      "view",
		Phase:     "gameOver",
		TotalTurn: 9,
		Winner:    "p1",
		ReplayID:  "replay-2",
		ViewMeta:  &ViewMeta{Role: "REPLAY"},
	}
	s.handleFullSync(buildFullSyncPayload(t, settlementState))

	got := s.GetState()
	if got == nil {
		t.Fatal("GetState() = nil, want non-nil")
	}
	if got.LocalPlayerID != "" {
		t.Errorf("spectator LocalPlayerID = %q, want empty (no backfill)", got.LocalPlayerID)
	}
}

// TestGameSession_PlayerID 验证 PlayerID() 返回握手回填的连接身份,
// 无 Account 时返回空串。
func TestGameSession_PlayerID(t *testing.T) {
	acc := &account.Account{ID: "pl-uuid", PlayerID: "pl-uuid"}
	s := NewGameSession(acc, nil, "ws://localhost:8080/ws", 1)
	if got := s.PlayerID(); got != "pl-uuid" {
		t.Errorf("PlayerID() = %q, want pl-uuid", got)
	}

	s2 := NewGameSession(nil, nil, "ws://localhost:8080/ws", 1)
	if got := s2.PlayerID(); got != "" {
		t.Errorf("PlayerID() without account = %q, want empty", got)
	}
}
