package hub

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/game"
)

// Predefined errors
var (
	ErrNoRoomsCreator  = errors.New("rooms creator not set")
	ErrPlayerNotFound  = errors.New("player not found")
	ErrGameStartFailed = errors.New("failed to start game")
)

// RoomCreateOptions 携带 roomsCreator 创建房间时所需的模式与规则配置。
// 快速匹配：BaseMode=首个玩家请求的模式，CustomRules=nil。
// 自定义队列：BaseMode=房主选定的模板，CustomRules=房主配置的全量规则（nil=无覆盖，按 BaseMode 预设）。
type RoomCreateOptions struct {
	BaseMode    string
	CustomRules *game.ModeRules
}

// RoomsCreatorFunc is a callback function type for creating rooms when queue is full.
// matchID is the UUID of the corresponding matches row (for replay storage).
// roomID is the room identifier (roomCode for quick match, queueID for custom queue).
// opts carries the base mode and optional custom rules (custom rooms only).
// It returns an error so the caller can react to failures (e.g. reset the queue).
type RoomsCreatorFunc func(matchID string, roomID string, playerIDs []string, opts RoomCreateOptions) error

// MatchService defines the interface for matchmaking operations
type MatchService interface {
	JoinQueue(ctx context.Context, player *PlayerInfo, preferredCount int, gameMode string) error
	LeaveQueue(ctx context.Context, playerID string) error
	GetQueueStatus(ctx context.Context, playerID string) (*QueueStatus, error)
	FindMatches(ctx context.Context) (*FindMatchesResult, error)
	// GetPlayerGameMode returns the gameMode the player queued for (empty = classic).
	// Used by the rooms creator to thread gameMode into InitConfig.
	GetPlayerGameMode(playerID string) string
	// Custom queue operations
	CreateCustomQueue(ctx context.Context, params CreateCustomQueueParams) (*CreateCustomQueueResult, error)
	JoinCustomQueue(ctx context.Context, params JoinCustomQueueParams) (*JoinCustomQueueResult, error)
	LeaveCustomQueue(ctx context.Context, playerID string, queueID string) error
	GetCustomQueueInfo(ctx context.Context, queueID string) (*CustomQueueInfo, error)
	GetPlayerQueues(ctx context.Context, playerID string) ([]CustomQueueInfo, error)
}

// QueueStatus represents a player's current queue status
type QueueStatus struct {
	InQueue      bool `json:"inQueue"`
	Position     int  `json:"position,omitempty"`
	TotalInQueue int  `json:"totalInQueue,omitempty"`
}

// QueueGroup represents one bucket of the queue histogram (grouped by preferredCount).
type QueueGroup struct {
	PlayerCount int `json:"playerCount"`
	Count       int `json:"count"`
}

// FindMatchesResult holds the result of finding matches
type FindMatchesResult struct {
	Matches [][]string
}

// Custom queue types
type CreateCustomQueueParams struct {
	PlayerID   string
	QueueName  string
	MinPlayers int32
	MaxPlayers int32
	// BaseGameMode 房主选定的模板：classic / civilization_relics。空串视为 classic。
	BaseGameMode string
	// CustomRules 房主在 BaseGameMode 之上逐项调整后的全量 ModeRules。
	// nil=无自定义覆盖，按 BaseGameMode 预设生效。存库后经 joinCustomQueue 透传至 Room→InitConfig。
	CustomRules *game.ModeRules
}

type CreateCustomQueueResult struct {
	Success bool
	QueueID string `json:"queueId,omitempty"`
	Error   string `json:"error,omitempty"`
}

type JoinCustomQueueParams struct {
	PlayerID    string
	QueueID     string
	PlayerCount int32
}

type JoinCustomQueueResult struct {
	Success      bool
	QueueID      string `json:"queueId,omitempty"`
	QueueName    string `json:"queueName,omitempty"`
	Position     int    `json:"position,omitempty"`
	TotalInQueue int    `json:"totalInQueue,omitempty"`
	Error        string `json:"error,omitempty"`
}

