package rooms

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
)

// RoomState represents the lifecycle state of a room
type RoomState string

const (
	RoomStateWaiting  RoomState = "waiting"  // 等待玩家加入
	RoomStateStarting RoomState = "starting" // 正在初始化游戏
	RoomStatePlaying  RoomState = "playing"  // 游戏进行中
	RoomStateFinished RoomState = "finished" // 游戏已结束
)

// RoomPlayer represents a player inside a room, as exposed to clients.
type RoomPlayer struct {
	PlayerID     string `json:"playerId"`
	DisplayName  string `json:"displayName"`
	IsHost       bool   `json:"isHost"`
	PlayerNumber int    `json:"playerNumber"`
	Position     int    `json:"position"`
	Ready        bool   `json:"ready"`
	Connected    bool   `json:"connected"`
}

// Room represents a game room that holds game state and players
type Room struct {
	ID          string
	State       RoomState
	PlayerCount int // 预期玩家数
	CreatedAt   time.Time
	LastActivity time.Time
	HostID      string // 房主玩家 ID

	Players []hub.PlayerInfo

	GameState *game.GameState

	mu sync.Mutex

	hubBroadcast func(roomID string, msg hub.Message)
}

// NewRoom creates a new room with the given ID and expected player count
func NewRoom(roomID string, playerCount int, broadcastFn func(roomID string, msg hub.Message)) *Room {
	return &Room{
		ID:          roomID,
		State:       RoomStateWaiting,
		PlayerCount: playerCount,
		CreatedAt:   time.Now(),
		LastActivity: time.Now(),
		Players:     make([]hub.PlayerInfo, 0, playerCount),
		GameState:   nil,
		hubBroadcast: broadcastFn,
	}
}

// AddPlayer adds a player to the room. Returns true if added successfully.
func (r *Room) AddPlayer(player *hub.PlayerInfo) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != RoomStateWaiting {
		return false
	}

	// Check if player is already in the room
	for _, p := range r.Players {
		if p.ID == player.ID {
			return true // Already in room, not an error
		}
	}

	if len(r.Players) >= r.PlayerCount {
		return false
	}

	pi := *player
	pi.Connected = true
	pi.Ready = false
	r.Players = append(r.Players, pi)
	r.LastActivity = time.Now()

	// First player becomes the host
	if len(r.Players) == 1 {
		r.HostID = player.ID
	}

	return true
}

// RemovePlayer removes a player from the room.
func (r *Room) RemovePlayer(playerID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, p := range r.Players {
		if p.ID == playerID {
			r.Players = append(r.Players[:i], r.Players[i+1:]...)
			r.LastActivity = time.Now()

			// If host left, assign host to the next remaining player.
			if r.HostID == playerID && len(r.Players) > 0 {
				r.HostID = r.Players[0].ID
				return true
			}
			return false
		}
	}
	return false
}

// HasPlayer checks if a player is in the room
func (r *Room) HasPlayer(playerID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, p := range r.Players {
		if p.ID == playerID {
			return true
		}
	}
	return false
}

// GetPlayers returns a copy of the internal player list.
func (r *Room) GetPlayers() []hub.PlayerInfo {
	r.mu.Lock()
	defer r.mu.Unlock()

	players := make([]hub.PlayerInfo, len(r.Players))
	copy(players, r.Players)
	return players
}

// GetRoomPlayers returns the room player list in the format expected by clients.
func (r *Room) GetRoomPlayers() []RoomPlayer {
	r.mu.Lock()
	defer r.mu.Unlock()

	players := make([]RoomPlayer, len(r.Players))
	for i, p := range r.Players {
		players[i] = RoomPlayer{
			PlayerID:     p.ID,
			DisplayName:  p.DisplayName,
			IsHost:       p.ID == r.HostID,
			PlayerNumber: i,
			Position:     i + 1,
			Ready:        p.Ready,
			Connected:    p.Connected,
		}
	}
	return players
}

// MarkPlayerConnected updates a player's connection status.
func (r *Room) MarkPlayerConnected(playerID string, connected bool) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i := range r.Players {
		if r.Players[i].ID == playerID {
			r.Players[i].Connected = connected
			return true
		}
	}
	return false
}

// SetPlayerReady updates a player's ready status.
func (r *Room) SetPlayerReady(playerID string, ready bool) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i := range r.Players {
		if r.Players[i].ID == playerID {
			r.Players[i].Ready = ready
			return true
		}
	}
	return false
}

// IsReady returns true if all expected players have joined
func (r *Room) IsReady() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.Players) >= r.PlayerCount
}

// CurrentPlayerCount returns the current number of players in the room
func (r *Room) CurrentPlayerCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.Players)
}

// StartGame initializes the game engine for this room
func (r *Room) StartGame(humanName string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != RoomStateWaiting {
		return false
	}

	if len(r.Players) == 0 {
		return false
	}

	r.State = RoomStateStarting

	config := game.InitConfig{
		PlayerCount: r.PlayerCount,
		HumanName:   humanName,
	}

	r.GameState = game.NewGame(config)
	r.State = RoomStatePlaying
	r.LastActivity = time.Now()

	return true
}

