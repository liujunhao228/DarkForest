package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
	"darkforest/mcpserver/internal/semantic"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ============================================================
// get_replay_semantic_view — 回放全知视角语义投影工具
// ============================================================

// GetReplaySemanticViewInput:
//   - ReplayID: 本地回放 UUID
//   - Turn: 玩家回合数（0=初始，1..TotalTurns=各动作应用后的快照）。
//     越界（> TotalTurns）时 clamp 到末帧并在输出置 Clamped=true，不再报错。
//     注意：与 get_replay_deltas 的 turn 参数同语义（玩家回合数）。
type GetReplaySemanticViewInput struct {
	ReplayID string `json:"replayId"`
	Turn     int    `json:"turn"`
}

// GetReplaySemanticViewOutput:
//   - Found: false 时 Error 含原因
//   - OmniscientView: 全知视角视图（Turn/Players.Hand/DrawPile 全可见）
//   - Clamped: 请求回合越界时 clamp 到末帧
//   - InvalidActions: 截至目标回合重放遇到的无效动作数（新记录从后端轻量帧获得）
type GetReplaySemanticViewOutput struct {
	Found          bool                     `json:"found"`
	Error          string                   `json:"error,omitempty"`
	OmniscientView *semantic.OmniscientView `json:"omniscientView,omitempty"`
	Clamped        bool                     `json:"clamped,omitempty"`
	InvalidActions int                      `json:"invalidActions,omitempty"`
}

// handleGetReplaySemanticView 实现 get_replay_semantic_view。
//
// 回合数→帧 映射：
//   - 老记录（states 全量多帧）：本地解析 states[]，经 GetReplayIndex 定位下标。
//   - 新记录（仅 actions + 首/终帧）：经后端帧端点 view=full 拉取全量 GameState
//     再投影（轻量帧缺全字段，无法本地投影；需 live 后端连接）。
//
// 越界 clamp：turn > TotalTurns 时取末帧，并置 Clamped=true（不再返回错误）。
func handleGetReplaySemanticView(mgr *session.Manager, db *persistence.DB) func(context.Context, *mcp.CallToolRequest, GetReplaySemanticViewInput) (*mcp.CallToolResult, GetReplaySemanticViewOutput, error) {
	return func(_ context.Context, req *mcp.CallToolRequest, in GetReplaySemanticViewInput) (*mcp.CallToolResult, GetReplaySemanticViewOutput, error) {
		out := GetReplaySemanticViewOutput{Found: false}

		replayID := parseReplayID(in.ReplayID)
		if replayID == "" {
			out.Error = "回放 ID 为空或格式无效"
			return nil, out, nil
		}
		if in.Turn < 0 {
			out.Error = fmt.Sprintf("回合数不能为负数（turn=%d）", in.Turn)
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

		// 越界 clamp：turn > TotalTurns → 取末帧
		clamped := in.Turn > row.TotalTurns
		effectiveTurn := in.Turn
		if clamped {
			effectiveTurn = row.TotalTurns
		}

		var raw json.RawMessage
		if isLightweightRecord(row) {
			// 新记录：仅存首/终帧，需从后端帧端点拉全量帧再投影。
			gs, err := mustConnect(req, mgr)
			if err != nil {
				out.Error = "轻量回放需要连接后端拉取全量帧: " + err.Error()
				return nil, out, nil
			}
			raw, err = fetchTurnFrame(gs, row.ID, effectiveTurn, "full")
			if err != nil {
				out.Error = "从后端拉取全量帧失败: " + err.Error()
				return nil, out, nil
			}
			// 轻量帧带 invalidActions（截至目标回合重放的无效动作数），尽力获取。
			if lightRaw, lerr := fetchTurnFrame(gs, row.ID, effectiveTurn, "light"); lerr == nil {
				var lf struct {
					InvalidActions int `json:"invalidActions"`
				}
				if json.Unmarshal(lightRaw, &lf) == nil {
					out.InvalidActions = lf.InvalidActions
				}
			}
		} else {
			// 老记录：本地解析 states[]，按索引定位。
			var states []json.RawMessage
			if err := json.Unmarshal([]byte(row.StatesJSON), &states); err != nil {
				out.Error = "解析回放 states[] 失败: " + err.Error()
				return nil, out, nil
			}
			if len(states) == 0 {
				out.Error = "回放 states[] 为空"
				return nil, out, nil
			}
			idx := GetReplayIndex(row).resolveStateIndexForTurn(effectiveTurn)
			if idx < 0 || idx >= len(states) {
				idx = len(states) - 1 // 越界保护：clamp 到末帧
			}
			raw = states[idx]
		}

		mode := extractGameModeOrDefault(raw, "classic")
		ov, err := semantic.ProjectOmniscient(raw, mode)
		if err != nil {
			out.Error = "语义投影失败: " + err.Error()
			return nil, out, nil
		}
		ov.Clamped = clamped
		ov.InvalidActions = out.InvalidActions

		out.Found = true
		out.Clamped = clamped
		out.OmniscientView = &ov
		return nil, out, nil
	}
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

// fetchTurnFrame 从后端帧端点拉取指定 turn 末帧（view: light/full）。
// 帧端点数字 frame 语义为"重放到该回合末帧"，与 MCP 的 turn 语义一致。
func fetchTurnFrame(gs *gamesdk.GameSession, replayID string, turn int, view string) (json.RawMessage, error) {
	return gs.HTTP.GetReplayFrame(gs.AuthValue(), replayID, strconv.Itoa(turn), view)
}

// isLightweightRecord 判断是否为轻量记录（仅存 actions + 首/终帧，states 长度 ≤2）。
// 老记录存全量 states[0..N]，长度 = 动作数+1 > 2。
func isLightweightRecord(row *persistence.ReplayRow) bool {
	var states []json.RawMessage
	if err := json.Unmarshal([]byte(row.StatesJSON), &states); err != nil {
		return false // 解析失败，按老记录处理
	}
	return len(states) <= 2
}
