package gamesdk

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestHTTPClient_TrustMode_SendsTrustHeader 验证 trust 下身份经请求参数写 X-Trust-User,
// 且不写 Authorization(B2:禁止共享 client 字段)。
func TestHTTPClient_TrustMode_SendsTrustHeader(t *testing.T) {
	var gotTrust, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTrust = r.Header.Get("X-Trust-User")
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(`{"success":true,"token":"","player":{"id":"p1","userId":"agent:x","displayName":"AI-x","role":"player"}}`))
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL)
	c.SetTrustMode(true) // 进程级装配,仅 main 调用一次
	var resp AuthResponse
	if err := c.doJSON("GET", "/health", "agent:llama", nil, &resp); err != nil {
		t.Fatalf("doJSON err: %v", err)
	}
	if gotTrust != "agent:llama" {
		t.Fatalf("期望 X-Trust-User=agent:llama,实际 %q", gotTrust)
	}
	if gotAuth != "" {
		t.Fatalf("trust 下不应有 Authorization,实际 %q", gotAuth)
	}
}

// TestHTTPClient_NonTrust_StillAuthorization 回归红线:非 trust 保持原 Authorization 行为。
func TestHTTPClient_NonTrust_StillAuthorization(t *testing.T) {
	var gotTrust, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTrust = r.Header.Get("X-Trust-User")
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL) // 未 SetTrustMode
	var out map[string]any
	if err := c.doJSON("GET", "/x", "t0ken", nil, &out); err != nil {
		t.Fatalf("doJSON err: %v", err)
	}
	if gotAuth != "Bearer t0ken" {
		t.Fatalf("非 trust 应 Authorization=Bearer t0ken,实际 %q", gotAuth)
	}
	if gotTrust != "" {
		t.Fatalf("非 trust 不应有 X-Trust-User,实际 %q", gotTrust)
	}
}

// TestHTTPClient_TrustMode_CircuitSkipped 验证 trust 下熔断绕行(Q17):
// 即使熔断器已 OPEN,带身份串的请求仍成功。
func TestHTTPClient_TrustMode_CircuitSkipped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL)
	c.SetTrustMode(true)
	cb := NewCircuitBreaker(1, time.Hour)
	// 直接置为 OPEN,确保 Allow() 返回 false。
	cb.mu.Lock()
	cb.state = CircuitOpen
	cb.openedAt = time.Now()
	cb.mu.Unlock()
	c.SetCircuitBreaker(cb)

	var out map[string]any
	if err := c.doJSON("GET", "/x", "agent:llama", nil, &out); err != nil {
		t.Fatalf("trust 下熔断不上,doJSON 应成功,实际: %v", err)
	}
}

// TestHTTPClient_NonTrust_CircuitStillApplies 回归:非 trust 依旧走熔断。
func TestHTTPClient_NonTrust_CircuitStillApplies(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL)
	cb := NewCircuitBreaker(1, time.Hour)
	cb.mu.Lock()
	cb.state = CircuitOpen
	cb.openedAt = time.Now()
	cb.mu.Unlock()
	c.SetCircuitBreaker(cb)

	var out map[string]any
	err := c.doJSON("GET", "/x", "t0ken", nil, &out)
	if err == nil || !strings.Contains(err.Error(), "熔断器开启") {
		t.Fatalf("非 trust 应被熔断拒绝,实际 err = %v", err)
	}
}
