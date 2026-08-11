package tools

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/persistence"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// sidAgentRegex 匹配合法的 agent sid(与 backend 信任契约一致)。
var sidAgentRegex = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// --- register_pool_account ---

type RegisterPoolAccountInput struct {
	InviteCode  string `json:"inviteCode,omitempty" jsonschema:"邀请码(留空则用 admin token 自动生成)"`
	DisplayName string `json:"displayName,omitempty" jsonschema:"显示名(留空自动生成 Bot_xxx)"`
	Password    string `json:"password,omitempty" jsonschema:"密码(留空自动生成)"`
	AdminToken  string `json:"adminToken,omitempty" jsonschema:"admin JWT(生成邀请码时必需,留空则使用配置中的 ADMIN_TOKEN)"`
}

type RegisterPoolAccountOutput struct {
	Registered  bool   `json:"registered"`
	AccountID   string `json:"accountId,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	InviteCode  string `json:"inviteCode,omitempty"`
	Message     string `json:"message,omitempty"`
}

func handleRegisterPoolAccount(pool *account.Pool, defaultAdminToken string) func(context.Context, *mcp.CallToolRequest, RegisterPoolAccountInput) (*mcp.CallToolResult, RegisterPoolAccountOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in RegisterPoolAccountInput) (*mcp.CallToolResult, RegisterPoolAccountOutput, error) {
		if pool.IsTrustMode() {
			return nil, RegisterPoolAccountOutput{}, fmt.Errorf("注册账户失败: 信任模式下 web 账号通道已废弃")
		}
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

// --- add_pool_account ---

type AddPoolAccountInput struct {
	DisplayName string `json:"displayName" jsonschema:"已注册账号的登录名"`
	Password    string `json:"password" jsonschema:"账号密码"`
}

type AddPoolAccountOutput struct {
	Added       bool   `json:"added"`
	AccountID   string `json:"accountId,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Message     string `json:"message,omitempty"`
}

func handleAddPoolAccount(pool *account.Pool) func(context.Context, *mcp.CallToolRequest, AddPoolAccountInput) (*mcp.CallToolResult, AddPoolAccountOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in AddPoolAccountInput) (*mcp.CallToolResult, AddPoolAccountOutput, error) {
		if pool.IsTrustMode() {
			return nil, AddPoolAccountOutput{}, fmt.Errorf("加入账户池失败: 信任模式下 web 账号通道已废弃")
		}
		acc, err := pool.AddExisting(in.DisplayName, in.Password)
		if err != nil {
			return nil, AddPoolAccountOutput{}, fmt.Errorf("加入账号池失败: %w", err)
		}
		return nil, AddPoolAccountOutput{
			Added:       true,
			AccountID:   acc.ID,
			DisplayName: acc.DisplayName,
			Message:     "账号已校验并加入池",
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

// --- add_pool_agent ---

type AddPoolAgentInput struct {
	SID  string `json:"sid" jsonschema:"agent sid(^[A-Za-z0-9_-]{1,64}$,不含 agent: 前缀)"`
	Name string `json:"name,omitempty" jsonschema:"显示昵称(留空回退 AI-<sid>)"`
}

type AddPoolAgentOutput struct {
	Added   bool   `json:"added"`
	AgentID string `json:"agentId,omitempty"`
	Message string `json:"message,omitempty"`
}

func handleAddPoolAgent(pool *account.Pool) func(context.Context, *mcp.CallToolRequest, AddPoolAgentInput) (*mcp.CallToolResult, AddPoolAgentOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in AddPoolAgentInput) (*mcp.CallToolResult, AddPoolAgentOutput, error) {
		if !sidAgentRegex.MatchString(in.SID) {
			return nil, AddPoolAgentOutput{}, fmt.Errorf("非法 sid %q:需匹配 ^[A-Za-z0-9_-]{1,64}$", in.SID)
		}
		acc, err := pool.AddAgent(in.SID, in.Name)
		if err != nil {
			return nil, AddPoolAgentOutput{}, fmt.Errorf("加入 agent 名单失败: %w", err)
		}
		return nil, AddPoolAgentOutput{
			Added:   true,
			AgentID: acc.ID,
			Message: "agent 已加入名单",
		}, nil
	}
}

// --- list_pool_agents ---

type ListPoolAgentsInput struct{}

type PoolAgentInfo struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Status      string `json:"status"`
	AssignedTo  string `json:"assignedTo,omitempty"`
}

