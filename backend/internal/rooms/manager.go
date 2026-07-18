package rooms

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
	"github.com/darkforest/backend/internal/replay"
	"github.com/darkforest/backend/internal/settlement"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	// RoomIdleTimeout is how long a room can be idle before being cleaned up
	RoomIdleTimeout = 30 * time.Minute

	// CleanupInterval is how often we check for idle rooms
	CleanupInterval = 5 * time.Minute

	// ReconnectTimeout 是断连玩家被强制移出房间前的等待时长，
	// 与 hub.go 中发给前端的 reconnectTimeout 保持一致。
	ReconnectTimeout = 30 * time.Second
)

// RoomManager manages all game rooms. It implements hub.RoomService and hub.GameService.
type RoomManager struct {
	rooms        map[string]*Room  // roomID -> Room
	playerToRoom map[string]string // playerID -> roomID

	mu sync.RWMutex

	hub    *hub.Hub
	logger *slog.Logger

	// replayService 用于给 Room 注入回放录制器；可为 nil（关闭回放）。
	replayService *replay.Service

	// queries 用于持久化对局结算信息到 matches 表；可为 nil（关闭结算）。
	queries *db.Queries

	// disconnectTimers 记录断连玩家的超时计时器，超时后强制移出房间。
	disconnectTimers map[string]*time.Timer

	quit chan struct{}
}

// NewRoomManager creates a new room manager.
// replayService 可为 nil（此时房间不录制回放）。
// queries 可为 nil（此时对局结束不持久化结算信息到 matches 表）。
func NewRoomManager(h *hub.Hub, logger *slog.Logger, replayService *replay.Service, queries *db.Queries) *RoomManager {
	return &RoomManager{
		rooms:            make(map[string]*Room),
		playerToRoom:     make(map[string]string),
		hub:              h,
		logger:           logger,
		replayService:    replayService,
		queries:          queries,
		disconnectTimers: make(map[string]*time.Timer),
		quit:             make(chan struct{}),
	}
}

// Start begins the room manager's background cleanup goroutine
func (rm *RoomManager) Start() {
	go rm.cleanupLoop()
	rm.logger.Info("room manager started", "idleTimeout", RoomIdleTimeout.String(), "cleanupInterval", CleanupInterval.String())
}

// Stop stops the room manager's background goroutines
func (rm *RoomManager) Stop() {
	close(rm.quit)

	// 停止所有房间的后台计时器（兜底计时器）
	rm.mu.Lock()
	for _, room := range rm.rooms {
		room.StopTimers()
	}
	rm.mu.Unlock()

	rm.logger.Info("room manager stopped")
}

// GetOrCreateRoom returns an existing room or creates a new one
func (rm *RoomManager) GetOrCreateRoom(roomID string, playerCount int) *Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		room = NewRoom(roomID, playerCount,
			func(rid string, msg hub.Message) {
				if rm.hub != nil {
					rm.hub.BroadcastToRoom(rid, msg)
				}
			},
			func(playerID string, msg hub.Message) {
				if rm.hub != nil {
					if client, ok := rm.hub.GetClientByPlayerID(playerID); ok {
						client.Send(msg)
					}
				}
			},
			rm.replayService, rm.logger,
			rm.onGameFinishCallback(),
		)
		rm.rooms[roomID] = room
		rm.logger.Info("room created", "roomId", roomID, "playerCount", playerCount)
	}
	return room
}

// onGameFinishCallback 返回注入给 Room 的游戏结束回调。
// Room 在 GamePhaseGameOver 时调用它，异步持久化结算信息到 matches 表。
func (rm *RoomManager) onGameFinishCallback() func(matchID string, state *game.GameState, startedAt time.Time) {
	return func(matchID string, state *game.GameState, startedAt time.Time) {
		if rm.queries == nil {
			return
		}
		// 异步执行，避免阻塞房间锁。FinalizeMatch 内部会克隆 state，
		// 但传入的 state 指针在回调期间不应被修改（调用方在持锁状态下触发），
		// 为安全起见这里传递指针后由 settlement 包负责序列化。
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := settlement.FinalizeMatch(ctx, rm.queries, matchID, state, startedAt, rm.logger); err != nil {
				rm.logger.Error("finalizeMatch failed", "matchId", matchID, "error", err)
			}
		}()
	}
}

// GetRoom returns a room by ID, or nil if it doesn't exist
func (rm *RoomManager) GetRoom(roomID string) *Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.rooms[roomID]
}

