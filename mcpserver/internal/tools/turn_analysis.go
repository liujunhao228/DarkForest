package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ============================================================
// get_turn_analysis — 回合因果解释工具
// 分析指定回合每个动作的"预期效果 vs 实际效果"，标注无效动作（no-op）及其原因，
// 用于深入理解"有动作无效果"等异常现象。
// ============================================================

type GetTurnAnalysisInput struct {
	ReplayID string `json:"replayId" jsonschema:"本地回放 ID"`
	Turn     int    `json:"turn" jsonschema:"玩家回合数(1..TotalTurns)"`
}

// TurnActionAnalysis 是单个动作的因果分析。
type TurnActionAnalysis struct {
	Action         string `json:"action"`
	PlayerID       string `json:"playerId"`
	CardName       string `json:"cardName,omitempty"`
	CardDefID      string `json:"cardDefId,omitempty"`
	ExpectedEffect string `json:"expectedEffect,omitempty"`
	ActualEffect   string `json:"actualEffect,omitempty"`
	Explanation    string `json:"explanation,omitempty"`
	WasNoOp        bool   `json:"wasNoOp,omitempty"`
	NoOpReason     string `json:"noOpReason,omitempty"`
}

// LogEntry 是回放日志的轻量表示。
type LogEntry struct {
	Turn    int    `json:"turn,omitempty"`
	Phase   string `json:"phase,omitempty"`
	Message string `json:"message"`
}

type GetTurnAnalysisOutput struct {
	Found        bool                 `json:"found"`
	Turn         int                  `json:"turn"`
	Actions      []TurnActionAnalysis `json:"actions"`
	Logs         []LogEntry           `json:"logs,omitempty"`
	TotalInvalid int                  `json:"totalInvalid,omitempty"` // 轻量记录下从后端帧获得
}

// analysisState 是回合分析所需的统一帧状态（从全量帧或轻量帧归一化而来）。
type analysisState struct {
	Turn              int
	CurrentPlayerID   string
	PlayerEnergy      map[string]int
	PlayerHandCount   map[string]int
	PlayerFaceUpCount map[string]int
	StrikeCount       int
	StrikeUIDs        map[string]bool // UID → arrived
}

func stateFromFull(gs replayGameState) analysisState {
	s := analysisState{
		Turn:              gs.TotalTurn,
		CurrentPlayerID:   gs.CurrentPlayerID,
		PlayerEnergy:      map[string]int{},
		PlayerHandCount:   map[string]int{},
		PlayerFaceUpCount: map[string]int{},
		StrikeUIDs:        map[string]bool{},
		StrikeCount:       len(gs.FlyingStrikes),
	}
	for _, p := range gs.Players {
		s.PlayerEnergy[p.ID] = p.Energy
		s.PlayerHandCount[p.ID] = len(p.Hand)
		s.PlayerFaceUpCount[p.ID] = len(p.FaceUpCards)
	}
	for _, st := range gs.FlyingStrikes {
		s.StrikeUIDs[st.UID] = st.Arrived
	}
	return s
}

func stateFromLight(lf lightFrame) analysisState {
	s := analysisState{
		Turn:              lf.Turn,
		CurrentPlayerID:   lf.CurrentPlayerID,
		PlayerEnergy:      map[string]int{},
		PlayerHandCount:   map[string]int{},
		PlayerFaceUpCount: map[string]int{},
		StrikeUIDs:        map[string]bool{},
		StrikeCount:       len(lf.FlyingStrikes),
	}
	for _, p := range lf.Players {
		s.PlayerEnergy[p.ID] = p.Energy
		s.PlayerHandCount[p.ID] = p.HandCount
		s.PlayerFaceUpCount[p.ID] = len(p.FaceUpNames)
	}
	for _, st := range lf.FlyingStrikes {
		s.StrikeUIDs[st.UID] = st.Arrived
	}
	return s
}

