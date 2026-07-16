package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/darkforest/backend/internal/db"
)

// PlayerHandler handles player-related requests
type PlayerHandler struct {
	queries *db.Queries
}

// NewPlayerHandler creates a new player handler
func NewPlayerHandler(q *db.Queries) *PlayerHandler {
	return &PlayerHandler{queries: q}
}

// PlayerResponse represents player data in API responses
type PlayerResponse struct {
	ID           string `json:"id"`
	UserID       string `json:"userId"`
	DisplayName  string `json:"displayName"`
	Role         string `json:"role"`
	Avatar       int32  `json:"avatar"`
	Wins         int32  `json:"wins"`
	Losses       int32  `json:"losses"`
	Draws        int32  `json:"draws"`
	TotalMatches int32  `json:"totalMatches"`
	CreatedAt    string `json:"createdAt"`
}

// GetPlayer handles GET /api/player/{id}
func (h *PlayerHandler) GetPlayer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		WriteJSONError(w, "缺少玩家 ID", http.StatusBadRequest)
		return
	}

	playerUUID, err := parseUUID(id)
	if err != nil {
		WriteJSONError(w, "无效的玩家 ID", http.StatusBadRequest)
		return
	}

	player, err := h.queries.GetPlayerByID(r.Context(), playerUUID)
	if err != nil {
		WriteJSONError(w, "玩家不存在", http.StatusNotFound)
		return
	}

	response := PlayerResponse{
		ID:           uuidString(player.ID),
		UserID:       player.UserID,
		DisplayName:  player.DisplayName,
		Role:         player.Role,
		Avatar:       player.Avatar,
		Wins:         player.Wins,
		Losses:       player.Losses,
		Draws:        player.Draws,
		TotalMatches: player.TotalMatches,
		CreatedAt:    player.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"player":  response,
	})
}

// GetCurrentPlayer handles GET /api/player/me - returns current authenticated player's info
func (h *PlayerHandler) GetCurrentPlayer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	payload := GetAuthFromContext(r.Context())
	if payload == nil {
		WriteJSONError(w, "未认证", http.StatusUnauthorized)
		return
	}

	playerUUID, err := parseUUID(payload.PlayerID)
	if err != nil {
		WriteJSONError(w, "无效的用户 ID", http.StatusBadRequest)
		return
	}

	player, err := h.queries.GetPlayerByID(r.Context(), playerUUID)
	if err != nil {
		WriteJSONError(w, "玩家不存在", http.StatusNotFound)
		return
	}

	response := PlayerResponse{
		ID:           uuidString(player.ID),
		UserID:       player.UserID,
		DisplayName:  player.DisplayName,
		Role:         player.Role,
		Avatar:       player.Avatar,
		Wins:         player.Wins,
		Losses:       player.Losses,
		Draws:        player.Draws,
		TotalMatches: player.TotalMatches,
		CreatedAt:    player.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"player":  response,
	})
}

// GetPlayerByDisplayName handles GET /api/player/by-name/{displayName}
func (h *PlayerHandler) GetPlayerByDisplayName(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	displayName := r.PathValue("displayName")
	if displayName == "" {
		WriteJSONError(w, "缺少玩家名称", http.StatusBadRequest)
		return
	}

	player, err := h.queries.GetPlayerByDisplayName(r.Context(), displayName)
	if err != nil {
		WriteJSONError(w, "玩家不存在", http.StatusNotFound)
		return
	}

	response := PlayerResponse{
		ID:           uuidString(player.ID),
		UserID:       player.UserID,
		DisplayName:  player.DisplayName,
		Role:         player.Role,
		Avatar:       player.Avatar,
		Wins:         player.Wins,
		Losses:       player.Losses,
		Draws:        player.Draws,
		TotalMatches: player.TotalMatches,
		CreatedAt:    player.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"player":  response,
	})
}

// formatWinRate formats win rate as percentage string
func formatWinRate(rate float64) string {
	if rate == 100 {
		return "100%"
	}
	return fmt.Sprintf("%.1f%%", rate)
}

// ListAllPlayers handles GET /api/player - lists all players (admin only)
func (h *PlayerHandler) ListAllPlayers(w http.ResponseWriter, r *http.Request) {
	players, err := h.queries.ListPlayers(r.Context(), db.ListPlayersParams{
		Limit:  1000,
		Offset: 0,
	})
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	result := make([]PlayerResponse, 0, len(players))
	for _, p := range players {
		result = append(result, PlayerResponse{
			ID:           uuidString(p.ID),
			UserID:       p.UserID,
			DisplayName:  p.DisplayName,
			Role:         p.Role,
			Avatar:       p.Avatar,
			Wins:         p.Wins,
			Losses:       p.Losses,
			Draws:        p.Draws,
			TotalMatches: p.TotalMatches,
			CreatedAt:    p.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"players": result,
	})
}

// GetPlayerStats handles GET /api/player/{id}/stats
func (h *PlayerHandler) GetPlayerStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		WriteJSONError(w, "缺少玩家 ID", http.StatusBadRequest)
		return
	}

	playerUUID, err := parseUUID(id)
	if err != nil {
		WriteJSONError(w, "无效的玩家 ID", http.StatusBadRequest)
		return
	}

	player, err := h.queries.GetPlayerByID(r.Context(), playerUUID)
	if err != nil {
		WriteJSONError(w, "玩家不存在", http.StatusNotFound)
		return
	}

	// Calculate win rate
	var winRate, lossRate, drawRate float64
	if player.TotalMatches > 0 {
		winRate = float64(player.Wins) / float64(player.TotalMatches) * 100
		lossRate = float64(player.Losses) / float64(player.TotalMatches) * 100
		drawRate = float64(player.Draws) / float64(player.TotalMatches) * 100
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"stats": map[string]interface{}{
			"playerId":     uuidString(player.ID),
			"displayName":  player.DisplayName,
			"wins":         player.Wins,
			"losses":       player.Losses,
			"draws":        player.Draws,
			"totalMatches": player.TotalMatches,
			"winRate":      formatWinRate(winRate),
			"lossRate":     formatWinRate(lossRate),
			"drawRate":     formatWinRate(drawRate),
		},
	})
}
