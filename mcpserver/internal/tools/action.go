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
	TargetPlayerID string `json:"targetPlayerId,omitempty" jsonschema:"目标玩家 ID。仅当卡牌为'科技锁死'(strike_tech_lock)时允许传入;其余打击类型传该字段会被服务器拒绝"`
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
	// 注意:jsonschema tag 内容前缀若不含空格且出现 `=`(如 `agreed=true`),
	// 会被 jsonschema-go 的 disallowedPrefixRegexp `^[^ \t\n]*=` 误判为
	// `WORD=...` 形式导致 AddTool panic。这里用 `agreed 为 true` 表述规避。
	Agreed  bool   `json:"agreed" jsonschema:"是否同意合作(true)或伪装(false)。agreed 为 true 时必须传 cardUid"`
	CardUID string `json:"cardUid,omitempty" jsonschema:"回应卡牌 UID。agreed 为 true 时必填,空串会被后端静默忽略(等同未响应)"`
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

// --- end_turn ---

type EndTurnInput struct {
	DiscardCards  []string `json:"discardCards,omitempty" jsonschema:"要弃掉的卡牌 UID 列表"`
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
	Mode               string `json:"mode" jsonschema:"跃迁模式：random(不公开位置) 或 specified(公开位置)。普通模式能量为随机10/指定13；文明遗迹模式能量为随机3/指定5"`
	TargetSystem       int    `json:"targetSystem" jsonschema:"指定跃迁目标星系(1-9)，仅 mode=specified 时生效"`
	CarryEnergy        int    `json:"carryEnergy" jsonschema:"携带至新星球的能量(封顶5)。仅文明遗迹模式生效；普通模式忽略（不可携带）"`
	Message            string `json:"message" jsonschema:"≤10字符留言，非空则额外消耗1能量。仅文明遗迹模式生效；普通模式忽略（无留言）"`
	LeaveBehind        bool   `json:"leaveBehind" jsonschema:"true 将余下能量与设施遗留原星球供继承; false 销毁之"`
	BroadcastOnInherit *bool  `json:"broadcastOnInherit,omitempty" jsonschema:"继承时的公共日志门控，省略默认 true"`
}

func handleLightspeedShip(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, LightspeedShipInput) (*mcp.CallToolResult, ActionOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in LightspeedShipInput) (*mcp.CallToolResult, ActionOutput, error) {
		return doAction(req, mgr, "lightspeedShip", map[string]any{
			"mode":               in.Mode,
			"targetSystem":       in.TargetSystem,
			"carryEnergy":        in.CarryEnergy,
			"message":            in.Message,
			"leaveBehind":        in.LeaveBehind,
			"broadcastOnInherit": in.BroadcastOnInherit,
		})
	}
}

