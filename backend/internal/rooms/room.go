package rooms

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
	"github.com/darkforest/backend/internal/replay"
	"github.com/google/uuid"
)

// FallbackTimeout 是房间内仅剩一名活跃玩家（其余断线或淘汰）时，
// 等待多久后自动结束游戏并判定该玩家获胜。
// 默认 3 分钟；测试环境可通过 E2E_FALLBACK_TIMEOUT_MS 环境变量缩短。
var FallbackTimeout = 3 * time.Minute

// TurnTimeout 是当前玩家回合的空闲超时时长。
// 默认 3 分钟；测试环境可通过 E2E_TURN_TIMEOUT_MS 环境变量缩短。
// 若房间设置了 ModeRules.TurnTimeoutSeconds（非 0），则该值优先于 TurnTimeout 生效。
var TurnTimeout = 3 * time.Minute

func init() {
	if ms := os.Getenv("E2E_FALLBACK_TIMEOUT_MS"); ms != "" {
		if n, err := strconv.Atoi(ms); err == nil && n > 0 {
			FallbackTimeout = time.Duration(n) * time.Millisecond
		}
	}
	if ms := os.Getenv("E2E_TURN_TIMEOUT_MS"); ms != "" {
		if n, err := strconv.Atoi(ms); err == nil && n > 0 {
			TurnTimeout = time.Duration(n) * time.Millisecond
		}
	}
}

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
	ID           string
	State        RoomState
	PlayerCount  int // 预期玩家数
	CreatedAt    time.Time
	LastActivity time.Time
	HostID       string // 房主玩家 ID

	// GameMode 是该房间对应对局的游戏模式（game.GameMode）。
	// 零值 GameModeClassic（"classic"）保持向后兼容。
	// 由 RoomManager.SetRoomGameMode 在房间创建后、StartGame 前设置。
	GameMode game.GameMode

	// CustomRules 是自定义房间房主在 GameMode 模板之上逐项调整后的全量规则。
	// nil=无自定义覆盖（快速匹配或自定义队列未配置规则），按 GameMode 预设生效。
	// 由 RoomManager.SetRoomCustomRules 在房间创建后、StartGame 前设置；
	// 透传至 InitConfig.CustomRules → state.ModeRules。
	CustomRules *game.ModeRules

	// MapID 是自定义房间所选地图的 UUID（P3 引入）。
	// nil=官方默认地图（与快匹配行为一致）；非 nil=自定义房间房主上传的地图。
	// 由 RoomManager.SetRoomMapID 在房间创建后、StartGame 前设置；
	// RoomManager.StartGameInRoomWithMatchInfo 会调 loadMapForRoom 把对应 MapState
	// 预加载到 MapState 缓存字段，StartGame 读取 r.MapState 注入 InitConfig.Map。
	MapID *uuid.UUID

	// MapState 是 r.MapID 对应的预加载 MapState 缓存（P3 引入）。
	// 由 RoomManager.StartGameInRoomWithMatchInfo 在调用 room.StartGame 前通过
	// loadMapForRoom 填充；StartGame 直接读 r.MapState 写入 InitConfig.Map。
	// nil=未预加载（含快匹配路径与 MapID 为 nil 的自定义房间），NewGame 回落 DefaultMapState。
	MapState *game.MapState

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

	// turnTimer 是当前玩家回合的空闲超时计时器。
	// 在玩家回合开始时启动；任意成功 dispatch 的 HandleGameAction 调用重置；
	// InterruptTurn 时暂停，ResumeTurn 时以完整 TurnTimeout 重启；
	// 触发后调用 triggerTurnTimeout 淘汰当前玩家。
	// 持 r.mu 保护。
	turnTimer *time.Timer
	// turnTimerPlayerID 记录 turnTimer 所针对的玩家 ID，用于回调时校验仍为当前玩家。
	// 持 r.mu 保护。
	turnTimerPlayerID string

	// gameStartedAt 记录游戏开始时间，用于结算时计算 duration。
	gameStartedAt time.Time

	// onGameFinish 在游戏结束（GamePhaseGameOver）时调用，
	// 由 RoomManager 注入，用于持久化对局结算信息到 matches 表。
	onGameFinish func(matchID string, state *game.GameState, startedAt time.Time)

	mu sync.Mutex

	// lastSentViews 缓存每个玩家上一次收到的 ViewState，用于 delta 同步的 diff 基线。
	// 持 r.mu 保护。
	lastSentViews map[string]*game.ViewState
	// lastAckVersion 记录每个玩家最近 ack 的版本号，用于判断是否可发 delta。
	// 持 r.mu 保护。
	lastAckVersion map[string]int

	hubBroadcast func(roomID string, msg hub.Message)
	sendToPlayer func(playerID string, msg hub.Message)
}

