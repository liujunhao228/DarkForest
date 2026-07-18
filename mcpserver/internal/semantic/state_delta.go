package semantic

import (
	"fmt"
	"strconv"

	"darkforest/mcpserver/internal/gamesdk"
)

// StateDelta 描述两个 ViewState 之间的状态演化叙事。
// 它是语义抽象层第 4 层（StateDelta），回答"刚发生了什么"：
// 把原始的 before/after 状态对比结果收拢为 Agent 决策友好的结构化 diff。
type StateDelta struct {
	Turn       int      `json:"turn"`
	Phase      string   `json:"phase"`
	Changes    []Change `json:"changes,omitempty"`
	Trend      Trend    `json:"trend"`
	Highlights []string `json:"highlights,omitempty"`
}

// Change 单个状态变更。
//
// Narrative 仅陈述事实（如 "Alice 能量 5→8"），禁用行动指导词
// （见 deltaForbiddenWords）。Before/After 为字符串表示，便于 Agent 直读。
type Change struct {
	Actor     string `json:"actor,omitempty"`  // 行动者 playerId
	Type      string `json:"type"`             // 变更类型（见 ChangeType* 枚举）
	Before    string `json:"before,omitempty"` // 变更前值（字符串表示）
	After     string `json:"after,omitempty"`  // 变更后值
	Narrative string `json:"narrative"`        // 人话描述（事实陈述，禁用行动指导词）
}

// Trend 趋势统计，刻画观察者自身的状态走向。
type Trend struct {
	MyEnergyDelta    int `json:"myEnergyDelta,omitempty"`
	MyHandDelta      int `json:"myHandDelta,omitempty"`
	ThreatLevelDelta int `json:"threatLevelDelta,omitempty"` // 入站打击数变化
}

// ChangeType 变更类型枚举。
//
// 注意：ChangeTypeDiscard 在 gamesdk.ViewState 中无对应字段（脱敏后不含 DiscardPile），
// ComputeDelta 当前不产出 discard 类型变更；枚举保留以便未来从 Logs 推断补齐。
// ChangeTypeTurnEnd 同理，当前不产出，保留枚举完整性。
const (
	ChangeTypeEnergy        = "energy"         // 能量变化
	ChangeTypeHand          = "hand"           // 手牌增减
	ChangeTypeDiscard       = "discard"        // 弃牌堆新增（ViewState 不含，暂不产出）
	ChangeTypeFlyingStrike  = "flying_strike"  // 飞行打击增减
	ChangeTypeDestroyedStar = "destroyed_star" // 恒星被摧毁
	ChangeTypeElimination   = "elimination"    // 玩家被淘汰
	ChangeTypePosition      = "position"       // 位置变化（光速飞船跃迁）
	ChangeTypeBroadcast     = "broadcast"      // 广播会话变化
	ChangeTypeTurnEnd       = "turn_end"       // 回合结束（暂不产出）
	ChangeTypeWinner        = "winner"         // 胜负判定
)

// deltaForbiddenWords 是 Narrative 字段禁用的行动指导词。
// Narrative 仅陈述事实，不得引导 Agent 采取具体行动。
// 与 strikeForbiddenWords（strike_view.go）保持同一份词表。
var deltaForbiddenWords = []string{
	"建议", "应当", "推荐", "可以", "不妨", "最好", "应该", "需要", "务必",
}

// maxDeltaHighlights 限制 Highlights 保留的最大条数。
const maxDeltaHighlights = 5

