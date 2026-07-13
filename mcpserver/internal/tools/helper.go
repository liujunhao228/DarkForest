// Package tools 实现 MCP Server 暴露给 Agent 的所有工具。
package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// sessionFromReq 从 MCP 请求中提取 session ID 并获取/创建对应的 GameSession。
func sessionFromReq(req *mcp.CallToolRequest, mgr *session.Manager) (*gamesdk.GameSession, error) {
	sid := req.GetSession().ID()
	gs, err := mgr.GetOrCreate(sid)
	if err != nil {
		return nil, fmt.Errorf("获取游戏会话失败: %w", err)
	}
	return gs, nil
}

// mustConnect 确保会话已连接游戏后端,返回 GameSession。
func mustConnect(req *mcp.CallToolRequest, mgr *session.Manager) (*gamesdk.GameSession, error) {
	gs, err := sessionFromReq(req, mgr)
	if err != nil {
		return nil, err
	}
	if err := gs.EnsureConnected(); err != nil {
		return nil, err
	}
	return gs, nil
}

// jsonMarshal 将任意值序列化为 json.RawMessage,失败时返回 nil。
func jsonMarshal(v any) json.RawMessage {
	if v == nil {
		return nil
	}
	data, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return data
}

// ctxCancelled 检查 context 是否已取消。
func ctxCancelled(ctx context.Context) bool {
	select {
	case <-ctx.Done():
		return true
	default:
		return false
	}
}
