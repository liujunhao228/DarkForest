package game

import "time"

// ViewRole 表示观察者角色
type ViewRole string

const (
	ViewRolePlayer    ViewRole = "PLAYER"
	ViewRoleSpectator ViewRole = "SPECTATOR"
	ViewRoleReplay    ViewRole = "REPLAY"
)

// ViewOptions 是 CreateViewState 的参数
type ViewOptions struct {
	Role     ViewRole
	PlayerID string
}

// PlayerView 是脱敏后的玩家视图（对手手牌隐藏）
type PlayerView struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Color            PlayerColor `json:"color"`
	Position         int    `json:"position"`
	Energy           int    `json:"energy"`
	HandCount        int    `json:"handCount"`
	Hand             []Card `json:"hand,omitempty"`
	FaceUpCards      []Card `json:"faceUpCards"`
	Eliminated       bool   `json:"eliminated"`
	BroadcastHistory []struct{ SystemID int; Turn int } `json:"broadcastHistory"`
}

// FlyingStrikeView 是脱敏后的打击牌视图（移除 TargetPlayerID）
type FlyingStrikeView struct {
	UID            string  `json:"uid"`
	DefID          string  `json:"defId"`
	OwnerID        string  `json:"ownerId"`
	Position       int     `json:"position"`
	TargetSystem   int     `json:"targetSystem"`
	Level          int     `json:"level"`
	Speed          int     `json:"speed"`
	RemainingMoves int     `json:"remainingMoves"`
	Effect         *string `json:"effect,omitempty"`
	StrikeName     string  `json:"strikeName"`
	Arrived        bool    `json:"arrived"`
	Delayed        bool    `json:"delayed"`
}

// BroadcastResponseView 是脱敏后的广播响应视图（ResponseCard 按揭示阶段门控）
type BroadcastResponseView struct {
	PlayerID     string `json:"playerId"`
	PlayerName   string `json:"playerName"`
	CanRespond   bool   `json:"canRespond"`
	MustRespond  bool   `json:"mustRespond"`
	Responded    bool   `json:"responded"`
	Agreed       bool   `json:"agreed"`
	ResponseCard *Card  `json:"responseCard,omitempty"`
}

// BroadcastStateView 是脱敏后的广播状态视图
// Card / Subtype / ResponseCard / Responses[].ResponseCard 按揭示阶段（reveal）与广播者身份门控
type BroadcastStateView struct {
	BroadcasterID       string                  `json:"broadcasterId"`
	CardUID             string                  `json:"cardUid"`
	Card                *Card                   `json:"card,omitempty"`
	TargetSystem        int                     `json:"targetSystem"`
	Range               int                     `json:"range"`
	Subtype             *BroadcastSubtype       `json:"subtype,omitempty"`
	Responses           []BroadcastResponseView `json:"responses"`
	Phase               BroadcastPhase          `json:"phase"`
	SelectedResponderID *string                 `json:"selectedResponderId,omitempty"`
	ResponseCard        *Card                   `json:"responseCard,omitempty"`
}

// ViewState 是脱敏后的游戏状态视图
// 注意：不含 DrawPile / DiscardPile 字段（敏感信息不发送）
type ViewState struct {
	Phase              GamePhase           `json:"phase"`
	TotalTurn          int                 `json:"totalTurn"`
	PlayerCount        int                 `json:"playerCount"`
	Players            []PlayerView        `json:"players"`
	CurrentPlayerIndex int                 `json:"currentPlayerIndex"`
	CurrentPlayerID    string              `json:"currentPlayerId"`
	LocalPlayerID      string              `json:"localPlayerId"`
	FlyingStrikes      []FlyingStrikeView  `json:"flyingStrikes"`
	Broadcast          *BroadcastStateView `json:"broadcast,omitempty"`
	TurnPhase          TurnPhase           `json:"turnPhase"`
	PendingAction      *PendingAction      `json:"pendingAction,omitempty"`
	Logs               []LogEntry          `json:"logs"`
	DestroyedStars     []int               `json:"destroyedStars"`
	Winner             *string             `json:"winner,omitempty"`
	IsProcessing       bool                `json:"isProcessing"`
	Version            *int                `json:"version,omitempty"`
	// LastRelicDiscovery 是继承遗迹/遗留物时的瞬时私有揭示；
	// 仅当 viewerID == state.LastRelicDiscovery.PlayerID 时填充，其他观察者始终为 nil。
	LastRelicDiscovery *RelicDiscovery `json:"lastRelicDiscovery,omitempty"`
	ViewMeta           ViewMeta        `json:"_viewMeta"`
}

// ViewMeta 是视图元信息
type ViewMeta struct {
	Role      ViewRole `json:"role"`
	ViewerID  string   `json:"viewerId,omitempty"`
	Timestamp int64    `json:"timestamp"`
}

