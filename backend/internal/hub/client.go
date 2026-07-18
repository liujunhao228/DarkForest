package hub

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 1024 * 1024 // 1MB
)

// Client represents a single websocket connection
type Client struct {
	ID            string
	PlayerID      string
	UserID        string
	DisplayName   string
	Role          string
	Authenticated bool

	hub  *Hub
	conn *websocket.Conn
	send chan Message

	mu     sync.RWMutex
	roomID string
}

func NewClient(hub *Hub, conn *websocket.Conn, clientID string) *Client {
	return &Client{
		ID:   clientID,
		hub:  hub,
		conn: conn,
		send: make(chan Message, 256),
	}
}

func (c *Client) SetAuthenticated(playerID, userID, displayName, role string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Authenticated = true
	c.PlayerID = playerID
	c.UserID = userID
	c.DisplayName = displayName
	c.Role = role
}

func (c *Client) SetRoom(roomID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.roomID = roomID
}

func (c *Client) GetRoom() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.roomID
}

// ReadPump pumps messages from the websocket connection to the hub
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, rawMessage, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure, websocket.CloseNoStatusReceived) {
				slog.Warn("websocket read error", "clientID", c.ID, "error", err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(rawMessage, &msg); err != nil {
			slog.Warn("invalid message format", "clientID", c.ID, "error", err)
			c.SendError("INVALID_FORMAT", "无效的消息格式")
			continue
		}

		c.hub.routeMessage(c, msg)
	}
}

// WritePump pumps messages from the hub to the websocket connection
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				slog.Warn("failed to get websocket writer", "clientID", c.ID, "error", err)
				return
			}

			data, err := json.Marshal(message)
			if err != nil {
				slog.Warn("failed to marshal message", "clientID", c.ID, "error", err)
				continue
			}

			if _, err := w.Write(data); err != nil {
				slog.Warn("failed to write message", "clientID", c.ID, "error", err)
				return
			}

			if err := w.Close(); err != nil {
				slog.Warn("failed to close writer", "clientID", c.ID, "error", err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Send sends a message to the client
func (c *Client) Send(msg Message) {
	defer func() {
		if r := recover(); r != nil {
			slog.Warn("send on closed channel", "clientID", c.ID, "recovered", r)
		}
	}()

	select {
	case c.send <- msg:
	default:
		// Channel is full - drop message to prevent blocking
		slog.Warn("send channel full, dropping message", "clientID", c.ID)
	}
}

// SendError sends a generic (match/queue) error message to the client.
func (c *Client) SendError(code, message string) {
	c.sendError(EvtSrvMatchError, code, message)
}

// SendGameError sends a game-specific error message to the client.
func (c *Client) SendGameError(code, message string) {
	c.sendError(EvtSrvGameError, code, message)
}

func (c *Client) sendError(event ServerEvent, code, message string) {
	payload, _ := json.Marshal(ErrorResponse{Code: code, Message: message})
	c.Send(Message{
		Type:    string(event),
		RoomID:  "",
		Payload: payload,
	})
}
