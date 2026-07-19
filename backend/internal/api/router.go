package api

import (
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"

	"github.com/darkforest/backend/internal/config"
	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/hub"
	"github.com/darkforest/backend/internal/replay"
	"github.com/darkforest/backend/internal/rooms"
)

// Router handles HTTP routing
type Router struct {
	mux         *http.ServeMux
	config      *config.Config
	logger      *slog.Logger
	queries     *db.Queries
	wsHub       *hub.Hub
	replay      *replay.Service
	roomManager *rooms.RoomManager
}

// NewRouter creates a new router.
// replaySvc 用于注入给 replay handler，与 RoomManager 共享同一实例。
func NewRouter(cfg *config.Config, logger *slog.Logger, q *db.Queries, ws *hub.Hub, replaySvc *replay.Service, rm *rooms.RoomManager) *Router {
	return &Router{
		mux:         http.NewServeMux(),
		config:      cfg,
		logger:      logger,
		queries:     q,
		wsHub:       ws,
		replay:      replaySvc,
		roomManager: rm,
	}
}

// SetupRoutes registers all routes
func (r *Router) SetupRoutes() {
	// Static files - serve frontend
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "./frontend/dist"
	}

	// Serve static files with proper MIME types
	// For /assets/ routes, serve from staticDir/assets/
	assetsHandler := &staticFileHandler{dir: http.Dir(staticDir + "/assets")}
	r.mux.Handle("/assets/", http.StripPrefix("/assets/", assetsHandler))

	// For root-level static files (favicon, icons), serve from staticDir directly
	rootHandler := &staticFileHandler{dir: http.Dir(staticDir)}
	r.mux.Handle("/favicon.svg", rootHandler)
	r.mux.Handle("/icons.svg", rootHandler)

	// Health check endpoint
	healthHandler := NewHealthHandler("1.0.0")
	r.mux.Handle("GET /api/health", healthHandler)

	// Sensitive words endpoint (public, no-auth)
	// 词表为占位测试词，无敏感政治内容，前端需拉取并缓存以用于预览过滤。
	r.mux.Handle("GET /api/sensitive-words", http.HandlerFunc(SensitiveWordsHandler))

	// Auth routes (public) — 加 IP 级速率限制防暴力破解
	authHandler := NewAuthHandler(r.queries)
	authRateLimit := RateLimitMiddleware(5.0/60.0, 5)     // 5 次/分钟
	adminSetupRateLimit := RateLimitMiddleware(3.0/60.0, 3) // 3 次/分钟(更严格,配合管理员密钥)
	r.mux.Handle("POST /api/auth/login", Chain(http.HandlerFunc(authHandler.Login), authRateLimit))
	r.mux.Handle("POST /api/auth/register", Chain(http.HandlerFunc(authHandler.Register), authRateLimit))
	r.mux.Handle("POST /api/auth/admin-setup", Chain(http.HandlerFunc(authHandler.AdminSetup), adminSetupRateLimit))

	// Auth routes (protected - admin only)
	createInviteHandler := Chain(http.HandlerFunc(authHandler.CreateInvite), AuthMiddleware)
	r.mux.Handle("POST /api/auth/invite", createInviteHandler)

	listInvitesHandler := Chain(http.HandlerFunc(authHandler.ListInvites), AuthMiddleware)
	r.mux.Handle("GET /api/auth/invite", listInvitesHandler)

	// Player routes
	playerHandler := NewPlayerHandler(r.queries)
	r.mux.Handle("GET /api/player", Chain(http.HandlerFunc(playerHandler.ListAllPlayers), AuthMiddleware, AdminRequiredMiddleware))
	r.mux.Handle("GET /api/player/me", Chain(http.HandlerFunc(playerHandler.GetCurrentPlayer), AuthMiddleware))
	r.mux.Handle("GET /api/player/{id}", http.HandlerFunc(playerHandler.GetPlayer))
	r.mux.Handle("GET /api/player/by-name/{displayName}", http.HandlerFunc(playerHandler.GetPlayerByDisplayName))
	r.mux.Handle("GET /api/player-stats/{id}", http.HandlerFunc(playerHandler.GetPlayerStats))

	// Replay routes (protected) - share the same replayService instance
	// that was injected into RoomManager, so writes & reads use the same layer.
	// 权限模型：
	//   - GET /api/replay/list        — 当前登录用户的回放列表（无公开列表）
	//   - GET /api/replay/{id}        — UUID 作为 capability token（= 分享链接），任意已登录用户可访问
	//   - GET /api/replay/match/{id}  — 参与者校验（matchID 可能可被枚举）
	//   - GET /api/replay/player/{id} — 仅本人或 admin
	//   - DELETE /api/replay/{id}     — 仅 admin
	replayHandler := NewReplayHandler(r.queries, r.replay)
	r.mux.Handle("GET /api/replay/list", Chain(http.HandlerFunc(replayHandler.ListReplays), AuthMiddleware))
	r.mux.Handle("GET /api/replay/{id}", Chain(http.HandlerFunc(replayHandler.GetReplayByID), AuthMiddleware))
	r.mux.Handle("GET /api/replay/match/{matchId}", Chain(http.HandlerFunc(replayHandler.GetReplayByMatchID), AuthMiddleware))
	r.mux.Handle("GET /api/replay/player/{playerId}", Chain(http.HandlerFunc(replayHandler.ListReplaysByPlayer), AuthMiddleware))
	r.mux.Handle("DELETE /api/replay/{id}", Chain(http.HandlerFunc(replayHandler.DeleteReplay), AuthMiddleware, AdminRequiredMiddleware))

	// WebSocket endpoint — 加连接频率限制
	wsRateLimit := RateLimitMiddleware(10.0/60.0, 10) // 10 次/分钟
	r.mux.Handle("/ws", Chain(hub.Handler(r.wsHub), wsRateLimit))

	// Game rules routes
	rulesHandler := NewRulesHandler(r.roomManager)
	r.mux.Handle("GET /api/game/rules", http.HandlerFunc(rulesHandler.HandleGetAllRules))
	r.mux.Handle("GET /api/rooms/{roomId}/rules",
		Chain(http.HandlerFunc(rulesHandler.HandleGetRoomRules), AuthMiddleware))

	// Catch-all for SPA - serve index.html for all other routes
	r.mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Don't serve index.html for API routes
		if len(r.URL.Path) > 4 && r.URL.Path[:4] == "/api" {
			http.NotFound(w, r)
			return
		}
		// Don't serve index.html for WebSocket endpoint
		if r.URL.Path == "/ws" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, staticDir+"/index.html")
	}))
}