// NewRoom creates a new room with the given ID and expected player count
func NewRoom(roomID string, playerCount int,
	broadcastFn func(roomID string, msg hub.Message),
	sendToPlayerFn func(playerID string, msg hub.Message),
	replaySvc *replay.Service, logger *slog.Logger,
	onGameFinishFn func(matchID string, state *game.GameState, startedAt time.Time),
) *Room {
	return &Room{
		ID:             roomID,
		State:          RoomStateWaiting,
		PlayerCount:    playerCount,
		CreatedAt:      time.Now(),
		LastActivity:   time.Now(),
		Players:        make([]hub.PlayerInfo, 0, playerCount),
		GameState:      nil,
		replayService:  replaySvc,
		recorder:       replay.NewReplayRecorder(replaySvc, logger),
		hubBroadcast:   broadcastFn,
		sendToPlayer:   sendToPlayerFn,
		onGameFinish:   onGameFinishFn,
		lastSentViews:  make(map[string]*game.ViewState),
		lastAckVersion: make(map[string]int),
	}
}

// AddPlayer adds a player to the room. Returns true if added successfully.
func (r *Room) AddPlayer(player *hub.PlayerInfo) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 优先检查玩家是否已在房间（允许测试注入 API 预添加的玩家在 State=Playing 后重新加入）
	for i := range r.Players {
		if r.Players[i].ID == player.ID {
			r.Players[i].Connected = true
			return true
		}
	}

	if r.State != RoomStateWaiting {
		return false
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
		CustomRules: r.CustomRules,
		// P3: 注入 RoomManager 预加载的 MapState 缓存（自定义房间所选地图）。
		// nil=未预加载或快匹配路径，NewGame 内部回落 DefaultMapState。
		Map: r.MapState,
	}

	r.GameState = game.NewGame(config)
	// 启动第一个回合：NewGame 只把 TurnPhase 初始化为 turnBegin 默认值，
	// 必须调用 StartTurn 才会真正执行加能量、SettlementPhase、DrawPhase，
	// 并推进到 actionPhase，否则玩家永远无法操作手牌。
	game.StartTurn(r.GameState)
	r.State = RoomStatePlaying
	// 启动第一个回合的空闲超时计时器（须在 r.State = RoomStatePlaying 之后）
	r.startTurnTimerLocked()
	r.LastActivity = time.Now()
	r.gameStartedAt = time.Now()
	// 新对局从干净的 delta 同步基线开始，清空上一局可能残留的缓存。
	r.lastSentViews = make(map[string]*game.ViewState)
	r.lastAckVersion = make(map[string]int)

	// 启动回放录制。recorder 为非 nil 的 no-op 也无副作用。
	if r.recorder != nil && matchID != "" {
		r.recorder.StartRecording(matchID, playerIDs, playerNames, r.GameState)
	}

	return true
}

// SetGameState 直接注入游戏状态，仅用于测试场景。
// 绕过 StartGame 的 NewGame 调用，不触发 room:gameStarting/room:gameStarted，
// 不启动回放录制。调用前需通过 AddPlayer 预添加所有玩家。
func (r *Room) SetGameState(state *game.GameState) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != RoomStateWaiting {
		return errors.New("room is not in waiting state")
	}
	if state == nil {
		return errors.New("game state is nil")
	}

	r.GameState = state
	r.State = RoomStatePlaying
	// 启动回合计时器（与 StartGame 保持一致，使注入式测试对局也受超时约束）
	r.startTurnTimerLocked()
	r.LastActivity = time.Now()
	r.gameStartedAt = time.Now()
	r.lastSentViews = make(map[string]*game.ViewState)
	r.lastAckVersion = make(map[string]int)
	return nil
}

