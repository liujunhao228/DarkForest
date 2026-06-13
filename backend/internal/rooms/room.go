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

// Room represents a game room that holds game state and players
type Room struct {
	ID          string
	State       RoomState
	PlayerCount int // 预期玩家数
	CreatedAt   time.Time
	LastActivity time.Time

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

	r.Players = append(r.Players, *player)
	r.LastActivity = time.Now()
	return true
}

// RemovePlayer removes a player from the room
func (r *Room) RemovePlayer(playerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, p := range r.Players {
		if p.ID == playerID {
			r.Players = append(r.Players[:i], r.Players[i+1:]...)
			r.LastActivity = time.Now()
			break
		}
	}
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

// GetPlayers returns a copy of the player list
func (r *Room) GetPlayers() []hub.PlayerInfo {
	r.mu.Lock()
	defer r.mu.Unlock()

	players := make([]hub.PlayerInfo, len(r.Players))
	copy(players, r.Players)
	return players
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

	return nil
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

	payload, err := json.Marshal(r.GameState)
	if err != nil {
		return
	}

	msg := hub.Message{
		Type:    string(hub.EvtSrvGameFullSync),
		RoomID:  r.ID,
		Payload: payload,
	}

	r.hubBroadcast(r.ID, msg)
}

// GetState returns the current room state
func (r *Room) GetState() RoomState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.State
}
