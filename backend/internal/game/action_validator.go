package game

import (
	"errors"
	"fmt"
	"slices"
)

// 动作校验错误。dispatch 层（rooms/room.go）将 error 透传给客户端 actionResult，
// 因此在错误文案上直接面向玩家/客户端可读。
var (
	// ErrActionPlayerNotFound 动作发起者不在对局中
	ErrActionPlayerNotFound = errors.New("玩家不在对局中")
	// ErrActionPlayerEliminated 动作发起者已被淘汰（终局观察者不应执行任何动作）
	ErrActionPlayerEliminated = errors.New("玩家已被淘汰")
	// ErrActionNotYourTurn 非当前玩家执行了仅限当前玩家的动作
	ErrActionNotYourTurn = errors.New("尚未轮到你行动")
	// ErrActionWrongPhase 当前回合阶段不允许该动作
	ErrActionWrongPhase = errors.New("当前阶段不允许该动作")
	// ErrActionPendingBlocked 存在待处理动作时执行了常规动作
	ErrActionPendingBlocked = errors.New("存在待处理动作，请先完成当前操作")
	// ErrActionNoPending 没有待处理动作却执行了依赖待处理动作的动作
	ErrActionNoPending = errors.New("当前没有待处理的动作")
	// ErrActionPendingMismatch 待处理动作类型与当前动作不匹配
	ErrActionPendingMismatch = errors.New("待处理动作与当前操作不匹配")
	// ErrActionNoBroadcast 没有进行中的广播却执行了广播相关动作
	ErrActionNoBroadcast = errors.New("当前没有进行中的广播")
)

// PendingActionRule 描述动作与 PendingAction 的相互作用。
type PendingActionRule int

const (
	// PendingIrrelevant 不关心 PendingAction（如 forfeit）。
	PendingIrrelevant PendingActionRule = iota
	// PendingBlocked 存在任何 PendingAction 时阻止（actionPhase 常规动作）。
	PendingBlocked
	// PendingAllowed 允许存在 PendingAction（如 endTurn 可在打击阶段跳过）。
	PendingAllowed
	// PendingRequired 必须有匹配类型的 PendingAction（如 moveStrike 需 strikeMove）。
	PendingRequired
)

// ActionSpec 描述一个游戏动作的合法执行上下文。
// 新动作（game:action 新增分支）必须在此登记，否则 dispatch 层不做门控。
type ActionSpec struct {
	Name string
	// AllowedPhases 允许的回合阶段；nil = 任意阶段（仅 forfeit）。
	AllowedPhases []TurnPhase
	// MustBeCurrentPlayer 是否必须为当前玩家。
	MustBeCurrentPlayer bool
	// PendingRule PendingAction 规则。
	PendingRule PendingActionRule
	// PendingTypes PendingRequired 时限定可接受的 PendingAction.Type；空 = 任意类型。
	PendingTypes []string
	// RequiresBroadcast 要求 state.Broadcast != nil（广播响应/选择/取消）。
	RequiresBroadcast bool
}

