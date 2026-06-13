package hub

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
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
		// Extract JWT token from query parameter or Authorization header
		token := r.URL.Query().Get("token")
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
		conn, err := upgrader.Upgrade(w, r, nil)
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
