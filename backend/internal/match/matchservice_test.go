package match

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// mockRow 实现 pgx.Row，用于在测试中模拟单行扫描结果。
type mockRow struct {
	scanFn func(dest ...interface{}) error
}

func (m *mockRow) Scan(dest ...interface{}) error {
	if m.scanFn != nil {
		return m.scanFn(dest...)
	}
	return nil
}

// mockDBTX 实现 db.DBTX，用于跟踪 Exec/QueryRow 调用。
// 在敏感词校验测试中，仅 GetPlayerByID 需要成功返回一个空 Player；
// 任何写操作（Exec）都不应被调用——若被调用说明校验未生效。
type mockDBTX struct {
	execSQLs []string
}

func (m *mockDBTX) Exec(_ context.Context, sql string, _ ...interface{}) (pgconn.CommandTag, error) {
	m.execSQLs = append(m.execSQLs, sql)
	return pgconn.CommandTag{}, nil
}

func (m *mockDBTX) Query(_ context.Context, _ string, _ ...interface{}) (pgx.Rows, error) {
	return nil, errors.New("mockDBTX.Query not expected")
}

func (m *mockDBTX) QueryRow(_ context.Context, sql string, _ ...interface{}) pgx.Row {
	// GetPlayerByID 的 SQL 包含 "FROM players" 与 "WHERE id = $1"。
	// 返回成功扫描的空 Player（字段零值即可，测试路径不使用具体字段）。
	if strings.Contains(sql, "FROM players") && strings.Contains(sql, "WHERE id = $1") {
		return &mockRow{}
	}
	return &mockRow{scanFn: func(_ ...interface{}) error { return errors.New("mockDBTX.QueryRow: no rows") }}
}

// TestMatchService_CreateCustomQueue_QueueNameContainsSensitive_Rejected 验证
// 当队列名包含敏感词时，CreateCustomQueue 在写入 DB 前即被拒绝。
func TestMatchService_CreateCustomQueue_QueueNameContainsSensitive_Rejected(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))

	mock := &mockDBTX{}
	service := &MatchService{
		queries: db.New(mock),
		logger:  logger,
	}

	playerID := uuid.New().String()
	result, err := service.CreateCustomQueue(context.Background(), CreateCustomQueueParams{
		QueueName:  "badword队列",
		MinPlayers: 3,
		MaxPlayers: 5,
		PlayerID:   playerID,
	})
	if err != nil {
		t.Fatalf("CreateCustomQueue 返回了未预期的 error: %v", err)
	}
	if result.Success {
		t.Errorf("期望 Success=false，实际 Success=true")
	}
	if result.Error != "队列名包含违规内容" {
		t.Errorf("期望 Error='队列名包含违规内容'，实际 Error=%q", result.Error)
	}

	// 断言未发生 DB 写入：CreateCustomMatchQueue 不应被调用
	for _, sql := range mock.execSQLs {
		if strings.Contains(sql, "custom_match_queues") {
			t.Errorf("期望未发生 DB 写入，但 Exec 被调用，SQL: %s", sql)
		}
	}
}
