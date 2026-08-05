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

	// activeGameByPlayer 索引：playerID -> roomID，用于主动重连发现。
	// 语义差异：playerToRoom 在 LeaveRoom 时删除，activeGameByPlayer 在 LeaveRoom 时不删除，
	// 仅在 RemoveRoom / cleanupIdleRooms / onGameFinish / triggerFallback 时清理。
	activeGameByPlayer map[string]string

	mu sync.RWMutex

	hub    *hub.Hub
	logger *slog.Logger

	// replayService 用于给 Room 注入回放录制器；可为 nil（关闭回放）。
	replayService *replay.Service

	// queries 用于持久化对局结算信息到 matches 表；可为 nil（关闭结算）。
	queries *db.Queries

	// mapService 用于按 map_id 加载自定义房间所选地图（P3 引入）。
	// nil=未注入（此时 SetRoomMapID 设置的 MapID 会被 loadMapForRoom 视为
	// 加载失败并回落 DefaultMapState，保证快匹配与未配置场景行为一致）。
	mapService *game.MapService

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
		activeGameByPlayer: make(map[string]string),
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
		// 游戏结束：清理该对局房间所有玩家的活跃对局索引
		// 通过 matchID 反查 roomID（避免 RoomManager ↔ Room 循环依赖）
		rm.mu.RLock()
		var targetRoomID string
		for rid, r := range rm.rooms {
			if r.MatchID == matchID {
				targetRoomID = rid
				break
			}
		}
		rm.mu.RUnlock()
		if targetRoomID != "" {
			rm.ClearActiveGameForRoom(targetRoomID)
		}

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

	// 清理该房间所有玩家的活跃对局索引
	rm.clearActiveGameForRoomLocked(roomID)

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
			rm.clearActiveGameForRoomLocked(roomID)
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
			rm.clearActiveGameForRoomLocked(roomID)
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

// SetActiveGame 写入 playerID -> roomID 索引，标记该玩家有活跃对局可重连。
// 在 StartGameInRoomWithMatchInfo 成功后调用。
func (rm *RoomManager) SetActiveGame(playerID, roomID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.activeGameByPlayer[playerID] = roomID
}

// GetActiveGame 返回玩家活跃对局的 roomID，空串表示无活跃对局。
func (rm *RoomManager) GetActiveGame(playerID string) string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.activeGameByPlayer[playerID]
}

// ClearActiveGame 删除单个玩家的活跃对局索引。
func (rm *RoomManager) ClearActiveGame(playerID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.activeGameByPlayer, playerID)
}

// ClearActiveGameForRoom 删除某房间所有玩家的活跃对局索引。
// 用于 RemoveRoom / cleanupIdleRooms / onGameFinish / triggerFallback。
func (rm *RoomManager) ClearActiveGameForRoom(roomID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for pid, rid := range rm.activeGameByPlayer {
		if rid == roomID {
			delete(rm.activeGameByPlayer, pid)
		}
	}
}

// clearActiveGameForRoomLocked 是 ClearActiveGameForRoom 的持锁版本。
// 调用方必须已持有 rm.mu。
func (rm *RoomManager) clearActiveGameForRoomLocked(roomID string) {
	for pid, rid := range rm.activeGameByPlayer {
		if rid == roomID {
			delete(rm.activeGameByPlayer, pid)
		}
	}
}

