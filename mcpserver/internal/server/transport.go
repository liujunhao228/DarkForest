package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"darkforest/mcpserver/internal/config"
	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// defaultHealthCheckInterval 是健康检查 goroutine 的执行间隔。
const defaultHealthCheckInterval = 30 * time.Second

// HealthStatus 是健康检查的结构化响应。
type HealthStatus struct {
	Status      string         `json:"status"` // ok|degraded|down
	MCP         MCPHealth       `json:"mcp"`
	Pool        PoolHealth      `json:"pool"`
	GameBackend GameBackendHealth `json:"gameBackend"`
}

type MCPHealth struct {
	Port       string `json:"port"`
	Sessions   int    `json:"sessions"`
	Uptime     int64  `json:"uptime"`
}

type PoolHealth struct {
	Total     int `json:"total"`
	Available int `json:"available"`
}

type GameBackendHealth struct {
	Reachable bool      `json:"reachable"`
	LastCheck time.Time `json:"lastCheck"`
}

// healthChecker 后台定期检查游戏后端可达性。
type healthChecker struct {
	mu         sync.RWMutex
	reachable  bool
	lastCheck  time.Time
	httpC      *gamesdk.HTTPClient
	stop       chan struct{}
}

func newHealthChecker(httpC *gamesdk.HTTPClient) *healthChecker {
	return &healthChecker{
		reachable: true, // 乐观初始化
		httpC:    httpC,
		stop:     make(chan struct{}),
	}
}

func (h *healthChecker) Start() {
	// 立即检查一次
	h.check()
	go func() {
		ticker := time.NewTicker(defaultHealthCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-h.stop:
				return
			case <-ticker.C:
				h.check()
			}
		}
	}()
}

func (h *healthChecker) check() {
	_, err := h.httpC.Health()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.reachable = err == nil
	h.lastCheck = time.Now()
}

func (h *healthChecker) snapshot() (bool, time.Time) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.reachable, h.lastCheck
}

func (h *healthChecker) StopChecker() {
	select {
	case <-h.stop:
	default:
		close(h.stop)
	}
}

// NewStreamableHandler 创建 Streamable HTTP handler,用于处理 MCP 客户端连接。
// 单实例 server,SDK 内部管理多 session。
// 启用 SessionTimeout(空闲 session 自动关闭)和 EventStore(SSE 流恢复)。
func NewStreamableHandler(server *mcp.Server, cfg *config.Config) http.Handler {
	opts := &mcp.StreamableHTTPOptions{
		Logger: slog.Default(),
	}
	if cfg.MCPSessionTimeout > 0 {
		opts.SessionTimeout = time.Duration(cfg.MCPSessionTimeout) * time.Second
	}
	// 启用 EventStore 以支持 SSE 流恢复
	opts.EventStore = NewMemoryEventStore(100)
	return mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return server
	}, opts)
}

// NewMux 创建 HTTP 路由,挂载 MCP 端点和增强的健康检查。
// mgr 用于 /health 端点的统计信息;httpC 用于探测游戏后端可达性。
func NewMux(endpoint string, mcpServer *mcp.Server, cfg *config.Config, mgr *session.Manager, httpC *gamesdk.HTTPClient, startedAt time.Time) (http.Handler, *healthChecker) {
	checker := newHealthChecker(httpC)
	mux := http.NewServeMux()
	mux.Handle(endpoint, NewStreamableHandler(mcpServer, cfg))
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		stats := mgr.Stats()
		reachable, lastCheck := checker.snapshot()
		status := "ok"
		if !reachable {
			status = "down"
		} else if stats.PoolAvailable < 1 {
			status = "degraded"
		}
		resp := HealthStatus{
			Status: status,
			MCP: MCPHealth{
				Port:     cfg.MCPPort,
				Sessions: stats.ActiveSessions,
				Uptime:   int64(time.Since(startedAt).Seconds()),
			},
			Pool: PoolHealth{
				Total:     stats.PoolTotal,
				Available: stats.PoolAvailable,
			},
			GameBackend: GameBackendHealth{
				Reachable: reachable,
				LastCheck: lastCheck,
			},
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
	return mux, checker
}
