package match

import (
	"log/slog"
	"os"
	"testing"
	"time"
)

func TestGenerateRoomCode(t *testing.T) {
	code1 := generateRoomCode()
	code2 := generateRoomCode()

	if len(code1) != 6 {
		t.Errorf("Room code should be 6 characters, got %d", len(code1))
	}

	if len(code2) != 6 {
		t.Errorf("Room code should be 6 characters, got %d", len(code2))
	}

	if code1 == code2 {
		t.Error("Two generated codes should not be equal")
	}

	chars := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for _, c := range code1 {
		if !containsChar(chars, c) {
			t.Errorf("Invalid character in room code: %c", c)
		}
	}
}

func containsChar(s string, c rune) bool {
	for _, r := range s {
		if r == c {
			return true
		}
	}
	return false
}

func TestShuffleInts(t *testing.T) {
	original := []int{1, 2, 3, 4, 5, 6, 7, 8, 9}
	shuffled := shuffleInts(original)

	if len(shuffled) != len(original) {
		t.Errorf("Shuffled array should have same length")
	}

	for _, v := range original {
		found := false
		for _, s := range shuffled {
			if s == v {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Missing value %d in shuffled array", v)
		}
	}
}

func TestMatchServiceLifecycle(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))

	// Create a mock service (we can't test DB operations without actual database)
	service := &MatchService{
		logger:  logger,
		quit:    make(chan struct{}),
		running: false,
	}

	// Test Start/Stop
	service.Start()
	if !service.running {
		t.Error("Service should be running after Start()")
	}

	service.Stop()
	if service.running {
		t.Error("Service should not be running after Stop()")
	}
}

func TestQueueStatus(t *testing.T) {
	status := &QueueStatus{InQueue: true, Position: 1}

	if !status.InQueue {
		t.Error("QueueStatus should be in queue")
	}
	if status.Position != 1 {
		t.Errorf("Position should be 1, got %d", status.Position)
	}

	emptyStatus := &QueueStatus{InQueue: false}
	if emptyStatus.InQueue {
		t.Error("QueueStatus should not be in queue")
	}
}

func TestMatchInfo(t *testing.T) {
	players := []MatchPlayerInfo{
		{PlayerID: "player-1", DisplayName: "Player1", IsHost: true, PlayerNumber: 0, Position: 1},
		{PlayerID: "player-2", DisplayName: "Player2", IsHost: false, PlayerNumber: 1, Position: 2},
	}

	match := &MatchInfo{
		ID:       "match-123",
		RoomCode: "ABC123",
		HostID:   "player-1",
		Players:  players,
	}

	if match.ID != "match-123" {
		t.Errorf("Match ID should be 'match-123', got '%s'", match.ID)
	}

	if match.RoomCode != "ABC123" {
		t.Errorf("RoomCode should be 'ABC123', got '%s'", match.RoomCode)
	}

	if len(match.Players) != 2 {
		t.Errorf("Should have 2 players, got %d", len(match.Players))
	}
}

func TestMatchResult(t *testing.T) {
	successResult := &MatchResult{Success: true}
	if !successResult.Success {
		t.Error("MatchResult should be successful")
	}

	errorResult := &MatchResult{Success: false, Error: "test error"}
	if errorResult.Success {
		t.Error("MatchResult should be unsuccessful")
	}
	if errorResult.Error != "test error" {
		t.Errorf("Error should be 'test error', got '%s'", errorResult.Error)
	}
}

func TestMatchPlayerInfo(t *testing.T) {
	player := MatchPlayerInfo{
		PlayerID:     "player-1",
		DisplayName:  "TestPlayer",
		IsHost:       true,
		PlayerNumber: 0,
		Position:     1,
	}

	if player.PlayerID != "player-1" {
		t.Errorf("PlayerID should be 'player-1', got '%s'", player.PlayerID)
	}

	if player.DisplayName != "TestPlayer" {
		t.Errorf("DisplayName should be 'TestPlayer', got '%s'", player.DisplayName)
	}

	if !player.IsHost {
		t.Error("IsHost should be true")
	}
}

func TestFindMatchesResult(t *testing.T) {
	result := &FindMatchesResult{Matches: [][]string{{"p1", "p2", "p3"}}}

	if len(result.Matches) != 1 {
		t.Errorf("Should have 1 match, got %d", len(result.Matches))
	}

	if len(result.Matches[0]) != 3 {
		t.Errorf("Match should have 3 players, got %d", len(result.Matches[0]))
	}
}

func TestMatchCheckInterval(t *testing.T) {
	if MatchCheckInterval != 5*time.Second {
		t.Errorf("MatchCheckInterval should be 5s, got %v", MatchCheckInterval)
	}
}
