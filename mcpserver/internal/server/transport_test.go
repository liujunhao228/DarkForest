package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/persistence"
	"darkforest/mcpserver/internal/session"
)

// newTestManager 用真实 SQLite 账户池 + nil registrar(trust,零网络)构造 Manager。
func newTransportTestManager(t *testing.T) *session.Manager {
	t.Helper()
	db, err := persistence.Open(t.TempDir() + "/mgr.db")
	if err != nil {
		t.Fatalf("persistence.Open 失败: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	pool := account.NewPool(db.Account, nil, true)
	return session.NewManager(pool, nil, "ws://127.0.0.1:1/ws", 0)
}

// serveViaMiddleware 用 agentSidMiddleware 包裹 inner handler 并发送一次请求。
func serveViaMiddleware(t *testing.T, mgr *session.Manager, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := agentSidMiddleware(inner, mgr)
	req := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestAgentSidMiddleware_RegistersPreferred 验证带 Mcp-Session-Id + X-Agent-Sid
// 的请求触发 SetPreferredAccount,且内层 handler 正常执行。
func TestAgentSidMiddleware_RegistersPreferred(t *testing.T) {
	mgr := newTransportTestManager(t)
	rec := serveViaMiddleware(t, mgr, map[string]string{
		"Mcp-Session-Id": "sess-1",
		"X-Agent-Sid":    "ai1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("内层 handler 未执行, status = %d", rec.Code)
	}
	if got := mgr.PreferredAccount("sess-1"); got != "ai1" {
		t.Fatalf("登记后 PreferredAccount = %q, want ai1", got)
	}
}

// TestAgentSidMiddleware_MissingHeaderNoRegistration 验证缺任一头不登记。
func TestAgentSidMiddleware_MissingHeaderNoRegistration(t *testing.T) {
	mgr := newTransportTestManager(t)

	// 缺 X-Agent-Sid
	serveViaMiddleware(t, mgr, map[string]string{"Mcp-Session-Id": "sess-1"})
	if got := mgr.PreferredAccount("sess-1"); got != "" {
		t.Fatalf("缺 X-Agent-Sid 时 PreferredAccount = %q, want 空串", got)
	}

	// 缺 Mcp-Session-Id
	serveViaMiddleware(t, mgr, map[string]string{"X-Agent-Sid": "ai1"})
	if got := mgr.PreferredAccount("sess-2"); got != "" {
		t.Fatalf("缺 Mcp-Session-Id 时 PreferredAccount = %q, want 空串", got)
	}

	// 全缺
	serveViaMiddleware(t, mgr, map[string]string{})
	if got := mgr.PreferredAccount("sess-3"); got != "" {
		t.Fatalf("全缺头时 PreferredAccount = %q, want 空串", got)
	}
}

// TestAgentSidMiddleware_FirstWins 验证同值幂等、换值被 first-wins 拒绝。
func TestAgentSidMiddleware_FirstWins(t *testing.T) {
	mgr := newTransportTestManager(t)

	serveViaMiddleware(t, mgr, map[string]string{
		"Mcp-Session-Id": "sess-1",
		"X-Agent-Sid":    "ai1",
	})
	// 同值幂等
	serveViaMiddleware(t, mgr, map[string]string{
		"Mcp-Session-Id": "sess-1",
		"X-Agent-Sid":    "ai1",
	})
	if got := mgr.PreferredAccount("sess-1"); got != "ai1" {
		t.Fatalf("同值幂等后 PreferredAccount = %q, want ai1", got)
	}
	// 换值被拒绝(first-wins)
	serveViaMiddleware(t, mgr, map[string]string{
		"Mcp-Session-Id": "sess-1",
		"X-Agent-Sid":    "ai2",
	})
	if got := mgr.PreferredAccount("sess-1"); got != "ai1" {
		t.Fatalf("换值后 PreferredAccount = %q, want ai1(不覆盖)", got)
	}
	// 不同 session 各自登记互不干扰
	serveViaMiddleware(t, mgr, map[string]string{
		"Mcp-Session-Id": "sess-2",
		"X-Agent-Sid":    "ai2",
	})
	if got := mgr.PreferredAccount("sess-2"); got != "ai2" {
		t.Fatalf("sess-2 PreferredAccount = %q, want ai2", got)
	}
}
