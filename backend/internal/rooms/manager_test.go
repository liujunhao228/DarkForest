package rooms

import (
	"log/slog"
	"testing"
	"time"

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

// TestFinishFinishedRoom_CleansPlayerLifecycle：对局结束后清理 playerToRoom
// 与 client 房间索引,使玩家可立即重新排队(连续对局)。
func TestFinishFinishedRoom_CleansPlayerLifecycle(t *testing.T) {
	rm := newTestRoomManager()
	go rm.hub.Run()
	roomID := "test-finish-cleanup"
	room := rm.GetOrCreateRoom(roomID, 2)

	// 房内玩家 + hub client(模拟已连接并加入房间)
	p1 := newTestPlayer("p1", "Alice")
	p2 := newTestPlayer("p2", "Bob")
	room.AddPlayer(p1)
	room.AddPlayer(p2)
	rm.playerToRoom["p1"] = roomID
	rm.playerToRoom["p2"] = roomID
	rm.SetActiveGame("p1", roomID)
	rm.SetActiveGame("p2", roomID)

	c1 := hub.NewTestClient("c1", "p1", "Alice", true)
	c2 := hub.NewTestClient("c2", "p2", "Bob", true)
	rm.hub.RegisterClient(c1)
	rm.hub.RegisterClient(c2)
	waitHubClients(t, rm.hub, 2)
	rm.hub.AddClientToRoom(c1.ID, roomID)
	rm.hub.AddClientToRoom(c2.ID, roomID)
	if c1.GetRoom() != roomID || c2.GetRoom() != roomID {
		t.Fatalf("前置条件失败: c1=%q c2=%q, want %q", c1.GetRoom(), c2.GetRoom(), roomID)
	}

	rm.finishFinishedRoom(roomID)

	// playerToRoom 全部清除
	if rm.GetPlayerRoom("p1") != "" || rm.GetPlayerRoom("p2") != "" {
		t.Fatalf("playerToRoom 未清除: p1=%q p2=%q", rm.GetPlayerRoom("p1"), rm.GetPlayerRoom("p2"))
	}
	// client 房间索引清除(JoinQueue 检查放行)
	if c1.GetRoom() != "" || c2.GetRoom() != "" {
		t.Fatalf("client 房间索引未清除: c1=%q c2=%q", c1.GetRoom(), c2.GetRoom())
	}
	// activeGameByPlayer 由调用方(onGameFinish)负责清除,本方法不动
	if rm.GetActiveGame("p1") != roomID {
		t.Fatal("finishFinishedRoom 不应清除 activeGameByPlayer")
	}
}

// TestFinishFinishedRoom_KeepsOtherRoomMapping：终局清理不得误清新房间映射
// (玩家已在极短时间内进入新房间)。
func TestFinishFinishedRoom_KeepsOtherRoomMapping(t *testing.T) {
	rm := newTestRoomManager()
	go rm.hub.Run()
	oldRoom := "test-old-room"
	newRoom := "test-new-room"
	room := rm.GetOrCreateRoom(oldRoom, 2)
	p1 := newTestPlayer("p1", "Alice")
	room.AddPlayer(p1)
	rm.playerToRoom["p1"] = oldRoom

	c1 := hub.NewTestClient("c1", "p1", "Alice", true)
	rm.hub.RegisterClient(c1)
	waitHubClients(t, rm.hub, 1)
	rm.hub.AddClientToRoom(c1.ID, oldRoom)

	// 玩家已进入新房间:playerToRoom 与 client.roomID 均指向新房间
	rm.playerToRoom["p1"] = newRoom
	rm.hub.AddClientToRoom(c1.ID, newRoom)
	if c1.GetRoom() != newRoom {
		t.Fatalf("前置条件失败: client.GetRoom() = %q, want %q", c1.GetRoom(), newRoom)
	}

	rm.finishFinishedRoom(oldRoom)

	if rm.GetPlayerRoom("p1") != newRoom {
		t.Fatalf("playerToRoom = %q, want 保留新房间 %q", rm.GetPlayerRoom("p1"), newRoom)
	}
	if c1.GetRoom() != newRoom {
		t.Fatalf("client.GetRoom() = %q, want 保留新房间 %q", c1.GetRoom(), newRoom)
	}
}

// waitHubClients 轮询等待 hub.clients 数量达到 expected(hub.Run 异步处理注册)。
func waitHubClients(t *testing.T, h *hub.Hub, expected int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if h.GetStats()["clients"] >= expected {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("hub.clients 未达到 %d", expected)
}
