package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/darkforest/backend/internal/auth"
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