type CustomQueueInfo struct {
	QueueID      string                  `json:"queueId"`
	QueueName    string                  `json:"queueName"`
	CreatorID    string                  `json:"creatorId"`
	MinPlayers   int32                   `json:"minPlayers"`
	MaxPlayers   int32                   `json:"maxPlayers"`
	Status       string                  `json:"status"`
	Players      []CustomQueuePlayerInfo `json:"players"`
	// 房主选定的模板：classic / civilization_relics
	BaseGameMode string `json:"baseGameMode,omitempty"`
	// 房主在模板之上自定义的全量规则；nil=无覆盖
	CustomRules *game.ModeRules `json:"customRules,omitempty"`
}

type CustomQueuePlayerInfo struct {
	PlayerID    string `json:"playerId"`
	DisplayName string `json:"displayName"`
	IsReady     bool   `json:"isReady"`
	JoinedAt    int64  `json:"joinedAt"`
}

// RoomService defines the interface for room operations
type RoomService interface {
	JoinRoom(player *PlayerInfo, roomID string) (bool, error)
	LeaveRoom(playerID string) error
	GetRoomPlayers(roomID string) []PlayerInfo
	BroadcastToRoom(roomID string, msg Message)
	GetRoomState(roomID string) string
	GetRoomHostID(roomID string) string
	GetRoomPlayerCount(roomID string) int
	IsRoomHost(roomID string, playerID string) bool
	SetPlayerReady(roomID string, playerID string, ready bool) bool
	SetPlayerConnected(roomID string, playerID string, connected bool) bool
	GetPlayerRoom(playerID string) string
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
	roomsCreator RoomsCreatorFunc

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

func (h *Hub) SetRoomsCreator(f RoomsCreatorFunc) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.roomsCreator = f
}

// OnCustomQueueFull is called when a custom queue becomes full and a game should start.
// matchID is the UUID of the corresponding matches row (for replay storage).
// roomID is the queueID used as the room identifier.
// opts carries the base mode and optional custom rules (custom rooms only).
// It returns the error from the rooms creator so the caller can reset the queue on failure.
func (h *Hub) OnCustomQueueFull(matchID string, roomID string, playerIDs []string, opts RoomCreateOptions) error {
	h.mu.Lock()
	rc := h.roomsCreator
	h.mu.Unlock()

	if rc == nil {
		h.logger.Error("roomsCreator not set, cannot start game from queue")
		return ErrNoRoomsCreator
	}

	// Call the rooms creator callback
	return rc(matchID, roomID, playerIDs, opts)
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

	// If client is already authenticated (e.g. via JWT during WebSocket upgrade),
	// register it in the players map as well.
	if client.Authenticated && client.PlayerID != "" {
		h.players[client.PlayerID] = client
	}

	h.logger.Info("client connected", "clientID", client.ID, "totalClients", len(h.clients), "authenticated", client.Authenticated)
}

func (h *Hub) handleUnregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clients[client.ID]; ok {
		delete(h.clients, client.ID)
		close(client.send)
	}

	// Remove from players map if authenticated.
	// 重连竞态修复：仅当 h.players 中记录的仍是本 client 时才删除。
	// 若玩家已用新 client 重连（register 先于 unregister 处理），
	// 旧 client 的反注册不得清除新连接，否则 GetClientByPlayerID 会误判玩家离线，
	// 进而导致 roomCreator 预检查失败并触发"有玩家未连接"误报。
	playerReconnected := false
	if client.Authenticated && client.PlayerID != "" {
		if current, ok := h.players[client.PlayerID]; ok && current.ID == client.ID {
			delete(h.players, client.PlayerID)
		} else if ok && current.ID != client.ID {
			// 玩家已用新 client 重连，保留新连接
			playerReconnected = true
		}
	}

	// Remove from any room
	roomID := client.GetRoom()
	if roomID != "" {
		// 始终从 hub.rooms 中移除旧 client（roomID -> clientID 映射）
		if clients, ok := h.rooms[roomID]; ok {
			delete(clients, client.ID)
			if len(clients) == 0 {
				delete(h.rooms, roomID)
			}
		}

		// 仅当玩家未重连时，才标记房间内玩家为断连并广播通知。
		// 若玩家已用新 client 重连，旧 client 的反注册不应产生误报。
		if !playerReconnected {
			// Mark the player as disconnected in the room state.
			if h.roomService != nil {
				h.roomService.SetPlayerConnected(roomID, client.PlayerID, false)
			}

			// Notify other players in the room
			payload, _ := json.Marshal(map[string]interface{}{
				"roomId":                 roomID,
				"players":                h.buildRoomPlayers(roomID),
				"disconnectedPlayerId":   client.PlayerID,
				"disconnectedPlayerName": client.DisplayName,
				"reason":                 "network_error",
				"canReconnect":           true,
				"reconnectTimeout":       30000,
			})
			h.broadcastToRoomInternal(roomID, Message{
				Type:    string(EvtSrvRoomPlayerDisconnected),
				RoomID:  roomID,
				Payload: payload,
			}, client.ID)
		}
	}

	h.logger.Info("client disconnected", "clientID", client.ID, "playerID", client.PlayerID, "totalClients", len(h.clients), "reconnected", playerReconnected)
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
	case EvtGameAction:
		h.handleGameAction(client, msg)
	case EvtGameCancelAction:
		h.handleGameCancelAction(client, msg)
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

	// If this player was previously in a room (e.g. reconnected after network loss),
	// mark them connected and notify other players.
	h.handleRoomReconnection(client)

	h.logger.Info("player logged in", "playerID", client.PlayerID, "displayName", client.DisplayName, "role", client.Role)
}

