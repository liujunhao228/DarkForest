package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"
)

// MatchService defines the interface for matchmaking operations
type MatchService interface {
	JoinQueue(ctx context.Context, player *PlayerInfo, preferredCount int) error
	LeaveQueue(ctx context.Context, playerID string) error
}

// QueueStatus represents a player's current queue status
type QueueStatus struct {
	InQueue       bool `json:"inQueue"`
	Position      int  `json:"position,omitempty"`
	EstimatedTime int  `json:"estimatedTime,omitempty"`
}

// RoomService defines the interface for room operations
type RoomService interface {
	JoinRoom(player *PlayerInfo, roomID string) (bool, error)
	LeaveRoom(playerID string) error
	GetRoomPlayers(roomID string) []PlayerInfo
	BroadcastToRoom(roomID string, msg Message)
}

// GameService defines the interface for game operations
type GameService interface {
	HandleAction(playerID string, action string, data json.RawMessage) error
	RequestSync(playerID string) error
}

// Hub maintains the set of active clients and routes messages
type Hub struct {
	clients map[string]*Client // key: clientID
	players map[string]*Client // key: playerID (authenticated only)

	mu sync.RWMutex

	register   chan *Client
	unregister chan *Client
	broadcast  chan Message

	matchService MatchService
	roomService  RoomService
	gameService  GameService

	// For room-specific broadcasting
	rooms map[string]map[string]bool // roomID -> set of clientIDs

	logger *slog.Logger
}

func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		players:    make(map[string]*Client),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Message, 256),
		rooms:      make(map[string]map[string]bool),
		logger:     logger,
	}
}

func (h *Hub) SetMatchService(s MatchService) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.matchService = s
}

func (h *Hub) SetRoomService(s RoomService) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.roomService = s
}

func (h *Hub) SetGameService(s GameService) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.gameService = s
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.handleRegister(client)

		case client := <-h.unregister:
			h.handleUnregister(client)

		case message := <-h.broadcast:
			h.broadcastAll(message)
		}
	}
}

func (h *Hub) handleRegister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[client.ID] = client
	h.logger.Info("client connected", "clientID", client.ID, "totalClients", len(h.clients))
}

func (h *Hub) handleUnregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clients[client.ID]; ok {
		delete(h.clients, client.ID)
		close(client.send)
	}

	// Remove from players map if authenticated
	if client.Authenticated && client.PlayerID != "" {
		delete(h.players, client.PlayerID)
	}

	// Remove from any room
	roomID := client.GetRoom()
	if roomID != "" {
		if clients, ok := h.rooms[roomID]; ok {
			delete(clients, client.ID)
			if len(clients) == 0 {
				delete(h.rooms, roomID)
			}
		}

		// Notify other players in the room
		leaveMsg := Message{
			Type:   string(EvtSrvRoomPlayerDisconnected),
			RoomID: roomID,
		}
		payload, _ := json.Marshal(map[string]string{"playerId": client.PlayerID, "displayName": client.DisplayName})
		leaveMsg.Payload = payload
		h.broadcastToRoomInternal(roomID, leaveMsg, client.ID)
	}

	h.logger.Info("client disconnected", "clientID", client.ID, "playerID", client.PlayerID, "totalClients", len(h.clients))
}

func (h *Hub) RegisterAuthenticatedClient(client *Client, player *PlayerInfo) {
	h.mu.Lock()
	defer h.mu.Unlock()
	client.Authenticated = true
	client.PlayerID = player.ID
	client.UserID = player.UserID
	client.DisplayName = player.DisplayName
	client.Role = player.Role
	h.players[player.ID] = client
}

func (h *Hub) GetClientByPlayerID(playerID string) (*Client, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	client, ok := h.players[playerID]
	return client, ok
}

func (h *Hub) AddClientToRoom(clientID, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if client, ok := h.clients[clientID]; ok {
		if _, roomExists := h.rooms[roomID]; !roomExists {
			h.rooms[roomID] = make(map[string]bool)
		}
		h.rooms[roomID][clientID] = true
		client.SetRoom(roomID)
	}
}

func (h *Hub) RemoveClientFromRoom(clientID, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.rooms[roomID]; ok {
		delete(clients, clientID)
		if len(clients) == 0 {
			delete(h.rooms, roomID)
		}
	}
	if client, ok := h.clients[clientID]; ok {
		client.SetRoom("")
	}
}

