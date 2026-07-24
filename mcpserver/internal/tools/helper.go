// Package tools 实现 MCP Server 暴露给 Agent 的所有工具。
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/session"

	"github.com/google/jsonschema-go/jsonschema"
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

// rawJSONTypeSchema 是 json.RawMessage 的 JSON Schema:不限制类型,允许任意 JSON 值。
// jsonschema-go 默认将 json.RawMessage (底层类型 []byte) 推断为 integer 数组,
// 与实际序列化输出(任意 JSON)不符,导致客户端 schema 解析/校验失败。
//
// 关键:必须是"对象型" schema,不能是布尔 schema。
// 空的 &jsonschema.Schema{} 会被 jsonschema-go 序列化为布尔值 `true`
// (见 jsonschema-go schema.go:Marshal {} as true),而部分 MCP 客户端
// (基于 TypeScript SDK 的 Zod 校验)不接受布尔 schema,会在
// tools[i].outputSchema.properties.<field> 处报 "Invalid input"。
// 这里用覆盖全部 JSON 类型的 type 数组表达"任意值":既语义正确,
// 又是被客户端接受的对象型 schema。
var rawJSONTypeSchema = &jsonschema.Schema{
	Types: []string{"object", "array", "string", "number", "integer", "boolean", "null"},
}

// outputSchemaFor 为输出类型 Out 生成 JSON Schema,将 json.RawMessage 映射为
// 任意 JSON 值(无类型约束)。需在 mcp.AddTool 之前设置到 Tool.OutputSchema,
// 否则 SDK 会用默认推断生成错误的 schema。
func outputSchemaFor[Out any]() *jsonschema.Schema {
	s, err := jsonschema.For[Out](&jsonschema.ForOptions{
		TypeSchemas: map[reflect.Type]*jsonschema.Schema{
			reflect.TypeFor[json.RawMessage](): rawJSONTypeSchema,
		},
	})
	if err != nil {
		panic(fmt.Sprintf("生成输出 schema 失败: %v", err))
	}
	return s
}
