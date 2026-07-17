package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"

	"darkforest/mcpserver/internal/session"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// resolve_strike_action.go 合并 6 个旧 strike 动作 tool 为单一分派 tool。
//
// 6 种 option 对应原 6 个 tool:
//   - move           → 原 move_strike           (后端 action: moveStrike)
//   - retarget       → 原 retarget_strike        (后端 action: retargetStrike)
//   - select         → 原 select_strike          (后端 action: selectStrike)
//   - skip_select    → 原 skip_strike_select     (后端 action: skipStrikeSelect)
//   - announce       → 原 announce_strike        (后端 action: announceStrike)
//   - skip_announce  → 原 skip_announce_strike   (后端 action: skipAnnounceStrike)
//
// 单一入口降低 Agent 工具面认知负担;分派逻辑复用现有 doAction,不直接调用旧 handler。

// 6 种合法 option 常量,集中管理避免字面量拼写不一致。
const (
	strikeOptionMove         = "move"
	strikeOptionRetarget     = "retarget"
	strikeOptionSelect       = "select"
	strikeOptionSkipSelect   = "skip_select"
	strikeOptionAnnounce     = "announce"
	strikeOptionSkipAnnounce = "skip_announce"
)

// ResolveStrikeActionInput 是 resolve_strike_action tool 的入参。
//
// 字段设计为 6 个旧 strike tool Input 字段的并集 {StrikeUID, TargetSystem}。
// 不同 option 对字段的取用规则:
//   - move / retarget : StrikeUID + TargetSystem 必填
//   - select          : StrikeUID 必填
//   - skip_select / announce / skip_announce : 无字段
//
// TargetSystem 用 *int 是为了让 0(合法星系编号)在 omitempty 下不被漏传;
// nil 表示未提供, *int == 0 表示显式传 0。
//
// 注意: jsonschema tag 只写纯描述文本。enum 约束与 required 由
// buildResolveStrikeActionInputSchema 手动注入(原因: jsonschema-go v0.4.3
// 不支持 tag 中的 enum=/required 关键字, 见 infer.go:333 disallowedPrefixRegexp)。
type ResolveStrikeActionInput struct {
	Option       string `json:"option" jsonschema:"打击动作类型, 取值: move/retarget/select/skip_select/announce/skip_announce"`
	StrikeUID    string `json:"strikeUid,omitempty" jsonschema:"打击实例 UID。option 取值为 move/retarget/select 时必填"`
	TargetSystem *int   `json:"targetSystem,omitempty" jsonschema:"目标星系编号。option 取值为 move/retarget 时必填"`
}

