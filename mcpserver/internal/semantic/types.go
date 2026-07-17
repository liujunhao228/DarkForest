package semantic

import "darkforest/mcpserver/internal/gamesdk"

// CardRole 是 SimpleCard 的语义角色，用于 Agent 快速理解卡牌用途。
type CardRole string

const (
	// CardRoleEnergy 表示产能设施（每回合产出能量）。
	CardRoleEnergy CardRole = "energy"
	// CardRoleDefense 表示防御设施（提供保护等级）。
	CardRoleDefense CardRole = "defense"
	// CardRoleUtility 表示功能设施（监听基地、光速飞船等能力型卡）。
	CardRoleUtility CardRole = "utility"
)

// SimpleCard 是 FaceUpCards 的简化投影，仅保留 Agent 决策所需的核心字段：
// 定义 ID、名称、语义角色、可读产出描述。
type SimpleCard struct {
	DefID  string   `json:"defId"`
	Name   string   `json:"name"`
	Role   CardRole `json:"role"`
	Output string   `json:"output"`
}

// FoePosition 是对手位置的判别式接口，通过 Known 字段在 JSON 中区分两种实现。
// 仅由 PositionKnown / PositionUnknown 实现，外部不应自行扩展。
type FoePosition interface {
	foePositionMarker()
}

// PositionKnown 表示对手位置已被揭示（通过广播或光速飞船）。
// JSON 形如 {"known":true,"system":N,"distanceFromMe":M,"reachableInOneJump":bool}。
type PositionKnown struct {
	Known              bool `json:"known"`
	System             int  `json:"system"`
	DistanceFromMe     int  `json:"distanceFromMe"`
	ReachableInOneJump bool `json:"reachableInOneJump"`
}

// foePositionMarker 实现 FoePosition 接口的密封标记。
func (PositionKnown) foePositionMarker() {}

// PositionUnknown 表示对手位置尚未揭示。
// JSON 形如 {"known":false,"hint":"..."}。
type PositionUnknown struct {
	Known bool   `json:"known"`
	Hint  string `json:"hint"`
}

// foePositionMarker 实现 FoePosition 接口的密封标记。
func (PositionUnknown) foePositionMarker() {}

// SelfSnapshot 是 Agent 自己的全量信息快照。
// Hand 直接复用 gamesdk.Card（已展开字段），其他玩家不会拿到此快照。
type SelfSnapshot struct {
	ID               string                          `json:"id"`
	Name             string                          `json:"name"`
	Color            string                          `json:"color"`
	Energy           int                             `json:"energy"`
	Position         int                             `json:"position"`
	PositionIsPublic bool                            `json:"positionIsPublic"`
	Hand             []gamesdk.Card                  `json:"hand,omitempty"`
	FaceUpCards      []SimpleCard                    `json:"faceUpCards,omitempty"`
	BroadcastHistory []gamesdk.BroadcastHistoryEntry `json:"broadcastHistory,omitempty"`
	Eliminated       bool                            `json:"eliminated"`
}

// FoeSnapshot 是单个对手的可见信息快照。
// 不暴露手牌内容（仅数量）与未揭示位置。
type FoeSnapshot struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Color       string       `json:"color"`
	Eliminated  bool         `json:"eliminated"`
	Position    FoePosition  `json:"position"`
	HandCount   int          `json:"handCount"`
	FaceUpCards []SimpleCard `json:"faceUpCards,omitempty"`
}

// LeftoverSummary 是公共可见的星系遗留物摘要。
// 仅暴露 Agent 决策需要的字段：所在星系、能量、设施数量、是否为遗迹。
type LeftoverSummary struct {
	SystemID      int  `json:"systemId"`
	Energy        int  `json:"energy"`
	FacilityCount int  `json:"facilityCount"`
	IsRelic       bool `json:"isRelic"`
}

// FieldSnapshot 是公共场景快照。
// 仅包含 ViewState 真正暴露的公共字段：已摧毁星系与可见遗留物。
type FieldSnapshot struct {
	DestroyedStars []int `json:"destroyedStars,omitempty"`
	// VisibleLeftovers 是公共可见的星系遗留物摘要。
	// TODO: 后端 ViewState 当前不暴露 Leftovers，此字段暂为空，待后端扩展。
	VisibleLeftovers []LeftoverSummary `json:"visibleLeftovers,omitempty"`
}

// EventTraceEntry 是结构化日志条目，在 gamesdk.LogEntry 基础上归纳决策相关字段。
// SystemID/CardDefID/PlayerIDs 为可选字段，不适用时省略。
type EventTraceEntry struct {
	Turn      int      `json:"turn"`
	Phase     string   `json:"phase"`
	Type      string   `json:"type"`
	Message   string   `json:"message"`
	SystemID  *int     `json:"systemId,omitempty"`
	CardDefID *string  `json:"cardDefId,omitempty"`
	PlayerIDs []string `json:"playerIds,omitempty"`
}

// EventTrace 是最近 N 条结构化事件的归纳。
type EventTrace struct {
	Entries []EventTraceEntry `json:"entries"`
}

// PendingActionSummary 是待处理动作的摘要。
// 仅保留 Type 与关键字段，原始 PendingAction 的完整结构由 gamesdk 透传给需要它的工具。
type PendingActionSummary struct {
	Type            string   `json:"type"`
	StrikeUID       string   `json:"strikeUid,omitempty"`
	StrikeUIDs      []string `json:"strikeUids,omitempty"`
	ValidMoves      []int    `json:"validMoves,omitempty"`
	TargetSystem    int      `json:"targetSystem,omitempty"`
	TargetPlayerIDs []string `json:"targetPlayerIds,omitempty"`
	PlayerID        string   `json:"playerId,omitempty"`
	CardUID         string   `json:"cardUid,omitempty"`
	ValidTargets    []int    `json:"validTargets,omitempty"`
	RefundEnergy    int      `json:"refundEnergy,omitempty"`
	Responders      []string `json:"responders,omitempty"`
}

// ActionCursor 是当前回合阶段状态，标识 Agent 是否需要行动及行动上下文。
type ActionCursor struct {
	TurnPhase       string                `json:"turnPhase"`
	IsMyTurn        bool                  `json:"isMyTurn"`
	TotalTurn       int                   `json:"totalTurn"`
	PendingAction   *PendingActionSummary `json:"pendingAction,omitempty"`
	InterruptReason string                `json:"interruptReason,omitempty"`
}

// AgentView 是 Agent 视角的顶层状态容器，由 ObjectProjector 投影产出。
// 五个域分别对应：自己 / 对手 / 公共场景 / 历史事件 / 当前回合阶段。
type AgentView struct {
	Self     SelfSnapshot  `json:"self"`
	Foes     []FoeSnapshot `json:"foes,omitempty"`
	Field    FieldSnapshot `json:"field"`
	Events   EventTrace    `json:"events"`
	Cursor   ActionCursor  `json:"cursor"`
	GameMode string        `json:"gameMode"`
}

// ObjectView 是 AgentView 的别名，用作 ProjectObject 的返回类型，
// 与"对象投影"语义对齐。
type ObjectView = AgentView
