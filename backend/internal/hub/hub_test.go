package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"testing"
	"time"
)

func setupTestHub(t *testing.T) *Hub {
	t.Helper()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	hub := NewHub(logger)
	go hub.Run()
	return hub
}

func TestNewHub(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	hub := NewHub(logger)

	if hub == nil {
		t.Fatal("NewHub returned nil")
	}

	stats := hub.GetStats()
	if stats["clients"] != 0 || stats["players"] != 0 || stats["rooms"] != 0 {
		t.Errorf("Expected empty stats, got %+v", stats)
	}
}

func TestHubRegisterAndUnregister(t *testing.T) {
	hub := setupTestHub(t)

	client := &Client{
		ID:            "test-client-1",
		PlayerID:      "player-123",
		UserID:        "user-456",
		DisplayName:   "TestPlayer",
		Role:          "player",
		Authenticated: true,
		send:          make(chan Message, 256),
	}

	hub.register <- client

	// Give hub time to process
	stats := pollStats(hub, "clients", 1, 50)
	if stats["clients"] != 1 {
		t.Errorf("Expected 1 client, got %d", stats["clients"])
	}

	hub.unregister <- client
	stats = pollStats(hub, "clients", 0, 50)
	if stats["clients"] != 0 {
		t.Errorf("Expected 0 clients after unregister, got %d", stats["clients"])
	}
}

func TestClientRoomManagement(t *testing.T) {
	hub := setupTestHub(t)

	client := &Client{
		ID:            "test-client-room",
		PlayerID:      "player-room-1",
		UserID:        "user-room-1",
		DisplayName:   "RoomPlayer",
		Role:          "player",
		Authenticated: true,
		send:          make(chan Message, 256),
	}

	hub.register <- client

	// Wait for registration
	pollStats(hub, "clients", 1, 50)

	hub.AddClientToRoom("test-client-room", "room-1")

	if client.GetRoom() != "room-1" {
		t.Errorf("Expected room to be 'room-1', got '%s'", client.GetRoom())
	}

	hub.RemoveClientFromRoom("test-client-room", "room-1")

	if client.GetRoom() != "" {
		t.Errorf("Expected room to be empty, got '%s'", client.GetRoom())
	}
}

func TestClientSend(t *testing.T) {
	hub := setupTestHub(t)

	client := &Client{
		ID:            "test-client-send",
		PlayerID:      "player-send-1",
		Authenticated: true,
		hub:           hub,
		send:          make(chan Message, 256),
	}

	msg := Message{
		Type:    string(EvtSrvMatchQueueJoined),
		Payload: json.RawMessage(`{"success":true}`),
	}

	client.Send(msg)

	select {
	case received := <-client.send:
		if received.Type != msg.Type {
			t.Errorf("Expected message type '%s', got '%s'", msg.Type, received.Type)
		}
	default:
		t.Error("Expected message in send channel, got none")
	}
}

func TestGenerateClientID(t *testing.T) {
	id1 := generateClientID()
	id2 := generateClientID()

	if id1 == "" || id2 == "" {
		t.Error("Generated client ID should not be empty")
	}

	if id1 == id2 {
		t.Error("Two generated IDs should not be equal")
	}
}

func TestProtocolVersion(t *testing.T) {
	if ProtocolVersion == "" {
		t.Error("Protocol version should not be empty")
	}
}

func TestClientSendError(t *testing.T) {
	hub := setupTestHub(t)

	client := &Client{
		ID:            "test-client-error",
		PlayerID:      "player-error-1",
		Authenticated: true,
		hub:           hub,
		send:          make(chan Message, 256),
	}

	client.SendError("TEST_ERROR", "Test error message")

	select {
	case received := <-client.send:
		if received.Type != string(EvtSrvMatchError) {
			t.Errorf("Expected error message type '%s', got '%s'", EvtSrvMatchError, received.Type)
		}
	default:
		t.Error("Expected error message in send channel, got none")
	}
}

// pollStats polls hub stats until expected count is met or timeout
func pollStats(hub *Hub, key string, expected, maxAttempts int) map[string]int {
	for i := 0; i < maxAttempts; i++ {
		stats := hub.GetStats()
		if stats[key] == expected {
			return stats
		}
		// Small sleep to allow hub goroutine to process messages
		time.Sleep(1 * time.Millisecond)
	}
	return hub.GetStats()
}

