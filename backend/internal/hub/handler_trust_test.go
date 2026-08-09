package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupTrustTestDB 尝试连接测试数据库。失败时调用 t.Skip 跳过。
// 返回 *db.Queries 与底层 pool，供测试与 cleanup 使用。
func setupTrustTestDB(t *testing.T) (*db.Queries, *pgxpool.Pool) {
	t.Helper()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable"
	}

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Skipf("解析 DATABASE_URL 失败，跳过 trust handler 测试: %v", err)
	}
	cfg.MaxConns = 2
	cfg.MinConns = 0

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Skipf("无法连接测试数据库，跳过 trust handler 测试: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("测试数据库不可达，跳过 trust handler 测试: %v", err)
	}

	queries := db.New(pool)
	t.Cleanup(func() { pool.Close() })
	return queries, pool
}

// cleanupTrustTestPlayers 清理指定 user_id 前缀的测试玩家。
func cleanupTrustTestPlayers(t *testing.T, pool *pgxpool.Pool, userIDs ...string) {
	t.Helper()
	ctx := context.Background()
	for _, uid := range userIDs {
		if _, err := pool.Exec(ctx, "DELETE FROM players WHERE user_id = $1", uid); err != nil {
			t.Logf("cleanup failed for user_id=%s: %v", uid, err)
		}
	}
}

// dialTrustWS 连接 trust mode 的 httptest.Server 并返回 WS 连接。
func dialTrustWS(t *testing.T, srv *httptest.Server, qq, name string) *websocket.Conn {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("解析 server URL 失败: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/ws"
	q := u.Query()
	if qq != "" {
		q.Set("qq", qq)
	}
	if name != "" {
		q.Set("name", name)
	}
	u.RawQuery = q.Encode()

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("WS 握手失败: %v", err)
	}
	return conn
}

// dialTrustWSSID 以 ?sid=<sid>&name=<name?> 连接 agent-mode trust server（name 可空）。
func dialTrustWSSID(t *testing.T, srv *httptest.Server, sid, name string) *websocket.Conn {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("解析 server URL 失败: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/ws"
	q := u.Query()
	q.Set("sid", sid)
	if name != "" {
		q.Set("name", name)
	}
	u.RawQuery = q.Encode()
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("WS 握手失败: %v", err)
	}
	return conn
}

// readLoginSuccess 从 WS 连接读取一条消息并断言为 player:loginSuccess。
// 返回解析后的 PlayerInfo。
func readLoginSuccess(t *testing.T, conn *websocket.Conn) PlayerInfo {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("读取 WS 消息失败: %v", err)
	}
	var msg Message
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("解析 WS 消息失败: %v (raw=%s)", err, string(raw))
	}
	if msg.Type != string(EvtSrvPlayerLoginSuccess) {
		t.Fatalf("期望 player:loginSuccess，实际: %s (raw=%s)", msg.Type, string(raw))
	}
	var info PlayerInfo
	if err := json.Unmarshal(msg.Payload, &info); err != nil {
		t.Fatalf("解析 loginSuccess payload 失败: %v", err)
	}
	return info
}

// TestTrustMode_ValidHandshake 验证合法 qq+name 的完整握手流程：
// 握手成功、收到 loginSuccess、DB 出现对应行。
func TestTrustMode_ValidHandshake(t *testing.T) {
	queries, pool := setupTrustTestDB(t)
	const qq = "12345"
	const uid = "qq:" + qq
	t.Cleanup(func() { cleanupTrustTestPlayers(t, pool, uid) })

	hub := setupTestHub(t)
	defer closeHub(hub)

	srv := httptest.NewServer(TrustModeHandler(hub, queries))
	defer srv.Close()

	conn := dialTrustWS(t, srv, qq, "Tester")
	defer conn.Close()

	info := readLoginSuccess(t, conn)
	if info.UserID != uid {
		t.Errorf("UserID 期望 %s，实际 %s", uid, info.UserID)
	}
	if info.DisplayName != "Tester" {
		t.Errorf("DisplayName 期望 Tester，实际 %s", info.DisplayName)
	}
	if info.Role != "player" {
		t.Errorf("Role 期望 player，实际 %s", info.Role)
	}
	if info.ID == "" {
		t.Error("PlayerID 不应为空")
	}

	// 验证 DB 行存在
	ctx := context.Background()
	var dbUID, dbName string
	err := pool.QueryRow(ctx, "SELECT user_id, display_name FROM players WHERE user_id = $1", uid).Scan(&dbUID, &dbName)
	if err != nil {
		t.Fatalf("查询 DB 行失败: %v", err)
	}
	if dbUID != uid || dbName != "Tester" {
		t.Errorf("DB 行不匹配: uid=%s name=%s", dbUID, dbName)
	}
}