// actionSpecs 注册表：所有 game:action 的合法执行上下文，key 与 room.go dispatch 的 action 字符串一致。
var actionSpecs = map[string]ActionSpec{
	// ---- actionPhase 常规动作：必须当前玩家、无待处理动作 ----
	"playCard": {
		Name: "playCard", AllowedPhases: []TurnPhase{TurnPhaseActionPhase},
		MustBeCurrentPlayer: true, PendingRule: PendingBlocked,
	},
	"deployCard": {
		Name: "deployCard", AllowedPhases: []TurnPhase{TurnPhaseActionPhase},
		MustBeCurrentPlayer: true, PendingRule: PendingBlocked,
	},
	"strike": {
		Name: "strike", AllowedPhases: []TurnPhase{TurnPhaseActionPhase},
		MustBeCurrentPlayer: true, PendingRule: PendingBlocked,
	},
	"broadcast": {
		Name: "broadcast", AllowedPhases: []TurnPhase{TurnPhaseActionPhase},
		MustBeCurrentPlayer: true, PendingRule: PendingBlocked,
	},
	"recycleCard": {
		Name: "recycleCard", AllowedPhases: []TurnPhase{TurnPhaseActionPhase},
		MustBeCurrentPlayer: true, PendingRule: PendingBlocked,
	},
	"lightspeedShip": {
		Name: "lightspeedShip", AllowedPhases: []TurnPhase{TurnPhaseActionPhase},
		MustBeCurrentPlayer: true, PendingRule: PendingBlocked,
	},

	// ---- endTurn：actionPhase 常规结束，亦可在打击/摸牌阶段跳过 ----
	"endTurn": {
		Name:                "endTurn",
		AllowedPhases:       []TurnPhase{TurnPhaseTurnBegin, TurnPhaseStrikeMovement, TurnPhaseDrawPhase, TurnPhaseActionPhase},
		MustBeCurrentPlayer: true, PendingRule: PendingAllowed,
	},

	// ---- 打击移动/宣布/选择：必须当前玩家 + 特定 PendingAction ----
	"moveStrike": {
		Name: "moveStrike", AllowedPhases: []TurnPhase{TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired, PendingTypes: []string{"strikeMove"},
	},
	"skipStrikeMove": {
		Name: "skipStrikeMove", AllowedPhases: []TurnPhase{TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired, PendingTypes: []string{"strikeMove"},
	},
	"announceStrike": {
		Name: "announceStrike", AllowedPhases: []TurnPhase{TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired, PendingTypes: []string{"announceStrike"},
	},
	"skipAnnounceStrike": {
		Name: "skipAnnounceStrike", AllowedPhases: []TurnPhase{TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired, PendingTypes: []string{"announceStrike"},
	},
	"selectStrike": {
		Name: "selectStrike", AllowedPhases: []TurnPhase{TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired, PendingTypes: []string{"strikeSelect"},
	},
	"skipStrikeSelect": {
		Name: "skipStrikeSelect", AllowedPhases: []TurnPhase{TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired, PendingTypes: []string{"strikeSelect"},
	},
	"retargetStrike": {
		Name: "retargetStrike", AllowedPhases: []TurnPhase{TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingAllowed,
	},
	"retargetMissedStrike": {
		// Direct 模式（Classic/自定义房间）下落空发生在 actionPhase（打击在 actionPhase 即刻判定，
		// 落空后挂 PendingAction 等待重定向）；OwnerPlanet 模式下在 strikeMovement。两者都允许。
		Name:                "retargetMissedStrike",
		AllowedPhases:       []TurnPhase{TurnPhaseActionPhase, TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired,
		PendingTypes: []string{"strikeMissedFree", "strikeMissedRequireTarget"},
	},
	"skipMissedStrike": {
		Name:                "skipMissedStrike",
		AllowedPhases:       []TurnPhase{TurnPhaseActionPhase, TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired, PendingTypes: []string{"strikeMissedFree"},
	},
	"discardMissedStrike": {
		Name:                "discardMissedStrike",
		AllowedPhases:       []TurnPhase{TurnPhaseActionPhase, TurnPhaseStrikeMovement},
		MustBeCurrentPlayer: true, PendingRule: PendingRequired,
		PendingTypes: []string{"strikeMissedFree", "strikeMissedRequireTarget"},
	},

	// ---- 广播三件套：回合中断期；不要求当前玩家（引擎内按广播者/回应者语义校验）----
	"respondBroadcast": {
		Name: "respondBroadcast", AllowedPhases: []TurnPhase{TurnPhaseInterrupted},
		MustBeCurrentPlayer: false, PendingRule: PendingIrrelevant, RequiresBroadcast: true,
	},
	"selectBroadcastResponder": {
		Name: "selectBroadcastResponder", AllowedPhases: []TurnPhase{TurnPhaseInterrupted},
		MustBeCurrentPlayer: false, PendingRule: PendingIrrelevant, RequiresBroadcast: true,
	},
	"cancelBroadcast": {
		Name: "cancelBroadcast", AllowedPhases: []TurnPhase{TurnPhaseInterrupted},
		MustBeCurrentPlayer: false, PendingRule: PendingIrrelevant, RequiresBroadcast: true,
	},

	// ---- forfeit：任意阶段、任意存活玩家 ----
	"forfeit": {
		Name: "forfeit", AllowedPhases: nil,
		MustBeCurrentPlayer: false, PendingRule: PendingIrrelevant,
	},
}

// pendingType 返回 PendingAction 的类型描述，nil 时返回"无"。
// 用于引擎层 PendingAction 不匹配错误的文案构造。
func pendingType(pa *PendingAction) string {
	if pa == nil {
		return "无"
	}
	return pa.Type
}

// ValidateAction 在引擎执行前校验动作上下文：
// 玩家存在性/存活 → 当前玩家 → 回合阶段 → PendingAction → 广播上下文。
// 返回 nil 表示通过门控；返回 error 表示拒绝，error 可直接透传给客户端 actionResult。
// 未登记的动作（未来新增分支）默认放行，交由引擎/其他层校验。
func ValidateAction(state *GameState, playerID string, action string) error {
	spec, ok := actionSpecs[action]
	if !ok {
		return nil
	}

	// 1. 玩家存在且未淘汰
	var player *Player
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			player = &state.Players[i]
			break
		}
	}
	if player == nil {
		return ErrActionPlayerNotFound
	}
	if player.Eliminated {
		return ErrActionPlayerEliminated
	}

	// 2. 当前玩家校验
	if spec.MustBeCurrentPlayer && state.CurrentPlayerID != playerID {
		return ErrActionNotYourTurn
	}

	// 3. 回合阶段校验
	if len(spec.AllowedPhases) > 0 && !slices.Contains(spec.AllowedPhases, state.TurnPhase) {
		return fmt.Errorf("%w: %s（当前阶段 %s）", ErrActionWrongPhase, action, state.TurnPhase)
	}

	// 4. PendingAction 校验
	switch spec.PendingRule {
	case PendingBlocked:
		if state.PendingAction != nil {
			return fmt.Errorf("%w: %s", ErrActionPendingBlocked, state.PendingAction.Type)
		}
	case PendingRequired:
		if state.PendingAction == nil {
			return ErrActionNoPending
		}
		if len(spec.PendingTypes) > 0 && !slices.Contains(spec.PendingTypes, state.PendingAction.Type) {
			return fmt.Errorf("%w: 需要 %v，当前 %s", ErrActionPendingMismatch, spec.PendingTypes, state.PendingAction.Type)
		}
	}

	// 5. 广播上下文校验
	if spec.RequiresBroadcast && state.Broadcast == nil {
		return ErrActionNoBroadcast
	}

	return nil
}
