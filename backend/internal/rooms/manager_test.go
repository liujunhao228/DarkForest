package rooms

import (
	"log/slog"
	"testing"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
)

func newTestRoomManager() *RoomManager {
	h := hub.NewHub(slog.Default())
	return NewRoomManager(h, slog.Default(), nil, nil)
}

func newTestPlayer(id, name string) *hub.PlayerInfo {
	return &hub.PlayerInfo{ID: id, DisplayName: name, Role: "player"}
}

// TestRejoinRoom_Success：创建房间 → 预添加玩家 → SetGameState → LeaveRoom 模拟超时移除 → RejoinRoom 成功
func TestRejoinRoom_Success(t *testing.T) {
	rm := newTestRoomManager()
	roomID := "test-rejoin-success"
	room := rm.GetOrCreateRoom(roomID, 3)
	p1 := newTestPlayer("p1", "Alice")
	room.AddPlayer(p1)
	rm.playerToRoom["p1"] = roomID
	rm.SetActiveGame("p1", roomID)

	// 注入 GameState（p1 未淘汰）
	gs := &game.GameState{
		Players:         []game.Player{{ID: "p1", Eliminated: false}},
		CurrentPlayerID: "p1",
	}
	if err := room.SetGameState(gs); err != nil {
		t.Fatalf("SetGameState failed: %v", err)
	}

	// 模拟 30s 超时：LeaveRoom 移除 p1（但 activeGameByPlayer 保留）
	if err := rm.LeaveRoom("p1"); err != nil {
		t.Fatalf("LeaveRoom failed: %v", err)
	}
	if rm.GetActiveGame("p1") != roomID {
		t.Fatal("activeGameByPlayer should survive LeaveRoom")
	}
	if rm.GetPlayerRoom("p1") != "" {
		t.Fatal("playerToRoom should be cleared after LeaveRoom")
	}

	// RejoinRoom 成功
	ok, err := rm.RejoinRoom(p1, roomID)
	if err != nil || !ok {
		t.Fatalf("RejoinRoom failed: ok=%v err=%v", ok, err)
	}
	if rm.GetPlayerRoom("p1") != roomID {
		t.Fatal("playerToRoom should be rebuilt after RejoinRoom")
	}
	// 验证玩家重新出现在 r.Players 且 Connected=true
	found := false
	for _, p := range room.GetPlayers() {
		if p.ID == "p1" && p.Connected {
			found = true
		}
	}
	if !found {
		t.Fatal("rejoined player should be in r.Players with Connected=true")
	}
}

func TestRejoinRoom_RoomNotFound(t *testing.T) {
	rm := newTestRoomManager()
	p := newTestPlayer("p1", "Alice")
	_, err := rm.RejoinRoom(p, "nonexistent")
	if err != ErrRoomNotFound {
		t.Fatalf("expected ErrRoomNotFound, got %v", err)
	}
}

func TestRejoinRoom_PlayerEliminated(t *testing.T) {
	rm := newTestRoomManager()
	roomID := "test-rejoin-eliminated"
	room := rm.GetOrCreateRoom(roomID, 3)
	p1 := newTestPlayer("p1", "Alice")
	room.AddPlayer(p1)
	rm.playerToRoom["p1"] = roomID
	rm.SetActiveGame("p1", roomID)

	gs := &game.GameState{
		Players:         []game.Player{{ID: "p1", Eliminated: true}},
		CurrentPlayerID: "p1",
	}
	room.SetGameState(gs)

	// 模拟 30s 超时：LeaveRoom 移除 p1（但 activeGameByPlayer 保留）
	if err := rm.LeaveRoom("p1"); err != nil {
		t.Fatalf("LeaveRoom failed: %v", err)
	}

	_, err := rm.RejoinRoom(p1, roomID)
	if err != ErrPlayerEliminated {
		t.Fatalf("expected ErrPlayerEliminated, got %v", err)
	}
}