// RejoinRoom 重新加入房间，绕过 RoomStateWaiting 检查。
// 实现 hub.RoomService.RejoinRoom 接口。
// 步骤：
//  1. 校验 player/roomID 非空
//  2. 获取 room，不存在返回 ErrRoomNotFound
//  3. 调用 room.RejoinPlayer(player)，失败返回对应错误
//  4. 更新 playerToRoom[playerID] = roomID（重建映射）
//  5. 取消 disconnectTimers[playerID]（若存在）
func (rm *RoomManager) RejoinRoom(player *hub.PlayerInfo, roomID string) (bool, error) {
	if player == nil || player.ID == "" || roomID == "" {
		return false, ErrPlayerNotFound
	}

	room := rm.GetRoom(roomID)
	if room == nil {
		return false, ErrRoomNotFound
	}

	if !room.RejoinPlayer(player) {
		// 区分失败原因：通过 GameState 判定是已淘汰还是不在游戏中
		gs := room.GetGameState()
		if gs != nil {
			for _, gp := range gs.Players {
				if gp.ID == player.ID {
					if gp.Eliminated {
						return false, ErrPlayerEliminated
					}
					// 在 GameState 但 RejoinPlayer 返回 false：房间非 Playing
					return false, ErrGameNotStarted
				}
			}
		}
		return false, ErrPlayerNotInGame
	}

	// 重建 playerToRoom 映射 + 取消断连计时器
	rm.mu.Lock()
	rm.playerToRoom[player.ID] = roomID
	if timer, ok := rm.disconnectTimers[player.ID]; ok {
		timer.Stop()
		delete(rm.disconnectTimers, player.ID)
	}
	rm.mu.Unlock()

	rm.logger.Info("player rejoined room", "playerId", player.ID, "roomId", roomID)
	return true, nil
}

// GetActiveGameInfo 返回玩家活跃对局信息，用于 player:login 后推送 room:activeRoomFound。
// 实现 hub.RoomService.GetActiveGameInfo 接口。
// 返回 nil 表示无活跃对局或对局不可重连（房间已销毁 / 已结束 / 玩家已淘汰）。
func (rm *RoomManager) GetActiveGameInfo(playerID string) *hub.ActiveGameInfo {
	roomID := rm.GetActiveGame(playerID)
	if roomID == "" {
		return nil
	}

	room := rm.GetRoom(roomID)
	if room == nil {
		// 房间已销毁但索引未清理（理论不应发生，兜底清理）
		rm.ClearActiveGame(playerID)
		return nil
	}

	if room.GetState() != RoomStatePlaying {
		return nil
	}

	gs := room.GetGameState()
	if gs == nil {
		return nil
	}

	// 已淘汰玩家不推送
	for _, gp := range gs.Players {
		if gp.ID == playerID && gp.Eliminated {
			return nil
		}
	}

	startedAt := room.GameStartedAt()
	return &hub.ActiveGameInfo{
		RoomID:        roomID,
		RoomCode:      roomID,
		GameMode:      string(room.GetGameMode()),
		PlayerCount:   room.GetPlayerCount(),
		ActivePlayers: room.ActivePlayersCount(),
		TotalTurn:     gs.TotalTurn,
		StartedAt:     startedAt.Unix(),
	}
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

// HandleAckState 路由玩家的 ack 到对应 room。
// ack 是尽力而为，room 不存在时静默返回（不返回 error）。
func (rm *RoomManager) HandleAckState(playerID string, version int) {
	room := rm.GetRoomByPlayerID(playerID)
	if room == nil {
		return
	}
	room.HandleAckState(playerID, version)
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

	// P3: 在 StartGame 之前预加载自定义房间所选地图。
	// room.MapID 非 nil 时通过 mapService 加载对应 MapState，写入 room.MapState 缓存；
	// nil 或加载失败时 ms 为 nil，StartGame → NewGame 回落 DefaultMapState。
	// 必须在 room.StartGame 之前完成，StartGame 持 r.mu 期间会读 r.MapState。
	ms := rm.loadMapForRoom(room)
	if ms != nil {
		room.SetMapState(ms)
	}

	if !room.StartGame(humanName, matchID) {
		return nil, ErrGameNotStarted
	}

	// 写入 activeGameByPlayer 索引，使玩家关闭 Tab 后可主动重连发现
	for _, p := range room.GetPlayers() {
		rm.SetActiveGame(p.ID, roomID)
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

// SetRoomCustomRules 设置房间的自定义规则覆盖（房主在基础模式之上逐项调整的最终规则集）。
// 必须在 StartGame 之前调用。nil=清除自定义覆盖（恢复 GameMode 预设）。
// 由 roomsCreator 在自定义队列满员时调用，传递 queue.CustomRules 至 Room.CustomRules，
// 最终在 StartGame 写入 InitConfig.CustomRules → state.ModeRules。
// 自定义覆盖优先于 GameMode 预设，所有规则消费点（打击/光速飞船/回合）经
// StateRules(state) 统一读取，对旧回放与预设模式游戏零影响。
func (rm *RoomManager) SetRoomCustomRules(roomID string, rules *game.ModeRules) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return
	}
	room.CustomRules = rules
}

// SetMapService 注入 MapService 实例（P3 引入）。
// 必须在 roomsCreator 注册之前调用；之后创建的房间在 StartGameInRoomWithMatchInfo
// 时才能通过 loadMapForRoom 加载自定义房间所选地图。
// 重复调用以最后一次注入的实例为准。
func (rm *RoomManager) SetMapService(ms *game.MapService) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.mapService = ms
}

