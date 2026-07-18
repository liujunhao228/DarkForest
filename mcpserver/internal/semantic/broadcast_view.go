package semantic

import (
	"strings"

	"darkforest/mcpserver/internal/gamesdk"
)

// maxBroadcastHistoryEntries 限制 PastBroadcast 保留的最近条数。
const maxBroadcastHistoryEntries = 10

// maxResidualMarkerAge 是残影标记的最大保留年龄（含）。
// 对齐前端 OnlineStarMap.tsx:489-492 的 `currentTurn - m.endTurn < 3` 过滤逻辑，
// 即保留 age ∈ {0,1,2} 共 3 个回合的标记。
const maxResidualMarkerAge = 2

// BroadcastView 是广播体系的决策视角投影。
//
// 把 gamesdk.ViewState 中松散的广播字段（Broadcast/Logs/Players[].BroadcastHistory）
// 收拢为 Agent 决策友好的强类型结构，屏蔽底层判断分支。
type BroadcastView struct {
	Phase           BroadcastPhase   `json:"phase"`                     // inactive/waiting/select/reveal/resolve/done
	MyRole          BroadcastMyRole  `json:"myRole"`                    // none/broadcaster/responder/mustResponder
	ActionRequired  *BroadcastAction `json:"actionRequired,omitempty"`  // 玩家需回应时给出
	History         []PastBroadcast  `json:"history,omitempty"`         // 近 N 次已结束广播
	ResidualMarkers []ResidualMarker `json:"residualMarkers,omitempty"` // 3 回合内已结束广播的残影
}

// BroadcastPhase 广播会话阶段（含 inactive 表示无广播）。
// 对齐前端 types.ts:115 的完整状态机：waiting/select/reveal/resolve/done，
// 其中 inactive 是 semantic 层"无广播"哨兵，resolve/done 是前端内部结算状态
// （gamesdk 协议当前仅暴露 waiting/select/reveal）。
type BroadcastPhase string

const (
	BroadcastPhaseInactive BroadcastPhase = "inactive"
	BroadcastPhaseWaiting  BroadcastPhase = "waiting"
	BroadcastPhaseSelect   BroadcastPhase = "select"
	BroadcastPhaseReveal   BroadcastPhase = "reveal"
	BroadcastPhaseResolve  BroadcastPhase = "resolve"
	BroadcastPhaseDone     BroadcastPhase = "done"
)

// BroadcastMyRole 玩家在当前广播中的角色。
type BroadcastMyRole string

const (
	BroadcastRoleNone          BroadcastMyRole = "none"
	BroadcastRoleBroadcaster   BroadcastMyRole = "broadcaster"
	BroadcastRoleResponder     BroadcastMyRole = "responder"
	BroadcastRoleMustResponder BroadcastMyRole = "mustResponder"
)

// BroadcastAction 玩家需执行的动作。
type BroadcastAction struct {
	Type         string   `json:"type"`         // agreeOrRefuse / selectResponder / cancel
	LegalOptions []string `json:"legalOptions"` // 如 ["agree","refuse"] 或 responder playerIds
}

// PastBroadcast 已结束的广播历史条目。
type PastBroadcast struct {
	Turn          int    `json:"turn"`
	BroadcasterID string `json:"broadcasterId"`
	TargetSystem  int    `json:"targetSystem"`
	Outcome       string `json:"outcome"` // success/failed/cancelled/unknown
}

// ResidualMarker 已结束广播的残影标记（3 回合淡出）。
type ResidualMarker struct {
	SystemID int `json:"systemId"`
	Turn     int `json:"turn"`     // 广播发起回合
	AgeTurns int `json:"ageTurns"` // 距今回合数
}

// ProjectBroadcast 把 ViewState 中的 Broadcast 投影为决策视角的 BroadcastView。
//
// viewerID 是当前观察者玩家 ID。
// currentTurn 从 state.TotalTurn 取（用于残影回合数计算）。
//
// 若 state 为 nil，返回零值 BroadcastView（Phase=inactive）。
func ProjectBroadcast(state *gamesdk.ViewState, viewerID string) BroadcastView {
	view := BroadcastView{
		Phase:  BroadcastPhaseInactive,
		MyRole: BroadcastRoleNone,
	}
	if state == nil {
		return view
	}

	if state.Broadcast != nil {
		view.Phase = BroadcastPhase(state.Broadcast.Phase)
		view.MyRole = classifyBroadcastRole(state.Broadcast, viewerID)
		view.ActionRequired = projectBroadcastAction(state.Broadcast, viewerID, view.MyRole)
	}

	view.History = projectBroadcastHistory(state.Logs)
	view.ResidualMarkers = projectResidualMarkers(state.Players, state.TotalTurn)

	return view
}

