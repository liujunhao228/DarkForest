package tools

import (
	"context"
	"fmt"

	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- ensure_connected ---

type EnsureConnectedInput struct{}

type EnsureConnectedOutput struct {
	Connected  bool   `json:"connected" jsonschema:"是否已连接游戏后端"`
	AccountID  string `json:"accountId" jsonschema:"账户 ID"`
	DisplayName string `json:"displayName" jsonschema:"账户显示名"`
	PlayerID   string `json:"playerId" jsonschema:"游戏玩家 ID"`
}

func handleEnsureConnected(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, EnsureConnectedInput) (*mcp.CallToolResult, EnsureConnectedOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ EnsureConnectedInput) (*mcp.CallToolResult, EnsureConnectedOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, EnsureConnectedOutput{}, err
		}
		return nil, EnsureConnectedOutput{
			Connected:   true,
			AccountID:   gs.Account.ID,
			DisplayName: gs.Account.DisplayName,
			PlayerID:    gs.Account.PlayerID,
		}, nil
	}
}

// --- disconnect ---

type DisconnectInput struct{}

type DisconnectOutput struct {
	Success bool `json:"success" jsonschema:"是否已断开"`
}

func handleDisconnect(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, DisconnectInput) (*mcp.CallToolResult, DisconnectOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ DisconnectInput) (*mcp.CallToolResult, DisconnectOutput, error) {
		sid := req.GetSession().ID()
		mgr.Close(sid)
		return nil, DisconnectOutput{Success: true}, nil
	}
}

// --- get_my_profile ---

type GetMyProfileInput struct{}

type GetMyProfileOutput struct {
	ID           string `json:"id"`
	DisplayName  string `json:"displayName"`
	Role         string `json:"role"`
	Wins         int    `json:"wins"`
	Losses       int    `json:"losses"`
	Draws        int    `json:"draws"`
	TotalMatches int    `json:"totalMatches"`
}

func handleGetMyProfile(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetMyProfileInput) (*mcp.CallToolResult, GetMyProfileOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetMyProfileInput) (*mcp.CallToolResult, GetMyProfileOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetMyProfileOutput{}, err
		}
		player, err := gs.HTTP.GetMe(gs.Account.Token)
		if err != nil {
			return nil, GetMyProfileOutput{}, fmt.Errorf("获取玩家信息失败: %w", err)
		}
		return nil, GetMyProfileOutput{
			ID:           player.ID,
			DisplayName:  player.DisplayName,
			Role:         player.Role,
			Wins:         player.Wins,
			Losses:       player.Losses,
			Draws:        player.Draws,
			TotalMatches: player.TotalMatches,
		}, nil
	}
}

// --- get_connection_status ---

type GetConnectionStatusInput struct{}

type GetConnectionStatusOutput struct {
	WSState        string `json:"wsState" jsonschema:"WS 连接状态: connected|reconnecting|disconnected"`
	LastPongAt     int64  `json:"lastPongAt" jsonschema:"上次收到 pong 的 Unix 毫秒时间戳;0 表示从未收到"`
	ReconnectCount int    `json:"reconnectCount" jsonschema:"累计重连次数"`
	RoomID         string `json:"roomId" jsonschema:"当前房间 ID(空表示不在房间)"`
	LastMatchID    string `json:"lastMatchId" jsonschema:"最近一场对局的 matchId(用于拉取回放)"`
}

func handleGetConnectionStatus(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetConnectionStatusInput) (*mcp.CallToolResult, GetConnectionStatusOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetConnectionStatusInput) (*mcp.CallToolResult, GetConnectionStatusOutput, error) {
		gs, err := sessionFromReq(req, mgr)
		if err != nil {
			return nil, GetConnectionStatusOutput{}, err
		}
		// 不强制 ensure_connected;返回当前状态(可能未连接)
		var lastPong int64
		if t := gs.LastPongAt(); !t.IsZero() {
			lastPong = t.UnixMilli()
		}
		roomID, _, _ := gs.GetRoomInfo()
		return nil, GetConnectionStatusOutput{
			WSState:        gs.ConnState().String(),
			LastPongAt:     lastPong,
			ReconnectCount: gs.ReconnectCount(),
			RoomID:         roomID,
			LastMatchID:    gs.GetLastMatchID(),
		}, nil
	}
}

// RegisterConnectTools 注册连接管理类工具。
func RegisterConnectTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "ensure_connected", Description: "建立(或确认已建立)到游戏后端的连接。首次调用时从账户池借用账户并连接 WebSocket。其他工具会自动调用此功能,但显式调用可提前确认连接状态。"},
		handleEnsureConnected(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "disconnect", Description: "主动断开游戏连接并归还账户到池中。通常在 Agent 结束游戏会话时调用。"},
		handleDisconnect(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_my_profile", Description: "查询当前账户的玩家信息与战绩。"},
		handleGetMyProfile(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_connection_status", Description: "查询当前会话到游戏后端的 WebSocket 连接状态、上次心跳响应时间、重连次数等。不强制建立连接,返回当前真实状态。"},
		handleGetConnectionStatus(mgr),
	)
}
