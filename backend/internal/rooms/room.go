package rooms

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
	"github.com/darkforest/backend/internal/replay"
)

// FallbackTimeout 是房间内仅剩一名活跃玩家（其余断线或淘汰）时，
// 等待多久后自动结束游戏并判定该玩家获胜。
const FallbackTimeout = 3 * time.Minute

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

	// GameMode 是该房间对应对局的游戏模式（game.GameMode）。
	// 零值 GameModeClassic（"classic"）保持向后兼容。
	// 由 RoomManager.SetRoomGameMode 在房间创建后、StartGame 前设置。
	GameMode game.GameMode

	Players []hub.PlayerInfo

	GameState *game.GameState

	// MatchID 是与该房间关联的对局 UUID（matches 表主键），
	// 用于回放保存。空字符串表示尚未关联对局。
	MatchID string

	// 回放录制器。StartGame 时若 replayService 非 nil 则创建。
	replayService *replay.Service
	recorder      *replay.ReplayRecorder

	// fallbackTimer 在房间内仅剩一名活跃玩家时启动，
	// 超时后自动结束游戏并判定该玩家获胜。
	fallbackTimer *time.Timer

	// gameStartedAt 记录游戏开始时间，用于结算时计算 duration。
	gameStartedAt time.Time

	// onGameFinish 在游戏结束（GamePhaseGameOver）时调用，
	// 由 RoomManager 注入，用于持久化对局结算信息到 matches 表。
	onGameFinish func(matchID string, state *game.GameState, startedAt time.Time)

	mu sync.Mutex

	hubBroadcast  func(roomID string, msg hub.Message)
	sendToPlayer  func(playerID string, msg hub.Message)
}