// HandleGameAction processes a game action from a player
// action: "playCard" | "deployCard" | "strike" | "broadcast" | "recycle" | "endTurn" | "moveStrike" | etc.
func (r *Room) HandleGameAction(playerID string, action string, data json.RawMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != RoomStatePlaying || r.GameState == nil {
		return ErrGameNotStarted
	}

	r.LastActivity = time.Now()

	// Extract optional requestId from action data
	requestID := extractRequestID(data)

	// Find the player in game state
	var player *game.Player
	for i := range r.GameState.Players {
		if r.GameState.Players[i].ID == playerID {
			player = &r.GameState.Players[i]
			break
		}
	}

	// Dispatch action to appropriate game engine function
	switch action {
	case "playCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if player != nil {
			game.PlayCard(r.GameState, player, req.CardUID)
		}

	case "deployCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.DeployCard(r.GameState, playerID, req.CardUID)

	case "strike":
		var req struct {
			CardUID        string  `json:"cardUid"`
			TargetSystem   int     `json:"targetSystem"`
			TargetPlayerID *string `json:"targetPlayerId,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.PlayStrikeCard(r.GameState, playerID, req.CardUID, req.TargetSystem, req.TargetPlayerID)

	case "broadcast":
		var req struct {
			CardUID      string `json:"cardUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.InitiateBroadcast(r.GameState, playerID, req.CardUID, req.TargetSystem)

	case "respondBroadcast":
		var req struct {
			Agreed  bool    `json:"agreed"`
			CardUID *string `json:"cardUid,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.RespondToBroadcast(r.GameState, playerID, req.Agreed, req.CardUID)

	case "selectBroadcastResponder":
		var req struct {
			ResponderID string `json:"responderId"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.SelectBroadcastResponder(r.GameState, req.ResponderID)

	case "cancelBroadcast":
		game.CancelBroadcast(r.GameState)

	case "recycleCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.RecycleCard(r.GameState, playerID, req.CardUID)

	case "moveStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.MoveStrike(r.GameState, req.StrikeUID, req.TargetSystem)

	case "announceStrike":
		game.AnnounceStrike(r.GameState)

	case "skipAnnounceStrike":
		game.SkipAnnounceStrike(r.GameState)

	case "endTurn":
		var req struct {
			DiscardCards []string `json:"discardCards"`
			PublicDiscard bool     `json:"publicDiscard"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.EndTurn(r.GameState, req.DiscardCards, req.PublicDiscard)
		game.AdvanceToNextPlayer(r.GameState)
		// After advancing, start the next player's turn
		game.StartTurn(r.GameState)

	case "lightspeedShip":
		game.ExecuteLightspeedShip(r.GameState, playerID)

	default:
		return ErrUnknownAction
	}

	// After processing action, check if game is over
	if r.GameState != nil && r.GameState.Phase == game.GamePhaseGameOver {
		r.State = RoomStateFinished
	}

	// Broadcast updated state to all players in room
	r.broadcastGameState()

	r.sendActionResult(playerID, action, requestID, "", "")

	return nil
}

func extractRequestID(data json.RawMessage) string {
	if len(data) == 0 {
		return ""
	}
	var wrapper struct {
		RequestID string `json:"requestId"`
	}
	if err := json.Unmarshal(data, &wrapper); err == nil {
		return wrapper.RequestID
	}
	return ""
}

func (r *Room) sendActionResult(playerID, action, requestID, errMsg, errCode string) {
	if r.hubBroadcast == nil {
		return
	}

	result := map[string]interface{}{
		"success":   errMsg == "",
		"action":    action,
		"requestId": requestID,
	}
	if errMsg != "" {
		result["error"] = errMsg
		result["errorCode"] = errCode
	}

	payload, err := json.Marshal(result)
	if err != nil {
		return
	}

	r.hubBroadcast(r.ID, hub.Message{
		Type:    string(hub.EvtSrvGameActionResult),
		RoomID:  r.ID,
		Payload: payload,
	})
}

// SendActionResultError sends an actionResult with success=false to all players in the room.
func (r *Room) SendActionResultError(playerID, action string, data json.RawMessage, actionErr error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.hubBroadcast == nil {
		return
	}

	errCode := "ACTION_FAILED"
	switch actionErr {
	case ErrGameNotStarted:
		errCode = "GAME_NOT_STARTED"
	case ErrUnknownAction:
		errCode = "UNKNOWN_ACTION"
	}

	r.sendActionResult(playerID, action, extractRequestID(data), actionErr.Error(), errCode)
}

// RequestSync returns the current game state for a sync request
func (r *Room) RequestSync(playerID string) *game.GameState {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.GameState == nil {
		return nil
	}

	// Return a reference to game state (in production you might want to clone)
	// but for now, we return the pointer and let caller serialize it
	return r.GameState
}

// IsIdleFor checks if the room has been inactive for the given duration
func (r *Room) IsIdleFor(duration time.Duration) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	return time.Since(r.LastActivity) > duration
}

// IsEmpty checks if the room has no players
func (r *Room) IsEmpty() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.Players) == 0
}

// broadcastGameState sends the current game state to all players in the room
func (r *Room) broadcastGameState() {
	if r.hubBroadcast == nil || r.GameState == nil {
		return
	}

	r.hubBroadcast(r.ID, r.buildFullSyncMessage())
}

func (r *Room) buildFullSyncMessage() hub.Message {
	version := 0
	if r.GameState.Version != nil {
		version = *r.GameState.Version
	}

	payload, err := json.Marshal(map[string]interface{}{
		"state":     r.GameState,
		"version":   version,
		"stateHash": "",
		"timestamp": time.Now().UnixMilli(),
	})
	if err != nil {
		return hub.Message{Type: string(hub.EvtSrvGameFullSync), RoomID: r.ID}
	}

	return hub.Message{
		Type:    string(hub.EvtSrvGameFullSync),
		RoomID:  r.ID,
		Payload: payload,
	}
}

// GetState returns the current room state
func (r *Room) GetState() RoomState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.State
}

// IsHost checks if a player is the host of the room
func (r *Room) IsHost(playerID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.HostID == playerID
}

// GetHostID returns the host player ID
func (r *Room) GetHostID() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.HostID
}

// GetPlayerCount returns the expected player count
func (r *Room) GetPlayerCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.PlayerCount
}