// ComputeDelta 计算两个 ViewState 之间的 StateDelta。
//
// before 是前一状态，after 是后一状态。
// viewerID 是当前观察者玩家 ID（用于 Trend.MyEnergyDelta/MyHandDelta/ThreatLevelDelta）。
//
// 若 before 为 nil，返回以 after 为基准的"初始状态" delta：
// Changes 为空，Highlights 仅含 "游戏开始"。
//
// 若 after 为 nil，返回零值 StateDelta（防御性，调用方通常不传 nil after）。
func ComputeDelta(before, after *gamesdk.ViewState, viewerID string) StateDelta {
	if after == nil {
		return StateDelta{}
	}
	if before == nil {
		return StateDelta{
			Turn:       after.TotalTurn,
			Phase:      after.TurnPhase,
			Highlights: []string{"游戏开始"},
		}
	}

	delta := StateDelta{
		Turn:  after.TotalTurn,
		Phase: after.TurnPhase,
	}

	// 玩家级变化：能量 / 手牌 / 位置 / 淘汰
	beforePlayers := indexPlayersByID(before.Players)
	for i := range after.Players {
		ap := &after.Players[i]
		bp, ok := beforePlayers[ap.ID]
		if !ok {
			continue
		}
		delta.Changes = append(delta.Changes, computePlayerChanges(bp, ap, viewerID)...)
	}

	// 飞行打击增减
	delta.Changes = append(delta.Changes, computeStrikeChanges(before.FlyingStrikes, after.FlyingStrikes, after)...)

	// 摧毁星辰新增
	delta.Changes = append(delta.Changes, computeDestroyedStarChanges(before.DestroyedStars, after.DestroyedStars)...)

	// 广播会话起止
	delta.Changes = append(delta.Changes, computeBroadcastChanges(before.Broadcast, after.Broadcast, after)...)

	// 胜负判定
	delta.Changes = append(delta.Changes, computeWinnerChange(before.Winner, after.Winner, after)...)

	// 趋势统计
	delta.Trend = computeTrend(before, after, viewerID)

	// 关键事件摘要
	delta.Highlights = extractHighlights(delta.Changes)

	return delta
}

// indexPlayersByID 按 ID 索引玩家指针。
func indexPlayersByID(players []gamesdk.ViewPlayer) map[string]*gamesdk.ViewPlayer {
	out := make(map[string]*gamesdk.ViewPlayer, len(players))
	for i := range players {
		out[players[i].ID] = &players[i]
	}
	return out
}

// computePlayerChanges 计算单个玩家的变化（能量/手牌/位置/淘汰）。
//
// 手牌数量：viewerID 本人用 len(Hand)（仅本人可见 Hand 内容），
// 其他玩家用 HandCount（脱敏后的数量字段）。
func computePlayerChanges(before, after *gamesdk.ViewPlayer, viewerID string) []Change {
	var changes []Change
	name := playerDisplayName(after)

	// 能量变化
	if after.Energy != before.Energy {
		changes = append(changes, Change{
			Actor:     after.ID,
			Type:      ChangeTypeEnergy,
			Before:    strconv.Itoa(before.Energy),
			After:     strconv.Itoa(after.Energy),
			Narrative: fmt.Sprintf("%s 能量 %d→%d", name, before.Energy, after.Energy),
		})
	}

	// 手牌变化
	beforeHand := handSizeForViewer(before, viewerID)
	afterHand := handSizeForViewer(after, viewerID)
	if afterHand != beforeHand {
		changes = append(changes, Change{
			Actor:     after.ID,
			Type:      ChangeTypeHand,
			Before:    strconv.Itoa(beforeHand),
			After:     strconv.Itoa(afterHand),
			Narrative: fmt.Sprintf("%s 手牌 %d→%d", name, beforeHand, afterHand),
		})
	}

	// 位置变化（仅 after 已知位置时报告）
	if after.Position != before.Position && after.Position > 0 {
		changes = append(changes, Change{
			Actor:     after.ID,
			Type:      ChangeTypePosition,
			Before:    strconv.Itoa(before.Position),
			After:     strconv.Itoa(after.Position),
			Narrative: fmt.Sprintf("%s 位置 %d→%d", name, before.Position, after.Position),
		})
	}

	// 淘汰（before 未淘汰 → after 已淘汰）
	if after.Eliminated && !before.Eliminated {
		changes = append(changes, Change{
			Actor:     after.ID,
			Type:      ChangeTypeElimination,
			Narrative: fmt.Sprintf("%s 被淘汰", name),
		})
	}

	return changes
}

// handSizeForViewer 返回玩家手牌数量。
// viewerID 本人用 len(Hand)；其他玩家用 HandCount。
func handSizeForViewer(p *gamesdk.ViewPlayer, viewerID string) int {
	if p.ID == viewerID {
		return len(p.Hand)
	}
	return p.HandCount
}

