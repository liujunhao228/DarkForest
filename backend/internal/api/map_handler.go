package api

import (
	"encoding/json"
	"net/http"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// MapHandler 处理地图 CRUD API 请求。
type MapHandler struct {
	queries *db.Queries
}

// NewMapHandler 创建 MapHandler。
func NewMapHandler(queries *db.Queries) *MapHandler {
	return &MapHandler{queries: queries}
}

// mapResponse 是地图 API 的响应格式。
type mapResponse struct {
	ID          string  `json:"id"`
	Slug        *string `json:"slug"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	IsOfficial  bool    `json:"isOfficial"`
	CreatedBy   *string `json:"createdBy,omitempty"`
	Version     int32   `json:"version"`
	LayoutJSON  json.RawMessage `json:"layoutJson"`
	CreatedAt   int64   `json:"createdAt"`
	UpdatedAt   int64   `json:"updatedAt"`
}

func mapToResponse(m db.Map) mapResponse {
	resp := mapResponse{
		ID:          uuidString(m.ID),
		Slug:        m.Slug,
		Name:        m.Name,
		Description: m.Description,
		IsOfficial:  m.IsOfficial,
		Version:     m.Version,
		LayoutJSON:  json.RawMessage(m.LayoutJson),
		CreatedAt:   m.CreatedAt.Time.Unix(),
		UpdatedAt:   m.UpdatedAt.Time.Unix(),
	}
	if m.CreatedBy.Valid {
		resp.CreatedBy = strPtr(uuidString(m.CreatedBy))
	}
	return resp
}

// ListMaps 处理 GET /api/maps — 列出官方地图（公开）。
func (h *MapHandler) ListMaps(w http.ResponseWriter, r *http.Request) {
	maps, err := h.queries.ListOfficialMaps(r.Context())
	if err != nil {
		WriteJSONError(w, "获取地图列表失败", http.StatusInternalServerError)
		return
	}

	resp := make([]mapResponse, 0, len(maps))
	for _, m := range maps {
		resp = append(resp, mapToResponse(m))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// GetMapByID 处理 GET /api/maps/{id} — 获取单张地图（公开）。
func (h *MapHandler) GetMapByID(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	if idStr == "" {
		WriteJSONError(w, "缺少地图 ID", http.StatusBadRequest)
		return
	}

	mapUUID, err := uuid.Parse(idStr)
	if err != nil {
		WriteJSONError(w, "无效的地图 ID", http.StatusBadRequest)
		return
	}

	m, err := h.queries.GetMapByID(r.Context(), pgtype.UUID{Bytes: mapUUID, Valid: true})
	if err != nil {
		WriteJSONError(w, "地图不存在", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mapToResponse(m))
}

// createMapRequest 是 CreateMap 的请求体。
type createMapRequest struct {
	Name        string                  `json:"name"`
	Description string                  `json:"description"`
	Slug        string                  `json:"slug"`
	LayoutJSON  *game.MapLayoutSnapshot `json:"layoutJson"`
}

// CreateMap 处理 POST /api/maps — 创建地图（role-aware）。
// P3: 由 admin-only 改为 role-aware：
//   - admin：可创建官方地图（is_official=true），可设 slug，无配额，仍走敏感词校验
//   - 普通用户：创建个人地图（is_official=false），slug 强制 NULL，受 10 张/用户配额约束
//   - name/description 命中敏感词一律拒绝（400）
func (h *MapHandler) CreateMap(w http.ResponseWriter, r *http.Request) {
	var req createMapRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, "无效的请求体", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		WriteJSONError(w, "地图名称不能为空", http.StatusBadRequest)
		return
	}

	if req.LayoutJSON == nil {
		WriteJSONError(w, "layoutJson 不能为空", http.StatusBadRequest)
		return
	}

	// 敏感词校验：admin 与普通用户均校验，保证一致性
	if _, err := game.SanitizeUserText(req.Name, game.SanitizeContextQueueName); err != nil {
		WriteJSONError(w, "地图名称包含违规内容", http.StatusBadRequest)
		return
	}
	if req.Description != "" {
		if _, err := game.SanitizeUserText(req.Description, game.SanitizeContextQueueName); err != nil {
			WriteJSONError(w, "地图描述包含违规内容", http.StatusBadRequest)
			return
		}
	}

	// 校验布局合法性
	if err := game.ValidateMap(req.LayoutJSON.Nodes, req.LayoutJSON.Edges); err != nil {
		WriteJSONError(w, "地图校验失败: "+err.Error(), http.StatusBadRequest)
		return
	}

	layoutBytes, err := json.Marshal(req.LayoutJSON)
	if err != nil {
		WriteJSONError(w, "序列化布局失败", http.StatusInternalServerError)
		return
	}

	// 从 auth context 获取创建者 ID
	payload := GetAuthFromContext(r.Context())
	var createdBy pgtype.UUID
	if payload != nil {
		if parsed, err := uuid.Parse(payload.PlayerID); err == nil {
			createdBy = pgtype.UUID{Bytes: parsed, Valid: true}
		}
	}

	// P3: role-aware 分支
	isAdmin := payload != nil && payload.Role == "admin"
	isOfficial := isAdmin

	// 普通用户配额检查：10 张/用户（仅统计个人地图 is_official=false）
	if !isAdmin {
		if createdBy.Valid {
			count, err := h.queries.CountUserMaps(r.Context(), createdBy)
			if err != nil {
				WriteJSONError(w, "查询地图配额失败", http.StatusInternalServerError)
				return
			}
			if count >= 10 {
				WriteJSONError(w, "已达上传配额上限（10 张/用户）", http.StatusTooManyRequests)
				return
			}
		}
	}

	mapUUID := uuid.New()
	var slugPtr *string
	// P3: 仅 admin 可设 slug；普通用户强制 NULL，避免占用官方地图命名空间
	if isAdmin && req.Slug != "" {
		slugPtr = strPtr(req.Slug)
	}
	var descPtr *string
	if req.Description != "" {
		descPtr = strPtr(req.Description)
	}

	m, err := h.queries.CreateMap(r.Context(), db.CreateMapParams{
		ID:          pgtype.UUID{Bytes: mapUUID, Valid: true},
		Slug:        slugPtr,
		Name:        req.Name,
		Description: descPtr,
		IsOfficial:  isOfficial,
		CreatedBy:   createdBy,
		Version:     1,
		LayoutJson:  layoutBytes,
	})
	if err != nil {
		WriteJSONError(w, "创建地图失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(mapToResponse(m))
}

// updateMapRequest 是 UpdateMap 的请求体。
type updateMapRequest struct {
	Name        string                  `json:"name"`
	Description string                  `json:"description"`
	LayoutJSON  *game.MapLayoutSnapshot `json:"layoutJson"`
}

// UpdateMap 处理 PUT /api/maps/{id} — 更新地图（仅创建者或 admin）。
// P3: 由 admin-only 改为所有权校验；name/description 走敏感词校验。
func (h *MapHandler) UpdateMap(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	if idStr == "" {
		WriteJSONError(w, "缺少地图 ID", http.StatusBadRequest)
		return
	}

	mapUUID, err := uuid.Parse(idStr)
	if err != nil {
		WriteJSONError(w, "无效的地图 ID", http.StatusBadRequest)
		return
	}

	pgMapID := pgtype.UUID{Bytes: mapUUID, Valid: true}

	// P3: 所有权校验——仅创建者或 admin 可修改
	payload := GetAuthFromContext(r.Context())
	existing, err := h.queries.GetMapByID(r.Context(), pgMapID)
	if err != nil {
		WriteJSONError(w, "地图不存在", http.StatusNotFound)
		return
	}
	if payload == nil || (uuidString(existing.CreatedBy) != payload.PlayerID && payload.Role != "admin") {
		WriteJSONError(w, "无权修改他人地图", http.StatusForbidden)
		return
	}

	var req updateMapRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, "无效的请求体", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		WriteJSONError(w, "地图名称不能为空", http.StatusBadRequest)
		return
	}

	// P3: 敏感词校验
	if _, err := game.SanitizeUserText(req.Name, game.SanitizeContextQueueName); err != nil {
		WriteJSONError(w, "地图名称包含违规内容", http.StatusBadRequest)
		return
	}
	if req.Description != "" {
		if _, err := game.SanitizeUserText(req.Description, game.SanitizeContextQueueName); err != nil {
			WriteJSONError(w, "地图描述包含违规内容", http.StatusBadRequest)
			return
		}
	}

	if req.LayoutJSON == nil {
		WriteJSONError(w, "layoutJson 不能为空", http.StatusBadRequest)
		return
	}

	if err := game.ValidateMap(req.LayoutJSON.Nodes, req.LayoutJSON.Edges); err != nil {
		WriteJSONError(w, "地图校验失败: "+err.Error(), http.StatusBadRequest)
		return
	}

	layoutBytes, err := json.Marshal(req.LayoutJSON)
	if err != nil {
		WriteJSONError(w, "序列化布局失败", http.StatusInternalServerError)
		return
	}

	var descPtr *string
	if req.Description != "" {
		descPtr = strPtr(req.Description)
	}

	m, err := h.queries.UpdateMap(r.Context(), db.UpdateMapParams{
		ID:          pgMapID,
		Name:        req.Name,
		Description: descPtr,
		LayoutJson:  layoutBytes,
	})
	if err != nil {
		WriteJSONError(w, "更新地图失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mapToResponse(m))
}

// DeleteMap 处理 DELETE /api/maps/{id} — 删除地图（仅创建者或 admin）。
// P3: 所有权校验 + waiting 房间引用阻止。
//   - 所有权：仅创建者或 admin 可删除（403）
//   - waiting 阻止：被 status='waiting' 的 custom_match_queues 引用时返回 409
//   - playing/finished 房间引用的地图可删，对局靠 MapSnapshot 不受影响
func (h *MapHandler) DeleteMap(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	if idStr == "" {
		WriteJSONError(w, "缺少地图 ID", http.StatusBadRequest)
		return
	}

	mapUUID, err := uuid.Parse(idStr)
	if err != nil {
		WriteJSONError(w, "无效的地图 ID", http.StatusBadRequest)
		return
	}

	pgMapID := pgtype.UUID{Bytes: mapUUID, Valid: true}

	// P3: 所有权校验——仅创建者或 admin 可删除
	payload := GetAuthFromContext(r.Context())
	existing, err := h.queries.GetMapByID(r.Context(), pgMapID)
	if err != nil {
		WriteJSONError(w, "地图不存在", http.StatusNotFound)
		return
	}
	if payload == nil || (uuidString(existing.CreatedBy) != payload.PlayerID && payload.Role != "admin") {
		WriteJSONError(w, "无权删除他人地图", http.StatusForbidden)
		return
	}

	// P3: waiting 房间引用阻止
	waitingCount, err := h.queries.CountWaitingRoomsByMapID(r.Context(), pgMapID)
	if err != nil {
		WriteJSONError(w, "检查房间引用失败", http.StatusInternalServerError)
		return
	}
	if waitingCount > 0 {
		WriteJSONError(w, "地图被 waiting 状态的房间引用，无法删除", http.StatusConflict)
		return
	}

	if err := h.queries.DeleteMap(r.Context(), pgMapID); err != nil {
		WriteJSONError(w, "删除地图失败", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true})
}

// strPtr 返回字符串指针。
func strPtr(s string) *string {
	return &s
}
