package tools

import (
	"context"
	"fmt"
	"time"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- join_match_queue ---

type JoinMatchQueueInput struct {
	PreferredCount int `json:"preferredCount" jsonschema:"期望匹配人数(3-5)"`
}

type JoinMatchQueueOutput struct {
	Joined bool   `json:"joined"`
	Message string `json:"message,omitempty"`
}

func handleJoinMatchQueue(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, JoinMatchQueueInput) (*mcp.CallToolResult, JoinMatchQueueOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in JoinMatchQueueInput) (*mcp.CallToolResult, JoinMatchQueueOutput, error) {
		if in.PreferredCount < 3 || in.PreferredCount > 5 {
			return nil, JoinMatchQueueOutput{}, fmt.Errorf("preferredCount 必须在 3-5 之间")
		}
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, JoinMatchQueueOutput{}, err
		}
		if err := gs.SendRaw(gamesdk.EventMatchJoinQueue, map[string]any{
			"preferredCount": in.PreferredCount,
		}); err != nil {
			return nil, JoinMatchQueueOutput{}, err
		}
		return nil, JoinMatchQueueOutput{Joined: true, Message: "已加入快速匹配队列,等待 match:found 事件"}, nil
	}
}

// --- cancel_match_queue ---

type CancelMatchQueueInput struct{}

type CancelMatchQueueOutput struct {
	Cancelled bool `json:"cancelled"`
}

func handleCancelMatchQueue(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, CancelMatchQueueInput) (*mcp.CallToolResult, CancelMatchQueueOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ CancelMatchQueueInput) (*mcp.CallToolResult, CancelMatchQueueOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, CancelMatchQueueOutput{}, err
		}
		if err := gs.SendRaw(gamesdk.EventMatchCancelQueue, nil); err != nil {
			return nil, CancelMatchQueueOutput{}, err
		}
		return nil, CancelMatchQueueOutput{Cancelled: true}, nil
	}
}

// --- get_match_status ---

type GetMatchStatusInput struct{}

type GetMatchStatusOutput struct {
	HasResult bool            `json:"hasResult"`
	Events    []gamesdk.GameEvent `json:"events,omitempty"`
}

func handleGetMatchStatus(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetMatchStatusInput) (*mcp.CallToolResult, GetMatchStatusOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetMatchStatusInput) (*mcp.CallToolResult, GetMatchStatusOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetMatchStatusOutput{}, err
		}
		if err := gs.SendRaw(gamesdk.EventMatchGetStatus, nil); err != nil {
			return nil, GetMatchStatusOutput{}, err
		}
		events, _ := gs.WaitForEvent(3 * time.Second)
		return nil, GetMatchStatusOutput{HasResult: len(events) > 0, Events: events}, nil
	}
}

// --- create_custom_queue ---

type CreateCustomQueueInput struct {
	QueueName  string `json:"queueName" jsonschema:"队列名称"`
	MinPlayers int    `json:"minPlayers" jsonschema:"最少人数(3-5)"`
	MaxPlayers int    `json:"maxPlayers" jsonschema:"最多人数(3-5)"`
}

type CreateCustomQueueOutput struct {
	Created bool   `json:"created"`
	Message string `json:"message,omitempty"`
}

func handleCreateCustomQueue(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, CreateCustomQueueInput) (*mcp.CallToolResult, CreateCustomQueueOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in CreateCustomQueueInput) (*mcp.CallToolResult, CreateCustomQueueOutput, error) {
		if in.MinPlayers < 3 || in.MinPlayers > 5 || in.MaxPlayers < 3 || in.MaxPlayers > 5 {
			return nil, CreateCustomQueueOutput{}, fmt.Errorf("minPlayers 和 maxPlayers 必须在 3-5 之间")
		}
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, CreateCustomQueueOutput{}, err
		}
		if err := gs.SendRaw(gamesdk.EventMatchCreateQueue, map[string]any{
			"queueName":  in.QueueName,
			"minPlayers": in.MinPlayers,
			"maxPlayers": in.MaxPlayers,
		}); err != nil {
			return nil, CreateCustomQueueOutput{}, err
		}
		return nil, CreateCustomQueueOutput{Created: true, Message: "自定义队列已创建,等待 match:queueCreated 事件"}, nil
	}
}

// --- join_custom_queue ---

type JoinCustomQueueInput struct {
	QueueID     string `json:"queueId" jsonschema:"队列 ID"`
	PlayerCount int    `json:"playerCount" jsonschema:"玩家数(通常 4)"`
}

type JoinCustomQueueOutput struct {
	Joined  bool   `json:"joined"`
	Message string `json:"message,omitempty"`
}

