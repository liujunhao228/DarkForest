package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
	"darkforest/mcpserver/internal/semantic"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ============================================================
// get_replay_semantic_view — 回放全知视角语义投影工具
// ============================================================

// GetReplaySemanticViewInput:
//   - ReplayID: 本地回放 UUID
//   - Turn: 玩家回合数（0=初始，1..TotalTurns=各动作应用后的快照）。
//     注意：与 get_replay_deltas 的 turn 参数同语义（玩家回合数），
//     内部会映射到 states 数组下标。
type GetReplaySemanticViewInput struct {
	ReplayID string `json:"replayId"`
	Turn     int    `json:"turn"`
}

// GetReplaySemanticViewOutput:
//   - Found: false 时 Error 含原因
//   - OmniscientView: 全知视角视图（Turn/Players.Hand/DrawPile 全可见）
type GetReplaySemanticViewOutput struct {
	Found          bool                     `json:"found"`
	Error          string                   `json:"error,omitempty"`
	OmniscientView *semantic.OmniscientView `json:"omniscientView,omitempty"`
}

// handleGetReplaySemanticView 实现 get_replay_semantic_view。
//
// 回合数→states 下标映射：
//
//	turn=0 → states[0]（初始）
//	turn=T (T>=1) → 找 actions 中 turn=T 的最后一条 action，用 states[lastIdx+1]
//	  （与 computeDeltas 相同的 "turn 末帧 = 最后一个动作应用后" 语义）。
//	若 turn=T 无对应 action（空回合）→ 退回 states[上一个有动作的 turn 末帧]。
func handleGetReplaySemanticView(db *persistence.DB) func(context.Context, *mcp.CallToolRequest, GetReplaySemanticViewInput) (*mcp.CallToolResult, GetReplaySemanticViewOutput, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in GetReplaySemanticViewInput) (*mcp.CallToolResult, GetReplaySemanticViewOutput, error) {
		out := GetReplaySemanticViewOutput{Found: false}

		replayID := parseReplayID(in.ReplayID)
		if replayID == "" {
			out.Error = "回放 ID 为空或格式无效"
			return nil, out, nil
		}

		row, err := db.Replay.GetReplay(replayID)
		if err != nil {
			out.Error = "读取回放失败: " + err.Error()
			return nil, out, nil
		}
		if row == nil {
			out.Error = "未在本地找到该回放。请先调用 fetch_shared_replay 从官方服务拉取或检查 replayId 是否正确"
			return nil, out, nil
		}

		// 解析 states[]（只用 ProjectOmniscient 需要的是单帧 JSON，
		// 但这里必须把整个 states 数组解析后取对应下标，再单独序列化给 ProjectOmniscient）。
		var states []json.RawMessage
		if err := json.Unmarshal([]byte(row.StatesJSON), &states); err != nil {
			out.Error = "解析回放 states[] 失败: " + err.Error()
			return nil, out, nil
		}
		if len(states) == 0 {
			out.Error = "回放 states[] 为空"
			return nil, out, nil
		}

		idx, err := resolveStateIndexForTurn(row, in.Turn, len(states))
		if err != nil {
			out.Error = err.Error()
			return nil, out, nil
		}
		if idx < 0 || idx >= len(states) {
			out.Error = fmt.Sprintf("回合 %d 映射的 state 下标越界（idx=%d，states=%d）", in.Turn, idx, len(states))
			return nil, out, nil
		}

		mode := extractGameModeOrDefault(states[idx], "classic")
		ov, err := semantic.ProjectOmniscient(states[idx], mode)
		if err != nil {
			out.Error = "语义投影失败: " + err.Error()
			return nil, out, nil
		}

		out.Found = true
		out.OmniscientView = &ov
		return nil, out, nil
	}
}

// resolveStateIndexForTurn 将玩家回合数 turn 映射到 states 数组下标。
//   - turn=0 → 0
//   - turn>=1 → 找 turn 最后一条 action 的 index，返回 lastIdx+1；
//     turn 没有 action 时退回 turn-1 找到的下标，递归到 turn=0。
func resolveStateIndexForTurn(row *persistence.ReplayRow, turn, numStates int) (int, error) {
	if turn < 0 {
		return -1, fmt.Errorf("回合数不能为负数（turn=%d）", turn)
	}
	if turn == 0 {
		return 0, nil
	}
	if row.TotalTurns > 0 && turn > row.TotalTurns {
		return -1, fmt.Errorf("回合 %d 超出该回放 totalTurns=%d", turn, row.TotalTurns)
	}
	var actions []gamesdk.ActionRecord
	if err := json.Unmarshal([]byte(row.ActionsJSON), &actions); err != nil {
		return -1, fmt.Errorf("解析 actions 失败: %w", err)
	}
	// 和 computeDeltas 相同的 turn→下标映射
	turnLastIdx := map[int]int{}
	for i, a := range actions {
		turnLastIdx[a.Turn] = i
	}
	// 从 turn 开始向下找最近有 action 的回合
	for t := turn; t >= 1; t-- {
		if lastIdx, ok := turnLastIdx[t]; ok {
			return lastIdx + 1, nil
		}
	}
	// 所有 1..turn 都没 action → 退到初始帧
	return 0, nil
}

// extractGameModeOrDefault 从某帧 state JSON 提取 gameMode；取不到时回退 defaultMode。
func extractGameModeOrDefault(rawState json.RawMessage, defaultMode string) string {
	var s struct {
		GameMode string `json:"gameMode,omitempty"`
	}
	if err := json.Unmarshal(rawState, &s); err != nil {
		return defaultMode
	}
	if s.GameMode == "" {
		return defaultMode
	}
	return s.GameMode
}
