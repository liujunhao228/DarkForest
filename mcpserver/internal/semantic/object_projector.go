package semantic

import (
	"encoding/json"
	"fmt"

	"darkforest/mcpserver/internal/gamesdk"
)

// maxEventTraceEntries 限制 EventTrace 保留的最近日志条数。
const maxEventTraceEntries = 20

// ProjectObject 把 gamesdk.ViewState 投影为 Agent 视角的对象快照。
//
// viewerID 通常等于 state.LocalPlayerID；显式传入以便未来支持观战视角
// （观战者不参与任何一方，IsMyTurn 恒为 false）。
//
// gameMode 用于后续 RelicView 分模式投影（如 "classic" / "civilization_relics"），
// 当前仅写入 AgentView.GameMode 顶层字段。
//
// 若 state 为 nil，返回零值 AgentView。
func ProjectObject(state *gamesdk.ViewState, viewerID string, gameMode string) ObjectView {
	if state == nil {
		return ObjectView{}
	}

	// 先定位自己，后续计算 foe 的 DistanceFromMe 需要自己的位置。
	var selfPlayer *gamesdk.ViewPlayer
	for i := range state.Players {
		if state.Players[i].ID == viewerID {
			selfPlayer = &state.Players[i]
			break
		}
	}

	view := ObjectView{
		Field:    projectField(state),
		Events:   EventTrace{Entries: projectEventTrace(state.Logs)},
		Cursor:   projectActionCursor(state, viewerID),
		GameMode: gameMode,
	}

	if selfPlayer != nil {
		view.Self = projectSelf(selfPlayer)
	}

	for i := range state.Players {
		p := &state.Players[i]
		if p.ID == viewerID {
			continue
		}
		view.Foes = append(view.Foes, projectFoe(p, selfPlayer))
	}

	return view
}

// projectSelf 投影玩家自己的全量信息。
func projectSelf(p *gamesdk.ViewPlayer) SelfSnapshot {
	return SelfSnapshot{
		ID:               p.ID,
		Name:             p.Name,
		Color:            p.Color,
		Energy:           p.Energy,
		Position:         p.Position,
		PositionIsPublic: inferPositionIsPublic(p),
		Hand:             p.Hand,
		FaceUpCards:      projectFaceUpCards(p.FaceUpCards),
		BroadcastHistory: p.BroadcastHistory,
		Eliminated:       p.Eliminated,
	}
}

// inferPositionIsPublic 推断自己的位置是否已对其他玩家公开。
//
// 启发式：若已有广播历史，则位置至少被揭示过一次（广播会暴露广播者所在星系）。
// 更精确的判定需要后端暴露"位置已被揭示"的显式标志，当前为近似。
func inferPositionIsPublic(p *gamesdk.ViewPlayer) bool {
	return len(p.BroadcastHistory) > 0
}

// projectFoe 投影单个对手的可见信息。
// selfPlayer 用于计算 DistanceFromMe，可为 nil（此时距离与可达性为零值）。
func projectFoe(p *gamesdk.ViewPlayer, self *gamesdk.ViewPlayer) FoeSnapshot {
	return FoeSnapshot{
		ID:          p.ID,
		Name:        p.Name,
		Color:       p.Color,
		Eliminated:  p.Eliminated,
		Position:    projectFoePosition(p, self),
		HandCount:   p.HandCount,
		FaceUpCards: projectFaceUpCards(p.FaceUpCards),
	}
}

// projectFoePosition 把对手的 Position 数值语义化为 FoePosition。
//   - Position <= 0: 未揭示 → PositionUnknown{Hint:"未广播/未飞船揭示"}
//   - Position > 0:  已揭示 → PositionKnown{System, DistanceFromMe, ReachableInOneJump}
//
// DistanceFromMe 使用真实星图 BFS 最短距离（semantic.GetDistance），
// ReachableInOneJump 使用邻接表判定（semantic.AreAdjacent）。
// 自身位置未揭示（self.Position <= 0）时这两个派生字段保持零值。
func projectFoePosition(foe *gamesdk.ViewPlayer, self *gamesdk.ViewPlayer) FoePosition {
	if foe.Position <= 0 {
		return PositionUnknown{
			Known: false,
			Hint:  "未广播/未飞船揭示",
		}
	}
	known := PositionKnown{
		Known:  true,
		System: foe.Position,
	}
	if self != nil && self.Position > 0 {
		known.DistanceFromMe = GetDistance(self.Position, foe.Position)
		known.ReachableInOneJump = AreAdjacent(self.Position, foe.Position)
	}
	return known
}