// CreateViewState 根据观察者角色与 ID 生成脱敏后的视图
func CreateViewState(state *GameState, opts ViewOptions) *ViewState {
	role := opts.Role
	viewerID := opts.PlayerID

	players := make([]PlayerView, 0, len(state.Players))
	for _, p := range state.Players {
		isViewer := role == ViewRolePlayer && p.ID == viewerID
		revealAll := role == ViewRoleReplay
		// 黑暗森林核心机制：仅自己或回放模式可见真实位置，对手位置隐藏为 -1
		pos := p.Position
		if !isViewer && !revealAll {
			pos = -1
		}
		pv := PlayerView{
			ID:               p.ID,
			Name:             p.Name,
			Color:            p.Color,
			Position:         pos,
			Energy:           p.Energy,
			HandCount:        len(p.Hand),
			Hand:             nil,
			FaceUpCards:      p.FaceUpCards,
			Eliminated:       p.Eliminated,
			BroadcastHistory: p.BroadcastHistory,
		}
		// 自己可见完整手牌；REPLAY 角色可见所有人手牌
		if role == ViewRoleReplay || p.ID == viewerID {
			pv.Hand = p.Hand
		}
		players = append(players, pv)
	}

	flyingStrikes := make([]FlyingStrikeView, 0, len(state.FlyingStrikes))
	for _, s := range state.FlyingStrikes {
		// 移除 TargetPlayerID（仅拥有者可见的敏感信息）
		flyingStrikes = append(flyingStrikes, FlyingStrikeView{
			UID:            s.UID,
			DefID:          s.DefID,
			OwnerID:        s.OwnerID,
			Position:       s.Position,
			TargetSystem:   s.TargetSystem,
			Level:          s.Level,
			Speed:          s.Speed,
			RemainingMoves: s.RemainingMoves,
			Effect:         s.Effect,
			StrikeName:     s.StrikeName,
			Arrived:        s.Arrived,
			Delayed:        s.Delayed,
		})
	}

	// 私有揭示门控：仅当 viewerID == state.LastRelicDiscovery.PlayerID 时填充。
	// 这是核心信息不对称：仅继承者本人可见，其他观察者始终为 nil。
	// （SPECTATOR 角色的 viewerID 通常不等于任何玩家 ID，故自然被排除。）
	var lastRelicDiscovery *RelicDiscovery
	if state.LastRelicDiscovery != nil && viewerID == state.LastRelicDiscovery.PlayerID {
		rd := *state.LastRelicDiscovery
		lastRelicDiscovery = &rd
	}

	return &ViewState{
		Phase:              state.Phase,
		TotalTurn:          state.TotalTurn,
		PlayerCount:        state.PlayerCount,
		Players:            players,
		CurrentPlayerIndex: state.CurrentPlayerIndex,
		CurrentPlayerID:    state.CurrentPlayerID,
		LocalPlayerID:      viewerID, // per-player：设为当前 viewer 的 ID
		FlyingStrikes:      flyingStrikes,
		Broadcast:          filterBroadcastForView(state.Broadcast, viewerID, role),
		TurnPhase:          state.TurnPhase,
		PendingAction:      state.PendingAction,
		Logs:               state.Logs,
		DestroyedStars:    state.DestroyedStars,
		Winner:             state.Winner,
		IsProcessing:       state.IsProcessing,
		Version:            state.Version,
		LastRelicDiscovery: lastRelicDiscovery,
		ViewMeta: ViewMeta{
			Role:      role,
			ViewerID:  viewerID,
			Timestamp: time.Now().UnixMilli(),
		},
	}
}

// filterBroadcastForView 按揭示阶段与广播者身份对广播状态脱敏
// 规则（与重构前 ViewManager.filterBroadcastState 一致）：
//   - Card / Subtype：仅广播者本人、已揭示（reveal）或 REPLAY 可见
//   - Responses[].ResponseCard：仅已揭示、回应者本人或 REPLAY 可见
//   - 顶层 ResponseCard：仅已揭示或 REPLAY 可见
func filterBroadcastForView(broadcast *BroadcastState, viewerID string, role ViewRole) *BroadcastStateView {
	if broadcast == nil {
		return nil
	}

	isBroadcaster := role == ViewRolePlayer && broadcast.BroadcasterID == viewerID
	isRevealed := broadcast.Phase == BroadcastPhaseReveal
	revealAll := role == ViewRoleReplay

	var card *Card
	if (isBroadcaster || isRevealed || revealAll) && broadcast.Card.UID != "" {
		c := broadcast.Card
		card = &c
	}

	var subtype *BroadcastSubtype
	if isBroadcaster || isRevealed || revealAll {
		st := broadcast.Subtype
		subtype = &st
	}

	responses := make([]BroadcastResponseView, 0, len(broadcast.Responses))
	for _, r := range broadcast.Responses {
		isResponder := role == ViewRolePlayer && r.PlayerID == viewerID
		var rc *Card
		if (isRevealed || isResponder || revealAll) && r.ResponseCard != nil {
			rc = r.ResponseCard
		}
		responses = append(responses, BroadcastResponseView{
			PlayerID:     r.PlayerID,
			PlayerName:   r.PlayerName,
			CanRespond:   r.CanRespond,
			MustRespond:  r.MustRespond,
			Responded:    r.Responded,
			Agreed:       r.Agreed,
			ResponseCard: rc,
		})
	}

	var topRC *Card
	if (isRevealed || revealAll) && broadcast.ResponseCard != nil {
		topRC = broadcast.ResponseCard
	}

	var selResp *string
	if broadcast.SelectedResponderID != nil {
		s := *broadcast.SelectedResponderID
		selResp = &s
	}

	return &BroadcastStateView{
		BroadcasterID:       broadcast.BroadcasterID,
		CardUID:             broadcast.CardUID,
		Card:                card,
		TargetSystem:        broadcast.TargetSystem,
		Range:               broadcast.Range,
		Subtype:             subtype,
		Responses:           responses,
		Phase:               broadcast.Phase,
		SelectedResponderID: selResp,
		ResponseCard:        topRC,
	}
}