// RemoveRoom removes a room from the manager
func (rm *RoomManager) RemoveRoom(roomID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return
	}

	// 停止房间后台计时器（兜底计时器）
	room.StopTimers()

	// Remove all players from the player-to-room mapping
	for _, player := range room.Players {
		delete(rm.playerToRoom, player.ID)
		// 清理该房间内玩家的断连计时器
		if timer, ok := rm.disconnectTimers[player.ID]; ok {
			timer.Stop()
			delete(rm.disconnectTimers, player.ID)
		}
	}

	delete(rm.rooms, roomID)
	rm.logger.Info("room removed", "roomId", roomID)
}

// GetRoomByPlayerID returns the room that a player is currently in, or nil
func (rm *RoomManager) GetRoomByPlayerID(playerID string) *Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	roomID, exists := rm.playerToRoom[playerID]
	if !exists {
		return nil
	}
	return rm.rooms[roomID]
}

// cleanupLoop periodically checks for and removes idle rooms
func (rm *RoomManager) cleanupLoop() {
	ticker := time.NewTicker(CleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rm.cleanupIdleRooms()
		case <-rm.quit:
			return
		}
	}
}

// cleanupIdleRooms removes rooms that have been idle or empty for too long
func (rm *RoomManager) cleanupIdleRooms() {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	for roomID, room := range rm.rooms {
		// Remove empty rooms after shorter timeout, or finished games
		if room.IsEmpty() && time.Since(room.CreatedAt) > 5*time.Minute {
			rm.logger.Info("cleaning up empty room", "roomId", roomID)
			room.StopTimers()
			// Remove player mappings
			for _, player := range room.Players {
				delete(rm.playerToRoom, player.ID)
			}
			delete(rm.rooms, roomID)
			continue
		}

		// Remove idle rooms
		if room.IsIdleFor(RoomIdleTimeout) {
			rm.logger.Info("cleaning up idle room", "roomId", roomID, "idleFor", time.Since(room.LastActivity).String())
			room.StopTimers()
			for _, player := range room.Players {
				delete(rm.playerToRoom, player.ID)
			}
			delete(rm.rooms, roomID)
		}
	}
}

// ============================================================================
// hub.RoomService interface implementation
// ============================================================================

// JoinRoom adds a player to a room. Creates the room if it doesn't exist.
func (rm *RoomManager) JoinRoom(player *hub.PlayerInfo, roomID string) (bool, error) {
	if player == nil || player.ID == "" || roomID == "" {
		return false, ErrPlayerNotFound
	}

	// Default to 4 players if creating a new room
	room := rm.GetOrCreateRoom(roomID, 4)

	if !room.AddPlayer(player) {
		return false, ErrRoomFull
	}

	// Update player-to-room mapping
	rm.mu.Lock()
	rm.playerToRoom[player.ID] = roomID
	rm.mu.Unlock()

	rm.logger.Info("player joined room", "playerId", player.ID, "displayName", player.DisplayName, "roomId", roomID)

	// Notify room members about the new player
	playersPayload, _ := json.Marshal(map[string]interface{}{
		"roomId":      roomID,
		"players":     room.GetRoomPlayers(),
		"playerId":    player.ID,
		"displayName": player.DisplayName,
	})
	rm.hub.BroadcastToRoom(roomID, hub.Message{
		Type:    string(hub.EvtSrvRoomPlayerJoined),
		RoomID:  roomID,
		Payload: playersPayload,
	})

	return true, nil
}

// LeaveRoom removes a player from their current room
func (rm *RoomManager) LeaveRoom(playerID string) error {
	room := rm.GetRoomByPlayerID(playerID)
	if room == nil {
		return ErrRoomNotFound
	}

	// 清理断连计时器（玩家主动离开时无需等待超时）
	rm.mu.Lock()
	if timer, ok := rm.disconnectTimers[playerID]; ok {
		timer.Stop()
		delete(rm.disconnectTimers, playerID)
	}
	rm.mu.Unlock()

	// Capture display name before removal for the broadcast payload.
	var displayName string
	for _, p := range room.GetPlayers() {
		if p.ID == playerID {
			displayName = p.DisplayName
			break
		}
	}

	hostChanged := room.RemovePlayer(playerID)

	rm.mu.Lock()
	delete(rm.playerToRoom, playerID)
	rm.mu.Unlock()

	rm.logger.Info("player left room", "playerId", playerID, "roomId", room.ID)

	// Notify remaining players
	leavePayload, _ := json.Marshal(map[string]interface{}{
		"roomId":      room.ID,
		"players":     room.GetRoomPlayers(),
		"playerId":    playerID,
		"displayName": displayName,
	})
	rm.hub.BroadcastToRoom(room.ID, hub.Message{
		Type:    string(hub.EvtSrvRoomPlayerLeft),
		RoomID:  room.ID,
		Payload: leavePayload,
	})

	if hostChanged {
		rm.broadcastHostChanged(room)
	}

	return nil
}