// projectFaceUpCards 把 FaceUpCards 强类型化为 SimpleCard 列表。
func projectFaceUpCards(cards []gamesdk.Card) []SimpleCard {
	if len(cards) == 0 {
		return nil
	}
	out := make([]SimpleCard, 0, len(cards))
	for i := range cards {
		out = append(out, simplifyCard(cards[i]))
	}
	return out
}

// simplifyCard 按卡牌类型把 gamesdk.Card 简化为 SimpleCard。
func simplifyCard(c gamesdk.Card) SimpleCard {
	role, output := classifyCard(c)
	return SimpleCard{
		DefID:  c.DefID,
		Name:   c.Name,
		Role:   role,
		Output: output,
	}
}

// classifyCard 按任务约定把卡牌类型映射到 (role, output)。
//   - defense:                          role=defense, output="防御Lv.{protectionLevel}"
//   - facility, EnergyPerTurn > 0:      role=energy,  output="+{N}能量/回合"
//   - facility, Ability=detect_broadcast: role=utility, output="监听基地"
//   - facility, Ability=escape:           role=utility, output="光速飞船"
//   - facility, Ability=其他:             role=utility, output=Ability 值
//   - facility, 无 Ability:               role=utility, output="未知"
//   - 其他类型（不应出现在 FaceUpCards）:  role=utility, output=""
func classifyCard(c gamesdk.Card) (CardRole, string) {
	switch c.Type {
	case "defense":
		return CardRoleDefense, fmt.Sprintf("防御Lv.%d", c.ProtectionLevel)
	case "facility":
		if c.EnergyPerTurn > 0 {
			return CardRoleEnergy, fmt.Sprintf("+%d能量/回合", c.EnergyPerTurn)
		}
		if c.Ability != "" {
			switch c.Ability {
			case "detect_broadcast":
				return CardRoleUtility, "监听基地"
			case "escape":
				return CardRoleUtility, "光速飞船"
			default:
				return CardRoleUtility, c.Ability
			}
		}
		return CardRoleUtility, "未知"
	default:
		return CardRoleUtility, ""
	}
}

// projectField 投影公共场景。
//
// 当前仅 DestroyedStars 由 ViewState 直接提供；
// VisibleLeftovers 暂为空（后端 ViewState 尚未暴露 Leftovers，见 types.go TODO）。
func projectField(state *gamesdk.ViewState) FieldSnapshot {
	return FieldSnapshot{
		DestroyedStars: state.DestroyedStars,
	}
}

// projectEventTrace 取最近 maxEventTraceEntries 条日志并结构化。
// 透传 gamesdk.LogEntry 的可选字段 SystemID/CardDefID/PlayerIDs（不适用时为 nil）。
func projectEventTrace(logs []gamesdk.LogEntry) []EventTraceEntry {
	if len(logs) == 0 {
		return nil
	}
	start := 0
	if len(logs) > maxEventTraceEntries {
		start = len(logs) - maxEventTraceEntries
	}
	recent := logs[start:]
	out := make([]EventTraceEntry, 0, len(recent))
	for i := range recent {
		l := &recent[i]
		out = append(out, EventTraceEntry{
			Turn:      l.Turn,
			Phase:     l.Phase,
			Type:      l.Type,
			Message:   l.Message,
			SystemID:  l.SystemID,
			CardDefID: l.CardDefID,
			PlayerIDs: l.PlayerIDs,
		})
	}
	return out
}

// projectActionCursor 投影当前回合阶段状态。
// PendingAction 为 gamesdk.ViewState 中的 json.RawMessage，这里反序列化为摘要。
// 若 TurnPhase == "interrupted"，从 PendingAction.Type 推断 InterruptReason。
func projectActionCursor(state *gamesdk.ViewState, viewerID string) ActionCursor {
	cursor := ActionCursor{
		TurnPhase: state.TurnPhase,
		IsMyTurn:  state.CurrentPlayerID == viewerID,
		TotalTurn: state.TotalTurn,
	}

	if len(state.PendingAction) > 0 && string(state.PendingAction) != "null" {
		var pa PendingActionSummary
		if err := json.Unmarshal(state.PendingAction, &pa); err == nil && pa.Type != "" {
			cursor.PendingAction = &pa
		}
	}

	if state.TurnPhase == "interrupted" && cursor.PendingAction != nil {
		// InterruptReason 从 PendingAction.Type 推断；无 pending action 时留空。
		cursor.InterruptReason = cursor.PendingAction.Type
	}

	return cursor
}
