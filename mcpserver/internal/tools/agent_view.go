package tools

import (
	"context"

	"darkforest/mcpserver/internal/semantic"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// agent_view.go 提供 Phase E 认知层工具:把 semantic 五层抽象暴露给 Agent。
//
// 4 个新 tool:
//   - get_agent_view    : 整合 ObjectProjector + StrikeView + BroadcastView + PositionView + RelicView
//   - get_affordances   : 暴露 ExploreAffordance(当前合法动作集)
//   - get_recent_delta  : 暴露 ComputeDelta(prev, current, viewerID)
//   - get_turn_delta    : 按 turn 查询历史 delta(本任务降级实现)
//
// 替代关系:本组 tool 上线后,旧 get_game_state / get_game_summary /
// get_broadcast_state / get_pending_action 在 Task 13 下线。本任务不删除旧 tool。

// --- get_agent_view ---

// GetAgentViewInput 无入参,从当前会话读取状态。
type GetAgentViewInput struct{}

// GetAgentViewOutput 整合语义层五个域的顶层视图。
// 仅当 InGame=true 时填充各字段;否则仅返回 InGame=false。
type GetAgentViewOutput struct {
	InGame    bool                    `json:"inGame"`
	AgentView *semantic.AgentView     `json:"agentView,omitempty"`
	Strike    *semantic.StrikeView    `json:"strike,omitempty"`
	Broadcast *semantic.BroadcastView `json:"broadcast,omitempty"`
	Position  *semantic.PositionView  `json:"position,omitempty"`
	Relic     *semantic.RelicView     `json:"relic,omitempty"`
}

func handleGetAgentView(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetAgentViewInput) (*mcp.CallToolResult, GetAgentViewOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetAgentViewInput) (*mcp.CallToolResult, GetAgentViewOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetAgentViewOutput{}, err
		}
		state := gs.GetState()
		if state == nil || state.Phase != "playing" {
			return nil, GetAgentViewOutput{InGame: false}, nil
		}
		viewerID := state.LocalPlayerID
		gameMode := gs.GetGameMode()

		// 计算自己的位置(Position 字段),ProjectStrike 需要它判定入站分类。
		selfPosition := 0
		for i := range state.Players {
			if state.Players[i].ID == viewerID {
				selfPosition = state.Players[i].Position
				break
			}
		}

		agentView := semantic.ProjectObject(state, viewerID, gameMode)
		strike := semantic.ProjectStrike(state, viewerID, selfPosition)
		broadcast := semantic.ProjectBroadcast(state, viewerID)
		position := semantic.ProjectPosition(state, viewerID, gameMode)
		relic := semantic.ProjectRelic(state, viewerID, gameMode)

		return nil, GetAgentViewOutput{
			InGame:    true,
			AgentView: &agentView,
			Strike:    &strike,
			Broadcast: &broadcast,
			Position:  &position,
			Relic:     &relic,
		}, nil
	}
}

// --- get_affordances ---

// GetAffordancesInput 无入参,从当前会话读取状态。
type GetAffordancesInput struct{}

// GetAffordancesOutput 暴露当前合法动作集(Affordance)。
// 仅当 InGame=true 时填充 Affordance;否则仅返回 InGame=false。
type GetAffordancesOutput struct {
	InGame     bool                 `json:"inGame"`
	Affordance *semantic.Affordance `json:"affordance,omitempty"`
}

func handleGetAffordances(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetAffordancesInput) (*mcp.CallToolResult, GetAffordancesOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetAffordancesInput) (*mcp.CallToolResult, GetAffordancesOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetAffordancesOutput{}, err
		}
		state := gs.GetState()
		if state == nil || state.Phase != "playing" {
			return nil, GetAffordancesOutput{InGame: false}, nil
		}
		viewerID := state.LocalPlayerID
		gameMode := gs.GetGameMode()
		aff := semantic.ExploreAffordance(state, viewerID, gameMode)
		return nil, GetAffordancesOutput{InGame: true, Affordance: &aff}, nil
	}
}

// --- get_recent_delta ---

// GetRecentDeltaInput 无入参,从当前会话读取状态。
type GetRecentDeltaInput struct{}

// GetRecentDeltaOutput 返回最近一次 fullSync 的 StateDelta。
// prev == nil(首次 fullSync)时返回初始状态 delta(highlights=["游戏开始"])。
type GetRecentDeltaOutput struct {
	InGame bool                 `json:"inGame"`
	Delta  *semantic.StateDelta `json:"delta,omitempty"`
}

func handleGetRecentDelta(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetRecentDeltaInput) (*mcp.CallToolResult, GetRecentDeltaOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetRecentDeltaInput) (*mcp.CallToolResult, GetRecentDeltaOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetRecentDeltaOutput{}, err
		}
		state := gs.GetState()
		if state == nil || state.Phase != "playing" {
			return nil, GetRecentDeltaOutput{InGame: false}, nil
		}
		viewerID := state.LocalPlayerID
		prev := gs.GetPrevState()
		delta := semantic.ComputeDelta(prev, state, viewerID)
		return nil, GetRecentDeltaOutput{InGame: true, Delta: &delta}, nil
	}
}

