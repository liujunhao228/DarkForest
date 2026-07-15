package tools

import (
	"context"
	"fmt"

	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ActionOutput 是所有游戏动作工具的通用输出。
type ActionOutput struct {
	Success   bool   `json:"success"`
	Action    string `json:"action,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	Error     string `json:"error,omitempty"`
	ErrorCode string `json:"errorCode,omitempty"`
}

// doAction 是游戏动作的通用执行逻辑。
func doAction(req *mcp.CallToolRequest, mgr *session.Manager, action string, data map[string]any) (*mcp.CallToolResult, ActionOutput, error) {
	gs, err := mustConnect(req, mgr)
	if err != nil {
		return nil, ActionOutput{}, err
	}
	result, err := gs.SendAction(action, data)
	if err != nil {
		return nil, ActionOutput{Action: action, Error: err.Error()}, nil
	}
	return nil, ActionOutput{
		Success:   result.Success,
		Action:    result.Action,
		RequestID: result.RequestID,
		Error:     result.Error,
		ErrorCode: result.ErrorCode,
	}, nil
}

// --- play_card ---

type PlayCardInput struct {
	CardUID string `json:"cardUid" jsonschema:"要出的卡牌实例 UID"`
}

func handlePlayCard(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, PlayCardInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in PlayCardInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "playCard", map[string]any{"cardUid": in.CardUID})
	}
}

// --- deploy_card ---

type DeployCardInput struct {
	CardUID string `json:"cardUid" jsonschema:"要部署的卡牌实例 UID"`
}

func handleDeployCard(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, DeployCardInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in DeployCardInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "deployCard", map[string]any{"cardUid": in.CardUID})
	}
}

// --- strike ---

type StrikeInput struct {
	CardUID        string `json:"cardUid" jsonschema:"打击卡牌 UID"`
	TargetSystem   int    `json:"targetSystem" jsonschema:"目标星系编号"`
	TargetPlayerID string `json:"targetPlayerId,omitempty" jsonschema:"目标玩家 ID(可选)"`
}

func handleStrike(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, StrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in StrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
		data := map[string]any{"cardUid": in.CardUID, "targetSystem": in.TargetSystem}
		if in.TargetPlayerID != "" {
			data["targetPlayerId"] = in.TargetPlayerID
		}
		return doAction(req, mgr, "strike", data)
	}
}

// --- broadcast ---

type BroadcastInput struct {
	CardUID      string `json:"cardUid" jsonschema:"广播卡牌 UID"`
	TargetSystem int    `json:"targetSystem" jsonschema:"广播目标星系"`
}

func handleBroadcast(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, BroadcastInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in BroadcastInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "broadcast", map[string]any{"cardUid": in.CardUID, "targetSystem": in.TargetSystem})
	}
}

// --- respond_broadcast ---

type RespondBroadcastInput struct {
	Agreed  bool   `json:"agreed" jsonschema:"是否同意合作(true)或伪装(false)"`
	CardUID string `json:"cardUid,omitempty" jsonschema:"回应卡牌 UID(若需要)"`
}

func handleRespondBroadcast(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, RespondBroadcastInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in RespondBroadcastInput) (*mcp.CallToolResult, ActionOutput, error) {
		data := map[string]any{"agreed": in.Agreed}
		if in.CardUID != "" {
			data["cardUid"] = in.CardUID
		}
		return doAction(req, mgr, "respondBroadcast", data)
	}
}

// --- select_broadcast_responder ---

type SelectBroadcastResponderInput struct {
	ResponderID string `json:"responderId" jsonschema:"选定的响应者玩家 ID"`
}

func handleSelectBroadcastResponder(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, SelectBroadcastResponderInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in SelectBroadcastResponderInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "selectBroadcastResponder", map[string]any{"responderId": in.ResponderID})
	}
}

// --- cancel_broadcast ---

type CancelBroadcastInput struct{}

func handleCancelBroadcast(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, CancelBroadcastInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ CancelBroadcastInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "cancelBroadcast", nil)
	}
}

// --- recycle_card ---

type RecycleCardInput struct {
	CardUID string `json:"cardUid" jsonschema:"要回收的明牌 UID"`
}

func handleRecycleCard(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, RecycleCardInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in RecycleCardInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "recycleCard", map[string]any{"cardUid": in.CardUID})
	}
}

// --- move_strike ---

type MoveStrikeInput struct {
	StrikeUID    string `json:"strikeUid" jsonschema:"飞行打击 UID"`
	TargetSystem int    `json:"targetSystem" jsonschema:"移动到的目标星系"`
}

func handleMoveStrike(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, MoveStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in MoveStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "moveStrike", map[string]any{"strikeUid": in.StrikeUID, "targetSystem": in.TargetSystem})
	}
}

// --- announce_strike ---

type AnnounceStrikeInput struct{}

func handleAnnounceStrike(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, AnnounceStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ AnnounceStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "announceStrike", nil)
	}
}

// --- skip_announce_strike ---

type SkipAnnounceStrikeInput struct{}

func handleSkipAnnounceStrike(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, SkipAnnounceStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ SkipAnnounceStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "skipAnnounceStrike", nil)
	}
}

// --- retarget_strike ---

type RetargetStrikeInput struct {
	StrikeUID    string `json:"strikeUid" jsonschema:"打击 UID"`
	TargetSystem int    `json:"targetSystem" jsonschema:"新的目标星系"`
}

func handleRetargetStrike(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, RetargetStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in RetargetStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "retargetStrike", map[string]any{"strikeUid": in.StrikeUID, "targetSystem": in.TargetSystem})
	}
}

// --- select_strike ---

type SelectStrikeInput struct {
	StrikeUID string `json:"strikeUid" jsonschema:"选定的打击 UID"`
}

func handleSelectStrike(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, SelectStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in SelectStrikeInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "selectStrike", map[string]any{"strikeUid": in.StrikeUID})
	}
}

// --- skip_strike_select ---

type SkipStrikeSelectInput struct{}

func handleSkipStrikeSelect(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, SkipStrikeSelectInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ SkipStrikeSelectInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "skipStrikeSelect", nil)
	}
}

// --- end_turn ---

type EndTurnInput struct {
	DiscardCards   []string `json:"discardCards,omitempty" jsonschema:"要弃掉的卡牌 UID 列表"`
	PublicDiscard bool     `json:"publicDiscard,omitempty" jsonschema:"是否公开弃牌"`
}

func handleEndTurn(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, EndTurnInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in EndTurnInput) (*mcp.CallToolResult, ActionOutput, error) {
		data := map[string]any{}
		if len(in.DiscardCards) > 0 {
			data["discardCards"] = in.DiscardCards
		}
		if in.PublicDiscard {
			data["publicDiscard"] = true
		}
		return doAction(req, mgr, "endTurn", data)
	}
}

// --- lightspeed_ship ---

type LightspeedShipInput struct {
	LeaveBehind bool `json:"leaveBehind" jsonschema:"true=将能量与设施遗留原星球供继承;false=销毁之"`
}

func handleLightspeedShip(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, LightspeedShipInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in LightspeedShipInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "lightspeedShip", map[string]any{"leaveBehind": in.LeaveBehind})
	}
}

// RegisterActionTools 注册全部 16 个游戏动作工具。
// 注意:必须逐个调用 mcp.AddTool 而非通过 slice 循环,否则 Go 的类型推断
// 无法从 any 接口推断出 handler 函数的具体输入类型。
func RegisterActionTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "play_card", Description: "出牌(基础动作)。需提供手牌中的卡牌 UID。"},
		handlePlayCard(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "deploy_card", Description: "部署设施卡到场上(含戴森球唯一性校验)。"},
		handleDeployCard(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "strike", Description: "发射打击卡牌,生成飞行打击。需指定目标星系。"},
		handleStrike(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "broadcast", Description: "发起广播。需指定广播卡牌和目标星系。"},
		handleBroadcast(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "respond_broadcast", Description: "响应广播:同意合作(true)或伪装(false)。"},
		handleRespondBroadcast(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "select_broadcast_responder", Description: "选择广播响应者。"},
		handleSelectBroadcastResponder(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "cancel_broadcast", Description: "取消当前广播。"},
		handleCancelBroadcast(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "recycle_card", Description: "回收场上明牌,退还能量/2。"},
		handleRecycleCard(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "move_strike", Description: "移动飞行打击到新星系。每回合移动 1 格。"},
		handleMoveStrike(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "announce_strike", Description: "宣告打击(触发特殊效果)。"},
		handleAnnounceStrike(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "skip_announce_strike", Description: "跳过宣告打击。"},
		handleSkipAnnounceStrike(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "retarget_strike", Description: "重新瞄准飞行打击的目标星系。"},
		handleRetargetStrike(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "select_strike", Description: "选择一个打击(多选一时)。"},
		handleSelectStrike(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "skip_strike_select", Description: "跳过打击选择。"},
		handleSkipStrikeSelect(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "end_turn", Description: "结束当前回合。可同时弃牌(discardCards 为卡牌 UID 列表)。"},
		handleEndTurn(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "lightspeed_ship", Description: "光速飞船跃迁（每次耗费3能量，可重复使用）。leaveBehind=true 将能量与设施遗留原星球供继承；false 销毁之。"},
		handleLightspeedShip(mgr))
}

// 确保 fmt 被使用
var _ = fmt.Sprintf