func (h *Hub) handleRoomReconnection(client *Client) {
	if h.roomService == nil || client.PlayerID == "" {
		return
	}

	roomID := h.roomService.GetPlayerRoom(client.PlayerID)
	if roomID == "" {
		return
	}

	// Mark the player as connected in the room state.
	h.roomService.SetPlayerConnected(roomID, client.PlayerID, true)

	// 关键修复：将新 client 加入 hub.rooms[roomID]，
	// 否则该 client 收不到任何房间广播（包括 broadcastGameState 的 per-player 推送）
	h.AddClientToRoom(client.ID, roomID)

	// 重连后主动推送一次游戏状态（per-player ViewState），
	// 避免前端需要额外发 game:requestSync 才能恢复画面
	if h.gameService != nil {
		if err := h.gameService.RequestSync(client.PlayerID); err != nil {
			h.logger.Warn("RequestSync after reconnect failed",
				"playerId", client.PlayerID, "roomId", roomID, "err", err)
		}
	}
}

func (h *Hub) handlePlayerLogout(client *Client) {
	h.mu.Lock()
	// 重连竞态修复：仅当 h.players 中记录的仍是本 client 时才删除。
	// 旧 client 的 logout 不应清除已用新 client 重连的玩家。
	if client.Authenticated && client.PlayerID != "" {
		if current, ok := h.players[client.PlayerID]; ok && current.ID == client.ID {
			delete(h.players, client.PlayerID)
		}
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
		if err := h.matchService.JoinQueue(context.Background(), playerInfo, req.PreferredCount, req.GameMode); err != nil {
			client.SendError("JOIN_QUEUE_FAILED", err.Error())
			return
		}
	}

	// Fetch full queue status so the frontend can render position / totalInQueue / groups.
	status, _ := h.matchService.GetQueueStatus(context.Background(), client.PlayerID)

	position := 0
	totalInQueue := 0
	if status != nil {
		position = status.Position
		totalInQueue = status.TotalInQueue
	}

	// Build groups histogram: group queues by PreferredCount.
	groups := []QueueGroup{}
	if h.matchService != nil {
		if findResult, err := h.matchService.FindMatches(context.Background()); err == nil {
			hist := map[int32]int{}
			for _, m := range findResult.Matches {
				hist[int32(len(m))]++
			}
			for count, c := range hist {
				groups = append(groups, QueueGroup{PlayerCount: int(count), Count: c})
			}
		}
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"preferredCount": req.PreferredCount,
		"joinedAt":       time.Now().Unix(),
		"position":       position,
		"totalInQueue":   totalInQueue,
		"groups":         groups,
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
	inQueue := false
	position := 0
	totalInQueue := 0
	if h.matchService != nil {
		if status, err := h.matchService.GetQueueStatus(context.Background(), client.PlayerID); err == nil && status != nil {
			inQueue = status.InQueue
			position = status.Position
			totalInQueue = status.TotalInQueue
		}
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"inQueue":      inQueue,
		"position":     position,
		"totalInQueue": totalInQueue,
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

	var req struct {
		QueueID     string `json:"queueId"`
		PlayerCount int32  `json:"playerCount"`
	}
	if err := json.Unmarshal(msg.Payload, &req); err != nil {
		client.SendError("INVALID_FORMAT", "加入队列请求格式错误")
		return
	}

	if req.QueueID == "" {
		client.SendError("INVALID_FORMAT", "队列ID不能为空")
		return
	}

	params := JoinCustomQueueParams{
		PlayerID:    client.PlayerID,
		QueueID:     req.QueueID,
		PlayerCount: req.PlayerCount,
	}

	result, err := h.matchService.JoinCustomQueue(context.Background(), params)
	if err != nil {
		client.SendError("JOIN_QUEUE_FAILED", "加入队列失败")
		return
	}

	if !result.Success {
		client.SendError("JOIN_QUEUE_FAILED", result.Error)
		return
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"success":      true,
		"queueId":      result.QueueID,
		"queueName":    result.QueueName,
		"position":     result.Position,
		"totalInQueue": result.TotalInQueue,
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

	var req struct {
		QueueName    string         `json:"queueName"`
		MinPlayers   int32          `json:"minPlayers"`
		MaxPlayers   int32          `json:"maxPlayers"`
		BaseGameMode string         `json:"baseGameMode"`
		CustomRules  *game.ModeRules `json:"customRules"`
	}
	if err := json.Unmarshal(msg.Payload, &req); err != nil {
		client.SendError("INVALID_FORMAT", "创建队列请求格式错误")
		return
	}

	if req.QueueName == "" {
		client.SendError("INVALID_FORMAT", "队列名称不能为空")
		return
	}

	if req.MinPlayers < 3 || req.MaxPlayers > 5 || req.MinPlayers > req.MaxPlayers {
		client.SendError("INVALID_FORMAT", "玩家数必须在 3-5 之间")
		return
	}

	// 校验基础模式：空串视为 classic；仅接受两模式之一（向后兼容：未传 baseGameMode 走 classic 默认）
	if req.BaseGameMode != "" &&
		req.BaseGameMode != string(game.GameModeClassic) &&
		req.BaseGameMode != string(game.GameModeCivilizationRelics) {
		client.SendError("INVALID_FORMAT", "无效的基础游戏模式")
		return
	}

	params := CreateCustomQueueParams{
		PlayerID:     client.PlayerID,
		QueueName:    req.QueueName,
		MinPlayers:   req.MinPlayers,
		MaxPlayers:   req.MaxPlayers,
		BaseGameMode: req.BaseGameMode,
		CustomRules:  req.CustomRules,
	}

	result, err := h.matchService.CreateCustomQueue(context.Background(), params)
	if err != nil {
		client.SendError("CREATE_QUEUE_FAILED", "创建队列失败")
		return
	}

	if !result.Success {
		client.SendError("CREATE_QUEUE_FAILED", result.Error)
		return
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"success":     true,
		"queueId":     result.QueueID,
		"queueName":   req.QueueName,
		"creatorId":   client.PlayerID,
		"creatorName": client.DisplayName,
		"minPlayers":  req.MinPlayers,
		"maxPlayers":  req.MaxPlayers,
		"players": []map[string]interface{}{
			{
				"playerId":    client.PlayerID,
				"displayName": client.DisplayName,
				"isReady":     true,
				"joinedAt":    time.Now().Unix(),
			},
		},
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

	var req struct {
		QueueID string `json:"queueId"`
	}
	if err := json.Unmarshal(msg.Payload, &req); err != nil {
		client.SendError("INVALID_FORMAT", "离开队列请求格式错误")
		return
	}

	if req.QueueID == "" {
		client.SendError("INVALID_FORMAT", "队列ID不能为空")
		return
	}

	err := h.matchService.LeaveCustomQueue(context.Background(), client.PlayerID, req.QueueID)
	if err != nil {
		client.SendError("LEAVE_QUEUE_FAILED", "离开队列失败")
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

	var req struct {
		QueueID string `json:"queueId"`
	}
	if err := json.Unmarshal(msg.Payload, &req); err != nil {
		client.SendError("INVALID_FORMAT", "获取队列信息请求格式错误")
		return
	}

	if req.QueueID == "" {
		client.SendError("INVALID_FORMAT", "队列ID不能为空")
		return
	}

	queueInfo, err := h.matchService.GetCustomQueueInfo(context.Background(), req.QueueID)
	if err != nil {
		client.SendError("QUEUE_NOT_FOUND", "队列不存在")
		return
	}

	payload, _ := json.Marshal(queueInfo)
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

	queues, err := h.matchService.GetPlayerQueues(context.Background(), client.PlayerID)
	if err != nil {
		client.SendError("GET_QUEUES_FAILED", "获取队列列表失败")
		return
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"queues": queues,
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

	// Send the room:joined event (with full room info) to the joining player.
	h.SendRoomJoinedInfo(client, req.RoomID)
}

// SendRoomJoinedInfo builds and sends the `room:joined` event (containing full
// room info) to a specific client. It is used by both handleRoomJoin and the
// custom-queue room creator to ensure every joining player receives the
// initial room snapshot, regardless of the entry path.
func (h *Hub) SendRoomJoinedInfo(client *Client, roomID string) {
	if client == nil || roomID == "" {
		return
	}

	roomState := "waiting"
	roomHostID := ""
	roomPlayerCount := 0
	isHost := false
	if h.roomService != nil {
		roomState = h.roomService.GetRoomState(roomID)
		roomHostID = h.roomService.GetRoomHostID(roomID)
		roomPlayerCount = h.roomService.GetRoomPlayerCount(roomID)
		isHost = h.roomService.IsRoomHost(roomID, client.PlayerID)
	}

	players := h.buildRoomPlayers(roomID)

	payload, _ := json.Marshal(map[string]interface{}{
		"roomId":      roomID,
		"roomCode":    roomID,
		"hostId":      roomHostID,
		"status":      roomState,
		"playerCount": roomPlayerCount,
		"players":     players,
		"joinedAt":    time.Now().Unix(),
		"isHost":      isHost,
	})
	client.Send(Message{
		Type:    string(EvtSrvRoomJoined),
		RoomID:  roomID,
		Payload: payload,
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
}

func (h *Hub) buildRoomPlayers(roomID string) []map[string]interface{} {
	hostID := ""
	if h.roomService != nil {
		hostID = h.roomService.GetRoomHostID(roomID)
	}

	infos := []PlayerInfo{}
	if h.roomService != nil {
		infos = h.roomService.GetRoomPlayers(roomID)
	}

	players := make([]map[string]interface{}, len(infos))
	for i, p := range infos {
		players[i] = map[string]interface{}{
			"playerId":     p.ID,
			"displayName":  p.DisplayName,
			"isHost":       p.ID == hostID,
			"playerNumber": i,
			"position":     i + 1,
			"ready":        p.Ready,
			"connected":    p.Connected,
		}
	}
	return players
}

func (h *Hub) handleRoomReady(client *Client) {
	roomID := client.GetRoom()
	if roomID == "" {
		client.SendError("NOT_IN_ROOM", "不在房间中")
		return
	}

	if h.roomService != nil {
		h.roomService.SetPlayerReady(roomID, client.PlayerID, true)
	}

	players := h.buildRoomPlayers(roomID)
	payload, _ := json.Marshal(map[string]interface{}{
		"roomId":      roomID,
		"playerId":    client.PlayerID,
		"displayName": client.DisplayName,
		"ready":       true,
		"players":     players,
	})
	h.BroadcastToRoom(roomID, Message{
		Type:    string(EvtSrvRoomPlayerReady),
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
		client.SendGameError("ACTION_FAILED", err.Error())
	}
}

func (h *Hub) handleGameCancelAction(client *Client, msg Message) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}

	// No-op: the client uses this event to clear its local pending-action timeout.
	// A real implementation could look up and cancel in-flight actions by requestId.
	payload, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"action":  "cancelAction",
	})
	client.Send(Message{
		Type:    string(EvtSrvGameActionResult),
		RoomID:  client.GetRoom(),
		Payload: payload,
	})
}

func (h *Hub) handleGameRequestSync(client *Client) {
	if !client.Authenticated {
		client.SendError("NOT_AUTHENTICATED", "未登录")
		return
	}

	if h.gameService != nil {
		if err := h.gameService.RequestSync(client.PlayerID); err != nil {
			h.logger.Debug("RequestSync failed, likely game not started yet",
				"playerId", client.PlayerID, "error", err)
		}
		return
	}

	// Fallback - just notify
	payload, _ := json.Marshal(map[string]interface{}{
		"state": map[string]interface{}{
			"status":  "pending",
			"message": "游戏引擎尚未安装",
		},
		"version":   0,
		"stateHash": "",
		"timestamp": time.Now().UnixMilli(),
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
