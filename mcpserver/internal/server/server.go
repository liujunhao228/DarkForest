// Package server 装配 MCP Server,注册所有工具并配置 Streamable HTTP 传输。
package server

import (
	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/config"
	"darkforest/mcpserver/internal/persistence"
	"darkforest/mcpserver/internal/session"
	"darkforest/mcpserver/internal/tools"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// New 创建并配置 MCP Server,注册全部工具。
func New(
	cfg *config.Config,
	pool *account.Pool,
	mgr *session.Manager,
	db *persistence.DB,
) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "darkforest-mcp",
		Version: "v0.1.0",
	}, nil)

	// 注册所有工具组
	tools.RegisterConnectTools(server, mgr)
	tools.RegisterMatchTools(server, mgr)
	tools.RegisterRoomTools(server, mgr)
	tools.RegisterStateTools(server, mgr)
	tools.RegisterActionTools(server, mgr)
	tools.RegisterReplayTools(server, mgr, db)
	tools.RegisterStatsTools(server, mgr)
	tools.RegisterAdminTools(server, pool, cfg.AdminToken, db)
	tools.RegisterAgentViewTools(server, mgr)
	tools.RegisterResolveStrikeActionTool(server, mgr)
	tools.RegisterCardDetailTools(server, mgr)

	// Resource 与 Prompt:静态知识(数据型 + 叙述型)
	RegisterResources(server)
	RegisterPrompts(server)

	return server
}
