package tools

import (
	"context"
	"fmt"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/persistence"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- register_pool_account ---

type RegisterPoolAccountInput struct {
	InviteCode  string `json:"inviteCode,omitempty" jsonschema:"邀请码(留空则用 admin token 自动生成)"`
	DisplayName string `json:"displayName,omitempty" jsonschema:"显示名(留空自动生成 Bot_xxx)"`
	Password    string `json:"password,omitempty" jsonschema:"密码(留空自动生成)"`
	AdminToken  string `json:"adminToken,omitempty" jsonschema:"admin JWT(生成邀请码时必需,留空则使用配置中的 ADMIN_TOKEN)"`
}

type RegisterPoolAccountOutput struct {
	Registered bool   `json:"registered"`
	AccountID  string `json:"accountId,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	InviteCode string `json:"inviteCode,omitempty"`
	Message    string `json:"message,omitempty"`
}

func handleRegisterPoolAccount(pool *account.Pool, defaultAdminToken string) func(context.Context, *mcp.CallToolRequest, RegisterPoolAccountInput) (*mcp.CallToolResult, RegisterPoolAccountOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in RegisterPoolAccountInput) (*mcp.CallToolResult, RegisterPoolAccountOutput, error) {
		adminToken := in.AdminToken
		if adminToken == "" {
			adminToken = defaultAdminToken
		}
		acc, err := pool.Register(in.DisplayName, in.Password, in.InviteCode, adminToken)
		if err != nil {
			return nil, RegisterPoolAccountOutput{}, fmt.Errorf("注册账户失败: %w", err)
		}
		return nil, RegisterPoolAccountOutput{
			Registered:  true,
			AccountID:   acc.ID,
			DisplayName: acc.DisplayName,
		}, nil
	}
}

// --- list_pool_accounts ---

type ListPoolAccountsInput struct{}

type PoolAccountInfo struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Status      string `json:"status"`
	AssignedTo  string `json:"assignedTo,omitempty"`
}

type ListPoolAccountsOutput struct {
	Accounts       []PoolAccountInfo `json:"accounts"`
	Total          int               `json:"total"`
	AvailableCount int               `json:"availableCount"`
}

func handleListPoolAccounts(pool *account.Pool) func(context.Context, *mcp.CallToolRequest, ListPoolAccountsInput) (*mcp.CallToolResult, ListPoolAccountsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ ListPoolAccountsInput) (*mcp.CallToolResult, ListPoolAccountsOutput, error) {
		all := pool.ListAll()
		infos := make([]PoolAccountInfo, 0, len(all))
		available := 0
		for _, a := range all {
			infos = append(infos, PoolAccountInfo{
				ID:          a.ID,
				DisplayName: a.DisplayName,
				Role:        a.Role,
				Status:      a.Status,
				AssignedTo:  a.AssignedTo,
			})
			if a.Status == account.StatusAvailable {
				available++
			}
		}
		return nil, ListPoolAccountsOutput{
			Accounts:       infos,
			Total:          len(infos),
			AvailableCount: available,
		}, nil
	}
}

// --- get_tool_call_stats ---

type GetToolCallStatsInput struct {
	Since    int64  `json:"since,omitempty" jsonschema:"起始时间(unix 秒,留空为全部)"`
	ToolName string `json:"toolName,omitempty" jsonschema:"按工具名筛选(留空为全部)"`
}

type GetToolCallStatsOutput struct {
	Summaries []persistence.StatsSummary `json:"summaries"`
}

func handleGetToolCallStats(db *persistence.DB) func(context.Context, *mcp.CallToolRequest, GetToolCallStatsInput) (*mcp.CallToolResult, GetToolCallStatsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetToolCallStatsInput) (*mcp.CallToolResult, GetToolCallStatsOutput, error) {
		summaries, err := db.Stats.GetStatsSummary(in.Since, in.ToolName)
		if err != nil {
			return nil, GetToolCallStatsOutput{}, fmt.Errorf("查询统计失败: %w", err)
		}
		return nil, GetToolCallStatsOutput{Summaries: summaries}, nil
	}
}

// RegisterAdminTools 注册运维管理类工具(面向账户池主人)。
func RegisterAdminTools(server *mcp.Server, pool *account.Pool, adminToken string, db *persistence.DB) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "register_pool_account", Description: "注册新账户到账户池。需提供邀请码或 admin token(用于自动生成邀请码)。运维操作,非游戏流程。"},
		handleRegisterPoolAccount(pool, adminToken),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "list_pool_accounts", Description: "列出账户池中所有账户及其状态。运维操作。"},
		handleListPoolAccounts(pool),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_tool_call_stats", Description: "查询工具调用统计(按工具名聚合)。运维操作。"},
		handleGetToolCallStats(db),
	)
}
