package gamesdk

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// trustWSCapture 捕获 WS 握手时收到的 query 与 Sec-WebSocket-Protocol 头。
type trustWSCapture struct {
	mu    sync.Mutex
	query []string
	proto []string
}

func (c *trustWSCapture) handler() http.HandlerFunc {
	up := websocket.Upgrader{}
	return func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		c.query = append(c.query, r.URL.RawQuery)
		c.proto = append(c.proto, r.Header.Get("Sec-WebSocket-Protocol"))
		c.mu.Unlock()
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		// 握手成功后立即正常关闭,触发客户端 readLoop 进入重连路径。
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		_ = conn.Close()
	}
}

func (c *trustWSCapture) snapshot() ([]string, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.query...), append([]string(nil), c.proto...)
}

func newTrustWSServer(c *trustWSCapture) (*httptest.Server, string) {
	srv := httptest.NewServer(c.handler())
	return srv, "ws" + strings.TrimPrefix(srv.URL, "http")
}

// TestWSClient_TrustDialQuery 验证 trust 握手以 ?sid=&name= 传参,且不设 Sec-WebSocket-Protocol。
func TestWSClient_TrustDialQuery(t *testing.T) {
	capture := &trustWSCapture{}
	srv, wsURL := newTrustWSServer(capture)
	defer srv.Close()

	c := NewWSClient(wsURL, "", 5) // token 为空(trust 无 JWT)
	c.SetTrustAgent("llama", "晓狐")
	if err := c.Connect(); err != nil {
		t.Fatalf("Connect err: %v", err)
	}
	defer c.Close()

	qs, protos := capture.snapshot()
	if len(qs) == 0 {
		t.Fatal("未捕获到 WS 握手")
	}
	if !strings.Contains(qs[0], "sid=llama") || !strings.Contains(qs[0], "name=") {
		t.Fatalf("期望 query 含 sid/name,实际 %q", qs[0])
	}
	if protos[0] != "" {
		t.Fatalf("trust 下不应设 Sec-WebSocket-Protocol,实际 %q", protos[0])
	}
	if strings.Contains(qs[0], "some-token") {
		t.Fatalf("trust 下 query 不应携带 token,实际 %q", qs[0])
	}
}

// TestWSClient_NonTrust_ProtocolHeader 回归红线:非 trust 保持 Sec-WebSocket-Protocol=token,
// 且 query 不含 sid=。
func TestWSClient_NonTrust_ProtocolHeader(t *testing.T) {
	capture := &trustWSCapture{}
	srv, wsURL := newTrustWSServer(capture)
	defer srv.Close()

	c := NewWSClient(wsURL, "some-token", 5)
	if err := c.Connect(); err != nil {
		t.Fatalf("Connect err: %v", err)
	}
	defer c.Close()

	q, protos := capture.snapshot()
	if len(protos) == 0 {
		t.Fatal("未捕获到 WS 握手")
	}
	if protos[0] != "some-token" {
		t.Fatalf("非 trust 应设 Sec-WebSocket-Protocol=some-token,实际 %q", protos[0])
	}
	if strings.Contains(q[0], "sid=") {
		t.Fatalf("非 trust query 不应含 sid=,实际 %q", q[0])
	}
}

// TestWSClient_TrustReconnectKeepsQuery 验证重连时 trust URL 每次重建,query 参数持续带入。
func TestWSClient_TrustReconnectKeepsQuery(t *testing.T) {
	capture := &trustWSCapture{}
	srv, wsURL := newTrustWSServer(capture)
	defer srv.Close()

	c := NewWSClient(wsURL, "", 5)
	c.SetTrustAgent("fox", "小鱼")
	if err := c.Connect(); err != nil {
		t.Fatalf("Connect err: %v", err)
	}
	defer c.Close()

	deadline := time.Now().Add(4000 * time.Millisecond)
	for time.Now().Before(deadline) {
		q, protos := capture.snapshot()
		if len(q) >= 2 {
			if !strings.Contains(q[1], "sid=fox") || !strings.Contains(q[1], "name=") {
				t.Fatalf("重连 query 应含 trust sid/name,实际 %q", q[1])
			}
			if protos[1] != "" {
				t.Fatalf("重连不应设 Sec-WebSocket-Protocol,实际 %q", protos[1])
			}
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("未观察到第二次信任握手(实现重连 query 重建)")
}

// TestWSClient_TrustDialQuery_NoName 验证 name 缺省时 URL 不带 name 参数(M3 语义)。
func TestWSClient_TrustDialQuery_NoName(t *testing.T) {
	capture := &trustWSCapture{}
	srv, wsURL := newTrustWSServer(capture)
	defer srv.Close()

	c := NewWSClient(wsURL, "", 5)
	c.SetTrustAgent("noops", "") // 不传昵称 → 不拼 name 参数
	if err := c.Connect(); err != nil {
		t.Fatalf("Connect err: %v", err)
	}
	defer c.Close()

	q, _ := capture.snapshot()
	if len(q) == 0 {
		t.Fatal("未捕获到 WS 握手")
	}
	if strings.Contains(q[0], "name=") {
		t.Fatalf("name 缺省时不应带 name 参数,实际 %q", q[0])
	}
	if !strings.Contains(q[0], "sid=noops") {
		t.Fatalf("应带 sid=noops,实际 %q", q[0])
	}
}