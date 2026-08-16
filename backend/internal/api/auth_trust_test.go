package api

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/darkforest/backend/internal/auth"
	"github.com/darkforest/backend/internal/db"
	"github.com/google/uuid"
)

// cleanupTrustRows 清理本文件全部测试可能留下的玩家行，
// 保证用例间/历史残留互不干扰（prefix 约束在 trust 头与 sid 校验下天然合法）。
func cleanupTrustRows(t *testing.T, pool *sql.DB) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.ExecContext(ctx,
		"DELETE FROM players WHERE user_id LIKE 'agent:test_%' OR user_id LIKE 'qq:test_%' OR user_id = 'qq:12345'"); err != nil {
		t.Logf("清理 trust 测试玩家失败: %v", err)
	}
}

// newTrustRequest 构造带 RemoteAddr 与可选 X-Trust-User 头的请求。
func newTrustRequest(method, target, remoteAddr, trustUser string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(""))
	req.RemoteAddr = remoteAddr
	if trustUser != "" {
		req.Header.Set(trustUserHeader, trustUser)
	}
	return req
}

// runTrustNext 用指定中间件跑一次请求，next 捕获注入 payload；返回状态码与 payload。
func runTrustNext(t *testing.T, mw func(http.Handler) http.Handler, req *http.Request) (int, *auth.JWTPayload) {
	t.Helper()
	rec := httptest.NewRecorder()
	var got *auth.JWTPayload
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = GetAuthFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	mw(next).ServeHTTP(rec, req)
	return rec.Code, got
}

// TestNewAuthMiddleware_NonTrust_IsAuthMiddleware 验证 localTrustMode=false 时
// 返回的中间件与既有 AuthMiddleware 一致：无论是否带 X-Trust-User，无 JWT 一律 401。
func TestNewAuthMiddleware_NonTrust_IsAuthMiddleware(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	cleanupTrustRows(t, pool)
	defer cleanupTrustRows(t, pool)

	for _, trustUser := range []string{"", "agent:test_nt"} {
		req := newTrustRequest(http.MethodGet, "/api/player/me", "127.0.0.1:12345", trustUser)
		code, got := runTrustNext(t, NewAuthMiddleware(queries, false), req)
		if code != http.StatusUnauthorized {
			t.Errorf("trustUser=%q 期望 401，实际 %d", trustUser, code)
		}
		if got != nil {
			t.Errorf("trustUser=%q next 不应被调用", trustUser)
		}
	}
}

// TestNewAuthMiddleware_TrustAgentValid 验证 trust 下合法 agent 头被注入
// role=player payload，且新行回退 AI-<sid>。
func TestNewAuthMiddleware_TrustAgentValid(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	cleanupTrustRows(t, pool)
	defer cleanupTrustRows(t, pool)

	req := newTrustRequest(http.MethodGet, "/api/player/me", "127.0.0.1:12345", "agent:test_a1")
	code, got := runTrustNext(t, NewAuthMiddleware(queries, true), req)

	if code != http.StatusOK {
		t.Fatalf("期望 200，实际 %d", code)
	}
	if got == nil {
		t.Fatal("next 未收到注入 payload")
	}
	if got.UserID != "agent:test_a1" {
		t.Errorf("UserID 期望 agent:test_a1，实际 %s", got.UserID)
	}
	if got.Role != "player" {
		t.Errorf("Role 期望 player，实际 %s", got.Role)
	}
	if got.DisplayName != "AI-test_a1" {
		t.Errorf("DisplayName 期望 AI-test_a1，实际 %s", got.DisplayName)
	}
	if got.PlayerID == "" {
		t.Error("PlayerID 不应为空")
	}

	ctx := context.Background()
	var dbName string
	err := pool.QueryRowContext(ctx, "SELECT display_name FROM players WHERE user_id = ?", "agent:test_a1").Scan(&dbName)
	if err != nil {
		t.Fatalf("查询 DB 行失败: %v", err)
	}
	if dbName != "AI-test_a1" {
		t.Errorf("DB display_name 期望 AI-test_a1，实际 %s", dbName)
	}
}

// TestNewAuthMiddleware_TrustQQValid 验证 trust 下 qq:<n> 头同时被认。
func TestNewAuthMiddleware_TrustQQValid(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	cleanupTrustRows(t, pool)
	defer cleanupTrustRows(t, pool)

	req := newTrustRequest(http.MethodGet, "/api/player/me", "127.0.0.1:12345", "qq:12345")
	code, got := runTrustNext(t, NewAuthMiddleware(queries, true), req)

	if code != http.StatusOK {
		t.Fatalf("期望 200，实际 %d", code)
	}
	if got == nil {
		t.Fatal("注入 payload 为空")
	}
	if got.UserID != "qq:12345" {
		t.Errorf("UserID 期望 qq:12345，实际 %s", got.UserID)
	}
	if got.Role != "player" {
		t.Errorf("Role 期望 player，实际 %s", got.Role)
	}
}