// SetMapState 设置房间的预加载 MapState 缓存（P3 引入）。
// 由 RoomManager.StartGameInRoomWithMatchInfo 在调用 room.StartGame 之前调用：
// 先通过 loadMapForRoom 把 room.MapID 对应的 MapState 加载好，再写入 r.MapState，
// 随后 room.StartGame 会读取 r.MapState 注入 InitConfig.Map。
// 必须在 StartGame 之前调用；StartGame 期间不应再修改本字段。
// ms 可为 nil（表示未预加载，NewGame 回落 DefaultMapState）。
func (r *Room) SetMapState(ms *game.MapState) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.MapState = ms
}

// HandleGameAction processes a game action from a player
// action: "playCard" | "deployCard" | "strike" | "broadcast" | "recycle" | "endTurn" | "moveStrike" | etc.
func (r *Room) HandleGameAction(playerID string, action string, data json.RawMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != RoomStatePlaying || r.GameState == nil {
		return ErrGameNotStarted
	}

	// 统一动作门控（L1+L2）：玩家存在/存活、当前玩家、回合阶段、PendingAction、广播上下文。
	// 校验失败直接返回，不进入 dispatch、不录制回放、不广播状态。
	if err := game.ValidateAction(r.GameState, playerID, action); err != nil {
		return err
	}

	r.LastActivity = time.Now()

	// 快照 dispatch 前的当前玩家与回合阶段，用于末尾调整回合计时器
	prevCurrentPlayerID := r.GameState.CurrentPlayerID
	prevTurnPhase := r.GameState.TurnPhase

	// Extract optional requestId from action data
	requestID := extractRequestID(data)

	// Find the player in game state（ValidateAction 已保证存在，此处查找供 playCard 使用）
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
		if err := game.PlayCard(r.GameState, player, req.CardUID); err != nil {
			return err
		}

	case "deployCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.DeployCard(r.GameState, playerID, req.CardUID); err != nil {
			return err
		}

	case "strike":
		var req struct {
			CardUID        string  `json:"cardUid"`
			TargetSystem   int     `json:"targetSystem"`
			TargetPlayerID *string `json:"targetPlayerId,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.PlayStrikeCard(r.GameState, playerID, req.CardUID, req.TargetSystem, req.TargetPlayerID); err != nil {
			return err
		}

	case "broadcast":
		var req struct {
			CardUID      string `json:"cardUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.InitiateBroadcast(r.GameState, playerID, req.CardUID, req.TargetSystem); err != nil {
			return err
		}

	case "respondBroadcast":
		var req struct {
			Agreed  bool    `json:"agreed"`
			CardUID *string `json:"cardUid,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.RespondToBroadcast(r.GameState, playerID, req.Agreed, req.CardUID); err != nil {
			return err
		}

	case "selectBroadcastResponder":
		var req struct {
			ResponderID string `json:"responderId"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.SelectBroadcastResponder(r.GameState, playerID, req.ResponderID); err != nil {
			return err
		}

	case "cancelBroadcast":
		if err := game.CancelBroadcast(r.GameState, playerID); err != nil {
			return err
		}

	case "recycleCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.RecycleCard(r.GameState, playerID, req.CardUID); err != nil {
			return err
		}

	case "moveStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.MoveStrike(r.GameState, req.StrikeUID, req.TargetSystem); err != nil {
			return err
		}

	case "announceStrike":
		if err := game.AnnounceStrike(r.GameState); err != nil {
			return err
		}

	case "skipAnnounceStrike":
		if err := game.SkipAnnounceStrike(r.GameState); err != nil {
			return err
		}

	case "retargetStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.RetargetStrike(r.GameState, req.StrikeUID, req.TargetSystem); err != nil {
			return err
		}

	case "retargetMissedStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.RetargetMissedStrike(r.GameState, req.StrikeUID, req.TargetSystem); err != nil {
			return err
		}

	case "skipMissedStrike":
		var req struct {
			StrikeUID string `json:"strikeUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.SkipMissedStrike(r.GameState, req.StrikeUID); err != nil {
			return err
		}

	case "discardMissedStrike":
		var req struct {
			StrikeUID string `json:"strikeUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.DiscardMissedStrike(r.GameState, req.StrikeUID); err != nil {
			return err
		}

	case "selectStrike":
		var req struct {
			StrikeUID string `json:"strikeUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.SelectStrike(r.GameState, req.StrikeUID); err != nil {
			return err
		}

	case "skipStrikeSelect":
		if err := game.SkipStrikeSelect(r.GameState); err != nil {
			return err
		}

	case "skipStrikeMove":
		if err := game.SkipStrikeMove(r.GameState); err != nil {
			return err
		}

	case "endTurn":
		var req struct {
			DiscardCards  []string `json:"discardCards"`
			PublicDiscard bool     `json:"publicDiscard"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.EndTurn(r.GameState, req.DiscardCards, req.PublicDiscard); err != nil {
			return err
		}

	case "lightspeedShip":
		// 光速飞船跃迁：handler 仅解析 payload 并透传给 ExecuteLightspeedShip，不在此做飞船存在性校验。
		// 模式差异由 ExecuteLightspeedShip 内部分派处理：
		//   - Relics 模式（LightspeedUsage=reusable）：飞船作为可复用设施，须已部署在 FaceUpCards，由 executeLightspeedShipRelics 校验。
		//   - Classic 模式（LightspeedUsage=oneTime）：飞船为一次性手牌，由 executeLightspeedShipClassic 内部遍历 player.Hand 查找 ability=="escape" 的卡，无则记录日志返回。
		var req struct {
			Mode               string `json:"mode"`
			TargetSystem       int    `json:"targetSystem"`
			CarryEnergy        int    `json:"carryEnergy"`
			Message            string `json:"message"`
			LeaveBehind        bool   `json:"leaveBehind"`
			BroadcastOnInherit *bool  `json:"broadcastOnInherit,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		if err := game.ExecuteLightspeedShip(r.GameState, playerID, req.CarryEnergy, req.Message, req.LeaveBehind, req.BroadcastOnInherit); err != nil {
			return err
		}

	case "forfeit":
		// 主动弃权（.exit）：玩家淘汰，无 attacker 不奖励能量。
		// ValidateAction 已保证 player 存在且未淘汰。
		// EliminatePlayerForForfeit 不推进回合、不判定 game over，
		// 此处统一处理：≤1 名存活玩家 → 游戏结束；弃权者为当前玩家 → 推进回合。
		wasCurrent := r.GameState.CurrentPlayerID == playerID
		if err := game.EliminatePlayerForForfeit(r.GameState, playerID); err != nil {
			return err
		}
		alivePlayers := game.Filter(r.GameState.Players, func(p game.Player) bool { return !p.Eliminated })
		if len(alivePlayers) <= 1 {
			r.GameState.Phase = game.GamePhaseGameOver
			if len(alivePlayers) == 1 {
				id := alivePlayers[0].ID
				r.GameState.Winner = &id
			} else {
				r.GameState.Winner = nil
			}
			game.AddGameOverLog(r.GameState)
		} else if wasCurrent {
			game.AdvanceToNextPlayer(r.GameState)
		}

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
			// 把回放 UUID 注入终局状态，使广播的结算视角携带一致的 replayId
			r.GameState.ReplayID = r.recorder.ReplayID()
		}
		r.State = RoomStateFinished
		// 持久化对局结算信息到 matches 表
		if r.onGameFinish != nil && r.MatchID != "" {
			r.onGameFinish(r.MatchID, r.GameState, r.gameStartedAt)
		}
	}

	// 调整回合计时器（GameOver 路径由 checkFallbackStateLocked 内部取消）
	if r.GameState.Phase != game.GamePhaseGameOver {
		currPlayer := r.GameState.CurrentPlayerID
		currPhase := r.GameState.TurnPhase
		if currPlayer != prevCurrentPlayerID || currPhase != prevTurnPhase {
			// 回合切换或阶段变化（含 InterruptTurn/ResumeTurn）→ reconcile
			r.reconcileTurnTimerLocked(prevCurrentPlayerID, prevTurnPhase)
		} else if playerID == currPlayer {
			// 同玩家同阶段且 dispatch 成功 → 重置空闲计时器
			r.resetTurnTimerLocked()
		}
		// 非当前玩家的成功动作不重置计时器
	}

	// 检查兜底条件：若仅剩一名活跃玩家（其余断线或淘汰），启动/取消兜底计时器。
	r.checkFallbackStateLocked()

	// 递增版本号用于 delta 同步
	if r.GameState.Version == nil {
		v := 1
		r.GameState.Version = &v
	} else {
		*r.GameState.Version++
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
	if code := actionErrorCode(actionErr); code != "" {
		errCode = code
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

// HandleAckState 处理客户端的 game:ackState 事件，记录玩家最近 ack 的版本号。
// 用于判断下次广播是否可发 delta（lastAck 必须与 currentVersion-1 或 currentVersion 匹配）。
// 即使 playerID 不在 r.Players 中也接受（避免 race：玩家刚断连但 ack 仍在途）。
func (r *Room) HandleAckState(playerID string, version int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lastAckVersion[playerID] = version
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
		currentVersion := 0
		if r.GameState.Version != nil {
			currentVersion = *r.GameState.Version
		}

		for _, p := range r.Players {
			if !p.Connected {
				continue
			}
			nextView := game.CreateViewState(r.GameState, game.ViewOptions{
				Role:     game.ViewRolePlayer,
				PlayerID: p.ID,
			})

			prevView := r.lastSentViews[p.ID]
			lastAck := r.lastAckVersion[p.ID]

			// 宽容策略：允许 lastAck == currentVersion-1 或 == currentVersion
			//（客户端可能尚未 ack 当前版本）
			canDelta := prevView != nil &&
				(lastAck == currentVersion-1 || lastAck == currentVersion)

			if canDelta {
				changes := game.DiffViewStates(prevView, nextView)
				if len(changes) == 0 {
					// 无变化，跳过发送但仍更新 cache
					r.lastSentViews[p.ID] = nextView
					continue
				}
				msg := r.buildDeltaSyncMessage(changes, currentVersion)
				r.sendToPlayer(p.ID, msg)
			} else {
				// fullSync 路径（cache miss 或 version 不连续）
				msg := r.buildFullSyncMessageWithState(nextView)
				r.sendToPlayer(p.ID, msg)
			}

			// 无论走哪条路径，更新 cache
			r.lastSentViews[p.ID] = nextView
		}

		// 终局且存在已连接玩家时，广播一份"全知视角"结算 state（用于结算推送）。
		// 数据源为终局全知视角 ViewState，仅当 GameOver 时才发送，避免泄露进行中对局信息。
		if r.GameState.Phase == game.GamePhaseGameOver {
			settlementView := game.CreateViewState(r.GameState, game.ViewOptions{
				Role:     game.ViewRoleReplay,
				PlayerID: "",
			})
			msg := r.buildFullSyncMessageWithState(settlementView)
			for _, p := range r.Players {
				if p.Connected {
					r.sendToPlayer(p.ID, msg)
				}
			}
		}
		return
	}

	// 回退到单一广播（用于无 sendToPlayer 的场景，如测试）
	if r.hubBroadcast != nil {
		r.hubBroadcast(r.ID, r.buildFullSyncMessage())
	}
}

// buildDeltaSyncMessage 构建 game:deltaSync 增量同步消息
func (r *Room) buildDeltaSyncMessage(changes []game.Change, version int) hub.Message {
	payload, err := json.Marshal(map[string]interface{}{
		"changes":   changes,
		"version":   version,
		"timestamp": time.Now().UnixMilli(),
	})
	if err != nil {
		return hub.Message{Type: string(hub.EvtSrvGameDeltaSync), RoomID: r.ID}
	}
	return hub.Message{
		Type:    string(hub.EvtSrvGameDeltaSync),
		RoomID:  r.ID,
		Payload: payload,
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

// RejoinPlayer 重新加入房间，绕过 RoomStateWaiting 检查。
// 语义：
//   - 若玩家已在 r.Players 中（30s 内重连 case）：仅标记 Connected=true，返回 true
//   - 否则校验 r.State == RoomStatePlaying && r.GameState != nil，
//     且玩家在 GameState.Players 中且未淘汰，append 到 r.Players，返回 true
//   - 不满足条件返回 false
//
// 不改变 HostID，不重置 GameState，不重启回放录制。
func (r *Room) RejoinPlayer(player *hub.PlayerInfo) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if player == nil || player.ID == "" {
		return false
	}

	// 1. 玩家已在 r.Players 中：仅标记 Connected（30s 内重连）
	for i := range r.Players {
		if r.Players[i].ID == player.ID {
			r.Players[i].Connected = true
			r.checkFallbackStateLocked()
			return true
		}
	}

	// 2. 校验房间处于 Playing 且 GameState 非空
	if r.State != RoomStatePlaying || r.GameState == nil {
		return false
	}

	// 3. 校验玩家在 GameState.Players 中且未淘汰
	var gp *game.Player
	for i := range r.GameState.Players {
		if r.GameState.Players[i].ID == player.ID {
			gp = &r.GameState.Players[i]
			break
		}
	}
	if gp == nil {
		return false
	}
	if gp.Eliminated {
		return false
	}

	// 4. 通过校验：append 到 r.Players（Connected=true, Ready=true）
	pi := *player
	pi.Connected = true
	pi.Ready = true
	r.Players = append(r.Players, pi)
	r.LastActivity = time.Now()

	r.checkFallbackStateLocked()
	return true
}

// ActivePlayersCount 返回房间内仍连接且未淘汰的玩家数量（公开方法，供 hub 构造 payload 使用）。
func (r *Room) ActivePlayersCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.activePlayersCountLocked()
}

// GetGameState 返回 GameState 指针（加锁返回，调用方仅读不写）。
// 供 hub 读取 TotalTurn 等。若游戏未开始返回 nil。
func (r *Room) GetGameState() *game.GameState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.GameState
}

// GetGameMode 返回房间的游戏模式（加锁返回）。
func (r *Room) GetGameMode() game.GameMode {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.GameMode
}

// GameStartedAt 返回游戏开始时间（加锁返回）。
func (r *Room) GameStartedAt() time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.gameStartedAt
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
		r.cancelTurnTimerLocked()
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
	var victimIDs []string
	for i := range r.GameState.Players {
		gp := &r.GameState.Players[i]
		if !gp.Eliminated && gp.ID != winnerID {
			victimIDs = append(victimIDs, gp.ID)
		}
	}
	game.EliminatePlayersForFallback(r.GameState, victimIDs)

	r.GameState.Phase = game.GamePhaseGameOver
	r.GameState.Winner = &winnerID
	r.GameState.PendingAction = nil
	game.AddStructuredLog(r.GameState, fmt.Sprintf("由于其他玩家已断线或淘汰，%s 获胜！", winnerName), game.LogEntryTypeSystem, game.LogFields{
		PlayerIDs: []string{winnerID},
	})

	// 触发回放保存
	if r.recorder != nil {
		// 记录兜底结束 action，使回放状态重建忠实重现批量淘汰与终局
		if len(victimIDs) > 0 {
			data, _ := json.Marshal(map[string][]string{"eliminatedPlayerIds": victimIDs})
			r.recorder.RecordAction(winnerID, "fallback", data, r.GameState.TotalTurn)
		}
		r.recorder.SaveReplay(r.GameState)
		// 把回放 UUID 注入终局状态，使广播的结算视角携带一致的 replayId
		r.GameState.ReplayID = r.recorder.ReplayID()
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

// StopTimers 停止房间所有后台计时器（兜底计时器与回合计时器），供 RoomManager 销毁房间时调用。
func (r *Room) StopTimers() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fallbackTimer != nil {
		r.fallbackTimer.Stop()
		r.fallbackTimer = nil
	}
	r.cancelTurnTimerLocked()
}

// ============================================================================
// 回合空闲超时机制：当前玩家 3 分钟内无任何有效操作则自动淘汰
// ============================================================================

// effectiveTurnTimeoutLocked 返回当前对局生效的回合超时时长。
// 优先使用 ModeRules.TurnTimeoutSeconds（非 0），否则回退到 rooms.TurnTimeout（环境变量）。
// 调用方必须持有 r.mu。
func (r *Room) effectiveTurnTimeoutLocked() time.Duration {
	if r.GameState != nil {
		rules := game.StateRules(r.GameState)
		if rules.TurnTimeoutSeconds > 0 {
			return time.Duration(rules.TurnTimeoutSeconds) * time.Second
		}
	}
	return TurnTimeout
}

// startTurnTimerLocked 为当前玩家启动回合计时器。
// 若已存在计时器先停止；若 GameState 不在 Playing 或 TurnPhase==Interrupted 则不启动。
// 调用方必须持有 r.mu。
func (r *Room) startTurnTimerLocked() {
	if r.turnTimer != nil {
		r.turnTimer.Stop()
		r.turnTimer = nil
	}
	if r.State != RoomStatePlaying || r.GameState == nil {
		r.turnTimerPlayerID = ""
		return
	}
	if r.GameState.Phase != game.GamePhasePlaying {
		r.turnTimerPlayerID = ""
		return
	}
	// InterruptTurn 期间不启动（等待 ResumeTurn 重启）
	if r.GameState.TurnPhase == game.TurnPhaseInterrupted {
		r.turnTimerPlayerID = r.GameState.CurrentPlayerID
		return
	}
	r.turnTimerPlayerID = r.GameState.CurrentPlayerID
	duration := r.effectiveTurnTimeoutLocked()
	r.turnTimer = time.AfterFunc(duration, r.triggerTurnTimeout)
}

// resetTurnTimerLocked 重置当前玩家的回合计时器（保持 turnTimerPlayerID 不变）。
// 仅当 GameState 处于 Playing 且非 Interrupted 时才重启计时器。
// 调用方必须持有 r.mu。
func (r *Room) resetTurnTimerLocked() {
	if r.turnTimer != nil {
		r.turnTimer.Stop()
	}
	if r.State != RoomStatePlaying || r.GameState == nil {
		r.turnTimer = nil
		r.turnTimerPlayerID = ""
		return
	}
	if r.GameState.Phase != game.GamePhasePlaying {
		r.turnTimer = nil
		r.turnTimerPlayerID = ""
		return
	}
	// InterruptTurn 期间不重启（等待 ResumeTurn）
	if r.GameState.TurnPhase == game.TurnPhaseInterrupted {
		r.turnTimer = nil
		r.turnTimerPlayerID = r.GameState.CurrentPlayerID
		return
	}
	r.turnTimerPlayerID = r.GameState.CurrentPlayerID
	duration := r.effectiveTurnTimeoutLocked()
	r.turnTimer = time.AfterFunc(duration, r.triggerTurnTimeout)
}

// cancelTurnTimerLocked 取消当前回合计时器并清空 playerID。
// 调用方必须持有 r.mu。
func (r *Room) cancelTurnTimerLocked() {
	if r.turnTimer != nil {
		r.turnTimer.Stop()
		r.turnTimer = nil
	}
	r.turnTimerPlayerID = ""
}

// reconcileTurnTimerLocked 在 HandleGameAction 末尾根据当前 GameState 调整计时器：
// 1. 若 CurrentPlayerID 与 dispatch 前不同 → 回合切换，启动新玩家计时器
// 2. 若 TurnPhase 从非 Interrupted → Interrupted → 暂停（cancel 但保留 playerID）
// 3. 若 TurnPhase 从 Interrupted → 非 Interrupted → 重启计时器
// 4. 若 Phase == GameOver → 取消计时器
// 5. 其他情况（同玩家同阶段）→ 不动计时器（由调用方按需 reset）
// 调用方必须持有 r.mu。prevCurrentPlayerID 是 dispatch 前的 CurrentPlayerID 快照。
func (r *Room) reconcileTurnTimerLocked(prevCurrentPlayerID string, prevTurnPhase game.TurnPhase) {
	if r.State != RoomStatePlaying || r.GameState == nil {
		r.cancelTurnTimerLocked()
		return
	}
	if r.GameState.Phase == game.GamePhaseGameOver {
		r.cancelTurnTimerLocked()
		return
	}
	currPlayer := r.GameState.CurrentPlayerID
	currPhase := r.GameState.TurnPhase

	// 回合切换：玩家不同 → 启动新计时器
	if currPlayer != prevCurrentPlayerID {
		r.startTurnTimerLocked()
		return
	}

	// 同玩家，阶段从非 Interrupted → Interrupted：暂停
	if prevTurnPhase != game.TurnPhaseInterrupted && currPhase == game.TurnPhaseInterrupted {
		if r.turnTimer != nil {
			r.turnTimer.Stop()
			r.turnTimer = nil
		}
		// 保留 turnTimerPlayerID = currPlayer（ResumeTurn 后会重启）
		return
	}

	// 同玩家，阶段从 Interrupted → 非 Interrupted：重启
	if prevTurnPhase == game.TurnPhaseInterrupted && currPhase != game.TurnPhaseInterrupted {
		r.startTurnTimerLocked()
		return
	}

	// 同玩家同阶段：不动（由 HandleGameAction 调用方按 dispatch 成功与否决定 reset）
}

// triggerTurnTimeout 是 turnTimer 的回调：淘汰当前玩家并推进回合。
func (r *Room) triggerTurnTimeout() {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 计时器已触发，清空引用
	r.turnTimer = nil

	if r.State != RoomStatePlaying || r.GameState == nil {
		r.turnTimerPlayerID = ""
		return
	}
	if r.GameState.Phase != game.GamePhasePlaying {
		r.turnTimerPlayerID = ""
		return
	}

	// 双重检查：触发时仍为原玩家且未淘汰
	currentID := r.GameState.CurrentPlayerID
	if currentID != r.turnTimerPlayerID {
		// 玩家已切换（可能是 dispatch 与 timer race）：不淘汰
		r.turnTimerPlayerID = ""
		return
	}
	var target *game.Player
	for i := range r.GameState.Players {
		if r.GameState.Players[i].ID == currentID {
			target = &r.GameState.Players[i]
			break
		}
	}
	if target == nil || target.Eliminated {
		r.turnTimerPlayerID = ""
		return
	}

	// 调用淘汰函数
	game.EliminatePlayerForTimeout(r.GameState, currentID)
	// 记录超时淘汰 action（推进前），使回放状态重建忠实重现本次淘汰
	if r.recorder != nil {
		r.recorder.RecordAction(currentID, "timeout", nil, r.GameState.TotalTurn)
	}
	r.turnTimerPlayerID = ""

	// 触发回放保存（若游戏结束）
	if r.recorder != nil && r.GameState.Phase == game.GamePhaseGameOver {
		r.recorder.SaveReplay(r.GameState)
		// 把回放 UUID 注入终局状态，使广播的结算视角携带一致的 replayId
		r.GameState.ReplayID = r.recorder.ReplayID()
	}
	if r.GameState.Phase == game.GamePhaseGameOver {
		r.State = RoomStateFinished
		if r.onGameFinish != nil && r.MatchID != "" {
			r.onGameFinish(r.MatchID, r.GameState, r.gameStartedAt)
		}
	} else {
		// 推进到下一玩家（EliminatePlayerForTimeout 不推进回合）
		game.AdvanceToNextPlayer(r.GameState)
		// 启动新玩家的回合计时器
		r.startTurnTimerLocked()
	}

	r.LastActivity = time.Now()

	// 评估是否需要启动 fallbackTimer
	r.checkFallbackStateLocked()

	// 递增版本号 + 广播
	if r.GameState.Version == nil {
		v := 1
		r.GameState.Version = &v
	} else {
		*r.GameState.Version++
	}
	r.broadcastGameState()
}