func (h *Hub) BroadcastToRoom(roomID string, msg Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	h.broadcastToRoomInternal(roomID, msg, "")
}

func (h *Hub) broadcastToRoomInternal(roomID string, msg Message, exceptClientID string) {
	clients, ok := h.rooms[roomID]
	if !ok {
		return
	}
	for clientID := range clients {
		if clientID == exceptClientID {
			continue
		}
		if client, ok := h.clients[clientID]; ok {
			client.Send(msg)
		}
	}
}

func (h *Hub) broadcastAll(msg Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, client := range h.clients {
		client.Send(msg)
	}
}

// RegisterClient registers a client with the hub
func (h *Hub) RegisterClient(client *Client) {
	h.register <- client
}

// UnregisterClient unregisters a client from the hub
func (h *Hub) UnregisterClient(client *Client) {
	h.unregister <- client
}

// NewTestClient creates a new client for testing purposes
func NewTestClient(id, playerID, displayName string, authenticated bool) *Client {
	return &Client{
		ID:            id,
		PlayerID:      playerID,
		DisplayName:   displayName,
		Authenticated: authenticated,
		send:          make(chan Message, 256),
	}
}

// SetHubForTest sets the hub reference on a client (for testing)
func (c *Client) SetHubForTest(h *Hub) {
	c.hub = h
}

// GetSendChannel returns the client's send channel (for testing)
func (c *Client) GetSendChannel() chan Message {
	return c.send
}

func (h *Hub) GetStats() map[string]int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return map[string]int{
		"clients":  len(h.clients),
		"players":  len(h.players),
		"rooms":    len(h.rooms),
		"timeUnix": int(time.Now().Unix()),
	}
}

// routeMessage routes incoming messages to appropriate handlers
func (h *Hub) routeMessage(client *Client, msg Message) {
	// Handle application-level ping/pong
	if msg.Type == "ping" {
		client.Send(Message{Type: "pong"})
		return
	}

	event := ClientEvent(msg.Type)

	switch event {
	case EvtPlayerLogin:
		h.handlePlayerLogin(client, msg)
	case EvtPlayerLogout:
		h.handlePlayerLogout(client)
	case EvtMatchJoinQueue:
		h.handleMatchJoinQueue(client, msg)
	case EvtMatchCancelQueue:
		h.handleMatchCancelQueue(client)
	case EvtMatchGetStatus:
		h.handleMatchGetStatus(client)
	case EvtMatchJoinSpecificQueue:
		h.handleMatchJoinSpecificQueue(client, msg)
	case EvtMatchCreateQueue:
		h.handleMatchCreateQueue(client, msg)
	case EvtMatchLeaveSpecificQueue:
		h.handleMatchLeaveSpecificQueue(client, msg)
	case EvtMatchGetQueueInfo:
		h.handleMatchGetQueueInfo(client, msg)
	case EvtMatchGetMyQueues:
		h.handleMatchGetMyQueues(client)
	case EvtRoomJoin:
		h.handleRoomJoin(client, msg)
	case EvtRoomLeave:
		h.handleRoomLeave(client)
	case EvtRoomReady:
		h.handleRoomReady(client)
	case EvtRoomStart:
		h.handleRoomStart(client)
	case EvtGameAction:
		h.handleGameAction(client, msg)
	case EvtGameRequestSync:
		h.handleGameRequestSync(client)
	case EvtGameAckState:
		h.handleGameAckState(client, msg)
	default:
		client.SendError("UNKNOWN_EVENT", "未知的事件类型: "+msg.Type)
	}
}

func (h *Hub) handlePlayerLogin(client *Client, msg Message) {
	var req LoginRequest
	if err := json.Unmarshal(msg.Payload, &req); err != nil {
		client.SendError("INVALID_FORMAT", "登录请求格式错误")
		return
	}

	// Auth service should be injected via middleware in HTTP handler
	// Client should already be authenticated at this point
	if !client.Authenticated {
		payload, _ := json.Marshal(ErrorResponse{Code: "NOT_AUTHENTICATED", Message: "请先通过 JWT 认证"})
		client.Send(Message{
			Type:    string(EvtSrvPlayerLoginError),
			Payload: payload,
		})
		return
	}

	playerInfo := PlayerInfo{
		ID:          client.PlayerID,
		UserID:      client.UserID,
		DisplayName: client.DisplayName,
		Role:        client.Role,
	}
	h.RegisterAuthenticatedClient(client, &playerInfo)

	payload, _ := json.Marshal(playerInfo)
	client.Send(Message{
		Type:    string(EvtSrvPlayerLoginSuccess),
		Payload: payload,
	})

	h.logger.Info("player logged in", "playerID", client.PlayerID, "displayName", client.DisplayName, "role", client.Role)
}