// TestNewAuthMiddleware_TrustPreservesExistingName 验证 trust 下已有昵称不被 AI-<sid> 覆盖。
func TestNewAuthMiddleware_TrustPreservesExistingName(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	cleanupTrustRows(t, pool)
	defer cleanupTrustRows(t, pool)

	ctx := context.Background()
	_, err := queries.GetOrCreatePlayerByUserID(ctx, db.GetOrCreatePlayerByUserIDParams{
		ID:          uuid.NewString(),
		UserID:      "agent:test_e1",
		DisplayName: "已有昵称",
	})
	if err != nil {
		t.Fatalf("预建玩家失败: %v", err)
	}

	req := newTrustRequest(http.MethodGet, "/api/player/me", "127.0.0.1:12345", "agent:test_e1")
	code, got := runTrustNext(t, NewAuthMiddleware(queries, true), req)

	if code != http.StatusOK {
		t.Fatalf("期望 200，实际 %d", code)
	}
	if got == nil {
		t.Fatal("注入 payload 为空")
	}
	if got.DisplayName != "已有昵称" {
		t.Errorf("DisplayName 期望 已有昵称（不被 AI-test_e1 覆盖），实际 %s", got.DisplayName)
	}
	var dbName string
	err = pool.QueryRowContext(ctx, "SELECT display_name FROM players WHERE user_id = ?", "agent:test_e1").Scan(&dbName)
	if err != nil {
		t.Fatalf("查询 DB 行失败: %v", err)
	}
	if dbName != "已有昵称" {
		t.Errorf("DB display_name 应为 已有昵称，实际 %s", dbName)
	}
}

// TestNewAuthMiddleware_TrustMissingHeader_Unauthorized 验证缺 X-Trust-User 头 → 401。
func TestNewAuthMiddleware_TrustMissingHeader_Unauthorized(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)

	req := newTrustRequest(http.MethodGet, "/api/player/me", "127.0.0.1:12345", "")
	code, got := runTrustNext(t, NewAuthMiddleware(queries, true), req)

	if code != http.StatusUnauthorized {
		t.Errorf("期望 401，实际 %d", code)
	}
	if got != nil {
		t.Error("next 不应被注入")
	}
}

// TestNewAuthMiddleware_TrustNonLocalhost_Unauthorized 验证非 localhost 来源 → 401。
func TestNewAuthMiddleware_TrustNonLocalhost_Unauthorized(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	cleanupTrustRows(t, pool)
	defer cleanupTrustRows(t, pool)

	req := newTrustRequest(http.MethodGet, "/api/player/me", "192.168.1.1:9999", "agent:test_x")
	code, got := runTrustNext(t, NewAuthMiddleware(queries, true), req)

	if code != http.StatusUnauthorized {
		t.Errorf("期望 401，实际 %d", code)
	}
	if got != nil {
		t.Error("next 不应被注入")
	}
}

// TestNewAuthMiddleware_TrustInvalidSID_Unauthorized 表驱动验证非法 sid → 401。
func TestNewAuthMiddleware_TrustInvalidSID_Unauthorized(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	cleanupTrustRows(t, pool)
	defer cleanupTrustRows(t, pool)

	long := strings.Repeat("a", 65)
	for _, trustUser := range []string{"agent:bad/sid!", "agent:", "agent:" + long} {
		req := newTrustRequest(http.MethodGet, "/api/player/me", "127.0.0.1:12345", trustUser)
		code, got := runTrustNext(t, NewAuthMiddleware(queries, true), req)
		if code != http.StatusUnauthorized {
			t.Errorf("trustUser=%q 期望 401，实际 %d", trustUser, code)
		}
		if got != nil {
			t.Errorf("trustUser=%q next 不应被注入", trustUser)
		}
	}
}

// TestNewAuthMiddleware_TrustNoAdminEscalation 验证 trust payload role=player
// 无法通过 AdminRequiredMiddleware（提权红线回归）。
func TestNewAuthMiddleware_TrustNoAdminEscalation(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	cleanupTrustRows(t, pool)
	defer cleanupTrustRows(t, pool)

	req := newTrustRequest(http.MethodGet, "/api/player", "127.0.0.1:12345", "agent:test_a2")
	rec := httptest.NewRecorder()
	handler := Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}),
		NewAuthMiddleware(queries, true), AdminRequiredMiddleware)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("期望 403（role=player 非 admin），实际 %d", rec.Code)
	}
}
