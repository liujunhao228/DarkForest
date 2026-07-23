package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/replay"
	"github.com/jackc/pgx/v5"
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
	ID          string                `json:"id"`
	MatchID     string                `json:"matchId"`
	PlayerIDs   []string              `json:"playerIds"`
	PlayerNames []string              `json:"playerNames"`
	Actions     []replay.ActionRecord `json:"actions"`
	States      []*game.GameState     `json:"states"`
	Winner      string                `json:"winner,omitempty"`
	TotalTurns  int                   `json:"totalTurns"`
	CreatedAt   int64                 `json:"createdAt"`
}

// ListReplaysResponse 是列表端点的响应结构，仅含摘要项。
type ListReplaysResponse struct {
	Replays []*replay.ReplayListItem `json:"replays"`
}

// buildReplayResponse 组装完整回放响应（含 states 快照）。
// 复用此函数避免 GetReplayByID / GetReplayByMatchID 重复逻辑。
func buildReplayResponse(replayData *replay.ReplayData, w http.ResponseWriter) bool {
	states, err := replay.GenerateStateSnapshots(replayData.InitialState, replayData.Actions)
	if err != nil {
		slog.Default().Error("failed to generate state snapshots",
			"replayId", replayData.ID, "error", err)
		WriteJSONError(w, "回放数据损坏，无法重放", http.StatusInternalServerError)
		return false
	}

	// 追加 finalState 作为最后一个快照（兜底结束/断线重连等场景下
	// 最后一条 action 不包含 Phase=GameOver 的状态）。
	if replayData.FinalState != nil && len(states) > 0 {
		if states[len(states)-1].Phase != game.GamePhaseGameOver {
			states = append(states, replayData.FinalState)
		}
	}

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
	return true
}

// GetReplayByID handles GET /api/replay/{id}
// 回放 UUID 作为不可猜测的 capability token（= 分享链接），任意已登录用户可访问。
func (h *ReplayHandler) GetReplayByID(w http.ResponseWriter, r *http.Request) {
	replayID := r.PathValue("id")
	if replayID == "" {
		WriteJSONError(w, "缺少回放 ID", http.StatusBadRequest)
		return
	}

	replayData, err := h.replayService.GetReplay(context.Background(), replayID)
	if err != nil {
		writeReplayDBError(w, err, "回放不存在")
		return
	}

	buildReplayResponse(replayData, w)
}

// GetReplayByMatchID handles GET /api/replay/match/{matchId}
// matchID 不像 replayUUID 那样是对外不暴露的随机 UUID，可能可被枚举，
// 因此保守地校验请求者是否为该对局参与者。
func (h *ReplayHandler) GetReplayByMatchID(w http.ResponseWriter, r *http.Request) {
	matchID := r.PathValue("matchId")
	if matchID == "" {
		WriteJSONError(w, "缺少对局 ID", http.StatusBadRequest)
		return
	}

	replayData, err := h.replayService.GetReplayByMatchID(context.Background(), matchID)
	if err != nil {
		writeReplayDBError(w, err, "回放不存在")
		return
	}

	// 参与者校验：仅对局参与者可按 matchID 查询回放
	payload := GetAuthFromContext(r.Context())
	if payload == nil {
		WriteJSONError(w, "未授权访问", http.StatusUnauthorized)
		return
	}
	if payload.Role != "admin" && !containsString(replayData.PlayerIDs, payload.PlayerID) {
		WriteJSONError(w, "无权查看该对局回放", http.StatusForbidden)
		return
	}

	buildReplayResponse(replayData, w)
}

// ListReplays handles GET /api/replay/list
// 返回当前登录用户的回放列表（无公开列表，仅本人可见）。
// 管理员如需查看他人列表请使用 /api/replay/player/{playerId}。
func (h *ReplayHandler) ListReplays(w http.ResponseWriter, r *http.Request) {
	payload := GetAuthFromContext(r.Context())
	if payload == nil {
		WriteJSONError(w, "未授权访问", http.StatusUnauthorized)
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

	items, err := h.replayService.ListReplayItemsByPlayer(context.Background(), payload.PlayerID, limit, offset)
	if err != nil {
		slog.Default().Error("failed to list replays", "playerId", payload.PlayerID, "error", err)
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	response := ListReplaysResponse{Replays: items}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// ListReplaysByPlayer handles GET /api/replay/player/{playerId}
// 仅允许查看自己的回放列表，管理员可查看任意玩家。
func (h *ReplayHandler) ListReplaysByPlayer(w http.ResponseWriter, r *http.Request) {
	payload := GetAuthFromContext(r.Context())
	if payload == nil {
		WriteJSONError(w, "未授权访问", http.StatusUnauthorized)
		return
	}

	playerID := r.PathValue("playerId")
	if playerID == "" {
		WriteJSONError(w, "缺少玩家 ID", http.StatusBadRequest)
		return
	}

	// 所有权校验：仅允许查看自己的回放列表，管理员可查看任意玩家
	if payload.PlayerID != playerID && payload.Role != "admin" {
		WriteJSONError(w, "无权查看该玩家的回放列表", http.StatusForbidden)
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

	items, err := h.replayService.ListReplayItemsByPlayer(context.Background(), playerID, limit, offset)
	if err != nil {
		slog.Default().Error("failed to list replays by player", "playerId", playerID, "error", err)
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	response := ListReplaysResponse{Replays: items}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// DeleteReplay handles DELETE /api/replay/{id}
// 仅管理员可删除（路由层挂 AdminRequiredMiddleware）。
func (h *ReplayHandler) DeleteReplay(w http.ResponseWriter, r *http.Request) {
	replayID := r.PathValue("id")
	if replayID == "" {
		WriteJSONError(w, "缺少回放 ID", http.StatusBadRequest)
		return
	}

	err := h.replayService.DeleteReplay(context.Background(), replayID)
	if err != nil {
		writeReplayDBError(w, err, "回放不存在")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// writeReplayDBError 统一处理回放 DB 错误：ErrNoRows → 404，其他 → 500。
func writeReplayDBError(w http.ResponseWriter, err error, notFoundMsg string) {
	if errors.Is(err, pgx.ErrNoRows) {
		WriteJSONError(w, notFoundMsg, http.StatusNotFound)
		return
	}
	slog.Default().Error("replay db error", "error", err)
	WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
}

// containsString 报告 s 是否包含 target。
func containsString(s []string, target string) bool {
	for _, v := range s {
		if v == target {
			return true
		}
	}
	return false
}
