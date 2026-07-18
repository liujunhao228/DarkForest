package match

import (
	"context"
	"encoding/json"
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
	"github.com/jackc/pgx/v5/pgtype"
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

// makeQueuePlayer 生成一个测试用玩家 UUID 字符串与对应的 MatchmakingQueue 条目。
// 返回的 pid 字符串与 MatchmakingQueue.PlayerID 的 uuidString() 输出一致，
// 便于在测试中作为 playerModes map 的 key。
func makeQueuePlayer(t *testing.T, preferredCount int32) (string, db.MatchmakingQueue) {
	t.Helper()
	id := uuid.New()
	pid := id.String()
	return pid, db.MatchmakingQueue{
		ID:             pgtype.UUID{Bytes: id, Valid: true},
		PlayerID:       pgtype.UUID{Bytes: id, Valid: true},
		PreferredCount: preferredCount,
	}
}

// modeLookupFromMap 返回一个基于 map 的 getGameMode 闭包，用于测试
// findMatchesFromQueues 而无需依赖 MatchService / playerModes。
func modeLookupFromMap(modes map[string]string) func(string) string {
	return func(pid string) string { return modes[pid] }
}

// TestFindMatchesFromQueues_SameModeSameCount_Matches 验证：
// 4 个 classic 玩家（空串 gameMode），PreferredCount=4 → 应产生 1 个 4 人对局。
// 这是基本的同模式同 count 匹配用例，确保新分组键不破坏原有按 PreferredCount 分组的行为。
func TestFindMatchesFromQueues_SameModeSameCount_Matches(t *testing.T) {
	p1, q1 := makeQueuePlayer(t, 4)
	p2, q2 := makeQueuePlayer(t, 4)
	p3, q3 := makeQueuePlayer(t, 4)
	p4, q4 := makeQueuePlayer(t, 4)

	// 全部 classic（空串，与 game.GameModeClassic 等价）
	modes := map[string]string{p1: "", p2: "", p3: "", p4: ""}

	queues := []db.MatchmakingQueue{q1, q2, q3, q4}
	matches := findMatchesFromQueues(queues, modeLookupFromMap(modes))

	if len(matches) != 1 {
		t.Fatalf("期望 1 个匹配，实际 %d", len(matches))
	}
	if len(matches[0]) != 4 {
		t.Fatalf("期望匹配 4 个玩家，实际 %d", len(matches[0]))
	}

	matched := make(map[string]bool, len(matches[0]))
	for _, pid := range matches[0] {
		matched[pid] = true
	}
	for _, p := range []string{p1, p2, p3, p4} {
		if !matched[p] {
			t.Errorf("玩家 %s 应被匹配", p)
		}
	}
}

// TestFindMatchesFromQueues_ExplicitRelicsSameCount_Matches 验证：
// 4 个 civilization_relics 玩家，PreferredCount=4 → 应产生 1 个 4 人对局。
// 确保 gameMode 非空串时同模式仍能匹配。
func TestFindMatchesFromQueues_ExplicitRelicsSameCount_Matches(t *testing.T) {
	p1, q1 := makeQueuePlayer(t, 4)
	p2, q2 := makeQueuePlayer(t, 4)
	p3, q3 := makeQueuePlayer(t, 4)
	p4, q4 := makeQueuePlayer(t, 4)

	const relics = "civilization_relics"
	modes := map[string]string{p1: relics, p2: relics, p3: relics, p4: relics}

	queues := []db.MatchmakingQueue{q1, q2, q3, q4}
	matches := findMatchesFromQueues(queues, modeLookupFromMap(modes))

	if len(matches) != 1 {
		t.Fatalf("期望 1 个匹配，实际 %d", len(matches))
	}
	if len(matches[0]) != 4 {
		t.Fatalf("期望匹配 4 个玩家，实际 %d", len(matches[0]))
	}
}

// TestFindMatchesFromQueues_CrossModeSameCount_NoMatch 验证：
// 2 个 classic + 2 个 civilization_relics，PreferredCount 均为 4 → 不应产生匹配。
// 这是 Task 8 修复的核心 bug 场景：跨模式混排。
func TestFindMatchesFromQueues_CrossModeSameCount_NoMatch(t *testing.T) {
	p1, q1 := makeQueuePlayer(t, 4)
	p2, q2 := makeQueuePlayer(t, 4)
	p3, q3 := makeQueuePlayer(t, 4)
	p4, q4 := makeQueuePlayer(t, 4)

	const relics = "civilization_relics"
	modes := map[string]string{
		p1: "",     // classic
		p2: "",     // classic
		p3: relics, // civilization_relics
		p4: relics, // civilization_relics
	}

	queues := []db.MatchmakingQueue{q1, q2, q3, q4}
	matches := findMatchesFromQueues(queues, modeLookupFromMap(modes))

	if len(matches) != 0 {
		t.Fatalf("期望 0 个匹配（跨模式不应匹配），实际 %d: %v", len(matches), matches)
	}
}

// TestFindMatchesFromQueues_SameModeDifferentCount_NoMatch 验证：
// 2 个 classic（count=3）+ 2 个 classic（count=4）→ 不应产生匹配。
// 确保新分组键仍保留原有"同 count 才匹配"的行为。
func TestFindMatchesFromQueues_SameModeDifferentCount_NoMatch(t *testing.T) {
	p1, q1 := makeQueuePlayer(t, 3)
	p2, q2 := makeQueuePlayer(t, 3)
	p3, q3 := makeQueuePlayer(t, 4)
	p4, q4 := makeQueuePlayer(t, 4)

	modes := map[string]string{p1: "", p2: "", p3: "", p4: ""}

	queues := []db.MatchmakingQueue{q1, q2, q3, q4}
	matches := findMatchesFromQueues(queues, modeLookupFromMap(modes))

	if len(matches) != 0 {
		t.Fatalf("期望 0 个匹配（同模式不同 count 不应匹配），实际 %d: %v", len(matches), matches)
	}
}

// TestFindMatchesFromQueues_MixedGroups_OnlyEligibleMatched 验证混合场景：
//   - 4 个 classic（count=4）→ 应匹配（1 个对局）
//   - 2 个 civilization_relics（count=4）→ 不应匹配（人数不足）
//   - 2 个 classic（count=3）→ 不应匹配（人数不足）
//
// 最终应仅产生 1 个 4 人 classic 对局，且对局中不含跨模式或不同 count 的玩家。
func TestFindMatchesFromQueues_MixedGroups_OnlyEligibleMatched(t *testing.T) {
	cp1, cq1 := makeQueuePlayer(t, 4)
	cp2, cq2 := makeQueuePlayer(t, 4)
	cp3, cq3 := makeQueuePlayer(t, 4)
	cp4, cq4 := makeQueuePlayer(t, 4)

	rp1, rq1 := makeQueuePlayer(t, 4)
	rp2, rq2 := makeQueuePlayer(t, 4)

	// 2 个 classic count=3（人数 < 3，不应匹配；3 是 PreferredCount，2 < 3）
	xp1, xq1 := makeQueuePlayer(t, 3)
	xp2, xq2 := makeQueuePlayer(t, 3)

	const relics = "civilization_relics"
	modes := map[string]string{
		cp1: "", cp2: "", cp3: "", cp4: "",
		rp1: relics, rp2: relics,
		xp1: "", xp2: "",
	}

	queues := []db.MatchmakingQueue{cq1, cq2, cq3, cq4, rq1, rq2, xq1, xq2}
	matches := findMatchesFromQueues(queues, modeLookupFromMap(modes))

	if len(matches) != 1 {
		t.Fatalf("期望 1 个匹配，实际 %d: %v", len(matches), matches)
	}
	if len(matches[0]) != 4 {
		t.Fatalf("期望匹配 4 个玩家，实际 %d", len(matches[0]))
	}

	// 匹配到的 4 个玩家必须全部是 classic + count=4 那组
	classic4 := map[string]bool{cp1: true, cp2: true, cp3: true, cp4: true}
	for _, pid := range matches[0] {
		if !classic4[pid] {
			t.Errorf("玩家 %s 不应在 classic count=4 对局中（跨组混入）", pid)
		}
	}
}

// decodeQueueUpdatePayload 解析 match:queueUpdate 的 payload JSON 为 map，便于断言。
func decodeQueueUpdatePayload(t *testing.T, raw []byte) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("无法解析 payload JSON: %v (raw=%s)", err, string(raw))
	}
	return m
}

