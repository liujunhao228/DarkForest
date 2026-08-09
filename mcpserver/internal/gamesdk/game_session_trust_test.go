package gamesdk

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"darkforest/mcpserver/internal/account"
)

// TestGameSession_AuthValue 验证 AuthValue:trust 返回 acc.ID(agent:<sid>),非 trust 返回 Token。
func TestGameSession_AuthValue(t *testing.T) {
	acc := &account.Account{ID: "agent:llama", Token: "jwt-token"}
	s := NewGameSession(acc, nil, "ws://localhost:1/ws", 1)
	s.SetTrustMode(true)
	if got := s.AuthValue(); got != "agent:llama" {
		t.Fatalf("trust AuthValue = %q, want %q", got, "agent:llama")
	}
	s.SetTrustMode(false)
	if got := s.AuthValue(); got != "jwt-token" {
		t.Fatalf("非 trust AuthValue = %q, want jwt-token", got)
	}
}

// TestGameSession_Trust_SkipsLogin 验证 trust 下 EnsureConnected 不访问 /auth/login(红旗红线),
// 并以 ?sid= 建立 WS 握手(sid 从 acc.ID 去 agent: 前缀)。
func TestGameSession_Trust_SkipsLogin(t *testing.T) {
	var loginHits int32
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/auth/login") {
			atomic.AddInt32(&loginHits, 1)
		}
		w.Write([]byte(`{"success":true,"token":"","player":{"id":"p1","userId":"agent:llama","displayName":"AI-llama","role":"player"}}`))
	}))
	defer apiSrv.Close()

	capture := &trustWSCapture{}
	wsSrv, wsURL := newTrustWSServer(capture)
	defer wsSrv.Close()

	acc := &account.Account{ID: "agent:llama", DisplayName: "晓狐", Token: ""}
	s := NewGameSession(acc, NewHTTPClient(apiSrv.URL), wsURL, 1)
	s.SetTrustMode(true)
	s.SetWSStabilityParams(0, 0, 0, 0)
	if err := s.EnsureConnected(); err != nil {
		t.Fatalf("EnsureConnected err: %v", err)
	}
	defer s.Close()

	if atomic.LoadInt32(&loginHits) != 0 {
		t.Fatalf("trust 下 EnsureConnected 不应调用 /auth/login,实际命中 %d 次", loginHits)
	}
	q, protos := capture.snapshot()
	if len(q) == 0 {
		t.Fatal("未捕获到 WS 握手")
	}
	if !strings.Contains(q[0], "sid=llama") {
		t.Fatalf("trust WS 握手应带 sid=llama,实际 %q", q[0])
	}
	if protos[0] != "" {
		t.Fatalf("trust WS 握手不应带 Sec-WebSocket-Protocol,实际 %q", protos[0])
	}
}