func (rm *RoomManager) broadcastHostChanged(room *Room) {
	if room == nil || rm.hub == nil {
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"newHostId": room.GetHostID(),
		"players":   room.GetRoomPlayers(),
	})
	rm.hub.BroadcastToRoom(room.ID, hub.Message{
		Type:    string(hub.EvtSrvRoomHostChanged),
		RoomID:  room.ID,
		Payload: payload,
	})
}

// GetRoomPlayers returns the list of players in a room.
// To support the hub.RoomService interface, this returns the internal PlayerInfo slice.
func (rm *RoomManager) GetRoomPlayers(roomID string) []hub.PlayerInfo {
	room := rm.GetRoom(roomID)
	if room == nil {
		return []hub.PlayerInfo{}
	}
	return room.GetPlayers()
}

// GetRoomPlayerList returns the room player list in the frontend-facing RoomPlayer format.
func (rm *RoomManager) GetRoomPlayerList(roomID string) []RoomPlayer {
	room := rm.GetRoom(roomID)
	if room == nil {
		return []RoomPlayer{}
	}
	return room.GetRoomPlayers()
}

// SetPlayerReady updates the ready state of a player in a room.
func (rm *RoomManager) SetPlayerReady(roomID string, playerID string, ready bool) bool {
	room := rm.GetRoom(roomID)
	if room == nil {
		return false
	}
	return room.SetPlayerReady(playerID, ready)
}

// SetPlayerConnected updates the connection state of a player in a room.
// 断连时启动 30s 超时计时器，超时后强制移出房间；重连时取消计时器。
func (rm *RoomManager) SetPlayerConnected(roomID string, playerID string, connected bool) bool {
	room := rm.GetRoom(roomID)
	if room == nil {
		return false
	}

	if connected {
		// 玩家重连：取消待执行的断连超时计时器
		rm.mu.Lock()
		if timer, ok := rm.disconnectTimers[playerID]; ok {
			timer.Stop()
			delete(rm.disconnectTimers, playerID)
		}
		rm.mu.Unlock()
	} else {
		// 玩家断连：启动超时计时器，超时后强制移出房间
		rm.mu.Lock()
		// 若已有旧计时器，先停止
		if old, ok := rm.disconnectTimers[playerID]; ok {
			old.Stop()
		}
		timer := time.AfterFunc(ReconnectTimeout, func() {
			rm.mu.Lock()
			// 再次检查：若期间已重连或已离开，则不执行
			if _, stillPending := rm.disconnectTimers[playerID]; !stillPending {
				rm.mu.Unlock()
				return
			}
			delete(rm.disconnectTimers, playerID)
			rm.mu.Unlock()

			// 确认玩家仍断连且仍在房间中
			currentRoom := rm.GetRoomByPlayerID(playerID)
			if currentRoom == nil || currentRoom.ID != roomID {
				return
			}
			if rm.IsPlayerConnected(roomID, playerID) {
				return // 已重连
			}

			rm.logger.Info("reconnect timeout, removing player from room", "playerId", playerID, "roomId", roomID)
			// LeaveRoom 会广播 room:playerLeft
			if err := rm.LeaveRoom(playerID); err != nil {
				rm.logger.Error("failed to remove player after reconnect timeout", "playerId", playerID, "error", err)
			}
		})
		rm.disconnectTimers[playerID] = timer
		rm.mu.Unlock()
	}

	return room.MarkPlayerConnected(playerID, connected)
}

// IsPlayerConnected 返回房间内某玩家的连接状态。
func (rm *RoomManager) IsPlayerConnected(roomID string, playerID string) bool {
	room := rm.GetRoom(roomID)
	if room == nil {
		return false
	}
	for _, p := range room.GetPlayers() {
		if p.ID == playerID {
			return p.Connected
		}
	}
	return false
}

// GetPlayerRoom returns the room ID for a given player, or empty if not in a room.
func (rm *RoomManager) GetPlayerRoom(playerID string) string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.playerToRoom[playerID]
}

// BroadcastToRoom broadcasts a message to all players in a room
// Note: This is typically handled directly by the hub, but we implement it
// to satisfy the interface. In practice, hub calls its own BroadcastToRoom.
func (rm *RoomManager) BroadcastToRoom(roomID string, msg hub.Message) {
	if rm.hub != nil {
		rm.hub.BroadcastToRoom(roomID, msg)
	}
}

// ============================================================================
// hub.GameService interface implementation
// ============================================================================

// HandleAction processes a game action from a player, routing it to the correct room
func (rm *RoomManager) HandleAction(playerID string, action string, data json.RawMessage) error {
	room := rm.GetRoomByPlayerID(playerID)
	if room == nil {
		return ErrRoomNotFound
	}

	err := room.HandleGameAction(playerID, action, data)
	if err != nil {
		rm.logger.Error("game action failed", "playerId", playerID, "action", action, "error", err)
		room.SendActionResultError(playerID, action, data, err)
		return err
	}

	return nil
}