// TestReconnectionRaceCondition verifies that when a player disconnects and
// quickly reconnects, the old client's unregister does NOT remove the player
// from the players map (which would cause GetClientByPlayerID to return false
// and trigger spurious "有玩家未连接" errors in roomCreator).
func TestReconnectionRaceCondition(t *testing.T) {
	hub := setupTestHub(t)

	const playerID = "player-reconnect-1"

	// Initial connection
	oldClient := &Client{
		ID:            "old-conn",
		PlayerID:      playerID,
		DisplayName:   "ReconnectPlayer",
		Authenticated: true,
		send:          make(chan Message, 256),
	}
	hub.register <- oldClient
	pollStats(hub, "clients", 1, 50)

	// Verify player is registered
	if _, ok := hub.GetClientByPlayerID(playerID); !ok {
		t.Fatal("expected player to be registered after initial connect")
	}

	// Player reconnects with a new connection BEFORE the old one is unregistered.
	// This simulates the race: register(new) happens before unregister(old).
	newClient := &Client{
		ID:            "new-conn",
		PlayerID:      playerID,
		DisplayName:   "ReconnectPlayer",
		Authenticated: true,
		send:          make(chan Message, 256),
	}
	hub.register <- newClient
	pollStats(hub, "clients", 2, 50)

	// Now process the old client's unregister (the delayed disconnect)
	hub.unregister <- oldClient
	pollStats(hub, "clients", 1, 50)

	// The player should still be registered, pointing to the new client.
	current, ok := hub.GetClientByPlayerID(playerID)
	if !ok {
		t.Fatal("expected player to still be registered after old client unregister (reconnection race)")
	}
	if current.ID != "new-conn" {
		t.Errorf("expected current client to be 'new-conn', got '%s'", current.ID)
	}
}

// TestUnregisterWithoutReconnect verifies the normal (non-race) disconnect
// still correctly removes the player from the players map.
func TestUnregisterWithoutReconnect(t *testing.T) {
	hub := setupTestHub(t)

	const playerID = "player-normal-1"

	client := &Client{
		ID:            "conn-1",
		PlayerID:      playerID,
		DisplayName:   "NormalPlayer",
		Authenticated: true,
		send:          make(chan Message, 256),
	}
	hub.register <- client
	pollStats(hub, "clients", 1, 50)

	if _, ok := hub.GetClientByPlayerID(playerID); !ok {
		t.Fatal("expected player to be registered")
	}

	hub.unregister <- client
	pollStats(hub, "clients", 0, 50)

	// Player should be removed since there was no reconnection
	if _, ok := hub.GetClientByPlayerID(playerID); ok {
		t.Fatal("expected player to be removed after disconnect (no reconnection)")
	}
}

// --- 对局结束后重新排队(match:joinQueue 对 finished/陈旧房间宽容) ---

// fakeRoomService 仅实现 handleMatchJoinQueue 用到的 RoomService 方法。
type fakeRoomService struct {
	RoomService
	playerRoom map[string]string
	roomStates map[string]string
	left       []string
}

func (f *fakeRoomService) GetPlayerRoom(playerID string) string { return f.playerRoom[playerID] }
func (f *fakeRoomService) GetRoomState(roomID string) string    { return f.roomStates[roomID] }
func (f *fakeRoomService) LeaveRoom(playerID string) error {
	f.left = append(f.left, playerID)
	delete(f.playerRoom, playerID)
	return nil
}

// fakeMatchService 仅实现 handleMatchJoinQueue 用到的 MatchService 方法。
type fakeMatchService struct {
	MatchService
	joined []string
}

func (f *fakeMatchService) JoinQueue(_ context.Context, player *PlayerInfo, _ int, _ string) error {
	f.joined = append(f.joined, player.ID)
	return nil
}
func (f *fakeMatchService) GetQueueStatus(context.Context, string) (*QueueStatus, error) {
	return &QueueStatus{InQueue: false}, nil
}
func (f *fakeMatchService) FindMatches(context.Context) (*FindMatchesResult, error) {
	return &FindMatchesResult{Matches: [][]string{}}, nil
}