// TestBuildQueueUpdateMessages_NoExclude_AllPlayersCovered 验证：
// 3 个玩家入队，调用 buildQueueUpdateMessages("", "") 时每个玩家都应收到一条消息，
// 且 position 为 1-indexed、totalInQueue 等于队列长度。
func TestBuildQueueUpdateMessages_NoExclude_AllPlayersCovered(t *testing.T) {
	p1, q1 := makeQueuePlayer(t, 4)
	p2, q2 := makeQueuePlayer(t, 4)
	p3, q3 := makeQueuePlayer(t, 4)

	queues := []db.MatchmakingQueue{q1, q2, q3}
	groups := []queueGroup{}

	msgs := buildQueueUpdateMessages(queues, groups, "")
	if len(msgs) != 3 {
		t.Fatalf("期望 3 条消息，实际 %d", len(msgs))
	}

	seenPositions := map[string]int{}
	for _, m := range msgs {
		payload := decodeQueueUpdatePayload(t, m.Payload)
		pos, _ := payload["position"].(float64)
		total, _ := payload["totalInQueue"].(float64)
		seenPositions[m.PlayerID] = int(pos)
		if total != 3 {
			t.Errorf("玩家 %s 的 totalInQueue 应为 3，实际 %v", m.PlayerID, total)
		}
		// groups 应为空数组（传入空切片应序列化为 []）
		if gs, ok := payload["groups"].([]interface{}); !ok || len(gs) != 0 {
			t.Errorf("玩家 %s 的 groups 应为空数组，实际 %v", m.PlayerID, payload["groups"])
		}
	}

	// 三个玩家应分别收到 position=1/2/3，且与队列顺序一致
	if seenPositions[p1] != 1 {
		t.Errorf("玩家 1 的 position 应为 1，实际 %d", seenPositions[p1])
	}
	if seenPositions[p2] != 2 {
		t.Errorf("玩家 2 的 position 应为 2，实际 %d", seenPositions[p2])
	}
	if seenPositions[p3] != 3 {
		t.Errorf("玩家 3 的 position 应为 3，实际 %d", seenPositions[p3])
	}
}

