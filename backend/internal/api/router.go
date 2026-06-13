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
)

// Router handles HTTP routing
type Router struct {
	mux     *http.ServeMux
	config  *config.Config
	logger  *slog.Logger
	queries *db.Queries
	wsHub   *hub.Hub
}

// NewRouter creates a new router
func NewRouter(cfg *config.Config, logger *slog.Logger, q *db.Queries, ws *hub.Hub) *Router {
	return &Router{
		mux:     http.NewServeMux(),
		config:  cfg,
		logger:  logger,
		queries: q,
		wsHub:   ws,
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

	// Auth routes (public)
	authHandler := NewAuthHandler(r.queries)
	r.mux.Handle("POST /api/auth/login", http.HandlerFunc(authHandler.Login))
	r.mux.Handle("POST /api/auth/register", http.HandlerFunc(authHandler.Register))
	r.mux.Handle("POST /api/auth/admin-setup", http.HandlerFunc(authHandler.AdminSetup))

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

	// Leaderboard (public)
	r.mux.Handle("GET /api/leaderboard", http.HandlerFunc(playerHandler.GetLeaderboard))

	// Replay routes (protected)
	replayHandler := NewReplayHandler(r.queries)
	r.mux.Handle("GET /api/replay/{id}", Chain(http.HandlerFunc(replayHandler.GetReplayByID), AuthMiddleware))
	r.mux.Handle("GET /api/replay/match/{matchId}", Chain(http.HandlerFunc(replayHandler.GetReplayByMatchID), AuthMiddleware))
	r.mux.Handle("GET /api/replay/list", Chain(http.HandlerFunc(replayHandler.ListReplays), AuthMiddleware))
	r.mux.Handle("GET /api/replay/player/{playerId}", Chain(http.HandlerFunc(replayHandler.ListReplaysByPlayer), AuthMiddleware))
	r.mux.Handle("DELETE /api/replay/{id}", Chain(http.HandlerFunc(replayHandler.DeleteReplay), AuthMiddleware))

	// WebSocket endpoint
	r.mux.HandleFunc("/ws", hub.Handler(r.wsHub))

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
