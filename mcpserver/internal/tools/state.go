package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- get_game_state ---

type GetGameStateInput struct{}

type GetGameStateOutput struct {
	InGame    bool             `json:"inGame"`
	State     *gamesdk.ViewState `json:"state,omitempty"`
	Version   int              `json:"version,omitempty"`
}

func handleGetGameState(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetGameStateInput) (*mcp.CallToolResult, GetGameStateOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetGameStateInput) (*mcp.CallToolResult, GetGameStateOutput, error) {
		gs, err := sessionFromReq(req, mgr)
		if err != nil {
			return nil, GetGameStateOutput{}, err
		}
		state := gs.GetState()
		if state == nil {
			return nil, GetGameStateOutput{InGame: false}, nil
		}
		return nil, GetGameStateOutput{InGame: true, State: state, Version: state.Version}, nil
	}
}

// --- get_game_summary ---

type GetGameSummaryInput struct{}

type GetGameSummaryOutput struct {
	InGame  bool   `json:"inGame"`
	Summary string `json:"summary,omitempty"`
}

func handleGetGameSummary(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetGameSummaryInput) (*mcp.CallToolResult, GetGameSummaryOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetGameSummaryInput) (*mcp.CallToolResult, GetGameSummaryOutput, error) {
		gs, err := sessionFromReq(req, mgr)
		if err != nil {
			return nil, GetGameSummaryOutput{}, err
		}
		state := gs.GetState()
		if state == nil {
			return nil, GetGameSummaryOutput{InGame: false}, nil
		}
		return nil, GetGameSummaryOutput{InGame: true, Summary: buildSummary(state)}, nil
	}
}

// buildSummary 生成人类可读的游戏状态摘要,辅助 Agent 决策。
func buildSummary(s *gamesdk.ViewState) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("=== 游戏状态摘要 ===\n"))
	b.WriteString(fmt.Sprintf("阶段: %s | 回合: %d | 回合阶段: %s\n", s.Phase, s.TotalTurn, s.TurnPhase))
	b.WriteString(fmt.Sprintf("当前玩家: %s (索引 %d)\n", s.CurrentPlayerID, s.CurrentPlayerIndex))
	b.WriteString(fmt.Sprintf("本地玩家: %s\n\n", s.LocalPlayerID))

	for i, p := range s.Players {
		b.WriteString(fmt.Sprintf("--- 玩家 %d: %s (%s) ---\n", i, p.Name, p.Color))
		b.WriteString(fmt.Sprintf("  能量: %d | 已淘汰: %v\n", p.Energy, p.Eliminated))
		if p.Position >= 0 {
			b.WriteString(fmt.Sprintf("  位置: %d\n", p.Position))
		} else {
			b.WriteString("  位置: 未知(对手)\n")
		}
		if len(p.Hand) > 0 {
			b.WriteString(fmt.Sprintf("  手牌(%d 张):\n", len(p.Hand)))
			for _, c := range p.Hand {
				b.WriteString(fmt.Sprintf("    - %s [%s] 能量:%d uid:%s\n", c.Name, c.Type, c.Energy, c.UID))
			}
		} else if p.HandCount > 0 {
			b.WriteString(fmt.Sprintf("  手牌: %d 张(对手,不可见)\n", p.HandCount))
		}
		if len(p.FaceUpCards) > 0 {
			b.WriteString(fmt.Sprintf("  场上明牌(%d 张):\n", len(p.FaceUpCards)))
			for _, c := range p.FaceUpCards {
				b.WriteString(fmt.Sprintf("    - %s [%s] 能量:%d uid:%s\n", c.Name, c.Type, c.Energy, c.UID))
			}
		}
		b.WriteString("\n")
	}

	if len(s.FlyingStrikes) > 0 {
		b.WriteString(fmt.Sprintf("飞行打击(%d 个):\n", len(s.FlyingStrikes)))
		for _, fs := range s.FlyingStrikes {
			b.WriteString(fmt.Sprintf("  - %s uid:%s 等级:%d 速度:%d 剩余移动:%d 位置:%d → 目标星系:%d\n",
				fs.StrikeName, fs.UID, fs.Level, fs.Speed, fs.RemainingMoves, fs.Position, fs.TargetSystem))
		}
		b.WriteString("\n")
	}

	if len(s.DestroyedStars) > 0 {
		b.WriteString(fmt.Sprintf("已摧毁星系: %v\n\n", s.DestroyedStars))
	}

	if s.Winner != "" {
		b.WriteString(fmt.Sprintf(">>> 游戏结束! 胜利者: %s <<<\n", s.Winner))
	}

	if len(s.Logs) > 0 {
		b.WriteString("\n最近日志:\n")
		start := 0
		if len(s.Logs) > 5 {
			start = len(s.Logs) - 5
		}
		for _, log := range s.Logs[start:] {
			b.WriteString(fmt.Sprintf("  [回合%d/%s] %s\n", log.Turn, log.Type, log.Message))
		}
	}

	return b.String()
}