// handleGetTurnAnalysis 实现 get_turn_analysis。
//
// 老记录（states 全量）本地解析前后帧；新记录（仅首/终帧）需连接后端经帧端点
// 拉取回合 T-1/T 的轻量帧。no-op 判定为启发式：对比回合前/后帧的关键指标
// （手牌数/场上卡/飞行打击数），供子 Agent 理解"有动作无效果"现象。
func handleGetTurnAnalysis(mgr *session.Manager, db *persistence.DB) func(context.Context, *mcp.CallToolRequest, GetTurnAnalysisInput) (*mcp.CallToolResult, GetTurnAnalysisOutput, error) {
	return func(_ context.Context, req *mcp.CallToolRequest, in GetTurnAnalysisInput) (*mcp.CallToolResult, GetTurnAnalysisOutput, error) {
		out := GetTurnAnalysisOutput{Found: false}

		row, err := db.Replay.GetReplay(in.ReplayID)
		if err != nil || row == nil {
			return nil, out, fmt.Errorf("未找到本地回放 %q，请先调用 fetch_shared_replay 拉取", in.ReplayID)
		}
		var actions []gamesdk.ActionRecord
		if err := json.Unmarshal([]byte(row.ActionsJSON), &actions); err != nil {
			return nil, out, fmt.Errorf("解析 actions 失败: %w", err)
		}
		idx := GetReplayIndex(row)
		if idx == nil {
			return nil, out, fmt.Errorf("构建回放索引失败")
		}
		if in.Turn < 1 || in.Turn > idx.MaxTurn {
			return nil, out, fmt.Errorf("回合 %d 超出范围 (1-%d)", in.Turn, idx.MaxTurn)
		}

		// 定位该回合动作区间
		turnFirstIdx, turnLastIdx := -1, -1
		for i, a := range actions {
			if a.Turn == in.Turn {
				if turnFirstIdx == -1 {
					turnFirstIdx = i
				}
				turnLastIdx = i
			}
		}
		if turnFirstIdx == -1 {
			return nil, out, fmt.Errorf("回合 %d 无动作记录", in.Turn)
		}

		// 获取回合前/后帧
		var prev, next analysisState
		var nextRaw json.RawMessage
		var hasPrev, hasNext bool
		if isLightweightRecord(row) {
			// 新记录（仅首/终帧）：需经后端帧端点逐回合拉取轻量帧。
			// stateless：用全局 HTTP client + 占位身份，不借对战账户（避免占用冲突）。
			httpc := sessionlessReplayClient(mgr)
			token := replayReaderToken()
			if prevRaw, err := fetchTurnFrame(httpc, token, row.ID, in.Turn-1, "light"); err == nil {
				var lf lightFrame
				if json.Unmarshal(prevRaw, &lf) == nil {
					prev, hasPrev = stateFromLight(lf), true
				}
			}
			if raw, err := fetchTurnFrame(httpc, token, row.ID, in.Turn, "light"); err == nil {
				nextRaw = raw
				var lf lightFrame
				if json.Unmarshal(nextRaw, &lf) == nil {
					next, hasNext = stateFromLight(lf), true
				}
			}
		} else {
			var states []json.RawMessage
			if err := json.Unmarshal([]byte(row.StatesJSON), &states); err != nil {
				return nil, out, fmt.Errorf("解析 states[] 失败: %w", err)
			}
			if turnFirstIdx < len(states) {
				var pgs replayGameState
				if json.Unmarshal(states[turnFirstIdx], &pgs) == nil {
					prev, hasPrev = stateFromFull(pgs), true
				}
			}
			if turnLastIdx+1 < len(states) {
				nextRaw = states[turnLastIdx+1]
				var ngs replayGameState
				if json.Unmarshal(nextRaw, &ngs) == nil {
					next, hasNext = stateFromFull(ngs), true
				}
			}
		}

		// 逐动作分析
		var analyses []TurnActionAnalysis
		for i := turnFirstIdx; i <= turnLastIdx; i++ {
			a := actions[i]
			an := analyzeAction(a, prev, next, hasPrev, hasNext)
			analyses = append(analyses, an)
		}

		out.Found = true
		out.Turn = in.Turn
		out.Actions = analyses
		if nextRaw != nil {
			out.Logs = extractTurnLogs(nextRaw, in.Turn)
		}
		if isLightweightRecord(row) && nextRaw != nil {
			var lf struct {
				InvalidActions int `json:"invalidActions"`
			}
			if json.Unmarshal(nextRaw, &lf) == nil {
				out.TotalInvalid = lf.InvalidActions
			}
		}
		return nil, out, nil
	}
}