// TestMatchJoinQueue_FinishedRoomAllowed 验证:客户端所在房间已结束(finished)
// 时,重新排队会被放行并自动清理陈旧房间索引。
func TestMatchJoinQueue_FinishedRoomAllowed(t *testing.T) {
	hub := setupTestHub(t)

	const playerID = "player-finished-1"
	client := &Client{
		ID:            "conn-finished",
		PlayerID:      playerID,
		DisplayName:   "FinishedPlayer",
		Authenticated: true,
		send:          make(chan Message, 256),
	}
	hub.register <- client
	pollStats(hub, "clients", 1, 50)

	// 玩家在已结束的房间中(终局清理未及时执行的兜底场景)
	hub.AddClientToRoom(client.ID, "room-finished")
	roomSvc := &fakeRoomService{
		playerRoom: map[string]string{playerID: "room-finished"},
		roomStates: map[string]string{"room-finished": "finished"},
	}
	matchSvc := &fakeMatchService{}
	hub.SetRoomService(roomSvc)
	hub.SetMatchService(matchSvc)

	payload, _ := json.Marshal(MatchmakingRequest{PreferredCount: 2})
	hub.routeMessage(client, Message{Type: string(EvtMatchJoinQueue), Payload: payload})

	// 客户端房间索引被清理,可继续排队
	if client.GetRoom() != "" {
		t.Fatalf("GetRoom() = %q, want 空(finished 房间成员关系应被清理)", client.GetRoom())
	}
	if len(matchSvc.joined) != 1 || matchSvc.joined[0] != playerID {
		t.Fatalf("joined = %v, want [%s](应放行入队)", matchSvc.joined, playerID)
	}
	if len(roomSvc.left) != 1 || roomSvc.left[0] != playerID {
		t.Fatalf("LeaveRoom 调用 = %v, want [%s]", roomSvc.left, playerID)
	}
	// 不应收到错误消息
	select {
	case m := <-client.send:
		if m.Type == string(EvtSrvMatchError) {
			t.Fatalf("收到不应出现的错误消息: %s", m.Payload)
		}
	default:
	}
}

// TestMatchJoinQueue_ActiveRoomRejected 验证:客户端所在房间仍在进行(playing)
// 时,重新排队被拒绝,且不清理成员关系。
func TestMatchJoinQueue_ActiveRoomRejected(t *testing.T) {
	hub := setupTestHub(t)

	const playerID = "player-active-1"
	client := &Client{
		ID:            "conn-active",
		PlayerID:      playerID,
		DisplayName:   "ActivePlayer",
		Authenticated: true,
		send:          make(chan Message, 256),
	}
	hub.register <- client
	pollStats(hub, "clients", 1, 50)

	hub.AddClientToRoom(client.ID, "room-active")
	roomSvc := &fakeRoomService{
		playerRoom: map[string]string{playerID: "room-active"},
		roomStates: map[string]string{"room-active": "playing"},
	}
	matchSvc := &fakeMatchService{}
	hub.SetRoomService(roomSvc)
	hub.SetMatchService(matchSvc)

	payload, _ := json.Marshal(MatchmakingRequest{PreferredCount: 2})
	hub.routeMessage(client, Message{Type: string(EvtMatchJoinQueue), Payload: payload})

	// 活跃房间:不清理、不入队、收到错误
	if client.GetRoom() != "room-active" {
		t.Fatalf("GetRoom() = %q, want 保留 room-active", client.GetRoom())
	}
	if len(matchSvc.joined) != 0 {
		t.Fatalf("joined = %v, want 空(活跃房间应拒绝)", matchSvc.joined)
	}
	select {
	case m := <-client.send:
		if m.Type != string(EvtSrvMatchError) {
			t.Fatalf("消息类型 = %q, want %q", m.Type, EvtSrvMatchError)
		}
	case <-time.After(time.Second):
		t.Fatal("未收到拒绝错误消息")
	}
}

// TestMatchJoinQueue_StaleRoomAllowed 验证:client.roomID 残留但 playerToRoom
// 已清除(断连超时被移出房间)时,重新排队放行并清理 client 侧索引。
func TestMatchJoinQueue_StaleRoomAllowed(t *testing.T) {
	hub := setupTestHub(t)

	const playerID = "player-stale-1"
	client := &Client{
		ID:            "conn-stale",
		PlayerID:      playerID,
		DisplayName:   "StalePlayer",
		Authenticated: true,
		send:          make(chan Message, 256),
	}
	hub.register <- client
	pollStats(hub, "clients", 1, 50)

	// client 侧残留 roomID,但 playerToRoom 已被断连超时清除
	hub.AddClientToRoom(client.ID, "room-stale")
	roomSvc := &fakeRoomService{
		playerRoom: map[string]string{}, // 玩家已不在房间
		roomStates: map[string]string{"room-stale": "playing"},
	}
	matchSvc := &fakeMatchService{}
	hub.SetRoomService(roomSvc)
	hub.SetMatchService(matchSvc)

	payload, _ := json.Marshal(MatchmakingRequest{PreferredCount: 2})
	hub.routeMessage(client, Message{Type: string(EvtMatchJoinQueue), Payload: payload})

	if client.GetRoom() != "" {
		t.Fatalf("GetRoom() = %q, want 空(stale 成员关系应被清理)", client.GetRoom())
	}
	if len(matchSvc.joined) != 1 {
		t.Fatalf("joined = %v, want 放行", matchSvc.joined)
	}
	// playerToRoom 已空,不应再触发 LeaveRoom
	if len(roomSvc.left) != 0 {
		t.Fatalf("LeaveRoom 调用 = %v, want 空(玩家已不在房间)", roomSvc.left)
	}
}