// playerDisplayName 返回玩家显示名，空名时回退为 ID。
func playerDisplayName(p *gamesdk.ViewPlayer) string {
	if p.Name != "" {
		return p.Name
	}
	return p.ID
}

// computeStrikeChanges 计算飞行打击的增减（按 UID 对比）。
//
// 新增的打击：After=StrikeName，Narrative="{ownerName} 发射 {strikeName} 指向星系 {targetSystem}"。
// 消失的打击：Before=StrikeName，Narrative="{strikeName} 已结算"。
func computeStrikeChanges(before, after []gamesdk.FlyingStrike, state *gamesdk.ViewState) []Change {
	beforeSet := make(map[string]bool, len(before))
	for _, s := range before {
		beforeSet[s.UID] = true
	}
	afterSet := make(map[string]bool, len(after))
	for _, s := range after {
		afterSet[s.UID] = true
	}

	var changes []Change
	// 新增的打击（按 after 顺序）
	for i := range after {
		s := after[i]
		if beforeSet[s.UID] {
			continue
		}
		ownerName := playerNameInState(state, s.OwnerID)
		changes = append(changes, Change{
			Actor:     s.OwnerID,
			Type:      ChangeTypeFlyingStrike,
			After:     s.StrikeName,
			Narrative: fmt.Sprintf("%s 发射 %s 指向星系 %d", ownerName, s.StrikeName, s.TargetSystem),
		})
	}
	// 消失的打击（按 before 顺序）
	for i := range before {
		s := before[i]
		if afterSet[s.UID] {
			continue
		}
		changes = append(changes, Change{
			Actor:     s.OwnerID,
			Type:      ChangeTypeFlyingStrike,
			Before:    s.StrikeName,
			Narrative: fmt.Sprintf("%s 已结算", s.StrikeName),
		})
	}
	return changes
}

// computeDestroyedStarChanges 计算被摧毁星辰的新增。
func computeDestroyedStarChanges(before, after []int) []Change {
	beforeSet := make(map[int]bool, len(before))
	for _, v := range before {
		beforeSet[v] = true
	}
	var changes []Change
	for _, v := range after {
		if beforeSet[v] {
			continue
		}
		changes = append(changes, Change{
			Type:      ChangeTypeDestroyedStar,
			After:     strconv.Itoa(v),
			Narrative: fmt.Sprintf("星系 %d 的恒星被摧毁", v),
		})
	}
	return changes
}

// computeBroadcastChanges 计算广播会话的起止。
//
// nil → non-nil：发起广播，Actor=广播者，Narrative 含广播者名与目标星系。
// non-nil → nil：广播结束，无 Actor，Narrative="广播会话结束"。
// 其他情况（两者均非 nil 但内容不同）不产出变更。
func computeBroadcastChanges(before, after *gamesdk.BroadcastStateView, state *gamesdk.ViewState) []Change {
	var changes []Change
	if after != nil && before == nil {
		broadcasterName := playerNameInState(state, after.BroadcasterID)
		changes = append(changes, Change{
			Actor:     after.BroadcasterID,
			Type:      ChangeTypeBroadcast,
			Narrative: fmt.Sprintf("%s 在星系 %d 发起广播", broadcasterName, after.TargetSystem),
		})
	}
	if after == nil && before != nil {
		changes = append(changes, Change{
			Type:      ChangeTypeBroadcast,
			Narrative: "广播会话结束",
		})
	}
	return changes
}

// computeWinnerChange 计算胜负判定。
//
// 仅当 before 无胜者、after 有胜者时产出：After=胜者 ID，Narrative 含胜者名。
func computeWinnerChange(before, after string, state *gamesdk.ViewState) []Change {
	if after != "" && before == "" {
		winnerName := playerNameInState(state, after)
		return []Change{{
			Type:      ChangeTypeWinner,
			After:     after,
			Narrative: fmt.Sprintf("游戏结束，胜者：%s", winnerName),
		}}
	}
	return nil
}

