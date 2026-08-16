package api

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/darkforest/backend/internal/auth"
	"github.com/darkforest/backend/internal/db"
	"github.com/google/uuid"
)

type AuthContextKey string

const (
	AuthPayloadKey AuthContextKey = "authPayload"
)

func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			WriteJSONError(w, "未授权访问：请提供有效的 JWT Token", http.StatusUnauthorized)
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			WriteJSONError(w, "未授权访问：请提供有效的 JWT Token", http.StatusUnauthorized)
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		payload, err := auth.VerifyToken(token)
		if err != nil {
			WriteJSONError(w, "未授权访问：请提供有效的 JWT Token", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), AuthPayloadKey, payload)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func AdminRequiredMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, ok := r.Context().Value(AuthPayloadKey).(*auth.JWTPayload)
		if !ok || payload == nil {
			WriteJSONError(w, "未授权访问", http.StatusUnauthorized)
			return
		}

		if payload.Role != "admin" {
			WriteJSONError(w, "需要管理员权限", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func GetAuthFromContext(ctx context.Context) *auth.JWTPayload {
	payload, ok := ctx.Value(AuthPayloadKey).(*auth.JWTPayload)
	if !ok {
		return nil
	}
	return payload
}

// trustUserHeader 是本地信任旁路的标识头。
const trustUserHeader = "X-Trust-User"

// trustSIDRegex / trustQQRegex 与 hub 包同源规则保持一致（hub 包内未导出，此处独立定义）。
var trustSIDRegex = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
var trustQQRegex = regexp.MustCompile(`^[0-9]+$`)

// NewAuthMiddleware 构造鉴权中间件：
//   - localTrustMode=false → 原样返回 AuthMiddleware（零回归）
//   - localTrustMode=true  → 附加"信任旁路"：仅本地来源 + 携带 X-Trust-User 头
//     时按 user_id 注入 auth.JWTPayload{role=player}；不满足条件回落既有 AuthMiddleware。
func NewAuthMiddleware(q *db.Queries, localTrustMode bool) func(http.Handler) http.Handler {
	if !localTrustMode {
		return AuthMiddleware
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			payload, err := trustPayloadFromRequest(r, q)
			if err == nil {
				ctx := context.WithValue(r.Context(), AuthPayloadKey, payload)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			// 不满足信任条件：回落到既有 JWT 校验（trust 模式下 jwt secret 为空 → 401）。
			AuthMiddleware(next).ServeHTTP(w, r)
		})
	}
}

// isLocalhostIP 判定 RemoteAddr 是否 127.0.0.1 或 ::1。
func isLocalhostIP(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	return host == "127.0.0.1" || host == "::1"
}

// trustPayloadFromRequest 解析信任头并 get-or-create。任何不满足条件返回 error，
// 由调用方回落既有 401 路径。
func trustPayloadFromRequest(r *http.Request, q *db.Queries) (*auth.JWTPayload, error) {
	if !isLocalhostIP(r.RemoteAddr) {
		return nil, errors.New("trust requires localhost")
	}
	headerVal := strings.TrimSpace(r.Header.Get(trustUserHeader))
	if headerVal == "" {
		return nil, errors.New("missing X-Trust-User header")
	}
	kind, id, found := strings.Cut(headerVal, ":")
	if !found || id == "" {
		return nil, errors.New("invalid trust user format")
	}
	switch kind {
	case "agent":
		if !trustSIDRegex.MatchString(id) {
			return nil, errors.New("invalid agent sid")
		}
	case "qq":
		if !trustQQRegex.MatchString(id) {
			return nil, errors.New("invalid qq")
		}
	default:
		return nil, errors.New("unsupported trust user kind")
	}
	userID := kind + ":" + id

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// 两段式 get-or-create：已有行（如 WS 建过）复用其昵称，避免 ON CONFLICT 覆盖；
	// 不存在则以 AI-<id> 兜底。
	// 注（M2 裁定）：先 SELECT 再 UPSERT 存在轻微 TOCTOU——两个并发新请求各自查到
	// ErrNoRows 后用同一 AI-<id> 兜底 upsert，ON CONFLICT 覆盖的是同值，结果无害；
	// 代价是每请求 2 RTT，可接受。此处有意不做合并/事务化改造。
	var displayName string
	existing, err := q.GetPlayerByUserID(ctx, userID)
	switch {
	case err == nil:
		displayName = existing.DisplayName
	case errors.Is(err, sql.ErrNoRows):
		displayName = "AI-" + id
	default:
		return nil, err
	}
	player, err := q.GetOrCreatePlayerByUserID(ctx, db.GetOrCreatePlayerByUserIDParams{
		ID:          uuid.NewString(),
		UserID:      userID,
		DisplayName: displayName,
	})
	if err != nil {
		return nil, err
	}

	return &auth.JWTPayload{
		PlayerID:    player.ID,
		UserID:      player.UserID,
		Role:        "player", // 恒 player，无提权
		DisplayName: player.DisplayName,
	}, nil
}