// TestTrustMode_RepeatReusesPlayerID 验证同一 QQ 号第二次连接复用 playerID
// 且 display_name 更新为最新 nickname。
func TestTrustMode_RepeatReusesPlayerID(t *testing.T) {
	queries, pool := setupTrustTestDB(t)
	const qq = "12345"
	const uid = "qq:" + qq
	t.Cleanup(func() { cleanupTrustTestPlayers(t, pool, uid) })

	hub := setupTestHub(t)
	defer closeHub(hub)

	srv := httptest.NewServer(TrustModeHandler(hub, queries))
	defer srv.Close()

	// 第一次连接
	conn1 := dialTrustWS(t, srv, qq, "First")
	info1 := readLoginSuccess(t, conn1)
	conn1.Close()

	// 第二次连接（不同 name）
	conn2 := dialTrustWS(t, srv, qq, "Second")
	info2 := readLoginSuccess(t, conn2)
	conn2.Close()

	if info1.ID != info2.ID {
		t.Errorf("同一 QQ 号应复用 playerID：第一次=%s 第二次=%s", info1.ID, info2.ID)
	}
	if info2.DisplayName != "Second" {
		t.Errorf("第二次 DisplayName 期望 Second，实际 %s", info2.DisplayName)
	}

	// 验证 DB 中 display_name 已更新
	ctx := context.Background()
	var dbName string
	err := pool.QueryRow(ctx, "SELECT display_name FROM players WHERE user_id = $1", uid).Scan(&dbName)
	if err != nil {
		t.Fatalf("查询 DB 行失败: %v", err)
	}
	if dbName != "Second" {
		t.Errorf("DB display_name 期望 Second，实际 %s", dbName)
	}
}

// TestTrustMode_MissingQQ_Returns400 验证缺少 qq 参数时返回 400。
func TestTrustMode_MissingQQ_Returns400(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)
	req := httptest.NewRequest(http.MethodGet, "/ws?name=Tester", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("期望 400，实际 %d", rec.Code)
	}
}

// TestTrustMode_NonNumericQQ_Returns400 验证 qq 非纯数字时返回 400。
func TestTrustMode_NonNumericQQ_Returns400(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)
	req := httptest.NewRequest(http.MethodGet, "/ws?qq=abc&name=Tester", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("期望 400，实际 %d", rec.Code)
	}
}

// TestTrustMode_EmptyName_Returns400 验证 name 为空或纯空白时返回 400。
func TestTrustMode_EmptyName_Returns400(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)

	for _, name := range []string{"", "   ", "\t\n"} {
		req := httptest.NewRequest(http.MethodGet, "/ws?qq=12345&name="+url.QueryEscape(name), nil)
		req.RemoteAddr = "127.0.0.1:12345"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("name=%q 期望 400，实际 %d", name, rec.Code)
		}
	}
}

// TestTrustMode_NonLocalhost_Returns403 验证来源 IP 非 localhost 时返回 403。
func TestTrustMode_NonLocalhost_Returns403(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)
	req := httptest.NewRequest(http.MethodGet, "/ws?qq=12345&name=Tester", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("期望 403，实际 %d", rec.Code)
	}
}

// TestTrustMode_IPv6Localhost_HandshakeOK 验证来源 IP 为 ::1 时握手成功。
func TestTrustMode_IPv6Localhost_HandshakeOK(t *testing.T) {
	queries, pool := setupTrustTestDB(t)
	const qq = "12346"
	const uid = "qq:" + qq
	t.Cleanup(func() { cleanupTrustTestPlayers(t, pool, uid) })

	hub := setupTestHub(t)
	defer closeHub(hub)

	// 使用 httptest.NewServer 自带的 listener（默认监听 127.0.0.1），
	// 客户端连接后 RemoteAddr 为 127.0.0.1:port。
	// 为验证 ::1 分支，直接调用 handler + 自定义 RemoteAddr，
	// 并断言请求未被 403 拒绝（即通过了 IP 校验进入后续流程）。
	// 由于 upgradeAndRegister 需要 DB 查询成功才算通过，
	// 这里用 httptest.NewRecorder 无法走真实 WS 升级，
	// 改为验证：handler 在 ::1 下不返回 403（返回 101 或其他非 403）。
	// 但 NewRecorder 不会自动处理 Upgrade，所以验证非 403 即可。
	handler := TrustModeHandler(hub, queries)
	req := httptest.NewRequest(http.MethodGet, "/ws?qq="+qq+"&name=IPv6Tester", nil)
	req.RemoteAddr = "[::1]:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Errorf("::1 不应被 403 拒绝，但返回了 403")
	}
	// 若 DB 查询成功，handler 会尝试 WS 升级（NewRecorder 下 Upgrade 会失败），
	// 此时 rec.Code 可能为 0（未写 header）或 500。
	// 关键断言：不返回 403。
	t.Logf("::1 RemoteAddr 下返回码: %d", rec.Code)
}