// SetRoomMapID 设置自定义房间所选地图 ID（P3 引入）。
// mapID=nil 表示使用官方默认地图（与快匹配行为一致）。
// 必须在 StartGameInRoomWithMatchInfo 之前调用；RoomManager 会在 StartGame
// 前通过 loadMapForRoom 把对应 MapState 预加载到 room.MapState 缓存。
// 仿 SetRoomCustomRules 的锁与存在性检查模式。
func (rm *RoomManager) SetRoomMapID(roomID string, mapID *uuid.UUID) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return
	}
	room.MapID = mapID
}

// loadMapForRoom 按 room.MapID 加载对应的 MapState（P3 引入）。
// 调用时机：RoomManager.StartGameInRoomWithMatchInfo 在调用 room.StartGame 之前。
// 行为：
//   - room.MapID 为 nil → 返回 nil（NewGame 回落 DefaultMapState）
//   - room.MapID 非 nil 但 mapService 未注入或加载失败 → 打印 warning 并返回 nil
//     （保证对局仍能开局，仅回落到 DefaultMapState，避免阻塞玩家）
//   - room.MapID 非 nil 且加载成功 → 返回 *MapState
//
// 调用方应在持锁状态下设置 room.MapState 后再调用 room.StartGame（room.StartGame 持 r.mu）。
// 为避免与 room.mu 嵌套，本方法不持 room.mu，仅读 room.MapID（由调用方保证此时 room 不会
// 被 SetRoomMapID 并发修改——StartGameInRoomWithMatchInfo 是开局临界点，不存在并发 SetRoomMapID）。
func (rm *RoomManager) loadMapForRoom(r *Room) *game.MapState {
	if r == nil || r.MapID == nil {
		return nil
	}
	if rm.mapService == nil {
		rm.logger.Warn("loadMapForRoom: mapService not injected, falling back to DefaultMapState",
			"roomId", r.ID, "mapId", r.MapID.String())
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pgID := pgtype.UUID{Bytes: *r.MapID, Valid: true}
	snapshot, err := rm.mapService.LoadMapByID(ctx, pgID)
	if err != nil {
		rm.logger.Warn("loadMapForRoom: LoadMapByID failed, falling back to DefaultMapState",
			"roomId", r.ID, "mapId", r.MapID.String(), "error", err)
		return nil
	}
	if snapshot == nil {
		rm.logger.Warn("loadMapForRoom: snapshot nil, falling back to DefaultMapState",
			"roomId", r.ID, "mapId", r.MapID.String())
		return nil
	}
	ms := snapshot.ToMapState()
	rm.logger.Info("loadMapForRoom: custom map loaded",
		"roomId", r.ID, "mapId", r.MapID.String(), "nodes", len(ms.Nodes), "edges", len(ms.Edges))
	return ms
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