// TestBuildQueueUpdateMessages_ExcludePlayer_SkipsTarget 验证：
// excludePlayerID 对应的玩家被跳过，其他玩家仍收到消息。
func TestBuildQueueUpdateMessages_ExcludePlayer_SkipsTarget(t *testing.T) {
	p1, q1 := makeQueuePlayer(t, 4)
	p2, q2 := makeQueuePlayer(t, 4)
	p3, q3 := makeQueuePlayer(t, 4)

	queues := []db.MatchmakingQueue{q1, q2, q3}
	groups := []queueGroup{}

	msgs := buildQueueUpdateMessages(queues, groups, p2) // 排除第二个玩家
	if len(msgs) != 2 {
		t.Fatalf("期望 2 条消息（排除 1 人），实际 %d", len(msgs))
	}

	for _, m := range msgs {
		if m.PlayerID == p2 {
			t.Errorf("被排除的玩家 %s 不应收到消息", p2)
		}
	}

	// 剩余玩家的 position 仍按原始队列索引计算（1, 3），不因排除而压缩
	seenPositions := map[string]int{}
	for _, m := range msgs {
		payload := decodeQueueUpdatePayload(t, m.Payload)
		pos, _ := payload["position"].(float64)
		seenPositions[m.PlayerID] = int(pos)
	}
	if seenPositions[p1] != 1 {
		t.Errorf("玩家 1 的 position 应为 1，实际 %d", seenPositions[p1])
	}
	if seenPositions[p3] != 3 {
		t.Errorf("玩家 3 的 position 应为 3，实际 %d", seenPositions[p3])
	}
}

