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
		ID:          "test-client-1",
		PlayerID:    "player-123",
		UserID:      "user-456",
		DisplayName: "TestPlayer",
		Role:        "player",
		Authenticated: true,
		send:        make(chan Message, 256),
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
		ID:          "test-client-room",
		PlayerID:    "player-room-1",
		UserID:      "user-room-1",
		DisplayName: "RoomPlayer",
		Role:        "player",
		Authenticated: true,
		send:        make(chan Message, 256),
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
		Type: string(EvtSrvMatchQueueJoined),
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
