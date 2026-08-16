package hub

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// dialTrustWatch 以 ?watch=<sid> 连接 trust server（只读旁观）。
func dialTrustWatch(t *testing.T, srv *httptest.Server, sid string) *websocket.Conn {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("解析 server URL 失败: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/ws"
	q := u.Query()
	q.Set("watch", sid)
	u.RawQuery = q.Encode()
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("WS 握手失败: %v", err)
	}
	return conn
}

// dialURLWS 连接任意 httptest.Server 根路径的 WS（升级由 handler 自身触发）。
func dialURLWS(t *testing.T, srvURL string) *websocket.Conn {
	t.Helper()
	u, err := url.Parse(srvURL)
	if err != nil {
		t.Fatalf("解析 URL 失败: %v", err)
	}
	u.Scheme = "ws"
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("WS 握手失败: %v", err)
	}
	return conn
}

// pollObserved 轮询直到 observed 非空或超时，返回观察到的目标 playerID。
func pollObserved(t *testing.T, observed *string, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if *observed == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("observerStartSync 未在超时前被触发，observed=%q want=%q", *observed, want)
}

// TestUpgradeAndRegisterObserver_TriggersStartSync 验证升级函数会触发 observerStartSync
// 且目标 playerID 正确（无需 DB）。
func TestUpgradeAndRegisterObserver_TriggersStartSync(t *testing.T) {
	hub := setupTestHub(t)
	defer closeHub(hub)

	var observed string
	hub.SetObserverStartSync(func(cl *Client) error {
		observed = cl.ObservedPlayerID()
		return nil
	})

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgradeAndRegisterObserver(w, r, hub, "target-player")
	})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	conn := dialURLWS(t, srv.URL)
	defer conn.Close()

	pollObserved(t, &observed, "target-player")
}

// TestTrustMode_WatchResolvesAgentToPlayerID 验证 ?watch=<sid> 能解析 agent:<sid>
// 到 playerID 并建立只读旁观连接（需 DB，无 DB 时跳过）。
func TestTrustMode_WatchResolvesAgentToPlayerID(t *testing.T) {
	queries, pool := setupTrustTestDB(t)
	const sid = "watch_target_1"
	const uid = "agent:" + sid
	t.Cleanup(func() { cleanupTrustTestPlayers(t, pool, uid) })

	hub := setupTestHub(t)
	defer closeHub(hub)

	srv := httptest.NewServer(TrustModeHandler(hub, queries))
	defer srv.Close()

	// 先以 ?sid= 建立 agent 玩家，拿到权威 playerID
	agentConn := dialTrustWSSID(t, srv, sid, "Alice")
	info := readLoginSuccess(t, agentConn)
	agentConn.Close()

	var observed string
	hub.SetObserverStartSync(func(cl *Client) error {
		observed = cl.ObservedPlayerID()
		return nil
	})

	// 以 ?watch=<sid> 建立旁观连接
	watchConn := dialTrustWatch(t, srv, sid)
	defer watchConn.Close()

	pollObserved(t, &observed, info.ID)
}

// TestTrustMode_WatchMissingAgent_Returns404 验证 ?watch= 目标不存在时返回 404。
func TestTrustMode_WatchMissingAgent_Returns404(t *testing.T) {
	queries, _ := setupTrustTestDB(t)
	hub := setupTestHub(t)
	defer closeHub(hub)

	handler := TrustModeHandler(hub, queries)
	req := httptest.NewRequest(http.MethodGet, "/ws?watch=no_such_agent", nil)
	req.RemoteAddr = "127.0.0.1:12345"

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("期望 404，实际 %d", rec.Code)
	}
}