func handleJoinCustomQueue(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, JoinCustomQueueInput) (*mcp.CallToolResult, JoinCustomQueueOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in JoinCustomQueueInput) (*mcp.CallToolResult, JoinCustomQueueOutput, error) {
		if in.QueueID == "" {
			return nil, JoinCustomQueueOutput{}, fmt.Errorf("queueId 不能为空")
		}
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, JoinCustomQueueOutput{}, err
		}
		pc := in.PlayerCount
		if pc == 0 {
			pc = 4
		}
		if err := gs.SendRaw(gamesdk.EventMatchJoinSpecific, map[string]any{
			"queueId":     in.QueueID,
			"playerCount": pc,
		}); err != nil {
			return nil, JoinCustomQueueOutput{}, err
		}
		return nil, JoinCustomQueueOutput{Joined: true, Message: "已加入自定义队列,等待 match:specificQueueJoined 事件"}, nil
	}
}

// --- leave_custom_queue ---

type LeaveCustomQueueInput struct {
	QueueID string `json:"queueId" jsonschema:"队列 ID"`
}

type LeaveCustomQueueOutput struct {
	Left bool `json:"left"`
}

func handleLeaveCustomQueue(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, LeaveCustomQueueInput) (*mcp.CallToolResult, LeaveCustomQueueOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in LeaveCustomQueueInput) (*mcp.CallToolResult, LeaveCustomQueueOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, LeaveCustomQueueOutput{}, err
		}
		if err := gs.SendRaw(gamesdk.EventMatchLeaveSpecific, map[string]any{
			"queueId": in.QueueID,
		}); err != nil {
			return nil, LeaveCustomQueueOutput{}, err
		}
		return nil, LeaveCustomQueueOutput{Left: true}, nil
	}
}

// --- get_queue_info ---

type GetQueueInfoInput struct {
	QueueID string `json:"queueId" jsonschema:"队列 ID"`
}

type GetQueueInfoOutput struct {
	HasResult bool                   `json:"hasResult"`
	Events    []gamesdk.GameEvent    `json:"events,omitempty"`
}

func handleGetQueueInfo(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetQueueInfoInput) (*mcp.CallToolResult, GetQueueInfoOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetQueueInfoInput) (*mcp.CallToolResult, GetQueueInfoOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetQueueInfoOutput{}, err
		}
		if err := gs.SendRaw(gamesdk.EventMatchGetQueueInfo, map[string]any{
			"queueId": in.QueueID,
		}); err != nil {
			return nil, GetQueueInfoOutput{}, err
		}
		events, _ := gs.WaitForEvent(3 * time.Second)
		return nil, GetQueueInfoOutput{HasResult: len(events) > 0, Events: events}, nil
	}
}

// --- get_my_queues ---

type GetMyQueuesInput struct{}

type GetMyQueuesOutput struct {
	HasResult bool                `json:"hasResult"`
	Events    []gamesdk.GameEvent `json:"events,omitempty"`
}

func handleGetMyQueues(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetMyQueuesInput) (*mcp.CallToolResult, GetMyQueuesOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetMyQueuesInput) (*mcp.CallToolResult, GetMyQueuesOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetMyQueuesOutput{}, err
		}
		if err := gs.SendRaw(gamesdk.EventMatchGetMyQueues, nil); err != nil {
			return nil, GetMyQueuesOutput{}, err
		}
		events, _ := gs.WaitForEvent(3 * time.Second)
		return nil, GetMyQueuesOutput{HasResult: len(events) > 0, Events: events}, nil
	}
}

// RegisterMatchTools 注册匹配类工具。
func RegisterMatchTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "join_match_queue", Description: "加入快速匹配队列。后端每 5 秒尝试匹配,人数达到 preferredCount 即开房。匹配成功后会收到 match:found 事件,可通过 wait_for_event 或 get_match_status 查看。"},
		handleJoinMatchQueue(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "cancel_match_queue", Description: "取消快速匹配队列。"},
		handleCancelMatchQueue(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "get_match_status",
			Description:  "查询当前匹配队列状态,返回最近的队列相关事件。",
			OutputSchema: outputSchemaFor[GetMatchStatusOutput](),
		},
		handleGetMatchStatus(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "create_custom_queue", Description: "创建自定义房间队列。创建者自动加入并准备。满员时后端自动创建房间。"},
		handleCreateCustomQueue(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "join_custom_queue", Description: "通过 queueId 加入自定义队列。满员时自动开始游戏。"},
		handleJoinCustomQueue(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "leave_custom_queue", Description: "离开自定义队列。"},
		handleLeaveCustomQueue(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "get_queue_info",
			Description:  "查询指定队列信息(玩家列表、状态等)。",
			OutputSchema: outputSchemaFor[GetQueueInfoOutput](),
		},
		handleGetQueueInfo(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "get_my_queues",
			Description:  "查询我加入的队列列表(用于断线恢复)。",
			OutputSchema: outputSchemaFor[GetMyQueuesOutput](),
		},
		handleGetMyQueues(mgr),
	)
}
