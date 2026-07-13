package tools

import (
	"context"
	"fmt"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- get_my_stats ---

type GetMyStatsInput struct{}

type GetMyStatsOutput struct {
	Stats *gamesdk.PlayerStats `json:"stats"`
}

func handleGetMyStats(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetMyStatsInput) (*mcp.CallToolResult, GetMyStatsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetMyStatsInput) (*mcp.CallToolResult, GetMyStatsOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetMyStatsOutput{}, err
		}
		stats, err := gs.HTTP.GetPlayerStats(gs.Account.Token, gs.Account.PlayerID)
		if err != nil {
			return nil, GetMyStatsOutput{}, fmt.Errorf("获取战绩失败: %w", err)
		}
		return nil, GetMyStatsOutput{Stats: stats}, nil
	}
}

// --- get_leaderboard ---

type GetLeaderboardInput struct{}

type GetLeaderboardOutput struct {
	Leaderboard []gamesdk.LeaderboardEntry `json:"leaderboard"`
}

func handleGetLeaderboard(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetLeaderboardInput) (*mcp.CallToolResult, GetLeaderboardOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetLeaderboardInput) (*mcp.CallToolResult, GetLeaderboardOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetLeaderboardOutput{}, err
		}
		lb, err := gs.HTTP.GetLeaderboard(gs.Account.Token)
		if err != nil {
			return nil, GetLeaderboardOutput{}, fmt.Errorf("获取排行榜失败: %w", err)
		}
		return nil, GetLeaderboardOutput{Leaderboard: lb}, nil
	}
}

// --- get_player_stats ---

type GetPlayerStatsInput struct {
	PlayerID string `json:"playerId" jsonschema:"目标玩家 ID"`
}

type GetPlayerStatsOutput struct {
	Stats *gamesdk.PlayerStats `json:"stats"`
}

func handleGetPlayerStats(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetPlayerStatsInput) (*mcp.CallToolResult, GetPlayerStatsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetPlayerStatsInput) (*mcp.CallToolResult, GetPlayerStatsOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetPlayerStatsOutput{}, err
		}
		stats, err := gs.HTTP.GetPlayerStats(gs.Account.Token, in.PlayerID)
		if err != nil {
			return nil, GetPlayerStatsOutput{}, fmt.Errorf("获取玩家战绩失败: %w", err)
		}
		return nil, GetPlayerStatsOutput{Stats: stats}, nil
	}
}

// RegisterStatsTools 注册统计类工具。
func RegisterStatsTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_my_stats", Description: "查询当前账户的战绩统计(胜/负/平/胜率)。"},
		handleGetMyStats(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_leaderboard", Description: "获取排行榜(前 100 名)。"},
		handleGetLeaderboard(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_player_stats", Description: "查询指定玩家的战绩统计。"},
		handleGetPlayerStats(mgr),
	)
}