func (h *Hub) handlePlayerLogout(client *Client) {
	h.mu.Lock()
	if client.Authenticated && client.PlayerID != "" {
		delete(h.players, client.PlayerID)
	}
	h.mu.Unlock()
	client.Authenticated = false
}

func (h *Hub) handleMatchJoinQueue(client *Client, msg Message) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}

	var req MatchmakingRequest
	if err := json.Unmarshal(msg.Payload, &req); err != nil {
		client.SendError("INVALID_FORMAT", "匹配请求格式错误")
		return
	}

	if req.PreferredCount < 3 || req.PreferredCount > 5 {
		client.SendError("INVALID_COUNT", "玩家数量必须在 3-5 之间")
		return
	}

	playerInfo := &PlayerInfo{
		ID:          client.PlayerID,
		UserID:      client.UserID,
		DisplayName: client.DisplayName,
		Role:        client.Role,
	}

	if h.matchService != nil {
		if err := h.matchService.JoinQueue(context.Background(), playerInfo, req.PreferredCount); err != nil {
			client.SendError("JOIN_QUEUE_FAILED", err.Error())
			return
		}
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"preferredCount": req.PreferredCount,
		"joinedAt":       time.Now().Unix(),
	})
	client.Send(Message{
		Type:    string(EvtSrvMatchQueueJoined),
		Payload: payload,
	})
}

func (h *Hub) handleMatchCancelQueue(client *Client) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}

	if h.matchService != nil {
		h.matchService.LeaveQueue(context.Background(), client.PlayerID)
	}

	payload, _ := json.Marshal(map[string]bool{"success": true})
	client.Send(Message{
		Type:    string(EvtSrvMatchQueueCancelled),
		Payload: payload,
	})
}

func (h *Hub) handleMatchGetStatus(client *Client) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"inQueue":  false,
		"position": 0,
	})
	client.Send(Message{
		Type:    string(EvtSrvMatchQueueStatus),
		Payload: payload,
	})
}

func (h *Hub) handleMatchJoinSpecificQueue(client *Client, msg Message) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"message": "已加入指定的匹配队列",
	})
	client.Send(Message{
		Type:    string(EvtSrvMatchSpecificQueueJoin),
		Payload: payload,
	})
}

func (h *Hub) handleMatchCreateQueue(client *Client, msg Message) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"queueId": "",
		"message": "匹配队列已创建",
	})
	client.Send(Message{
		Type:    string(EvtSrvMatchQueueCreated),
		Payload: payload,
	})
}

func (h *Hub) handleMatchLeaveSpecificQueue(client *Client, msg Message) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}
	payload, _ := json.Marshal(map[string]bool{"success": true})
	client.Send(Message{
		Type:    string(EvtSrvMatchSpecificQueueLeft),
		Payload: payload,
	})
}

func (h *Hub) handleMatchGetQueueInfo(client *Client, msg Message) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"queueId":     "",
		"queueName":   "",
		"playerCount": 0,
		"maxPlayers":  0,
		"status":      "unknown",
	})
	client.Send(Message{
		Type:    string(EvtSrvMatchQueueInfoResp),
		Payload: payload,
	})
}

func (h *Hub) handleMatchGetMyQueues(client *Client) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"queues": []interface{}{},
	})
	client.Send(Message{
		Type:    string(EvtSrvMatchMyQueuesResp),
		Payload: payload,
	})
}