// --- get_pending_action ---

type GetPendingActionInput struct{}

type GetPendingActionOutput struct {
	HasPending    bool            `json:"hasPending"`
	PendingAction json.RawMessage `json:"pendingAction,omitempty"`
}

func handleGetPendingAction(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetPendingActionInput) (*mcp.CallToolResult, GetPendingActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetPendingActionInput) (*mcp.CallToolResult, GetPendingActionOutput, error) {
		gs, err := sessionFromReq(req, mgr)
		if err != nil {
			return nil, GetPendingActionOutput{}, err
		}
		state := gs.GetState()
		if state == nil {
			return nil, GetPendingActionOutput{HasPending: false}, nil
		}
		if len(state.PendingAction) == 0 || string(state.PendingAction) == "null" {
			return nil, GetPendingActionOutput{HasPending: false}, nil
		}
		return nil, GetPendingActionOutput{HasPending: true, PendingAction: state.PendingAction}, nil
	}
}

// --- get_game_logs ---

type GetGameLogsInput struct {
	Limit int `json:"limit,omitempty" jsonschema:"返回最近 N 条日志(默认全部)"`
}

type GetGameLogsOutput struct {
	InGame bool                  `json:"inGame"`
	Logs   []gamesdk.LogEntry    `json:"logs,omitempty"`
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
	HasEvent bool                    `json:"hasEvent"`
	Events   []gamesdk.GameEvent     `json:"events,omitempty"`
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
		return nil, WaitForEventOutput{HasEvent: len(events) > 0, Events: events}, nil
	}
}

// RegisterStateTools 注册游戏状态(只读)类工具。
func RegisterStateTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{
			Name:          "get_game_state",
			Description:   "获取当前完整游戏状态(脱敏后的 ViewState)。包含手牌、场上明牌、飞行打击、广播状态等。对手手牌和位置被隐藏。",
			OutputSchema:  outputSchemaFor[GetGameStateOutput](),
		},
		handleGetGameState(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_game_summary", Description: "获取人类可读的游戏状态摘要文本,便于快速理解局势。建议优先使用此工具而非直接解析 get_game_state 的 JSON。"},
		handleGetGameSummary(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:          "get_pending_action",
			Description:   "查询当前需要你执行的待处理动作(如打击移动、广播响应等)。若无待处理动作返回 hasPending=false。",
			OutputSchema:  outputSchemaFor[GetPendingActionOutput](),
		},
		handleGetPendingAction(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_game_logs", Description: "获取游戏日志。可指定 limit 返回最近 N 条。"},
		handleGetGameLogs(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:          "wait_for_event",
			Description:   "阻塞等待新的游戏事件(状态变更、回合切换、对手动作、匹配成功等)。返回自上次调用以来的所有事件。默认超时 30 秒。用于替代轮询。",
			OutputSchema:  outputSchemaFor[WaitForEventOutput](),
		},
		handleWaitForEvent(mgr),
	)
}
