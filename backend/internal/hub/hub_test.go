package hub

import (
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
