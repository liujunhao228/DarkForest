package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"time"
)

// HealthResponse represents the health check response
type HealthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Timestamp string `json:"timestamp"`
	Uptime    int    `json:"uptime"`
	Memory    Memory `json:"memory"`
	Env       string `json:"env"`
}

// Memory represents memory usage information
type Memory struct {
	RSS      string `json:"rss"`
	HeapUsed string `json:"heapUsed"`
}

// HealthHandler handles health check requests
type HealthHandler struct {
	startTime time.Time
	version   string
	env       string
}

// NewHealthHandler creates a new health handler
func NewHealthHandler(version string) *HealthHandler {
	return &HealthHandler{
		startTime: time.Now(),
		version:   version,
		env:       "development",
	}
}

// ServeHTTP handles GET /api/health requests
func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only allow GET method
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	uptime := time.Since(h.startTime)

	// Get memory stats
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	response := HealthResponse{
		Status:    "ok",
		Version:   h.version,
		Timestamp: time.Now().Format(time.RFC3339),
		Uptime:    int(uptime.Seconds()),
		Memory: Memory{
			RSS:      formatBytes(m.Sys),
			HeapUsed: formatBytes(m.HeapAlloc),
		},
		Env: h.env,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// formatBytes converts bytes to human-readable string
func formatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%d %cB", b/div, "KMGTPE"[exp])
}