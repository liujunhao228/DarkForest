package hub

import (
	"encoding/json"
	"testing"
)

// stubGameService 是 GameService 的测试桩，记录调用次数。
type stubGameService struct {
	handleActionCalls int
	requestSyncCalls  int
	ackStateCalls     int
}

func (s *stubGameService) HandleAction(_ string, _ string, _ json.RawMessage) error {
	s.handleActionCalls++
	return nil
}
func (s *stubGameService) RequestSync(_ string) error     { s.requestSyncCalls++; return nil }
func (s *stubGameService) HandleAckState(_ string, _ int) { s.ackStateCalls++ }

func TestGetClientByID(t *testing.T) {
	hub := setupTestHub(t)
	c := &Client{ID: "c-1", send: make(chan Message, 256)}

	hub.register <- c
	if got := pollStats(hub, "clients", 1, 50); got["clients"] != 1 {
		t.Fatalf("expected 1 client, got %d", got["clients"])
	}

	got, ok := hub.GetClientByID("c-1")
	if !ok || got != c {
		t.Fatalf("GetClientByID(c-1) = %v, %v; want same client, true", got, ok)
	}
	if _, ok := hub.GetClientByID("missing"); ok {
		t.Fatal("expected GetClientByID(missing) to be false")
	}
}

func TestObserverDoesNotOccupyPlayerSlot(t *testing.T) {
	hub := setupTestHub(t)
	obs := &Client{ID: "obs-1", send: make(chan Message, 256)}
	obs.SetObserver("target-player")

	// 观察者仅注册为普通 client，不应进入 h.players（不占玩家槽位）
	hub.register <- obs
	if got := pollStats(hub, "clients", 1, 50); got["clients"] != 1 {
		t.Fatalf("expected 1 client, got %d", got["clients"])
	}
	if got := hub.GetStats()["players"]; got != 0 {
		t.Fatalf("observer must not occupy a player slot, players=%d", got)
	}
}

func TestObserverRequestSyncRoutesToObserverStartSync(t *testing.T) {
	hub := setupTestHub(t)
	gs := &stubGameService{}
	hub.SetGameService(gs)

	var observerSyncCalls int
	hub.SetObserverStartSync(func(_ *Client) error { observerSyncCalls++; return nil })

	obs := &Client{ID: "obs-2", send: make(chan Message, 256)}
	obs.SetObserver("target-player")
	hub.register <- obs
	if got := pollStats(hub, "clients", 1, 50); got["clients"] != 1 {
		t.Fatalf("expected 1 client, got %d", got["clients"])
	}

	hub.routeMessage(obs, Message{Type: string(EvtGameRequestSync)})

	if observerSyncCalls == 0 {
		t.Fatal("expected observerStartSync to be called for observer requestSync")
	}
	if gs.requestSyncCalls != 0 {
		t.Fatal("expected gameService.RequestSync NOT to be called for observer")
	}
}

func TestObserverGameActionBlocked(t *testing.T) {
	hub := setupTestHub(t)
	gs := &stubGameService{}
	hub.SetGameService(gs)

	obs := &Client{ID: "obs-3", send: make(chan Message, 256)}
	obs.SetObserver("target-player")
	hub.register <- obs
	if got := pollStats(hub, "clients", 1, 50); got["clients"] != 1 {
		t.Fatalf("expected 1 client, got %d", got["clients"])
	}

	// 观察者发送 game 动作应被拒绝，且不落到底层 gameService
	hub.routeMessage(obs, Message{Type: string(EvtGameAction), Payload: json.RawMessage(`{"action":"playCard"}`)})

	if gs.handleActionCalls != 0 {
		t.Fatal("expected observer game action to be blocked")
	}
	// 观察者应收到一条 game:error（OBSERVER_READONLY）
	select {
	case msg := <-obs.send:
		if msg.Type != string(EvtSrvGameError) {
			t.Fatalf("expected game:error, got %s", msg.Type)
		}
	default:
		t.Fatal("expected observer to receive a game:error")
	}
}
