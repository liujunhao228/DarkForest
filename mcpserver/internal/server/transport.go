package server

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/config"
	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
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
	h.mu.RLock()
	httpC := h.httpC
	h.mu.RUnlock()
	_, err := httpC.Health()
	h.mu.Lock()
	h.reachable = err == nil
	h.lastCheck = time.Now()
	h.mu.Unlock()
}

func (h *healthChecker) snapshot() (bool, time.Time) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.reachable, h.lastCheck
}

// SetHTTPClient 替换用于探测游戏后端的 HTTP 客户端(运行时切换游戏服务器后调用)。
func (h *healthChecker) SetHTTPClient(httpC *gamesdk.HTTPClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.httpC = httpC
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

// NewMux 创建 HTTP 路由,挂载 MCP 端点、增强的健康检查与游戏服务器管理 API。
// mgr 用于 /health 端点的统计信息;httpC 用于探测游戏后端可达性;
// pool / db 用于 /admin/game-server 端点运行时切换游戏后端。
func NewMux(endpoint string, mcpServer *mcp.Server, cfg *config.Config, pool *account.Pool, mgr *session.Manager, httpC *gamesdk.HTTPClient, db *persistence.DB, startedAt time.Time) (http.Handler, *healthChecker) {
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

	// 游戏服务器 URL 管理(ADMIN_TOKEN 鉴权)
	mux.HandleFunc("/admin/game-server", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPut {
			w.Header().Set("Allow", "GET, PUT")
			http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
			return
		}
		if !requireAdminToken(r, cfg.AdminToken) {
			http.Error(w, "未授权:需要有效的 ADMIN_TOKEN", http.StatusForbidden)
			return
		}
		if r.Method == http.MethodGet {
			handleGetGameServer(w, r, mgr)
			return
		}
		handlePutGameServer(w, r, cfg, pool, mgr, db, checker)
	})

	return mux, checker
}

// gameServerResponse 是 /admin/game-server 的响应体。
type gameServerResponse struct {
	Success   bool   `json:"success"`
	GameAPIURL string `json:"gameApiUrl,omitempty"`
	GameWSURL  string `json:"gameWsUrl,omitempty"`
	Error     string `json:"error,omitempty"`
	Note      string `json:"note,omitempty"`
}

// handleGetGameServer 返回当前运行时生效的游戏后端 URL。
func handleGetGameServer(w http.ResponseWriter, _ *http.Request, mgr *session.Manager) {
	apiURL, wsURL := mgr.GameServerURLs()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(gameServerResponse{
		Success:    true,
		GameAPIURL: apiURL,
		GameWSURL:  wsURL,
	})
}

// handlePutGameServer 校验、持久化并热切换游戏后端 URL(仅对新会话生效)。
func handlePutGameServer(w http.ResponseWriter, r *http.Request, cfg *config.Config, pool *account.Pool, mgr *session.Manager, db *persistence.DB, checker *healthChecker) {
	var body struct {
		GameAPIURL string `json:"gameApiUrl"`
		GameWSURL  string `json:"gameWsUrl"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeGameServerError(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}

	// 读取当前值作为未提供字段的回退
	curAPI, curWS := mgr.GameServerURLs()
	newAPI := body.GameAPIURL
	newWS := body.GameWSURL
	if newAPI == "" {
		newAPI = curAPI
	}
	if newWS == "" {
		newWS = curWS
	}

	// 校验:scheme 必须正确
	if err := validateURL(newAPI, "http", "https"); err != nil {
		writeGameServerError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateURL(newWS, "ws", "wss"); err != nil {
		writeGameServerError(w, http.StatusBadRequest, err.Error())
		return
	}

	// 持久化
	if err := db.Settings.Set("game_api_url", newAPI); err != nil {
		writeGameServerError(w, http.StatusInternalServerError, "持久化 gameApiUrl 失败: "+err.Error())
		return
	}
	if err := db.Settings.Set("game_ws_url", newWS); err != nil {
		writeGameServerError(w, http.StatusInternalServerError, "持久化 gameWsUrl 失败: "+err.Error())
		return
	}

	// 构造新 HTTPClient(复制稳定性配置,熔断器重置)
	newHTTPC := gamesdk.NewHTTPClient(newAPI)
	newHTTPC.SetRetryMax(cfg.HTTPRetryMax)
	newCB := gamesdk.NewCircuitBreaker(cfg.HTTPCircuitBreakerThreshold,
		time.Duration(cfg.HTTPCircuitBreakerCooldown)*time.Second)
	newHTTPC.SetCircuitBreaker(newCB)

	// 热切换:Manager / Pool / healthChecker
	mgr.SetGameServer(newHTTPC, newWS)
	pool.SetRegistrar(newHTTPC)
	checker.SetHTTPClient(newHTTPC)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(gameServerResponse{
		Success:    true,
		GameAPIURL: newAPI,
		GameWSURL:  newWS,
		Note:       "仅对新会话生效;旧账户可能需要在新服务器重新注册",
	})
}

func writeGameServerError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(gameServerResponse{Success: false, Error: msg})
}

// validateURL 校验 URL 非空且 scheme 在允许列表中。
func validateURL(raw string, allowedSchemes ...string) error {
	if raw == "" {
		return fmt.Errorf("URL 不能为空")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("URL 解析失败(%s): %w", raw, err)
	}
	scheme := strings.ToLower(u.Scheme)
	for _, s := range allowedSchemes {
		if scheme == s {
			return nil
		}
	}
	return fmt.Errorf("URL scheme 必须为 %s 之一(当前: %s)", strings.Join(allowedSchemes, "/"), scheme)
}

// requireAdminToken 校验 Authorization: Bearer <token> 是否匹配预期的 admin token。
// expected 为空时直接拒绝(未配置 ADMIN_TOKEN)。
func requireAdminToken(r *http.Request, expected string) bool {
	if expected == "" {
		return false
	}
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return false
	}
	return strings.TrimPrefix(h, "Bearer ") == expected
}