func TestRejoinRoom_PlayerNotInGame(t *testing.T) {
	rm := newTestRoomManager()
	roomID := "test-rejoin-notin"
	room := rm.GetOrCreateRoom(roomID, 3)
	p1 := newTestPlayer("p1", "Alice")
	p2 := newTestPlayer("p2", "Bob")
	room.AddPlayer(p1)
	rm.SetActiveGame("p2", roomID)

	gs := &game.GameState{
		Players:         []game.Player{{ID: "p1", Eliminated: false}},
		CurrentPlayerID: "p1",
	}
	room.SetGameState(gs)

	_, err := rm.RejoinRoom(p2, roomID)
	if err != ErrPlayerNotInGame {
		t.Fatalf("expected ErrPlayerNotInGame, got %v", err)
	}
}

// TestActiveGameByPlayer_Lifecycle：StartGame 写入 → LeaveRoom 保留 → RemoveRoom 清理
func TestActiveGameByPlayer_Lifecycle(t *testing.T) {
	rm := newTestRoomManager()
	roomID := "test-lifecycle"
	room := rm.GetOrCreateRoom(roomID, 2)
	p1 := newTestPlayer("p1", "Alice")
	p2 := newTestPlayer("p2", "Bob")
	room.AddPlayer(p1)
	room.AddPlayer(p2)

	// StartGame 写入索引（直接调用 SetActiveGame 模拟）
	rm.SetActiveGame("p1", roomID)
	rm.SetActiveGame("p2", roomID)
	if rm.GetActiveGame("p1") != roomID || rm.GetActiveGame("p2") != roomID {
		t.Fatal("SetActiveGame should write index for all players")
	}

	// LeaveRoom 不删除索引
	rm.LeaveRoom("p1")
	if rm.GetActiveGame("p1") != roomID {
		t.Fatal("activeGameByPlayer should survive LeaveRoom")
	}

	// RemoveRoom 删除该房间所有玩家索引
	rm.RemoveRoom(roomID)
	if rm.GetActiveGame("p1") != "" || rm.GetActiveGame("p2") != "" {
		t.Fatal("RemoveRoom should clear activeGameByPlayer for room's players")
	}
}

// TestGetActiveGameInfo_FinishedRoomReturnsNil：房间进入 Finished 状态后不推送
func TestGetActiveGameInfo_FinishedRoomReturnsNil(t *testing.T) {
	rm := newTestRoomManager()
	roomID := "test-finished"
	room := rm.GetOrCreateRoom(roomID, 2)
	p1 := newTestPlayer("p1", "Alice")
	room.AddPlayer(p1)
	rm.SetActiveGame("p1", roomID)

	gs := &game.GameState{
		Players:         []game.Player{{ID: "p1", Eliminated: false}},
		CurrentPlayerID: "p1",
	}
	room.SetGameState(gs)
	// 模拟游戏结束：将 State 改为 Finished
	room.mu.Lock()
	room.State = RoomStateFinished
	room.mu.Unlock()

	if rm.GetActiveGameInfo("p1") != nil {
		t.Fatal("GetActiveGameInfo should return nil for Finished room")
	}
}

// TestGetActiveGameInfo_EliminatedPlayerReturnsNil：已淘汰玩家不推送
func TestGetActiveGameInfo_EliminatedPlayerReturnsNil(t *testing.T) {
	rm := newTestRoomManager()
	roomID := "test-eliminated"
	room := rm.GetOrCreateRoom(roomID, 2)
	p1 := newTestPlayer("p1", "Alice")
	room.AddPlayer(p1)
	rm.SetActiveGame("p1", roomID)

	gs := &game.GameState{
		Players:         []game.Player{{ID: "p1", Eliminated: true}},
		CurrentPlayerID: "p1",
	}
	room.SetGameState(gs)

	if rm.GetActiveGameInfo("p1") != nil {
		t.Fatal("GetActiveGameInfo should return nil for eliminated player")
	}
}

// TestGetActiveGameInfo_NoActiveGameReturnsNil：无活跃对局时返回 nil
func TestGetActiveGameInfo_NoActiveGameReturnsNil(t *testing.T) {
	rm := newTestRoomManager()
	if rm.GetActiveGameInfo("nonexistent") != nil {
		t.Fatal("GetActiveGameInfo should return nil when no active game")
	}
}