// RegisterActionTools 注册全部 10 个动作工具(9 个核心动作 + cancel_broadcast)。
// 注意:必须逐个调用 mcp.AddTool 而非通过 slice 循环,否则 Go 的类型推断
// 无法从 any 接口推断出 handler 函数的具体输入类型。
//
// 竞态提示:工具返回 success 仅代表动作被后端接收,本地缓存的游戏状态
// 可能尚未通过 fullSync 更新。Agent 在动作返回后立即读取本地状态可能
// 看到旧值,决策前调用 get_agent_view 复核。
// 受影响工具:broadcast / respond_broadcast / select_broadcast_responder / cancel_broadcast。
//
// Task 13 下线 6 个旧 strike tool(move_strike / retarget_strike /
// select_strike / skip_strike_select / announce_strike / skip_announce_strike),
// 替代品为 resolve_strike_action(在 resolve_strike_action.go 中注册)。
func RegisterActionTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "play_card", Description: "出牌(基础动作)。需提供手牌中的卡牌 UID。合法目标集（如合法 targetSystem / cardUid / validMoves 等）请参考 get_affordances 的 legalTargets 字段，避免传入非法值被后端拒绝。"},
		handlePlayCard(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "deploy_card", Description: "部署设施卡到场上(含戴森球唯一性校验)。合法目标集（如合法 targetSystem / cardUid / validMoves 等）请参考 get_affordances 的 legalTargets 字段，避免传入非法值被后端拒绝。"},
		handleDeployCard(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "strike", Description: "发射打击卡牌,生成飞行打击。需指定目标星系。仅'科技锁死'(strike_tech_lock)支持指定目标玩家(targetPlayerId);其余打击类型仅支持指定星球,传 targetPlayerId 会被拒绝。合法目标集（如合法 targetSystem / cardUid / validMoves 等）请参考 get_affordances 的 legalTargets 字段，避免传入非法值被后端拒绝。"},
		handleStrike(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "broadcast", Description: "发起广播。需指定广播卡牌和目标星系。调用前请先调用 get_broadcast_state 确认当前无进行中的广播。注意:工具返回 success 仅代表动作被后端接收,本地缓存的游戏状态可能尚未通过 fullSync 更新,决策前请调用 get_game_state 或 get_broadcast_state 复核最新状态。合法目标集（如合法 targetSystem / cardUid / validMoves 等）请参考 get_affordances 的 legalTargets 字段，避免传入非法值被后端拒绝。"},
		handleBroadcast(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "respond_broadcast", Description: "响应广播:同意合作(agreed=true)或伪装(agreed=false)。规则:agreed=true 时必须传 cardUid(广播卡 UID),否则后端静默忽略该响应(等同未响应)。若你的 mustRespond=true(位于目标星系且有可用广播牌),必须 agreed=true+cardUid 才能完成响应。请先调用 get_broadcast_state 确认 localRole=responder 且 needsMyResponse=true。注意:工具返回 success 仅代表动作被后端接收,本地缓存的游戏状态可能尚未通过 fullSync 更新,决策前请调用 get_game_state 或 get_broadcast_state 复核最新状态。合法目标集（如合法 targetSystem / cardUid / validMoves 等）请参考 get_affordances 的 legalTargets 字段，避免传入非法值被后端拒绝。"},
		handleRespondBroadcast(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "select_broadcast_responder", Description: "选择广播响应者。仅广播发起者(localRole=broadcaster)能选择回应者;非发起者调用将被服务器拒绝。请先调用 get_broadcast_state 确认 agreedResponders 列表后再选择。注意:工具返回 success 仅代表动作被后端接收,本地缓存的游戏状态可能尚未通过 fullSync 更新,决策前请调用 get_game_state 或 get_broadcast_state 复核最新状态。合法目标集（如合法 targetSystem / cardUid / validMoves 等）请参考 get_affordances 的 legalTargets 字段，避免传入非法值被后端拒绝。"},
		handleSelectBroadcastResponder(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "cancel_broadcast", Description: "取消当前广播。仅广播发起者(localRole=broadcaster)有权取消自己发起的广播;非发起者调用将被服务器拒绝。先调用 get_broadcast_state 确认角色。注意:工具返回 success 仅代表动作被后端接收,本地缓存的游戏状态可能尚未通过 fullSync 更新,决策前调用 get_game_state 或 get_broadcast_state 复核最新状态。"},
		handleCancelBroadcast(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "recycle_card", Description: "回收场上明牌,退还能量/2。合法目标集（如合法 targetSystem / cardUid / validMoves 等）请参考 get_affordances 的 legalTargets 字段，避免传入非法值被后端拒绝。"},
		handleRecycleCard(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "end_turn", Description: "结束当前回合。可同时弃牌(discardCards 为卡牌 UID 列表)。结束回合前请确认 get_affordances 的 legalActions 中无其他必做动作（如 PendingAction 强制响应）。"},
		handleEndTurn(mgr))
	mcp.AddTool(server,
		&mcp.Tool{Name: "lightspeed_ship", Description: "光速飞船跃迁。行为按模式分化：普通模式——一次性牌，从手牌直接打出，random(10能量,位置不公开)或 specified(13能量,位置公开)，不可携带能量(carryEnergy 被忽略)、无留言(message 被忽略)，跃迁后进弃牌堆；余下能量与设施 leaveBehind=true 遗留或 false 销毁。文明遗迹模式——可重复使用，先部署(10能量)后跃迁，random(3能量,不公开)或 specified(5能量,公开)，可携带0-5能量，可填写≤10字符留言(额外1能量)，飞船保留。合法目标集（如合法 targetSystem / cardUid / validMoves 等）请参考 get_affordances 的 legalTargets 字段，避免传入非法值被后端拒绝。"},
		handleLightspeedShip(mgr))
}

// 确保 fmt 被使用
var _ = fmt.Sprintf