// TestTrustMode_AgentValidHandshake 验证合法 agent sid+name 的完整握手流程：
// 握手成功、收到 loginSuccess、DB 出现对应行。
func TestTrustMode_AgentValidHandshake(t *testing.T) {
	queries, pool := setupTrustTestDB(t)
	const sid = "agent_test_1"
	const uid = "agent:" + sid
	t.Cleanup(func() { cleanupTrustTestPlayers(t, pool, uid) })

	hub := setupTestHub(t)
	defer closeHub(hub)

	srv := httptest.NewServer(TrustModeHandler(hub, queries))
	defer srv.Close()

	conn := dialTrustWSSID(t, srv, sid, "机器人甲")
	defer conn.Close()

	info := readLoginSuccess(t, conn)
	if info.UserID != uid {
		t.Errorf("UserID 期望 %s，实际 %s", uid, info.UserID)
	}
	if info.DisplayName != "机器人甲" {
		t.Errorf("DisplayName 期望 机器人甲，实际 %s", info.DisplayName)
	}
	if info.Role != "player" {
		t.Errorf("Role 期望 player，实际 %s", info.Role)
	}
	if info.ID == "" {
		t.Error("PlayerID 不应为空")
	}

	ctx := context.Background()
	var dbUID, dbName string
	err := pool.QueryRow(ctx, "SELECT user_id, display_name FROM players WHERE user_id = $1", uid).Scan(&dbUID, &dbName)
	if err != nil {
		t.Fatalf("查询 DB 行失败: %v", err)
	}
	if dbUID != uid || dbName != "机器人甲" {
		t.Errorf("DB 行不匹配: uid=%s name=%s", dbUID, dbName)
	}
}

// TestTrustMode_AgentNameFallbackAI 验证 agent 缺省 name 时回退 AI-<sid>。
func TestTrustMode_AgentNameFallbackAI(t *testing.T) {
	queries, pool := setupTrustTestDB(t)
	const sid = "agent_test_2"
	const uid = "agent:" + sid
	t.Cleanup(func() { cleanupTrustTestPlayers(t, pool, uid) })

	hub := setupTestHub(t)
	defer closeHub(hub)

	srv := httptest.NewServer(TrustModeHandler(hub, queries))
	defer srv.Close()

	conn := dialTrustWSSID(t, srv, sid, "")
	defer conn.Close()

	info := readLoginSuccess(t, conn)
	if info.DisplayName != "AI-agent_test_2" {
		t.Errorf("DisplayName 期望 AI-agent_test_2，实际 %s", info.DisplayName)
	}

	ctx := context.Background()
	var dbName string
	err := pool.QueryRow(ctx, "SELECT display_name FROM players WHERE user_id = $1", uid).Scan(&dbName)
	if err != nil {
		t.Fatalf("查询 DB 行失败: %v", err)
	}
	if dbName != "AI-agent_test_2" {
		t.Errorf("DB display_name 期望 AI-agent_test_2，实际 %s", dbName)
	}
}

// TestTrustMode_AgentReconnectReusesPlayerID 验证同一 sid 第二次连接复用 playerID
// 且 display_name 更新为最新昵称（与 qq 分支 upsert 覆盖语义一致）。
func TestTrustMode_AgentReconnectReusesPlayerID(t *testing.T) {
	queries, pool := setupTrustTestDB(t)
	const sid = "agent_test_3"
	const uid = "agent:" + sid
	t.Cleanup(func() { cleanupTrustTestPlayers(t, pool, uid) })

	hub := setupTestHub(t)
	defer closeHub(hub)

	srv := httptest.NewServer(TrustModeHandler(hub, queries))
	defer srv.Close()

	conn1 := dialTrustWSSID(t, srv, sid, "First")
	info1 := readLoginSuccess(t, conn1)
	conn1.Close()

	conn2 := dialTrustWSSID(t, srv, sid, "Second")
	info2 := readLoginSuccess(t, conn2)
	conn2.Close()

	if info1.ID != info2.ID {
		t.Errorf("同一 sid 应复用 playerID：第一次=%s 第二次=%s", info1.ID, info2.ID)
	}
	if info2.DisplayName != "Second" {
		t.Errorf("第二次 DisplayName 期望 Second，实际 %s", info2.DisplayName)
	}

	ctx := context.Background()
	var dbName string
	err := pool.QueryRow(ctx, "SELECT display_name FROM players WHERE user_id = $1", uid).Scan(&dbName)
	if err != nil {
		t.Fatalf("查询 DB 行失败: %v", err)
	}
	if dbName != "Second" {
		t.Errorf("DB display_name 期望 Second，实际 %s", dbName)
	}
}