// ResolveStrikeActionOutput 是 resolve_strike_action tool 的输出。
// 字段与旧 ActionOutput 对齐,额外携带 Option 标识分派分支。
type ResolveStrikeActionOutput struct {
	Success   bool   `json:"success"`
	Option    string `json:"option"`
	Action    string `json:"action,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	Error     string `json:"error,omitempty"`
	ErrorCode string `json:"errorCode,omitempty"`
}

// buildStrikeActionRequest 根据 option 把 input 映射为后端 action 名与 payload。
// 返回 (action, data, error): error 非空表示入参校验失败(字段缺失或 option 非法)。
//
// 该函数是纯函数,不依赖 session,便于单测覆盖 6 种 option 的分派逻辑。
func buildStrikeActionRequest(option string, in ResolveStrikeActionInput) (string, map[string]any, error) {
	switch option {
	case strikeOptionMove:
		if in.StrikeUID == "" {
			return "", nil, fmt.Errorf("option=move 缺少 strikeUid")
		}
		if in.TargetSystem == nil {
			return "", nil, fmt.Errorf("option=move 缺少 targetSystem")
		}
		return "moveStrike", map[string]any{
			"strikeUid":    in.StrikeUID,
			"targetSystem": *in.TargetSystem,
		}, nil
	case strikeOptionRetarget:
		if in.StrikeUID == "" {
			return "", nil, fmt.Errorf("option=retarget 缺少 strikeUid")
		}
		if in.TargetSystem == nil {
			return "", nil, fmt.Errorf("option=retarget 缺少 targetSystem")
		}
		return "retargetStrike", map[string]any{
			"strikeUid":    in.StrikeUID,
			"targetSystem": *in.TargetSystem,
		}, nil
	case strikeOptionSelect:
		if in.StrikeUID == "" {
			return "", nil, fmt.Errorf("option=select 缺少 strikeUid")
		}
		return "selectStrike", map[string]any{
			"strikeUid": in.StrikeUID,
		}, nil
	case strikeOptionSkipSelect:
		return "skipStrikeSelect", nil, nil
	case strikeOptionAnnounce:
		return "announceStrike", nil, nil
	case strikeOptionSkipAnnounce:
		return "skipAnnounceStrike", nil, nil
	default:
		return "", nil, fmt.Errorf("未知 option: %q, 合法值: move/retarget/select/skip_select/announce/skip_announce", option)
	}
}

// buildResolveStrikeActionInputSchema 构造 resolve_strike_action 的 InputSchema。
//
// 由于 jsonschema-go v0.4.3 不支持 struct tag 中的 enum=/required 关键字
// (tag 含 "WORD=" 前缀会报错 "must not begin with 'WORD='", 见 infer.go:333),
// 这里先用 jsonschema.For 推导基础 schema, 再手动给 option 字段注入 enum 约束。
// option 字段因无 omitempty 会自动出现在 Required 列表中(infer.go:342-344)。
func buildResolveStrikeActionInputSchema() *jsonschema.Schema {
	s, err := jsonschema.For[ResolveStrikeActionInput](&jsonschema.ForOptions{
		TypeSchemas: map[reflect.Type]*jsonschema.Schema{
			reflect.TypeFor[json.RawMessage](): rawJSONTypeSchema,
		},
	})
	if err != nil {
		panic(fmt.Sprintf("生成 ResolveStrikeActionInput schema 失败: %v", err))
	}
	if prop, ok := s.Properties["option"]; ok {
		prop.Enum = []any{
			strikeOptionMove, strikeOptionRetarget, strikeOptionSelect,
			strikeOptionSkipSelect, strikeOptionAnnounce, strikeOptionSkipAnnounce,
		}
	}
	return s
}

// handleResolveStrikeAction 构造 resolve_strike_action 的 handler 闭包。
// 流程: buildStrikeActionRequest 校验+映射 → doAction 复用现有动作执行链。
func handleResolveStrikeAction(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, ResolveStrikeActionInput) (*mcp.CallToolResult, ResolveStrikeActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in ResolveStrikeActionInput) (*mcp.CallToolResult, ResolveStrikeActionOutput, error) {
		action, data, err := buildStrikeActionRequest(in.Option, in)
		if err != nil {
			// 入参校验失败: 返回结构化错误(不向 MCP 框架抛 err,让 Agent 能读到 Error 字段)
			return nil, ResolveStrikeActionOutput{
				Success: false,
				Option:  in.Option,
				Error:   err.Error(),
			}, nil
		}
		_, out, err := doAction(req, mgr, action, data)
		if err != nil {
			// mustConnect 失败等基础设施错误: 向上抛给 MCP 框架
			return nil, ResolveStrikeActionOutput{
				Success: false,
				Option:  in.Option,
				Error:   err.Error(),
			}, err
		}
		return nil, ResolveStrikeActionOutput{
			Success:   out.Success,
			Option:    in.Option,
			Action:    out.Action,
			RequestID: out.RequestID,
			Error:     out.Error,
			ErrorCode: out.ErrorCode,
		}, nil
	}
}

// RegisterResolveStrikeActionTool 注册 resolve_strike_action 单一入口 strike 动作 tool。
//
// 该 tool 合并原 6 个独立 strike 动作 tool(move_strike / retarget_strike /
// select_strike / skip_strike_select / announce_strike / skip_announce_strike)
// 为单一分派入口,降低 Agent 工具面认知负担。
//
// option 取值与参数取用规则:
//   - move          : 移动飞行打击到新星系(每回合 1 格); 需 strikeUid + targetSystem
//   - retarget      : 重新瞄准飞行打击的目标星系; 需 strikeUid + targetSystem
//   - select        : 在多个打击中选定一个; 需 strikeUid
//   - skip_select   : 跳过打击选择; 无参数
//   - announce      : 宣告打击(触发特殊效果); 无参数
//   - skip_announce : 跳过宣告打击; 无参数
//
// 具体合法 strikeUid / validMoves 等请参考 get_agent_view 的 strike 域或
// get_affordances 的 pendingAction 字段。
//
// 注意: 注册此 tool 不影响旧 6 个 strike tool 的注册(由 server.go 控制);
// 旧 tool 的下线在 Task 13 统一处理。
func RegisterResolveStrikeActionTool(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "resolve_strike_action",
			Description: "统一入口处理 6 种打击相关动作,通过 option 字段分派:" +
				"move(移动飞行打击到新星系,每回合 1 格,需 strikeUid + targetSystem)、" +
				"retarget(重新瞄准飞行打击目标星系,需 strikeUid + targetSystem)、" +
				"select(多选一时选定打击,需 strikeUid)、" +
				"skip_select(跳过打击选择,无参数)、" +
				"announce(宣告打击触发特殊效果,无参数)、" +
				"skip_announce(跳过宣告打击,无参数)。" +
				"具体合法 strikeUid / validMoves 等请参考 get_agent_view 的 strike 域或 get_affordances 的 pendingAction 字段。",
			InputSchema:  buildResolveStrikeActionInputSchema(),
			OutputSchema: outputSchemaFor[ResolveStrikeActionOutput](),
		},
		handleResolveStrikeAction(mgr),
	)
}