// analyzeAction 对单个动作生成因果分析（预期效果 / 实际效果 / no-op 判定）。
func analyzeAction(a gamesdk.ActionRecord, prev, next analysisState, hasPrev, hasNext bool) TurnActionAnalysis {
	an := TurnActionAnalysis{
		Action:   a.Action,
		PlayerID: a.PlayerID,
	}
	if a.Data != nil {
		if cn, ok := a.Data["cardName"].(string); ok && cn != "" {
			an.CardName = cn
		}
		if cd, ok := a.Data["cardDefId"].(string); ok && cd != "" {
			an.CardDefID = cd
		}
		if an.CardName == "" {
			if uid, ok := a.Data["cardUid"].(string); ok && uid != "" {
				an.CardName = uid
			}
		}
	}

	// 若前后帧缺失，仅给预期效果
	if !hasPrev || !hasNext {
		an.ExpectedEffect = expectedEffectFor(a.Action)
		an.Explanation = "前后帧不可用，无法判定实际效果（老记录本地 states 缺失或轻量帧拉取失败）"
		return an
	}

	switch a.Action {
	case "strike":
		an.ExpectedEffect = "发射打击：消耗能量，向目标星系发射飞行打击"
		if next.StrikeCount > prev.StrikeCount {
			an.ActualEffect = "打击已发射，进入飞行队列"
			an.Explanation = "飞行打击数量增加，打击成功进入飞行队列"
		} else {
			an.WasNoOp = true
			an.NoOpReason = "回合末飞行打击数未增加：打击可能因无效卡UID/目标非法/能量不足被后端拒绝，或同回合内已抵达并结算"
			an.ActualEffect = "无效果（打击未进入飞行队列）"
		}
	case "playCard":
		an.ExpectedEffect = "打出手牌中的卡牌（移入弃牌堆或生效）"
		if prev.PlayerHandCount[a.PlayerID] > next.PlayerHandCount[a.PlayerID] {
			an.ActualEffect = fmt.Sprintf("手牌从 %d 减至 %d（打出 1 张）", prev.PlayerHandCount[a.PlayerID], next.PlayerHandCount[a.PlayerID])
		} else {
			an.WasNoOp = true
			an.NoOpReason = "手牌数未减少：卡牌可能不在手牌中（已被使用/在手牌前被误记录），或打出被后端拒绝"
			an.ActualEffect = "无效果（卡牌未从手牌移除）"
		}
	case "deployCard":
		an.ExpectedEffect = "部署卡牌到己方星系（进入场上区）"
		if next.PlayerFaceUpCount[a.PlayerID] > prev.PlayerFaceUpCount[a.PlayerID] {
			an.ActualEffect = fmt.Sprintf("场上卡从 %d 增至 %d（部署 1 张）", prev.PlayerFaceUpCount[a.PlayerID], next.PlayerFaceUpCount[a.PlayerID])
		} else {
			an.WasNoOp = true
			an.NoOpReason = "场上卡数量未增加：卡牌不在手牌/能量不足/星系容量已达上限"
			an.ActualEffect = "无效果（部署未生效）"
		}
	case "recycleCard":
		an.ExpectedEffect = "回收手牌中的卡牌（移出手牌并获得能量）"
		if prev.PlayerHandCount[a.PlayerID] > next.PlayerHandCount[a.PlayerID] {
			an.ActualEffect = fmt.Sprintf("手牌从 %d 减至 %d（回收 1 张），能量 %d→%d",
				prev.PlayerHandCount[a.PlayerID], next.PlayerHandCount[a.PlayerID],
				prev.PlayerEnergy[a.PlayerID], next.PlayerEnergy[a.PlayerID])
		} else {
			an.WasNoOp = true
			an.NoOpReason = "手牌数未减少：卡牌不在手牌中，回收被拒绝"
			an.ActualEffect = "无效果（回收未生效）"
		}
	case "moveStrike", "retargetStrike":
		an.ExpectedEffect = "移动/重新定向飞行打击到新目标星系"
		an.ActualEffect = "飞行打击数量未变化（位置/目标变化无法从轻量帧直接观测）"
		an.Explanation = "打击位置/目标在帧中不直接暴露；若目标非法则被后端拒绝（no-op）"
	case "endTurn":
		an.ExpectedEffect = "结束当前回合，推进到下一玩家"
		if next.Turn > prev.Turn {
			an.ActualEffect = fmt.Sprintf("回合从 %d 推进到 %d", prev.Turn, next.Turn)
		} else if next.CurrentPlayerID != prev.CurrentPlayerID {
			an.ActualEffect = fmt.Sprintf("回合数不变（%d），当前玩家从 %s 切换为 %s", next.Turn, prev.CurrentPlayerID, next.CurrentPlayerID)
		} else {
			an.WasNoOp = true
			an.NoOpReason = "回合未推进且当前玩家未切换：endTurn 被后端忽略或该回合已结束"
			an.ActualEffect = "无效果（回合状态未变化）"
		}
	case "timeout":
		an.ExpectedEffect = "超时回合（未及时操作，系统自动跳过）"
		an.ActualEffect = "回合按超时处理推进"
		an.Explanation = "超时不消耗有效动作；若连续超时可能触发淘汰"
	case "forfeit":
		an.ExpectedEffect = "认输：该玩家被淘汰，对局按规则结算"
		an.ActualEffect = "该玩家被标记淘汰（回合末帧可观测）"
	case "fallback":
		an.ExpectedEffect = "回退回合（系统纠正）"
		an.ActualEffect = "回合状态被系统修正"
	default:
		an.ExpectedEffect = expectedEffectFor(a.Action)
		an.ActualEffect = "执行常规动作（效果依赖具体逻辑）"
	}
	return an
}

