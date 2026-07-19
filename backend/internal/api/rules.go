package api

import (
	"encoding/json"
	"net/http"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/rooms"
)

// RulesHandler handles game rules API requests.
type RulesHandler struct {
	roomManager *rooms.RoomManager
}

// NewRulesHandler creates a new rules handler.
func NewRulesHandler(rm *rooms.RoomManager) *RulesHandler {
	return &RulesHandler{
		roomManager: rm,
	}
}

// HandleGetAllRules handles GET /api/game/rules
// 返回所有游戏模式的完整规则信息。无需认证。
func (h *RulesHandler) HandleGetAllRules(w http.ResponseWriter, r *http.Request) {
	rules := game.GetAllRules()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(rules)
}

// HandleGetRoomRules handles GET /api/rooms/{roomId}/rules
// 返回指定房间的游戏规则（根据房间的游戏模式过滤）。需要认证，玩家须在房间内。
func (h *RulesHandler) HandleGetRoomRules(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("roomId")
	if roomID == "" {
		WriteJSONError(w, "缺少房间 ID", http.StatusBadRequest)
		return
	}

	// 验证认证
	payload := GetAuthFromContext(r.Context())
	if payload == nil {
		WriteJSONError(w, "未授权访问", http.StatusUnauthorized)
		return
	}

	// 查找房间
	room := h.roomManager.GetRoom(roomID)
	if room == nil {
		WriteJSONError(w, "房间不存在", http.StatusNotFound)
		return
	}

	// 校验请求者是否在房间内
	if !room.HasPlayer(payload.PlayerID) {
		WriteJSONError(w, "未加入该房间", http.StatusForbidden)
		return
	}

	// 获取该房间模式对应的规则；自定义房间则用 room.CustomRules 覆盖预设。
	// 与后端对局引擎 StateRules(state) 语义一致：customRules 优先于 GameMode 预设。
	rules := game.GetRoomRulesWithOverrides(roomID, string(room.GameMode), room.CustomRules)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(rules)
}