// playerNameInState 在 state.Players 中按 ID 查找玩家名，未找到时回退为 ID。
func playerNameInState(state *gamesdk.ViewState, playerID string) string {
	if state == nil {
		return playerID
	}
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			if state.Players[i].Name != "" {
				return state.Players[i].Name
			}
			return playerID
		}
	}
	return playerID
}

// computeTrend 计算趋势统计。
//
//   - MyEnergyDelta: self after.Energy - before.Energy
//   - MyHandDelta:   self after hand size - before hand size（viewerID 用 Hand，否则 HandCount）
//   - ThreatLevelDelta: 指向 self.Position 的飞行打击数差
func computeTrend(before, after *gamesdk.ViewState, viewerID string) Trend {
	var trend Trend
	beforeSelf := findPlayerInState(before, viewerID)
	afterSelf := findPlayerInState(after, viewerID)
	if beforeSelf != nil && afterSelf != nil {
		trend.MyEnergyDelta = afterSelf.Energy - beforeSelf.Energy
		trend.MyHandDelta = handSizeForViewer(afterSelf, viewerID) - handSizeForViewer(beforeSelf, viewerID)
	}
	trend.ThreatLevelDelta = countInboundStrikes(after, viewerID) - countInboundStrikes(before, viewerID)
	return trend
}

// findPlayerInState 在 state.Players 中按 ID 查找玩家指针。
func findPlayerInState(state *gamesdk.ViewState, playerID string) *gamesdk.ViewPlayer {
	if state == nil {
		return nil
	}
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			return &state.Players[i]
		}
	}
	return nil
}

// countInboundStrikes 统计指向 viewerID 所在星系的飞行打击数。
// self.Position <= 0（未知）时返回 0。
func countInboundStrikes(state *gamesdk.ViewState, viewerID string) int {
	if state == nil {
		return 0
	}
	self := findPlayerInState(state, viewerID)
	if self == nil || self.Position <= 0 {
		return 0
	}
	count := 0
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].TargetSystem == self.Position {
			count++
		}
	}
	return count
}

// extractHighlights 从 Changes 中提取关键事件摘要（最多 maxDeltaHighlights 条）。
//
// 提取顺序（与任务规范一致）：
//  1. 淘汰事件（全部）
//  2. 摧毁恒星事件（全部）
//  3. 胜负判定（1 条）
//  4. 发射打击事件（取最后一条：Type=flying_strike 且 After 非空 且 Before 空）
//  5. 广播发起事件（取最后一条：Type=broadcast 且 Actor 非空 且 Before 空）
//
// 总数截断到 maxDeltaHighlights。
func extractHighlights(changes []Change) []string {
	var highlights []string

	// 淘汰事件
	for _, c := range changes {
		if c.Type == ChangeTypeElimination {
			highlights = append(highlights, c.Narrative)
		}
	}
	// 摧毁恒星事件
	for _, c := range changes {
		if c.Type == ChangeTypeDestroyedStar {
			highlights = append(highlights, c.Narrative)
		}
	}
	// 胜负判定
	for _, c := range changes {
		if c.Type == ChangeTypeWinner {
			highlights = append(highlights, c.Narrative)
		}
	}
	// 发射打击事件（取最后一条）
	var lastStrikeLaunch *Change
	for i := range changes {
		c := &changes[i]
		if c.Type == ChangeTypeFlyingStrike && c.After != "" && c.Before == "" {
			lastStrikeLaunch = c
		}
	}
	if lastStrikeLaunch != nil {
		highlights = append(highlights, lastStrikeLaunch.Narrative)
	}
	// 广播发起事件（取最后一条）
	var lastBroadcastStart *Change
	for i := range changes {
		c := &changes[i]
		if c.Type == ChangeTypeBroadcast && c.Actor != "" && c.Before == "" {
			lastBroadcastStart = c
		}
	}
	if lastBroadcastStart != nil {
		highlights = append(highlights, lastBroadcastStart.Narrative)
	}

	if len(highlights) > maxDeltaHighlights {
		highlights = highlights[:maxDeltaHighlights]
	}
	if len(highlights) == 0 {
		return nil
	}
	return highlights
}
