package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/replay"
)

// ReplayHandler handles replay-related API requests
type ReplayHandler struct {
	replayService *replay.Service
}

// NewReplayHandler creates a new replay handler
func NewReplayHandler(queries *db.Queries) *ReplayHandler {
	return &ReplayHandler{
		replayService: replay.NewService(queries, nil),
	}
}

// GetReplayByID handles GET /api/replay/{id}
func (h *ReplayHandler) GetReplayByID(w http.ResponseWriter, r *http.Request) {
	replayID := r.PathValue("id")
	if replayID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	replayData, err := h.replayService.GetReplay(context.Background(), replayID)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(replayData)
}

// GetReplayByMatchID handles GET /api/replay/match/{matchId}
func (h *ReplayHandler) GetReplayByMatchID(w http.ResponseWriter, r *http.Request) {
	matchID := r.PathValue("matchId")
	if matchID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	replayData, err := h.replayService.GetReplayByMatchID(context.Background(), matchID)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(replayData)
}

// ListReplays handles GET /api/replay/list
func (h *ReplayHandler) ListReplays(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	limit := int32(20)
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = int32(l)
		}
	}

	offset := int32(0)
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = int32(o)
		}
	}

	replays, err := h.replayService.ListReplays(context.Background(), limit, offset)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(replays)
}

// ListReplaysByPlayer handles GET /api/replay/player/{playerId}
func (h *ReplayHandler) ListReplaysByPlayer(w http.ResponseWriter, r *http.Request) {
	playerID := r.PathValue("playerId")
	if playerID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	limit := int32(20)
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = int32(l)
		}
	}

	offset := int32(0)
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = int32(o)
		}
	}

	replays, err := h.replayService.ListReplaysByPlayer(context.Background(), playerID, limit, offset)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(replays)
}

// DeleteReplay handles DELETE /api/replay/{id}
func (h *ReplayHandler) DeleteReplay(w http.ResponseWriter, r *http.Request) {
	replayID := r.PathValue("id")
	if replayID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	err := h.replayService.DeleteReplay(context.Background(), replayID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
