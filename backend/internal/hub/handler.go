package hub

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/darkforest/backend/internal/auth"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in dev; restrict in production via CORS middleware
	},
	HandshakeTimeout: 15 * time.Second,
}

// Handler creates an HTTP handler for WebSocket connections
func Handler(h *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract JWT token from Sec-WebSocket-Protocol header or Authorization header
		// 优先使用 Sec-WebSocket-Protocol（浏览器 WebSocket 子协议，不由 URL 传递，减少日志泄露风险）
		token := ""
		if proto := r.Header.Get("Sec-WebSocket-Protocol"); proto != "" {
			// 子协议格式为完整的 JWT token 字符串，取第一段
			if idx := strings.Index(proto, ","); idx >= 0 {
				token = strings.TrimSpace(proto[:idx])
			} else {
				token = strings.TrimSpace(proto)
			}
		}
		if token == "" {
			if authHeader := r.Header.Get("Authorization"); authHeader != "" {
				if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
					token = authHeader[7:]
				}
			}
		}

		if token == "" {
			http.Error(w, "未提供认证 token", http.StatusUnauthorized)
			return
		}

		// Verify JWT token
		payload, err := auth.VerifyToken(token)
		if err != nil {
			http.Error(w, "Token 验证失败", http.StatusUnauthorized)
			return
		}

		// Upgrade HTTP connection to WebSocket
		// 通过 responseHeader 回显客户端发送的子协议（即 JWT token），
		// 否则浏览器会因请求携带了 Sec-WebSocket-Protocol 但响应未回显而拒绝握手。
		responseHeader := http.Header{}
		if token != "" {
			responseHeader.Set("Sec-WebSocket-Protocol", token)
		}
		conn, err := upgrader.Upgrade(w, r, responseHeader)
		if err != nil {
			return
		}

		// Generate unique client ID
		clientID := generateClientID()

		// Create client with pre-authenticated info
		client := NewClient(h, conn, clientID)
		client.Authenticated = true
		client.PlayerID = payload.PlayerID
		client.UserID = payload.UserID
		client.DisplayName = payload.DisplayName
		client.Role = payload.Role

		// Register client with hub
		h.register <- client

		// Allow collection of memory referenced by the caller by doing all work in new goroutines
		go client.WritePump()
		go client.ReadPump()

		// Send initial login success message
		playerInfo := PlayerInfo{
			ID:          payload.PlayerID,
			UserID:      payload.UserID,
			DisplayName: payload.DisplayName,
			Role:        payload.Role,
		}
		initialPayload, _ := json.Marshal(playerInfo)
		client.Send(Message{
			Type:    string(EvtSrvPlayerLoginSuccess),
			Payload: initialPayload,
		})
	}
}

func generateClientID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		// Fallback to timestamp-based ID
		return "client-" + hex.EncodeToString([]byte(time.Now().String()))
	}
	return hex.EncodeToString(bytes)
}
