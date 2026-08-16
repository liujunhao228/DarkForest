package rooms

import (
	"encoding/json"
	"log/slog"
	"sync"
	"testing"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
)

// TestRoom_ObserverReceivesTargetPrivateView 验证：room 中目标玩家的私有
// ViewState 也会被转发给观察者（旁观者），且不泄露其他玩家的私有状态。
func TestRoom_ObserverReceivesTargetPrivateView(t *testing.T) {
	type recvMsg struct {
		clientID string
		msg      hub.Message
	}
	var mu sync.Mutex
	var obsSent []recvMsg

	room := NewRoom(
		"test-obs",
		2,
		func(roomID string, msg hub.Message) {},
		func(playerID string, msg hub.Message) {},
		nil,
		slog.Default(),
		nil,
	)
	room.SetObserverSender(func(clientID string, msg hub.Message) {
		mu.Lock()
		obsSent = append(obsSent, recvMsg{clientID: clientID, msg: msg})
		mu.Unlock()
	})

	room.AddPlayer(&hub.PlayerInfo{ID: "p1", DisplayName: "Alice", Role: "player"})
	room.AddPlayer(&hub.PlayerInfo{ID: "p2", DisplayName: "Bob", Role: "player"})
	if !room.StartGame("test", "") {
		t.Fatal("StartGame failed")
	}

	// 观察者只观察 p1
	room.AddObserver("p1", "obs-1")

	room.BroadcastGameState()

	mu.Lock()
	defer mu.Unlock()
	if len(obsSent) == 0 {
		t.Fatal("expected observer to receive a fullSync")
	}
	for _, r := range obsSent {
		if r.clientID != "obs-1" {
			t.Fatalf("unexpected observer client %q", r.clientID)
		}
		var payload struct {
			State *game.ViewState `json:"state"`
		}
		if err := json.Unmarshal(r.msg.Payload, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		if payload.State == nil {
			t.Fatal("expected non-nil ViewState in observer fullSync")
		}
		if payload.State.ViewMeta.Role != game.ViewRolePlayer {
			t.Fatalf("observer view role = %v, want ViewRolePlayer", payload.State.ViewMeta.Role)
		}
		if payload.State.ViewMeta.ViewerID != "p1" {
			t.Fatalf("observer view viewerId = %q, want p1", payload.State.ViewMeta.ViewerID)
		}
	}
}

// TestRoom_RemoveObserver 验证 RemoveObserver 后不再转发。
func TestRoom_RemoveObserver(t *testing.T) {
	var mu sync.Mutex
	var obsSent []int
	room := NewRoom(
		"test-obs-rm",
		2,
		func(roomID string, msg hub.Message) {},
		func(playerID string, msg hub.Message) {},
		nil,
		slog.Default(),
		nil,
	)
	room.SetObserverSender(func(clientID string, msg hub.Message) {
		mu.Lock()
		obsSent = append(obsSent, 1)
		mu.Unlock()
	})
	room.AddObserver("p1", "obs-1")
	room.RemoveObserver("p1", "obs-1")

	room.BroadcastGameState()
	_ = room

	mu.Lock()
	defer mu.Unlock()
	if len(obsSent) != 0 {
		t.Fatalf("expected no observer broadcast after RemoveObserver, got %d", len(obsSent))
	}
}
