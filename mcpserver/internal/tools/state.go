package tools

import (
	"context"
	"time"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/semantic"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// state.go 提供游戏状态(只读)类工具。
//
// Task 13 后保留的 tool:
//   - get_game_logs : 获取游戏日志
//   - wait_for_event: 阻塞等待游戏事件(返回值附带 StateDelta)
//
// 旧 get_game_state / get_game_summary / get_broadcast_state / get_pending_action
// 已被 Task 9 的 get_agent_view 替代并下线;buildSummary / buildBroadcastState
// 派生逻辑已迁移到 semantic 包的 ProjectObject / ProjectBroadcast。

// --- get_game_logs ---

type GetGameLogsInput struct {
	Limit int `json:"limit,omitempty" jsonschema:"返回最近 N 条日志(默认全部)"`
}

type GetGameLogsOutput struct {
	InGame bool               `json:"inGame"`
	Logs   []gamesdk.LogEntry `json:"logs,omitempty"`
}

func handleGetGameLogs(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetGameLogsInput) (*mcp.CallToolResult, GetGameLogsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetGameLogsInput) (*mcp.CallToolResult, GetGameLogsOutput, error) {
		gs, err := sessionFromReq(req, mgr)
		if err != nil {
			return nil, GetGameLogsOutput{}, err
		}
		state := gs.GetState()
		if state == nil {
			return nil, GetGameLogsOutput{InGame: false}, nil
		}
		logs := state.Logs
		if in.Limit > 0 && in.Limit < len(logs) {
			logs = logs[len(logs)-in.Limit:]
		}
		return nil, GetGameLogsOutput{InGame: true, Logs: logs}, nil
	}
}

// --- wait_for_event ---

type WaitForEventInput struct {
	TimeoutSeconds int `json:"timeoutSeconds,omitempty" jsonschema:"等待超时秒数(默认 30,最大 120)"`
}

type WaitForEventOutput struct {
	HasEvent bool                `json:"hasEvent"`
	Events   []gamesdk.GameEvent `json:"events,omitempty"`
	// Delta 是事件触发后(prev → current)的语义化 diff。
	// 仅当事件伴随 fullSync 更新 gameState 时计算;若 state 仍为 nil 或非 playing,Delta 留空。
	Delta *semantic.StateDelta `json:"delta,omitempty"`
}

func handleWaitForEvent(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, WaitForEventInput) (*mcp.CallToolResult, WaitForEventOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in WaitForEventInput) (*mcp.CallToolResult, WaitForEventOutput, error) {
		gs, err := sessionFromReq(req, mgr)
		if err != nil {
			return nil, WaitForEventOutput{}, err
		}
		timeout := 30 * time.Second
		if in.TimeoutSeconds > 0 {
			timeout = time.Duration(in.TimeoutSeconds) * time.Second
		}
		if timeout > 120*time.Second {
			timeout = 120 * time.Second
		}
		// 若 context 有更早的截止时间,取较小值
		if dl, ok := ctx.Deadline(); ok {
			if remaining := time.Until(dl); remaining > 0 && remaining < timeout {
				timeout = remaining
			}
		}
		events, err := gs.WaitForEvent(timeout)
		if err != nil {
			return nil, WaitForEventOutput{}, err
		}
		out := WaitForEventOutput{HasEvent: len(events) > 0, Events: events}
		// 事件通常伴随 fullSync,尝试计算 delta 附加到返回值。
		// 若 state 仍为 nil 或非 playing,Delta 留空。
		if state := gs.GetState(); state != nil && state.Phase == "playing" {
			viewerID := state.LocalPlayerID
			prev := gs.GetPrevState()
			delta := semantic.ComputeDelta(prev, state, viewerID)
			out.Delta = &delta
		}
		return nil, out, nil
	}
}

// RegisterStateTools 注册游戏状态(只读)类工具。
//
// Task 13 下线 4 个旧状态查询 tool 后,仅保留 get_game_logs 与 wait_for_event。
// 旧 tool 的替代品为 get_agent_view(在 agent_view.go 中注册)。
func RegisterStateTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_game_logs", Description: "获取游戏日志。可指定 limit 返回最近 N 条。"},
		handleGetGameLogs(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "wait_for_event",
			Description:  "阻塞等待新的游戏事件(状态变更、回合切换、对手动作、匹配成功等)。返回自上次调用以来的所有事件。默认超时 30 秒。用于替代轮询。",
			OutputSchema: outputSchemaFor[WaitForEventOutput](),
		},
		handleWaitForEvent(mgr),
	)
}