// --- get_turn_delta ---

// GetTurnDeltaInput 指定要查询的回合数。
type GetTurnDeltaInput struct {
	Turn int `json:"turn" jsonschema:"要查询的回合数"`
}

// GetTurnDeltaOutput 返回指定回合的 StateDelta。
//
// 降级实现:GameSession 当前仅维护 prev/current 两份快照,无法按回合索引。
//   - turn == 当前回合:返回 get_recent_delta 同样的 delta(Found=true)
//   - 其他回合:Found=false
//
// 完整实现需 GameSession 维护按回合的状态序列(未来扩展)。
type GetTurnDeltaOutput struct {
	Found bool                 `json:"found"`
	Delta *semantic.StateDelta `json:"delta,omitempty"`
}

func handleGetTurnDelta(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetTurnDeltaInput) (*mcp.CallToolResult, GetTurnDeltaOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetTurnDeltaInput) (*mcp.CallToolResult, GetTurnDeltaOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetTurnDeltaOutput{}, err
		}
		state := gs.GetState()
		if state == nil || state.Phase != "playing" {
			return nil, GetTurnDeltaOutput{Found: false}, nil
		}
		// 降级方案:仅当 turn == 当前回合时返回 recent delta;否则 Found=false。
		// 完整实现需 GameSession 维护按回合的状态序列(未来扩展)。
		if in.Turn != state.TotalTurn {
			return nil, GetTurnDeltaOutput{Found: false}, nil
		}
		viewerID := state.LocalPlayerID
		prev := gs.GetPrevState()
		delta := semantic.ComputeDelta(prev, state, viewerID)
		return nil, GetTurnDeltaOutput{Found: true, Delta: &delta}, nil
	}
}

// RegisterAgentViewTools 注册认知层(Agent 视角语义抽象)工具。
//
// 这一组 tool 把 semantic 包五层抽象暴露给 Agent:
//   - get_agent_view    : 顶层视图(对象 + 打击 + 广播 + 位置 + 遗迹)
//   - get_affordances   : 当前合法动作集
//   - get_recent_delta  : 最近一次状态变更叙事
//   - get_turn_delta    : 指定回合的状态变更叙事(降级实现)
//
// 注意:动作 tool 的"合法目标集请参考 get_affordances" 引导更新在 Task 12 完成。
func RegisterAgentViewTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "get_agent_view",
			Description: "获取整合后的 Agent 视角视图,把对象(ObjectProjector)/打击(StrikeView)/广播(BroadcastView)/位置(PositionView)/遗迹(RelicView)五个语义域一次性返回。" +
				"仅当处于游戏中(Phase=playing)时填充;否则 inGame=false。" +
				"本工具替代旧的 get_game_state + get_game_summary + get_broadcast_state + get_pending_action 组合,作为回合开始的首选查询。" +
				"具体可执行动作的合法目标集请参考 get_affordances。",
			OutputSchema: outputSchemaFor[GetAgentViewOutput](),
		},
		handleGetAgentView(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "get_affordances",
			Description: "获取当前合法动作集(Affordance),回答\"现在能做什么\"。" +
				"PendingAction 非空时仅返回强制挂起动作(pendingAction 字段);" +
				"否则当 TurnPhase=actionPhase 且 IsMyTurn 时返回自由动作集(legalActions 字段,含 play_card/strike/deploy_card/lightspeed_ship/recycle_card/end_turn)。" +
				"每个 ActionOption 含 cost / legalTargets / precondition / expectedEffect / riskNote,供 Agent 直接决策。" +
				"本工具是动作 tool(play_card/strike 等)的合法目标集权威来源。",
			OutputSchema: outputSchemaFor[GetAffordancesOutput](),
		},
		handleGetAffordances(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "get_recent_delta",
			Description: "获取最近一次 fullSync 的 StateDelta,回答\"刚发生了什么\"。" +
				"对比 prevGameState 与 currentGameState 派生结构化 diff:changes(能量/手牌/位置/淘汰/打击/恒星/广播/胜负)+ trend(自身能量/手牌/入站打击数变化)+ highlights(关键事件摘要)。" +
				"首次 fullSync 时 prev=nil,返回初始状态 delta(highlights=[\"游戏开始\"])。" +
				"与 wait_for_event 配合:事件触发后调用本工具理解变化。",
			OutputSchema: outputSchemaFor[GetRecentDeltaOutput](),
		},
		handleGetRecentDelta(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "get_turn_delta",
			Description:  "获取指定回合的 StateDelta。当前为降级实现:仅当 turn 等于当前回合时返回 recent delta(Found=true);其他回合 Found=false(由 GameSession 维护按回合的状态序列,未来扩展)。优先使用 get_recent_delta。",
			OutputSchema: outputSchemaFor[GetTurnDeltaOutput](),
		},
		handleGetTurnDelta(mgr),
	)
}