// classifyBroadcastRole 判定观察者在当前广播中的角色。
//
//   - BroadcasterID == viewerID → broadcaster
//   - responses 中找到 PlayerID == viewerID：
//     MustRespond==true → mustResponder；否则 → responder
//   - 否则 → none
func classifyBroadcastRole(b *gamesdk.BroadcastStateView, viewerID string) BroadcastMyRole {
	if b.BroadcasterID == viewerID {
		return BroadcastRoleBroadcaster
	}
	for i := range b.Responses {
		r := &b.Responses[i]
		if r.PlayerID == viewerID {
			if r.MustRespond {
				return BroadcastRoleMustResponder
			}
			return BroadcastRoleResponder
		}
	}
	return BroadcastRoleNone
}

// projectBroadcastAction 派生玩家需要执行的动作。
//
//   - responder/mustResponder + waiting + 未回应 → agreeOrRefuse [agree, refuse]
//   - broadcaster + select → selectResponder [所有 Responded&&Agreed 的 PlayerID]
//   - broadcaster + waiting → cancel [cancel]（广播者可主动取消）
//   - 其他 → nil
func projectBroadcastAction(b *gamesdk.BroadcastStateView, viewerID string, role BroadcastMyRole) *BroadcastAction {
	switch role {
	case BroadcastRoleResponder, BroadcastRoleMustResponder:
		if BroadcastPhase(b.Phase) != BroadcastPhaseWaiting {
			return nil
		}
		for i := range b.Responses {
			r := &b.Responses[i]
			if r.PlayerID == viewerID && !r.Responded {
				return &BroadcastAction{
					Type:         "agreeOrRefuse",
					LegalOptions: []string{"agree", "refuse"},
				}
			}
		}
		return nil

	case BroadcastRoleBroadcaster:
		switch BroadcastPhase(b.Phase) {
		case BroadcastPhaseSelect:
			opts := make([]string, 0)
			for _, r := range b.Responses {
				if r.Responded && r.Agreed {
					opts = append(opts, r.PlayerID)
				}
			}
			if len(opts) == 0 {
				return nil
			}
			return &BroadcastAction{
				Type:         "selectResponder",
				LegalOptions: opts,
			}
		case BroadcastPhaseWaiting:
			return &BroadcastAction{
				Type:         "cancel",
				LegalOptions: []string{"cancel"},
			}
		}
	}

	return nil
}

// projectBroadcastHistory 从 logs 推断广播历史。
//
// 扫描 Type=="broadcast" 的日志条目，提取：
//   - turn（从 LogEntry.Turn）
//   - broadcasterId（从 LogEntry.PlayerIDs[0]，缺失时为空串）
//   - targetSystem（从 LogEntry.SystemID，缺失时为 0）
//   - outcome（从 Message 启发式判断）
//
// outcome 启发式：
//   - 含 "成功"/"合作"/"伪装" → success
//   - 含 "取消" → cancelled
//   - 含 "失败" → failed
//   - 否则 → unknown
//
// 保留最近 maxBroadcastHistoryEntries 条。
func projectBroadcastHistory(logs []gamesdk.LogEntry) []PastBroadcast {
	if len(logs) == 0 {
		return nil
	}
	out := make([]PastBroadcast, 0, len(logs))
	for i := range logs {
		l := &logs[i]
		if l.Type != "broadcast" {
			continue
		}
		pb := PastBroadcast{
			Turn:    l.Turn,
			Outcome: classifyBroadcastOutcome(l.Message),
		}
		if len(l.PlayerIDs) > 0 {
			pb.BroadcasterID = l.PlayerIDs[0]
		}
		if l.SystemID != nil {
			pb.TargetSystem = *l.SystemID
		}
		out = append(out, pb)
	}
	if len(out) > maxBroadcastHistoryEntries {
		out = out[len(out)-maxBroadcastHistoryEntries:]
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// classifyBroadcastOutcome 从 Message 文本启发式判断广播结果。
func classifyBroadcastOutcome(msg string) string {
	if strings.Contains(msg, "成功") || strings.Contains(msg, "合作") || strings.Contains(msg, "伪装") {
		return "success"
	}
	if strings.Contains(msg, "取消") {
		return "cancelled"
	}
	if strings.Contains(msg, "失败") {
		return "failed"
	}
	return "unknown"
}

// projectResidualMarkers 从所有玩家的 BroadcastHistory 提取 3 回合内的残影标记。
//
// 遍历每个玩家的 BroadcastHistory，对每个 entry：
//   - age = currentTurn - entry.Turn（负值按 0 处理）
//   - 若 age <= maxResidualMarkerAge（2）则生成 ResidualMarker（保留 age ∈ {0,1,2}）
func projectResidualMarkers(players []gamesdk.ViewPlayer, currentTurn int) []ResidualMarker {
	if len(players) == 0 {
		return nil
	}
	out := make([]ResidualMarker, 0)
	for i := range players {
		p := &players[i]
		for _, h := range p.BroadcastHistory {
			age := currentTurn - h.Turn
			if age < 0 {
				age = 0
			}
			if age <= maxResidualMarkerAge {
				out = append(out, ResidualMarker{
					SystemID: h.SystemID,
					Turn:     h.Turn,
					AgeTurns: age,
				})
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