// RequestSync sends the current game state to a player
func (rm *RoomManager) RequestSync(playerID string) error {
	room := rm.GetRoomByPlayerID(playerID)
	if room == nil {
		return ErrRoomNotFound
	}

	viewState := room.RequestSync(playerID)
	if viewState == nil {
		return ErrGameNotStarted
	}

	// Send state directly to this player via hub
	client, found := rm.hub.GetClientByPlayerID(playerID)
	if !found {
		return ErrPlayerNotFound
	}

	client.Send(room.buildFullSyncMessageWithState(viewState))

	return nil
}

// ============================================================================
// Additional helper methods
// ============================================================================

// StartGameInRoomWithMatchInfo 用显式 matchID 启动游戏，使该房间的所有
// 游戏动作都会被录制到对应 matches 行的回放中。matchID 为空时关闭回放。
func (rm *RoomManager) StartGameInRoomWithMatchInfo(roomID string, matchID string, humanName string) (*game.GameState, error) {
	room := rm.GetRoom(roomID)
	if room == nil {
		return nil, ErrRoomNotFound
	}

	if !room.StartGame(humanName, matchID) {
		return nil, ErrGameNotStarted
	}

	rm.logger.Info("game started", "roomId", roomID, "matchId", matchID)

	// 异步更新 matches 表 status 为 playing + started_at
	if matchID != "" && rm.queries != nil {
		rm.startMatchAsync(matchID)
	}

	// 不在此主动推送 game:fullSync：前端监听器要等 room:gameStarting →
	// gameConnect → connect() 链路跑完才注册，此时主动推会被 wsClient 丢弃。
	// 改由前端 connect() 内的 game:requestSync 主动拉取，消除时序耦合。
	// 后端 RequestSync 处理器会发送相同的 game:fullSync 给该玩家。

	return room.GameState, nil
}

// startMatchAsync 异步更新 matches 表的 status 为 playing + started_at。
// 失败仅记日志，不阻断游戏开始。
func (rm *RoomManager) startMatchAsync(matchID string) {
	matchUUID, err := uuid.Parse(matchID)
	if err != nil {
		rm.logger.Warn("startMatch: invalid matchID, skipping", "matchId", matchID, "error", err)
		return
	}
	pgID := pgtype.UUID{Bytes: matchUUID, Valid: true}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := rm.queries.StartMatch(ctx, pgID); err != nil {
			rm.logger.Error("startMatch failed", "matchId", matchID, "error", err)
		}
	}()
}

// GetRoomCount returns the current number of active rooms
func (rm *RoomManager) GetRoomCount() int {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return len(rm.rooms)
}

// ============================================================================
// RoomService interface implementations (additional methods)
// ============================================================================

// StartGameInRoom starts the game engine for a specific room.
// Implements hub.RoomService.StartGameInRoom (returns error only).
// 该入口由房主手动开局触发，无对应 matches 记录，因此关闭回放。
func (rm *RoomManager) StartGameInRoom(roomID string, humanName string) error {
	_, err := rm.StartGameInRoomWithMatchInfo(roomID, "", humanName)
	return err
}

// GetRoomState returns the current state of a room
func (rm *RoomManager) GetRoomState(roomID string) string {
	room := rm.GetRoom(roomID)
	if room == nil {
		return ""
	}
	return string(room.GetState())
}

// GetRoomHostID returns the host player ID of a room
func (rm *RoomManager) GetRoomHostID(roomID string) string {
	room := rm.GetRoom(roomID)
	if room == nil {
		return ""
	}
	return room.GetHostID()
}

// SetRoomGameMode 设置房间的游戏模式，必须在 StartGame 之前调用。
// mode 为空串时视为 classic（零值），保持向后兼容。
// 由 roomsCreator 在创建房间后、开始游戏前调用，将匹配时玩家选择的 gameMode
// 透传至 Room.GameMode，最终写入 InitConfig.GameMode。
func (rm *RoomManager) SetRoomGameMode(roomID string, mode string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return
	}
	room.GameMode = game.GameMode(mode)
}

// GetRoomPlayerCount returns the expected player count of a room
func (rm *RoomManager) GetRoomPlayerCount(roomID string) int {
	room := rm.GetRoom(roomID)
	if room == nil {
		return 0
	}
	return room.GetPlayerCount()
}

// IsRoomHost checks if a player is the host of a room
func (rm *RoomManager) IsRoomHost(roomID string, playerID string) bool {
	room := rm.GetRoom(roomID)
	if room == nil {
		return false
	}
	return room.IsHost(playerID)
}
