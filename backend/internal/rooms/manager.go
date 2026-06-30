package rooms

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
)

const (
	// RoomIdleTimeout is how long a room can be idle before being cleaned up
	RoomIdleTimeout = 30 * time.Minute

	// CleanupInterval is how often we check for idle rooms
	CleanupInterval = 5 * time.Minute
)

// RoomManager manages all game rooms. It implements hub.RoomService and hub.GameService.
type RoomManager struct {
	rooms    map[string]*Room // roomID -> Room
	playerToRoom map[string]string // playerID -> roomID

	mu sync.RWMutex

	hub *hub.Hub
	logger *slog.Logger

	quit chan struct{}
}

// NewRoomManager creates a new room manager
func NewRoomManager(h *hub.Hub, logger *slog.Logger) *RoomManager {
	return &RoomManager{
		rooms:        make(map[string]*Room),
		playerToRoom: make(map[string]string),
		hub:          h,
		logger:       logger,
		quit:         make(chan struct{}),
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
	rm.logger.Info("room manager stopped")
}

// GetOrCreateRoom returns an existing room or creates a new one
func (rm *RoomManager) GetOrCreateRoom(roomID string, playerCount int) *Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		room = NewRoom(roomID, playerCount, func(rid string, msg hub.Message) {
			if rm.hub != nil {
				rm.hub.BroadcastToRoom(rid, msg)
			}
		})
		rm.rooms[roomID] = room
		rm.logger.Info("room created", "roomId", roomID, "playerCount", playerCount)
	}
	return room
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

	// Remove all players from the player-to-room mapping
	for _, player := range room.Players {
		delete(rm.playerToRoom, player.ID)
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
func (rm *RoomManager) SetPlayerConnected(roomID string, playerID string, connected bool) bool {
	room := rm.GetRoom(roomID)
	if room == nil {
		return false
	}
	return room.MarkPlayerConnected(playerID, connected)
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

	gameState := room.RequestSync(playerID)
	if gameState == nil {
		return ErrGameNotStarted
	}

	// Send state directly to this player via hub
	client, found := rm.hub.GetClientByPlayerID(playerID)
	if !found {
		return ErrPlayerNotFound
	}

	client.Send(room.buildFullSyncMessage())

	return nil
}

// ============================================================================
// Additional helper methods
// ============================================================================

// StartGameInRoomWithState starts the game engine for a specific room and returns the game state.
func (rm *RoomManager) StartGameInRoomWithState(roomID string, humanName string) (*game.GameState, error) {
	room := rm.GetRoom(roomID)
	if room == nil {
		return nil, ErrRoomNotFound
	}

	if !room.StartGame(humanName) {
		return nil, ErrGameNotStarted
	}

	rm.logger.Info("game started", "roomId", roomID)

	// Broadcast initial game state
	gameState := room.RequestSync("")
	if gameState != nil {
		rm.hub.BroadcastToRoom(roomID, room.buildFullSyncMessage())
	}

	return room.GameState, nil
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
func (rm *RoomManager) StartGameInRoom(roomID string, humanName string) error {
	room := rm.GetRoom(roomID)
	if room == nil {
		return ErrRoomNotFound
	}

	if !room.StartGame(humanName) {
		return ErrGameNotStarted
	}

	rm.logger.Info("game started", "roomId", roomID)

	// Broadcast initial game state
	gameState := room.RequestSync("")
	if gameState != nil {
		rm.hub.BroadcastToRoom(roomID, room.buildFullSyncMessage())
	}

	return nil
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