// TestBuildQueueUpdateMessages_EmptyQueue_NoMessages 验证空队列不产生消息。
func TestBuildQueueUpdateMessages_EmptyQueue_NoMessages(t *testing.T) {
	msgs := buildQueueUpdateMessages([]db.MatchmakingQueue{}, []queueGroup{}, "")
	if len(msgs) != 0 {
		t.Errorf("空队列应产生 0 条消息，实际 %d", len(msgs))
	}
}

// TestBuildQueueUpdateMessages_GroupsIncluded 验证 groups 直方图被透传到 payload。
func TestBuildQueueUpdateMessages_GroupsIncluded(t *testing.T) {
	_, q1 := makeQueuePlayer(t, 4)
	queues := []db.MatchmakingQueue{q1}
	groups := []queueGroup{
		{PlayerCount: 4, Count: 1},
		{PlayerCount: 3, Count: 2},
	}

	msgs := buildQueueUpdateMessages(queues, groups, "")
	if len(msgs) != 1 {
		t.Fatalf("期望 1 条消息，实际 %d", len(msgs))
	}

	payload := decodeQueueUpdatePayload(t, msgs[0].Payload)
	gs, ok := payload["groups"].([]interface{})
	if !ok {
		t.Fatalf("groups 应为 array，实际 %T", payload["groups"])
	}
	if len(gs) != 2 {
		t.Fatalf("期望 2 个 group，实际 %d", len(gs))
	}
	// JSON 解码后顺序应与传入一致（map→slice 透传保持顺序）
	first := gs[0].(map[string]interface{})
	if first["playerCount"].(float64) != 4 || first["count"].(float64) != 1 {
		t.Errorf("第一个 group 应为 {playerCount:4, count:1}，实际 %v", first)
	}
	second := gs[1].(map[string]interface{})
	if second["playerCount"].(float64) != 3 || second["count"].(float64) != 2 {
		t.Errorf("第二个 group 应为 {playerCount:3, count:2}，实际 %v", second)
	}
}

// TestBuildQueueGroups_FindsError_ReturnsEmpty 验证 findFn 返回 error 时 groups 为空数组。
func TestBuildQueueGroups_FindsError_ReturnsEmpty(t *testing.T) {
	findFn := func() (*FindMatchesResult, error) {
		return nil, errors.New("db error")
	}
	groups := buildQueueGroups(findFn)
	if len(groups) != 0 {
		t.Errorf("findFn 报错时 groups 应为空，实际 %d", len(groups))
	}
}

// TestBuildQueueGroups_MatchesHistogram 验证 matches → groups 直方图转换正确。
// 4 个 classic 玩家 count=4 → 1 个 4 人对局 → groups=[{4,1}]。
func TestBuildQueueGroups_MatchesHistogram(t *testing.T) {
	p1, q1 := makeQueuePlayer(t, 4)
	p2, q2 := makeQueuePlayer(t, 4)
	p3, q3 := makeQueuePlayer(t, 4)
	p4, q4 := makeQueuePlayer(t, 4)
	queues := []db.MatchmakingQueue{q1, q2, q3, q4}
	matches := findMatchesFromQueues(queues, modeLookupFromMap(map[string]string{
		p1: "", p2: "", p3: "", p4: "",
	}))

	findFn := func() (*FindMatchesResult, error) {
		return &FindMatchesResult{Matches: matches}, nil
	}
	groups := buildQueueGroups(findFn)
	if len(groups) != 1 {
		t.Fatalf("期望 1 个 group，实际 %d", len(groups))
	}
	if groups[0].PlayerCount != 4 || groups[0].Count != 1 {
		t.Errorf("期望 {playerCount:4, count:1}，实际 %+v", groups[0])
	}
}