// expectedEffectFor 返回动作类型对应的预期效果描述。
func expectedEffectFor(action string) string {
	switch action {
	case "playCard":
		return "打出手牌中的卡牌"
	case "deployCard":
		return "部署卡牌到己方星系"
	case "strike":
		return "发射打击到目标星系"
	case "broadcast":
		return "发起广播协议（公开广播）"
	case "respondBroadcast":
		return "响应广播（同意/拒绝）"
	case "selectBroadcastResponder":
		return "选择广播响应者"
	case "cancelBroadcast":
		return "取消进行中的广播"
	case "recycleCard":
		return "回收卡牌"
	case "moveStrike", "retargetStrike":
		return "移动/重新定向飞行打击"
	case "announceStrike":
		return "宣告打击阶段"
	case "endTurn":
		return "结束当前回合"
	case "timeout":
		return "超时跳过回合"
	case "forfeit":
		return "认输"
	case "fallback":
		return "回退回合"
	case "lightspeedShip":
		return "光速航行（移动母舰）"
	default:
		return "执行常规动作"
	}
}

// extractTurnLogs 从某帧原始 JSON 提取指定回合的日志（兼容全量 logs 与轻量 logEntries 字段）。
func extractTurnLogs(raw json.RawMessage, turn int) []LogEntry {
	var entries []LogEntry
	var full struct {
		Logs []struct {
			Turn    int    `json:"turn"`
			Phase   string `json:"phase"`
			Message string `json:"message"`
		} `json:"logs"`
	}
	if err := json.Unmarshal(raw, &full); err == nil {
		for _, l := range full.Logs {
			if l.Turn == turn {
				entries = append(entries, LogEntry{Turn: l.Turn, Phase: l.Phase, Message: l.Message})
			}
		}
		if len(entries) > 0 {
			return entries
		}
	}
	var light struct {
		LogEntries []struct {
			Turn    int    `json:"turn,omitempty"`
			Phase   string `json:"phase,omitempty"`
			Message string `json:"message"`
		} `json:"logEntries"`
	}
	if err := json.Unmarshal(raw, &light); err == nil {
		for _, l := range light.LogEntries {
			if l.Turn == turn || l.Turn == 0 {
				entries = append(entries, LogEntry{Turn: l.Turn, Phase: l.Phase, Message: l.Message})
			}
		}
	}
	return entries
}
