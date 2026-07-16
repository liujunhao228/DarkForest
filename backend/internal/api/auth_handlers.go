package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/darkforest/backend/internal/auth"
	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type AuthHandler struct {
	queries *db.Queries
}

func NewAuthHandler(q *db.Queries) *AuthHandler {
	return &AuthHandler{queries: q}
}

type LoginRequest struct {
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

type RegisterRequest struct {
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
	InviteCode  string `json:"inviteCode"`
}

type AdminSetupRequest struct {
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
	Secret      string `json:"secret"`
}

type AuthResponse struct {
	Success bool       `json:"success"`
	Player  PlayerInfo `json:"player"`
	Token   string     `json:"token"`
}

type PlayerInfo struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}

type InviteResponse struct {
	Success    bool           `json:"success"`
	Invitation InvitationInfo `json:"invitation"`
}

type InvitationInfo struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	CreatedBy string `json:"createdBy"`
	IsUsed    bool   `json:"isUsed"`
}

func uuidString(id pgtype.UUID) string {
	return uuid.UUID(id.Bytes).String()
}

func parseUUID(s string) (pgtype.UUID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: u, Valid: true}, nil
}

func newUUID() pgtype.UUID {
	u := uuid.New()
	return pgtype.UUID{Bytes: u, Valid: true}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, "缺少必填字段", http.StatusBadRequest)
		return
	}

	if req.DisplayName == "" || req.Password == "" {
		WriteJSONError(w, "缺少必填字段", http.StatusBadRequest)
		return
	}

	player, err := h.queries.GetPlayerByDisplayName(r.Context(), req.DisplayName)
	if err != nil {
		WriteJSONError(w, "账号或密码错误", http.StatusUnauthorized)
		return
	}

	if player.Password == nil || *player.Password == "" {
		WriteJSONError(w, "账号或密码错误", http.StatusUnauthorized)
		return
	}

	if !auth.VerifyPassword(req.Password, *player.Password) {
		WriteJSONError(w, "账号或密码错误", http.StatusUnauthorized)
		return
	}

	token, err := auth.GenerateToken(auth.JWTPayload{
		PlayerID:    uuidString(player.ID),
		UserID:      player.UserID,
		Role:        player.Role,
		DisplayName: player.DisplayName,
	})
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	response := AuthResponse{
		Success: true,
		Player: PlayerInfo{
			ID:          uuidString(player.ID),
			DisplayName: player.DisplayName,
			Role:        player.Role,
		},
		Token: token,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, "缺少必填字段", http.StatusBadRequest)
		return
	}

	if req.DisplayName == "" || req.Password == "" || req.InviteCode == "" {
		WriteJSONError(w, "缺少必填字段", http.StatusBadRequest)
		return
	}

	// 敏感词校验：DisplayName 命中即拒绝注册
	if _, err := game.SanitizeUserText(req.DisplayName, game.SanitizeContextDisplayName); err != nil {
		WriteJSONError(w, "显示名包含违规内容，请修改", http.StatusBadRequest)
		return
	}

	invitation, err := h.queries.GetInvitationCode(r.Context(), strings.ToUpper(req.InviteCode))
	if err != nil {
		WriteJSONError(w, "邀请码无效", http.StatusBadRequest)
		return
	}

	if invitation.IsUsed {
		WriteJSONError(w, "邀请码已被使用", http.StatusBadRequest)
		return
	}

	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	playerID := newUUID()

	player, err := h.queries.CreatePlayer(r.Context(), db.CreatePlayerParams{
		ID:          playerID,
		UserID:      fmt.Sprintf("player_%d", time.Now().UnixNano()/1e6),
		DisplayName: req.DisplayName,
		Role:        "player",
		Password:    &hashedPassword,
		Avatar:      0,
	})
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	_, err = h.queries.UseInvitationCode(r.Context(), db.UseInvitationCodeParams{
		Code:   strings.ToUpper(req.InviteCode),
		UsedBy: playerID,
	})
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	token, err := auth.GenerateToken(auth.JWTPayload{
		PlayerID:    uuidString(player.ID),
		UserID:      player.UserID,
		Role:        player.Role,
		DisplayName: player.DisplayName,
	})
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	response := AuthResponse{
		Success: true,
		Player: PlayerInfo{
			ID:          uuidString(player.ID),
			DisplayName: player.DisplayName,
			Role:        player.Role,
		},
		Token: token,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *AuthHandler) AdminSetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AdminSetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, "缺少必填字段", http.StatusBadRequest)
		return
	}

	if req.DisplayName == "" || req.Password == "" || req.Secret == "" {
		WriteJSONError(w, "缺少必填字段", http.StatusBadRequest)
		return
	}

	// 敏感词校验：DisplayName 命中即拒绝创建管理员
	if _, err := game.SanitizeUserText(req.DisplayName, game.SanitizeContextDisplayName); err != nil {
		WriteJSONError(w, "显示名包含违规内容，请修改", http.StatusBadRequest)
		return
	}

	if !auth.VerifyAdminSecret(req.Secret) {
		WriteJSONError(w, "管理员密钥错误", http.StatusForbidden)
		return
	}

	existingAdmin, err := h.queries.GetPlayerByRole(r.Context(), "admin")
	if err == nil && existingAdmin.Role == "admin" {
		WriteJSONError(w, "管理员账号已存在", http.StatusBadRequest)
		return
	}

	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	adminID := newUUID()

	admin, err := h.queries.CreatePlayer(r.Context(), db.CreatePlayerParams{
		ID:          adminID,
		UserID:      fmt.Sprintf("admin_%d", time.Now().UnixNano()/1e6),
		DisplayName: req.DisplayName,
		Role:        "admin",
		Password:    &hashedPassword,
		Avatar:      0,
	})
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	token, err := auth.GenerateToken(auth.JWTPayload{
		PlayerID:    uuidString(admin.ID),
		UserID:      admin.UserID,
		Role:        admin.Role,
		DisplayName: admin.DisplayName,
	})
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	response := AuthResponse{
		Success: true,
		Player: PlayerInfo{
			ID:          uuidString(admin.ID),
			DisplayName: admin.DisplayName,
			Role:        admin.Role,
		},
		Token: token,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *AuthHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	payload := GetAuthFromContext(r.Context())
	if payload == nil || payload.Role != "admin" {
		WriteJSONError(w, "需要管理员权限", http.StatusForbidden)
		return
	}

	creatorUUID, err := parseUUID(payload.PlayerID)
	if err != nil {
		WriteJSONError(w, "无效的用户 ID", http.StatusBadRequest)
		return
	}

	code := auth.GenerateInviteCode()
	inviteID := newUUID()

	invitation, err := h.queries.CreateInvitationCode(r.Context(), db.CreateInvitationCodeParams{
		ID:        inviteID,
		Code:      code,
		CreatedBy: creatorUUID,
	})
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	response := InviteResponse{
		Success: true,
		Invitation: InvitationInfo{
			ID:        uuidString(invitation.ID),
			Code:      invitation.Code,
			CreatedBy: uuidString(invitation.CreatedBy),
			IsUsed:    invitation.IsUsed,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *AuthHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	payload := GetAuthFromContext(r.Context())
	if payload == nil || payload.Role != "admin" {
		WriteJSONError(w, "需要管理员权限", http.StatusForbidden)
		return
	}

	creatorUUID, err := parseUUID(payload.PlayerID)
	if err != nil {
		WriteJSONError(w, "无效的用户 ID", http.StatusBadRequest)
		return
	}

	invites, err := h.queries.ListInvitationCodesByCreator(r.Context(), creatorUUID)
	if err != nil {
		WriteJSONError(w, "服务器错误", http.StatusInternalServerError)
		return
	}

	result := make([]InvitationInfo, 0, len(invites))
	for _, inv := range invites {
		result = append(result, InvitationInfo{
			ID:        uuidString(inv.ID),
			Code:      inv.Code,
			CreatedBy: uuidString(inv.CreatedBy),
			IsUsed:    inv.IsUsed,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"invitations": result,
	})
}
