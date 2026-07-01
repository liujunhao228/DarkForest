package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/replay"
)

// ReplayHandler handles replay-related API requests
type ReplayHandler struct {
	replayService *replay.Service
}

// NewReplayHandler creates a new replay handler.
// svc 是已注入的 replay.Service 实例（与 RoomManager 共享同一实例）。
func NewReplayHandler(queries *db.Queries, svc *replay.Service) *ReplayHandler {
	return &ReplayHandler{
		replayService: svc,
	}
}

// ReplayResponse is the response structure for replay data with state snapshots
type ReplayResponse struct {
	ID           string          `json:"id"`
	MatchID      string          `json:"matchId"`
	PlayerIDs    []string        `json:"playerIds"`
	PlayerNames  []string        `json:"playerNames"`
	Actions      []replay.ActionRecord `json:"actions"`
	States       []*game.GameState `json:"states"`
	Winner       string           `json:"winner,omitempty"`
	TotalTurns   int              `json:"totalTurns"`
	CreatedAt    int64           `json:"createdAt"`
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

	// Generate state snapshots for replay playback
	states, _ := replay.GenerateStateSnapshots(replayData.InitialState, replayData.Actions)

	response := ReplayResponse{
		ID:          replayData.ID,
		MatchID:     replayData.MatchID,
		PlayerIDs:   replayData.PlayerIDs,
		PlayerNames: replayData.PlayerNames,
		Actions:     replayData.Actions,
		States:      states,
		CreatedAt:   replayData.CreatedAt,
	}

	if replayData.FinalState != nil {
		if replayData.FinalState.Winner != nil {
			response.Winner = *replayData.FinalState.Winner
		}
		response.TotalTurns = replayData.FinalState.TotalTurn
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
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

	// Generate state snapshots for replay playback
	states, _ := replay.GenerateStateSnapshots(replayData.InitialState, replayData.Actions)

	response := ReplayResponse{
		ID:          replayData.ID,
		MatchID:     replayData.MatchID,
		PlayerIDs:   replayData.PlayerIDs,
		PlayerNames: replayData.PlayerNames,
		Actions:     replayData.Actions,
		States:      states,
		CreatedAt:   replayData.CreatedAt,
	}

	if replayData.FinalState != nil {
		if replayData.FinalState.Winner != nil {
			response.Winner = *replayData.FinalState.Winner
		}
		response.TotalTurns = replayData.FinalState.TotalTurn
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
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
