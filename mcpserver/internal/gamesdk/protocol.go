// Package gamesdk 封装到游戏后端的 HTTP + WebSocket 客户端。
package gamesdk

import "encoding/json"

// ProtocolVersion 对齐后端 hub 协议版本。
const ProtocolVersion = "1.0.0"

// 客户端 → 服务端事件。
const (
	EventPlayerLogin       = "player:login"
	EventPlayerLogout      = "player:logout"
	EventMatchJoinQueue    = "match:joinQueue"
	EventMatchCancelQueue  = "match:cancelQueue"
	EventMatchGetStatus    = "match:getStatus"
	EventMatchCreateQueue  = "match:createQueue"
	EventMatchJoinSpecific = "match:joinSpecificQueue"
	EventMatchLeaveSpecific = "match:leaveSpecificQueue"
	EventMatchGetQueueInfo = "match:getQueueInfo"
	EventMatchGetMyQueues  = "match:getMyQueues"
	EventRoomJoin          = "room:join"
	EventRoomLeave         = "room:leave"
	EventRoomReady         = "room:ready"
	EventGameAction        = "game:action"
	EventGameCancelAction  = "game:cancelAction"
	EventGameRequestSync   = "game:requestSync"
	EventGameAckState      = "game:ackState"
	EventPing              = "ping"
)

// 服务端 → 客户端事件。
const (
	EventPlayerLoginSuccess     = "player:loginSuccess"
	EventPlayerLoginError       = "player:loginError"
	EventMatchQueueJoined       = "match:queueJoined"
	EventMatchQueueCancelled    = "match:queueCancelled"
	EventMatchQueueError        = "match:queueError"
	EventMatchQueueStatus       = "match:queueStatus"
	EventMatchFound             = "match:found"
	EventMatchQueueCreated      = "match:queueCreated"
	EventMatchSpecificJoined    = "match:specificQueueJoined"
	EventMatchSpecificLeft      = "match:specificQueueLeft"
	EventMatchQueueInfoResp     = "match:queueInfoResponse"
	EventMatchMyQueuesResp      = "match:myQueuesResponse"
	EventMatchQueueUpdate       = "match:queueUpdate"
	EventMatchError             = "match:error"
	EventRoomJoined             = "room:joined"
	EventRoomPlayerJoined       = "room:playerJoined"
	EventRoomPlayerLeft         = "room:playerLeft"
	EventRoomPlayerDisconnected = "room:playerDisconnected"
	EventRoomPlayerReconnected  = "room:playerReconnected"
	EventRoomPlayerReady        = "room:playerReady"
	EventRoomGameStarting       = "room:gameStarting"
	EventRoomGameStarted        = "room:gameStarted"
	EventRoomHostChanged        = "room:hostChanged"
	EventGameFullSync           = "game:fullSync"
	EventGameDeltaSync          = "game:deltaSync"
	EventGameActionResult       = "game:actionResult"
	EventGameError              = "game:error"
	EventGameTurnStart          = "game:turnStart"
	EventGameTurnEnd            = "game:turnEnd"
	EventGamePhaseChange        = "game:phaseChange"
	EventGamePlayerAction       = "game:playerAction"
	EventGameBroadcastRequest   = "game:broadcastRequest"
	EventGameStrikeMoveRequest  = "game:strikeMoveRequest"
	EventGameGameOver           = "game:gameOver"
	EventPong                   = "pong"
)

// Message 是 WS 消息的基础结构,对齐后端 hub.Message。
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
	RoomID  string          `json:"roomId,omitempty"`
}

// GameActionRequest 是 game:action 的 payload,兼容 data/payload 两个键名。
type GameActionRequest struct {
	Action  string         `json:"action"`
	Data    map[string]any `json:"data,omitempty"`
	Payload map[string]any `json:"payload,omitempty"` // 同义键,发送时用 Data
}