// Handler returns the http.Handler with middleware applied
func (r *Router) Handler() http.Handler {
	// Apply middleware in reverse order (last middleware is applied first)
	handler := Chain(r.mux,
		SecurityHeadersMiddleware(r.config),
		RecoveryMiddleware(r.logger),
		LoggingMiddleware(r.logger),
		CORSMiddleware(r.config),
		RequestIDMiddleware,
	)

	return handler
}

// staticFileHandler serves static files with proper MIME types
type staticFileHandler struct {
	dir http.FileSystem
}

func (h *staticFileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Get the file path
	path := r.URL.Path
	if path == "" {
		path = "/"
	}

	// Open the file
	f, err := h.dir.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	// Get file info
	fi, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	// Set proper Content-Type header based on file extension
	ext := filepath.Ext(path)
	mimeType := getMimeType(ext)
	w.Header().Set("Content-Type", mimeType)

	// Serve the file
	http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
}

// getMimeType returns MIME type for common file extensions
func getMimeType(ext string) string {
	switch ext {
	case ".css":
		return "text/css; charset=utf-8"
	case ".js":
		return "application/javascript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".eot":
		return "application/vnd.ms-fontobject"
	default:
		// Try standard library first, then fallback
		if mimeType := mime.TypeByExtension(ext); mimeType != "" {
			return mimeType
		}
		return "application/octet-stream"
	}
}