type ListPoolAgentsOutput struct {
	Agents []PoolAgentInfo `json:"agents"`
	Total  int             `json:"total"`
}

func handleListPoolAgents(pool *account.Pool) func(context.Context, *mcp.CallToolRequest, ListPoolAgentsInput) (*mcp.CallToolResult, ListPoolAgentsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ ListPoolAgentsInput) (*mcp.CallToolResult, ListPoolAgentsOutput, error) {
		all := pool.ListAll()
		infos := make([]PoolAgentInfo, 0, len(all))
		for _, a := range all {
			infos = append(infos, PoolAgentInfo{
				ID:          a.ID,
				DisplayName: a.DisplayName,
				Role:        a.Role,
				Status:      a.Status,
				AssignedTo:  a.AssignedTo,
			})
		}
		return nil, ListPoolAgentsOutput{
			Agents: infos,
			Total:  len(infos),
		}, nil
	}
}

// --- force_release_accounts ---

type ForceReleaseAccountsInput struct {
	// SessionID 指定释放某个 MCP 会话借用的账户;留空释放全部 in_use 账户。
	SessionID string `json:"sessionId,omitempty" jsonschema:"MCP 会话 ID(留空则释放全部借用中的账户)"`
}

type ForceReleaseAccountsOutput struct {
	Released int    `json:"released"`
	Message  string `json:"message,omitempty"`
}

func handleForceReleaseAccounts(pool *account.Pool) func(context.Context, *mcp.CallToolRequest, ForceReleaseAccountsInput) (*mcp.CallToolResult, ForceReleaseAccountsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in ForceReleaseAccountsInput) (*mcp.CallToolResult, ForceReleaseAccountsOutput, error) {
		if in.SessionID != "" {
			if err := pool.ForceRelease(in.SessionID); err != nil {
				if errors.Is(err, account.ErrAccountNotFound) {
					return nil, ForceReleaseAccountsOutput{}, fmt.Errorf("释放失败: 会话 %s 未借用账户", in.SessionID)
				}
				return nil, ForceReleaseAccountsOutput{}, fmt.Errorf("释放失败: %w", err)
			}
			return nil, ForceReleaseAccountsOutput{
				Released: 1,
				Message:  "已释放会话 " + in.SessionID + " 借用的账户",
			}, nil
		}
		n := pool.ForceReleaseAll()
		return nil, ForceReleaseAccountsOutput{
			Released: n,
			Message:  "已释放全部借用中的账户",
		}, nil
	}
}

// RegisterAdminTools 注册运维管理类工具(面向账户池主人)。
func RegisterAdminTools(server *mcp.Server, pool *account.Pool, adminToken string, db *persistence.DB) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "add_pool_agent", Description: "将一个 agent sid 加入信任模式的 agent 名单(幂等)。需提供 sid(可选昵称)。运维操作。"},
		handleAddPoolAgent(pool),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "list_pool_agents", Description: "列出 agent 名单中的所有 agent 及其状态。运维操作。"},
		handleListPoolAgents(pool),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "register_pool_account", Description: "注册新账户到账户池。需提供邀请码或 admin token(用于自动生成邀请码)。运维操作,非游戏流程;信任模式下已废弃。"},
		handleRegisterPoolAccount(pool, adminToken),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "add_pool_account", Description: "将已注册账号加入账户池(通过登录校验凭据可用后落库)。需提供登录名与密码。运维操作;信任模式下已废弃。"},
		handleAddPoolAccount(pool),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "list_pool_accounts", Description: "列出账户池中所有账户及其状态(信任模式下即 agent 名单)。运维操作。"},
		handleListPoolAccounts(pool),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_tool_call_stats", Description: "查询工具调用统计(按工具名聚合)。运维操作。"},
		handleGetToolCallStats(db),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "force_release_accounts", Description: "强制释放借用中的账户回池(异常对局导致账户不可用时,无需重启 MCP Server)。可指定会话 ID 或全部释放。运维操作。"},
		handleForceReleaseAccounts(pool),
	)
}