// ErrorResponse 是错误事件的 payload。
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// GameActionResult 是 game:actionResult 的 payload。
type GameActionResult struct {
	Success   bool   `json:"success"`
	Action    string `json:"action,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	Error     string `json:"error,omitempty"`
	ErrorCode string `json:"errorCode,omitempty"`
}

// PlayerInfo 是匹配/房间中的玩家信息。
type PlayerInfo struct {
	PlayerID     string `json:"playerId"`
	UserID       string `json:"userId,omitempty"`
	DisplayName  string `json:"displayName"`
	Role         string `json:"role,omitempty"`
	IsHost       bool   `json:"isHost"`
	PlayerNumber int    `json:"playerNumber"`
	Position     int    `json:"position"`
}

// MatchFoundResponse 是 match:found 的 payload。
type MatchFoundResponse struct {
	RoomID   string       `json:"roomId"`
	RoomCode string       `json:"roomCode"`
	HostID   string       `json:"hostId"`
	Players  []PlayerInfo `json:"players"`
	IsHost   bool         `json:"isHost"`
}

// RoomPlayer 是房间中的玩家信息。
type RoomPlayer struct {
	PlayerID     string `json:"playerId"`
	DisplayName  string `json:"displayName"`
	IsHost       bool   `json:"isHost"`
	PlayerNumber int    `json:"playerNumber"`
	Position     int    `json:"position"`
	Ready        bool   `json:"ready"`
	Connected    bool   `json:"connected"`
}

// RoomJoinedResponse 是 room:joined 的 payload。
type RoomJoinedResponse struct {
	RoomID      string       `json:"roomId"`
	RoomCode    string       `json:"roomCode"`
	HostID      string       `json:"hostId"`
	Status      string       `json:"status"` // waiting / starting / playing / finished
	PlayerCount int          `json:"playerCount"`
	Players     []RoomPlayer `json:"players"`
	JoinedAt    int64        `json:"joinedAt"`
	IsHost      bool         `json:"isHost"`
}

// CustomQueuePlayer 是自定义队列中的玩家。
type CustomQueuePlayer struct {
	PlayerID    string `json:"playerId"`
	DisplayName string `json:"displayName"`
	IsReady     bool   `json:"isReady"`
	JoinedAt    int64  `json:"joinedAt"`
}

// CustomQueueInfo 是 match:queueInfoResponse 中的队列信息。
type CustomQueueInfo struct {
	QueueID    string              `json:"queueId"`
	QueueName  string              `json:"queueName"`
	CreatorID  string              `json:"creatorId"`
	MinPlayers int                 `json:"minPlayers"`
	MaxPlayers int                 `json:"maxPlayers"`
	Status     string              `json:"status"` // waiting / matching / full / started
	Players    []CustomQueuePlayer `json:"players"`
}

// FullSyncPayload 是 game:fullSync 的 payload。
type FullSyncPayload struct {
	State      json.RawMessage `json:"state"`
	Version    int             `json:"version"`
	StateHash  string          `json:"stateHash,omitempty"`
	Timestamp  int64           `json:"timestamp,omitempty"`
}

// 以下为游戏状态相关类型,对齐后端 game.ViewState(脱敏后的)。
// 使用 json.RawMessage 保留原始 JSON,工具返回时直接透传给 Agent。

// ViewState 是脱敏后的游戏状态。字段较松,未解析的部分以 RawMessage 保留。
type ViewState struct {
	Kind              string          `json:"kind"`              // "view"
	Phase             string          `json:"phase"`             // setup / playing / gameOver
	TotalTurn         int             `json:"totalTurn"`
	PlayerCount       int             `json:"playerCount"`
	Players           []ViewPlayer    `json:"players"`
	CurrentPlayerIndex int            `json:"currentPlayerIndex"`
	CurrentPlayerID   string          `json:"currentPlayerId"`
	LocalPlayerID     string          `json:"localPlayerId"`
	FlyingStrikes     []FlyingStrike  `json:"flyingStrikes"`
	Broadcast         json.RawMessage `json:"broadcast,omitempty"` // BroadcastState | null
	TurnPhase         string          `json:"turnPhase"`
	PendingAction     json.RawMessage `json:"pendingAction,omitempty"`
	Logs              []LogEntry      `json:"logs"`
	DestroyedStars    []int           `json:"destroyedStars"`
	Winner            string          `json:"winner,omitempty"`
	Version           int             `json:"version,omitempty"`
}

// ViewPlayer 是脱敏后的玩家信息。
type ViewPlayer struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Color           string          `json:"color"`
	Position        int             `json:"position"` // 对手为 -1
	Energy          int             `json:"energy"`
	Hand            []Card          `json:"hand,omitempty"`     // 仅本人有
	HandCount       int             `json:"handCount,omitempty"` // 仅对手有
	FaceUpCards     []Card          `json:"faceUpCards"`
	Eliminated      bool            `json:"eliminated"`
	BroadcastHistory json.RawMessage `json:"broadcastHistory,omitempty"`
}

// Card 是卡牌。
type Card struct {
	UID             string `json:"uid"`
	DefID           string `json:"defId"`
	Name            string `json:"name"`
	Type            string `json:"type"` // broadcast / strike / defense / facility
	Energy          int    `json:"energy"`
	Description     string `json:"description"`
	Image           string `json:"image"`
	Subtype         string `json:"subtype,omitempty"`
	Range           int    `json:"range,omitempty"`
	Level           int    `json:"level,omitempty"`
	Speed           int    `json:"speed,omitempty"`
	Effect          string `json:"effect,omitempty"`
	ProtectionLevel int    `json:"protectionLevel,omitempty"`
	EnergyPerTurn   int    `json:"energyPerTurn,omitempty"`
	Ability         string `json:"ability,omitempty"`
}

// FlyingStrike 是飞行中的打击。
type FlyingStrike struct {
	UID            string `json:"uid"`
	DefID          string `json:"defId"`
	OwnerID        string `json:"ownerId"`
	Position       int    `json:"position"`
	TargetSystem   int    `json:"targetSystem"`
	TargetPlayerID string `json:"targetPlayerId,omitempty"`
	Level          int    `json:"level"`
	Speed          int    `json:"speed"`
	RemainingMoves int    `json:"remainingMoves"`
	Effect         string `json:"effect,omitempty"`
	StrikeName     string `json:"strikeName"`
	Arrived        bool   `json:"arrived"`
}

// LogEntry 是游戏日志。
type LogEntry struct {
	ID      string `json:"id"`
	Turn    int    `json:"turn"`
	Phase   string `json:"phase"`
	Message string `json:"message"`
	Type    string `json:"type"` // info / action / combat / system / broadcast
}

// GameEvent 是 wait_for_event 返回的事件项。
type GameEvent struct {
	Type      string          `json:"type"`
	Timestamp int64           `json:"timestamp"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}
