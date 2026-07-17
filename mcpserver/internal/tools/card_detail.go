package tools

import (
	"context"

	"darkforest/mcpserver/internal/semantic"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// card_detail.go 提供详情层工具:让 Agent 按需查询卡牌完整定义与卡牌目录。
//
// 2 个新 tool:
//   - get_card_detail    : 按 defId 查询单张卡牌完整定义(含 description/extended)
//   - get_card_glossary  : 按类型批量返回卡牌轻量信息(SimpleCard)
//
// 设计意图:get_agent_view 返回的 SimpleCard 仅含 {defId, name, role, output},
// Agent 若需详细机制文本(如打击卡 effect、防御卡 protectionLevel、设施卡 energyPerTurn),
// 调用 get_card_detail 按需获取。get_card_glossary 用于浏览卡牌目录、了解卡池构成。
//
// 这两个 tool 是静态查询,不依赖 GameSession 状态;保留 mgr 参数以对齐注册模式。

// --- get_card_detail ---

// GetCardDetailInput 指定要查询的卡牌定义 ID。
type GetCardDetailInput struct {
	DefID string `json:"defId" jsonschema:"卡牌定义 ID(如 strike_thermal / facility_solar_array)"`
}

// GetCardDetailOutput 返回单张卡牌的完整定义。
// 未找到时 Found=false,Card 为 nil。
type GetCardDetailOutput struct {
	Found bool                   `json:"found"`
	Card  *semantic.CardDefEntry `json:"card,omitempty"`
}

// handleGetCardDetail 返回 get_card_detail 的 handler 闭包。
// 静态查询,不依赖 GameSession 状态;mgr 参数保留以对齐注册模式。
func handleGetCardDetail(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetCardDetailInput) (*mcp.CallToolResult, GetCardDetailOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetCardDetailInput) (*mcp.CallToolResult, GetCardDetailOutput, error) {
		_ = mgr // 静态查询, 不依赖会话状态; 保留参数以对齐注册模式
		entry, ok := semantic.GetCardDef(in.DefID)
		if !ok {
			return nil, GetCardDetailOutput{Found: false}, nil
		}
		return nil, GetCardDetailOutput{Found: true, Card: &entry}, nil
	}
}

// --- get_card_glossary ---

// GetCardGlossaryInput 可选按类型过滤卡牌目录。
// type 取值: broadcast / strike / defense / facility;留空返回全部 19 张。
type GetCardGlossaryInput struct {
	Type string `json:"type,omitempty" jsonschema:"可选, 按类型过滤: broadcast / strike / defense / facility; 留空返回全部"`
}

// GetCardGlossaryOutput 返回卡牌轻量信息列表(SimpleCard)。
// Cards 为 SimpleCard 列表,Total 为列表长度。
type GetCardGlossaryOutput struct {
	Cards []semantic.SimpleCard `json:"cards"`
	Total int                   `json:"total"`
}

// handleGetCardGlossary 返回 get_card_glossary 的 handler 闭包。
// 静态查询,不依赖 GameSession 状态;mgr 参数保留以对齐注册模式。
func handleGetCardGlossary(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetCardGlossaryInput) (*mcp.CallToolResult, GetCardGlossaryOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetCardGlossaryInput) (*mcp.CallToolResult, GetCardGlossaryOutput, error) {
		_ = mgr // 静态查询, 不依赖会话状态; 保留参数以对齐注册模式
		defs := semantic.ListCardDefsByType(in.Type)
		cards := make([]semantic.SimpleCard, 0, len(defs))
		for i := range defs {
			cards = append(cards, semantic.ToSimpleCard(defs[i]))
		}
		return nil, GetCardGlossaryOutput{Cards: cards, Total: len(cards)}, nil
	}
}

// RegisterCardDetailTools 注册详情层(卡牌定义查询)工具。
//
// 这一组 tool 把 semantic 包的静态卡牌库暴露给 Agent:
//   - get_card_detail    : 单张卡牌完整定义(含 description / extended)
//   - get_card_glossary  : 按类型批量返回卡牌轻量信息(SimpleCard)
//
// 静态查询 tool,不依赖 GameSession 状态;保留 mgr 参数以对齐注册模式,
// 便于未来扩展(如缓存、会话级统计)。
func RegisterCardDetailTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "get_card_detail",
			Description: "按 defId 查询卡牌完整定义,包含 description / extended 字段。" +
				"当 get_agent_view 返回的 SimpleCard 信息不足以决策时(如查看打击卡 effect、防御卡 protectionLevel、设施卡 energyPerTurn 等机制细节),调用本工具获取详情。",
			OutputSchema: outputSchemaFor[GetCardDetailOutput](),
		},
		handleGetCardDetail(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "get_card_glossary",
			Description: "按类型批量返回卡牌轻量信息(SimpleCard: defId / name / role / output)。" +
				"可选 type 参数过滤: broadcast / strike / defense / facility;留空返回全部 19 张。" +
				"用于在游戏开始时浏览卡牌目录、了解卡池构成。",
			OutputSchema: outputSchemaFor[GetCardGlossaryOutput](),
		},
		handleGetCardGlossary(mgr),
	)
}