// NewRoom creates a new room with the given ID and expected player count
func NewRoom(roomID string, playerCount int,
	broadcastFn func(roomID string, msg hub.Message),
	sendToPlayerFn func(playerID string, msg hub.Message),
	replaySvc *replay.Service, logger *slog.Logger,
	onGameFinishFn func(matchID string, state *game.GameState, startedAt time.Time),
) *Room {
	return &Room{
		ID:            roomID,
		State:         RoomStateWaiting,
		PlayerCount:   playerCount,
		CreatedAt:     time.Now(),
		LastActivity:  time.Now(),
		Players:       make([]hub.PlayerInfo, 0, playerCount),
		GameState:     nil,
		replayService: replaySvc,
		recorder:      replay.NewReplayRecorder(replaySvc, logger),
		hubBroadcast:  broadcastFn,
		sendToPlayer:  sendToPlayerFn,
		onGameFinish:  onGameFinishFn,
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

			hostChanged := false
			// If host left, assign host to the next remaining player.
			if r.HostID == playerID && len(r.Players) > 0 {
				r.HostID = r.Players[0].ID
				hostChanged = true
			}
			r.checkFallbackStateLocked()
			return hostChanged
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
			r.checkFallbackStateLocked()
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

// StartGame initializes the game engine for this room.
// matchID 关联到 matches 表的 UUID；非空时同时启动回放录制。
func (r *Room) StartGame(humanName string, matchID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != RoomStateWaiting {
		return false
	}

	if len(r.Players) == 0 {
		return false
	}

	r.State = RoomStateStarting
	r.MatchID = matchID

	seeds := make([]game.PlayerSeed, 0, len(r.Players))
	playerIDs := make([]string, 0, len(r.Players))
	playerNames := make([]string, 0, len(r.Players))
	for _, p := range r.Players {
		seeds = append(seeds, game.PlayerSeed{ID: p.ID, Name: p.DisplayName})
		playerIDs = append(playerIDs, p.ID)
		playerNames = append(playerNames, p.DisplayName)
	}

	config := game.InitConfig{
		PlayerCount: r.PlayerCount,
		PlayerSeeds: seeds,
		GameMode:    r.GameMode,
	}

	r.GameState = game.NewGame(config)
	// 启动第一个回合：NewGame 只把 TurnPhase 初始化为 turnBegin 默认值，
	// 必须调用 StartTurn 才会真正执行加能量、SettlementPhase、DrawPhase，
	// 并推进到 actionPhase，否则玩家永远无法操作手牌。
	game.StartTurn(r.GameState)
	r.State = RoomStatePlaying
	r.LastActivity = time.Now()
	r.gameStartedAt = time.Now()

	// 启动回放录制。recorder 为非 nil 的 no-op 也无副作用。
	if r.recorder != nil && matchID != "" {
		r.recorder.StartRecording(matchID, playerIDs, playerNames, r.GameState)
	}

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

	case "retargetStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.RetargetStrike(r.GameState, req.StrikeUID, req.TargetSystem)

	case "selectStrike":
		var req struct {
			StrikeUID string `json:"strikeUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.SelectStrike(r.GameState, req.StrikeUID)

	case "skipStrikeSelect":
		game.SkipStrikeSelect(r.GameState)

	case "skipStrikeMove":
		game.SkipStrikeMove(r.GameState)

	case "endTurn":
		var req struct {
			DiscardCards []string `json:"discardCards"`
			PublicDiscard bool     `json:"publicDiscard"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.EndTurn(r.GameState, req.DiscardCards, req.PublicDiscard)

	case "lightspeedShip":
		var req struct {
			LeaveBehind        bool  `json:"leaveBehind"`
			BroadcastOnInherit *bool `json:"broadcastOnInherit,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		game.ExecuteLightspeedShip(r.GameState, playerID, req.LeaveBehind, req.BroadcastOnInherit)

	default:
		return ErrUnknownAction
	}

	// dispatch 成功后记录动作（仅录制成功 dispatch 的动作，过滤 unmarshal 失败/未知 action）
	if r.recorder != nil {
		r.recorder.RecordAction(playerID, action, data, r.GameState.TotalTurn)
	}

	// After processing action, check if game is over
	if r.GameState != nil && r.GameState.Phase == game.GamePhaseGameOver {
		// 触发回放保存：克隆一份 final state 后再异步写库，避免与广播共享同一指针。
		// recorder 内部会自行去重，多次调用安全。
		if r.recorder != nil {
			r.recorder.SaveReplay(r.GameState)
		}
		r.State = RoomStateFinished
		// 持久化对局结算信息到 matches 表
		if r.onGameFinish != nil && r.MatchID != "" {
			r.onGameFinish(r.MatchID, r.GameState, r.gameStartedAt)
		}
	}

	// 检查兜底条件：若仅剩一名活跃玩家（其余断线或淘汰），启动/取消兜底计时器。
	r.checkFallbackStateLocked()

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

// RequestSync returns a per-player ViewState for sync requests
func (r *Room) RequestSync(playerID string) *game.ViewState {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.GameState == nil {
		return nil
	}
	return game.CreateViewState(r.GameState, game.ViewOptions{
		Role:     game.ViewRolePlayer,
		PlayerID: playerID,
	})
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

// BroadcastGameState 公开方法，供 RoomManager 调用
func (r *Room) BroadcastGameState() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.broadcastGameState()
}

// broadcastGameState sends the current game state to all players in the room
func (r *Room) broadcastGameState() {
	if r.GameState == nil {
		return
	}

	// 若有 sendToPlayer 回调，按玩家生成 ViewState 单独发送（脱敏）
	if r.sendToPlayer != nil {
		for _, p := range r.Players {
			if !p.Connected {
				continue
			}
			viewState := game.CreateViewState(r.GameState, game.ViewOptions{
				Role:     game.ViewRolePlayer,
				PlayerID: p.ID,
			})
			msg := r.buildFullSyncMessageWithState(viewState)
			r.sendToPlayer(p.ID, msg)
		}
		return
	}

	// 回退到单一广播（用于无 sendToPlayer 的场景，如测试）
	if r.hubBroadcast != nil {
		r.hubBroadcast(r.ID, r.buildFullSyncMessage())
	}
}

func (r *Room) buildFullSyncMessage() hub.Message {
	return r.buildFullSyncMessageWithState(r.GameState)
}

// buildFullSyncMessageWithState 用任意 state（GameState 或 ViewState）构建 fullSync 消息
func (r *Room) buildFullSyncMessageWithState(state interface{}) hub.Message {
	version := 0
	if r.GameState != nil && r.GameState.Version != nil {
		version = *r.GameState.Version
	}

	payload, err := json.Marshal(map[string]interface{}{
		"state":     state,
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

// ============================================================================
// 兜底机制：房间内仅剩一名活跃玩家时自动结束游戏
// ============================================================================

// activePlayersCountLocked 返回房间内仍连接且未淘汰的玩家数量。
// 调用方必须持有 r.mu。
func (r *Room) activePlayersCountLocked() int {
	if r.GameState == nil {
		return 0
	}
	eliminated := make(map[string]bool, len(r.GameState.Players))
	for _, gp := range r.GameState.Players {
		if gp.Eliminated {
			eliminated[gp.ID] = true
		}
	}
	count := 0
	for _, p := range r.Players {
		if p.Connected && !eliminated[p.ID] {
			count++
		}
	}
	return count
}

// checkFallbackStateLocked 根据当前活跃玩家数量启动或取消兜底计时器。
// 调用方必须持有 r.mu。
//
// 触发时机：玩家断连/重连（MarkPlayerConnected）、玩家移出房间（RemovePlayer）、
// 游戏动作处理完毕后（HandleGameAction，可能产生淘汰）。
func (r *Room) checkFallbackStateLocked() {
	if r.State != RoomStatePlaying || r.GameState == nil {
		if r.fallbackTimer != nil {
			r.fallbackTimer.Stop()
			r.fallbackTimer = nil
		}
		return
	}

	active := r.activePlayersCountLocked()
	if active == 1 {
		// 仅剩一名活跃玩家：启动兜底计时器（若尚未启动）
		if r.fallbackTimer == nil {
			r.fallbackTimer = time.AfterFunc(FallbackTimeout, r.triggerFallback)
		}
	} else {
		// 活跃玩家数恢复为 0 或 >=2：取消计时器
		if r.fallbackTimer != nil {
			r.fallbackTimer.Stop()
			r.fallbackTimer = nil
		}
	}
}

// triggerFallback 是兜底计时器回调：当房间内仅剩一名活跃玩家持续
// FallbackTimeout 时，自动将其判为获胜并结束游戏。
func (r *Room) triggerFallback() {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 计时器已触发，清空引用；后续状态变化会按需重启
	r.fallbackTimer = nil

	if r.State != RoomStatePlaying || r.GameState == nil {
		return
	}

	// 双重检查：触发时仍需满足仅剩一名活跃玩家
	if r.activePlayersCountLocked() != 1 {
		return
	}

	// 找到唯一的活跃玩家
	eliminated := make(map[string]bool, len(r.GameState.Players))
	for _, gp := range r.GameState.Players {
		if gp.Eliminated {
			eliminated[gp.ID] = true
		}
	}

	var winnerID string
	var winnerName string
	for _, p := range r.Players {
		if p.Connected && !eliminated[p.ID] {
			winnerID = p.ID
			winnerName = p.DisplayName
			break
		}
	}
	if winnerID == "" {
		return
	}

	// 将其余未淘汰玩家标记为淘汰（断线或已离开房间），清空其手牌与设施
	for i := range r.GameState.Players {
		gp := &r.GameState.Players[i]
		if !gp.Eliminated && gp.ID != winnerID {
			gp.Eliminated = true
			gp.Hand = []game.Card{}
			gp.FaceUpCards = []game.Card{}
			game.CleanupPlayerStrikes(r.GameState, gp.ID)
		}
	}

	r.GameState.Phase = game.GamePhaseGameOver
	r.GameState.Winner = &winnerID
	r.GameState.PendingAction = nil
	game.AddLog(r.GameState, fmt.Sprintf("由于其他玩家已断线或淘汰，%s 获胜！", winnerName), game.LogEntryTypeSystem)

	// 触发回放保存
	if r.recorder != nil {
		r.recorder.SaveReplay(r.GameState)
	}

	r.State = RoomStateFinished
	r.LastActivity = time.Now()

	// 持久化对局结算信息到 matches 表
	if r.onGameFinish != nil && r.MatchID != "" {
		r.onGameFinish(r.MatchID, r.GameState, r.gameStartedAt)
	}

	// 广播最终游戏状态
	r.broadcastGameState()
}

// StopTimers 停止房间所有后台计时器（兜底计时器），供 RoomManager 销毁房间时调用。
func (r *Room) StopTimers() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fallbackTimer != nil {
		r.fallbackTimer.Stop()
		r.fallbackTimer = nil
	}
}