func (h *Hub) handleRoomJoin(client *Client, msg Message) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}

	var req RoomJoinRequest
	if err := json.Unmarshal(msg.Payload, &req); err != nil {
		client.SendError("INVALID_FORMAT", "房间请求格式错误")
		return
	}

	if req.RoomID == "" {
		client.SendError("EMPTY_ROOM", "房间ID不能为空")
		return
	}

	playerInfo := &PlayerInfo{
		ID:          client.PlayerID,
		UserID:      client.UserID,
		DisplayName: client.DisplayName,
		Role:        client.Role,
	}

	joined := false
	var err error
	if h.roomService != nil {
		joined, err = h.roomService.JoinRoom(playerInfo, req.RoomID)
	} else {
		// Fallback: direct hub room management
		h.AddClientToRoom(client.ID, req.RoomID)
		joined = true
	}

	if err != nil {
		client.SendError("JOIN_ROOM_FAILED", err.Error())
		return
	}

	if !joined {
		client.SendError("JOIN_ROOM_FAILED", "加入房间失败")
		return
	}

	h.AddClientToRoom(client.ID, req.RoomID)

	payload, _ := json.Marshal(map[string]interface{}{
		"roomId":      req.RoomID,
		"joinedAt":    time.Now().Unix(),
		"displayName": client.DisplayName,
	})
	client.Send(Message{
		Type:    string(EvtSrvRoomJoined),
		RoomID:  req.RoomID,
		Payload: payload,
	})

	// Notify other players in the room
	notifyPayload, _ := json.Marshal(playerInfo)
	h.BroadcastToRoom(req.RoomID, Message{
		Type:    string(EvtSrvRoomPlayerJoined),
		RoomID:  req.RoomID,
		Payload: notifyPayload,
	})
}

func (h *Hub) handleRoomLeave(client *Client) {
	roomID := client.GetRoom()
	if roomID == "" {
		return
	}

	if h.roomService != nil {
		h.roomService.LeaveRoom(client.PlayerID)
	}

	h.RemoveClientFromRoom(client.ID, roomID)

	payload, _ := json.Marshal(map[string]interface{}{
		"roomId":      roomID,
		"playerId":    client.PlayerID,
		"displayName": client.DisplayName,
	})
	h.BroadcastToRoom(roomID, Message{
		Type:    string(EvtSrvRoomPlayerLeft),
		RoomID:  roomID,
		Payload: payload,
	})
}

func (h *Hub) handleRoomReady(client *Client) {
	roomID := client.GetRoom()
	if roomID == "" {
		client.SendError("NOT_IN_ROOM", "不在房间中")
		return
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"playerId":    client.PlayerID,
		"displayName": client.DisplayName,
		"ready":       true,
	})
	h.BroadcastToRoom(roomID, Message{
		Type:    string(EvtSrvRoomPlayerReady),
		RoomID:  roomID,
		Payload: payload,
	})
}

func (h *Hub) handleRoomStart(client *Client) {
	roomID := client.GetRoom()
	if roomID == "" {
		client.SendError("NOT_IN_ROOM", "不在房间中")
		return
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"roomId":    roomID,
		"startedBy": client.PlayerID,
		"startedAt": time.Now().Unix(),
	})
	h.BroadcastToRoom(roomID, Message{
		Type:    string(EvtSrvRoomGameStarting),
		RoomID:  roomID,
		Payload: payload,
	})
}

func (h *Hub) handleGameAction(client *Client, msg Message) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}

	if h.gameService == nil {
		// No game service installed - just echo back
		payload, _ := json.Marshal(map[string]interface{}{
			"status": "pending",
			"note":   "游戏引擎尚未安装",
		})
		client.Send(Message{
			Type:    string(EvtSrvGameActionResult),
			RoomID:  client.GetRoom(),
			Payload: payload,
		})
		return
	}

	var req GameActionRequest
	if err := json.Unmarshal(msg.Payload, &req); err != nil {
		client.SendError("INVALID_FORMAT", "游戏动作格式错误")
		return
	}

	if err := h.gameService.HandleAction(client.PlayerID, req.Action, req.Data); err != nil {
		client.SendError("ACTION_FAILED", err.Error())
	}
}

func (h *Hub) handleGameRequestSync(client *Client) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}

	if h.gameService != nil {
		h.gameService.RequestSync(client.PlayerID)
		return
	}

	// Fallback - just notify
	payload, _ := json.Marshal(map[string]interface{}{
		"status":  "pending",
		"message": "游戏引擎尚未安装",
	})
	client.Send(Message{
		Type:    string(EvtSrvGameFullSync),
		RoomID:  client.GetRoom(),
		Payload: payload,
	})
}

func (h *Hub) handleGameAckState(client *Client, msg Message) {
	if !client.Authenticated {
		return
	}
	// Acknowledge game state update - no response needed
}