// TestTrustMode_AgentReconnectNoName_PreservesNick 验证同 sid 缺 name 重连时
// 保留既有昵称，不被 AI-<sid> 覆盖（M3 对齐，HTTP 两段式同语义）。
func TestTrustMode_AgentReconnectNoName_PreservesNick(t *testing.T) {
	queries, pool := setupTrustTestDB(t)
	const sid = "agent_test_5"
	const uid = "agent:" + sid
	t.Cleanup(func() { cleanupTrustTestPlayers(t, pool, uid) })

	hub := setupTestHub(t)
	defer closeHub(hub)

	srv := httptest.NewServer(TrustModeHandler(hub, queries))
	defer srv.Close()

	conn1 := dialTrustWSSID(t, srv, sid, "自定义昵称")
	info1 := readLoginSuccess(t, conn1)
	conn1.Close()

	conn2 := dialTrustWSSID(t, srv, sid, "")
	info2 := readLoginSuccess(t, conn2)
	conn2.Close()

	if info1.ID != info2.ID {
		t.Errorf("同一 sid 应复用 playerID：第一次=%s 第二次=%s", info1.ID, info2.ID)
	}
	if info2.DisplayName != "自定义昵称" {
		t.Errorf("缺 name 重连应保留昵称，实际 %s", info2.DisplayName)
	}

	ctx := context.Background()
	var dbName string
	err := pool.QueryRow(ctx, "SELECT display_name FROM players WHERE user_id = $1", uid).Scan(&dbName)
	if err != nil {
		t.Fatalf("查询 DB 行失败: %v", err)
	}
	if dbName != "自定义昵称" {
		t.Errorf("DB display_name 应为 自定义昵称，实际 %s", dbName)
	}
}

// TestTrustMode_AgentNoQQNoSID_Returns400 验证既无 qq 也无 sid 参数时返回 400。
func TestTrustMode_AgentNoQQNoSID_Returns400(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)
	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("期望 400，实际 %d", rec.Code)
	}
}

// TestTrustMode_AgentInvalidSID_Returns400 表驱动验证非法（或缺失）sid 返回 400。
func TestTrustMode_AgentInvalidSID_Returns400(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)
	invalidSIDs := []string{
		"",
		"bad/sid!",
		strings.Repeat("a", 65),
	}
	for _, sid := range invalidSIDs {
		req := httptest.NewRequest(http.MethodGet, "/ws?sid="+url.QueryEscape(sid)+"&name=X", nil)
		req.RemoteAddr = "127.0.0.1:12345"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("sid=%q 期望 400，实际 %d", sid, rec.Code)
		}
	}
}

// TestTrustMode_AgentNonLocalhost_Returns403 验证来源 IP 非 localhost 时返回 403。
func TestTrustMode_AgentNonLocalhost_Returns403(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)
	req := httptest.NewRequest(http.MethodGet, "/ws?sid=agent_test_4&name=X", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("期望 403，实际 %d", rec.Code)
	}
}

// TestTrustMode_AgentIPv6Localhost_HandshakeOK 验证来源 IP 为 ::1 时进入后续流程（非 403）。
func TestTrustMode_AgentIPv6Localhost_HandshakeOK(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)
	req := httptest.NewRequest(http.MethodGet, "/ws?sid=agent_test_abc&name=IPv6Agent", nil)
	req.RemoteAddr = "[::1]:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Errorf("::1 不应被 403 拒绝，但返回了 403")
	}
	t.Logf("::1 RemoteAddr 下返回码: %d", rec.Code)
}

// closeHub 安全关闭 hub 的 Run goroutine。
// 由于 hub.Run 是无限循环且无停止 channel，测试中只能让其泄漏。
// 此函数为占位，实际依赖进程退出清理。
func closeHub(h *Hub) {
	// no-op: hub.Run 循环无停止机制，测试进程退出时自动回收
	_ = h
}

// init 确保 slog 在测试中不输出过多噪声。
func init() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
}
