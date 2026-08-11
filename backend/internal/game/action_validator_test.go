package game

import (
	"errors"
	"testing"
)

// makeValidatorTestState 构造 ValidateAction 测试用 GameState：
// p1 为当前玩家（星系 1，能量 20，actionPhase），p2 为非当前玩家（星系 2）。
func makeValidatorTestState() *GameState {
	players := []Player{
		{ID: "p1", Name: "p1", Color: PlayerColorRed, Position: 1, Energy: 20, Hand: []Card{}},
		{ID: "p2", Name: "p2", Color: PlayerColorBlue, Position: 2, Energy: 20, Hand: []Card{}},
	}
	return &GameState{
		Phase:              GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        2,
		Players:            players,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:    "p1",
		LocalPlayerID:      "p1",
		TurnPhase:          TurnPhaseActionPhase,
		PendingAction:      nil,
		Broadcast:          nil,
	}
}

func TestValidateAction_NotYourTurn(t *testing.T) {
	state := makeValidatorTestState()
	// p2 非当前玩家执行仅限当前玩家的 playCard
	err := ValidateAction(state, "p2", "playCard")
	if !errors.Is(err, ErrActionNotYourTurn) {
		t.Fatalf("ValidateAction(non-current playCard) = %v, want ErrActionNotYourTurn", err)
	}
	// 非当前玩家弃权是合法的（forfeit 不要求当前玩家）
	if err := ValidateAction(state, "p2", "forfeit"); err != nil {
		t.Fatalf("ValidateAction(non-current forfeit) = %v, want nil", err)
	}
}

func TestValidateAction_WrongPhase(t *testing.T) {
	state := makeValidatorTestState()
	// 当前玩家在 actionPhase 执行 moveStrike → 阶段不允许
	err := ValidateAction(state, "p1", "moveStrike")
	if !errors.Is(err, ErrActionWrongPhase) {
		t.Fatalf("ValidateAction(moveStrike in actionPhase) = %v, want ErrActionWrongPhase", err)
	}
	// 打击阶段执行 playCard → 阶段不允许
	state.TurnPhase = TurnPhaseStrikeMovement
	err = ValidateAction(state, "p1", "playCard")
	if !errors.Is(err, ErrActionWrongPhase) {
		t.Fatalf("ValidateAction(playCard in strikeMovement) = %v, want ErrActionWrongPhase", err)
	}
	// actionPhase 的 playCard 正常通过
	state.TurnPhase = TurnPhaseActionPhase
	if err := ValidateAction(state, "p1", "playCard"); err != nil {
		t.Fatalf("ValidateAction(playCard in actionPhase) = %v, want nil", err)
	}
}

func TestValidateAction_PendingBlocked(t *testing.T) {
	state := makeValidatorTestState()
	state.PendingAction = &PendingAction{Type: "strikeMove", StrikeUID: "s-1"}
	// 存在 PendingAction 时常规动作被阻止
	err := ValidateAction(state, "p1", "playCard")
	if !errors.Is(err, ErrActionPendingBlocked) {
		t.Fatalf("ValidateAction(playCard with pending) = %v, want ErrActionPendingBlocked", err)
	}
	// endTurn 允许存在 PendingAction（跳过路径）
	if err := ValidateAction(state, "p1", "endTurn"); err != nil {
		t.Fatalf("ValidateAction(endTurn with pending) = %v, want nil", err)
	}
	// moveStrike 需要匹配类型（先切换到打击阶段）
	state.TurnPhase = TurnPhaseStrikeMovement
	if err := ValidateAction(state, "p1", "moveStrike"); err != nil {
		t.Fatalf("ValidateAction(moveStrike with strikeMove pending) = %v, want nil", err)
	}
}

func TestValidateAction_PendingRequired(t *testing.T) {
	state := makeValidatorTestState()
	state.TurnPhase = TurnPhaseStrikeMovement
	// 无 PendingAction 时依赖它的动作被拒绝
	err := ValidateAction(state, "p1", "moveStrike")
	if !errors.Is(err, ErrActionNoPending) {
		t.Fatalf("ValidateAction(moveStrike no pending) = %v, want ErrActionNoPending", err)
	}
	// PendingAction 类型不匹配 → ErrActionPendingMismatch
	state.PendingAction = &PendingAction{Type: "announceStrike", StrikeUID: "s-1"}
	err = ValidateAction(state, "p1", "moveStrike")
	if !errors.Is(err, ErrActionPendingMismatch) {
		t.Fatalf("ValidateAction(moveStrike w/ announceStrike pending) = %v, want ErrActionPendingMismatch", err)
	}
	// 匹配类型通过
	state.PendingAction = &PendingAction{Type: "strikeMove", StrikeUID: "s-1"}
	if err := ValidateAction(state, "p1", "moveStrike"); err != nil {
		t.Fatalf("ValidateAction(moveStrike w/ strikeMove pending) = %v, want nil", err)
	}
}

// TestValidateAction_MissedStrikeInActionPhase 验证 Direct 模式（Classic/自定义房间）下
// 落空打击的 PendingAction 出现在 actionPhase 时，落空打击动作仍被允许（否则玩家会卡死）。
func TestValidateAction_MissedStrikeInActionPhase(t *testing.T) {
	state := makeValidatorTestState() // TurnPhase = actionPhase
	state.PendingAction = &PendingAction{Type: "strikeMissedFree", StrikeUID: "s-1"}

	if err := ValidateAction(state, "p1", "skipMissedStrike"); err != nil {
		t.Fatalf("ValidateAction(skipMissedStrike in actionPhase) = %v, want nil", err)
	}
	if err := ValidateAction(state, "p1", "discardMissedStrike"); err != nil {
		t.Fatalf("ValidateAction(discardMissedStrike in actionPhase) = %v, want nil", err)
	}
	state.PendingAction = &PendingAction{Type: "strikeMissedRequireTarget", StrikeUID: "s-1"}
	if err := ValidateAction(state, "p1", "retargetMissedStrike"); err != nil {
		t.Fatalf("ValidateAction(retargetMissedStrike in actionPhase) = %v, want nil", err)
	}
	// 但 actionPhase 下常规动作仍被 pending 阻止（pending 未解决前不能出牌）
	err := ValidateAction(state, "p1", "playCard")
	if !errors.Is(err, ErrActionPendingBlocked) {
		t.Fatalf("ValidateAction(playCard with missed pending) = %v, want ErrActionPendingBlocked", err)
	}
}

func TestValidateAction_BroadcastRequired(t *testing.T) {
	state := makeValidatorTestState()
	state.TurnPhase = TurnPhaseInterrupted
	// 无广播时 cancelBroadcast 被拒绝
	err := ValidateAction(state, "p1", "cancelBroadcast")
	if !errors.Is(err, ErrActionNoBroadcast) {
		t.Fatalf("ValidateAction(cancelBroadcast no broadcast) = %v, want ErrActionNoBroadcast", err)
	}
	// 有广播时通过（respondBroadcast 不要求当前玩家）
	state.Broadcast = &BroadcastState{
		BroadcasterID: "p1",
		CardUID:       "bc-1",
		Card:          Card{UID: "bc-1", Name: "恒星广播", Type: CardTypeBroadcast},
		TargetSystem:  2,
		Range:         1,
		Subtype:       BroadcastSubtypeCooperation,
		Responses:     []BroadcastResponse{{PlayerID: "p2", CanRespond: true}},
		Phase:         BroadcastPhaseWaiting,
	}
	if err := ValidateAction(state, "p2", "respondBroadcast"); err != nil {
		t.Fatalf("ValidateAction(respondBroadcast during broadcast) = %v, want nil", err)
	}
	// 广播期间当前玩家不能 playCard（阶段 interrupted 不允许）
	err = ValidateAction(state, "p1", "playCard")
	if !errors.Is(err, ErrActionWrongPhase) {
		t.Fatalf("ValidateAction(playCard during broadcast) = %v, want ErrActionWrongPhase", err)
	}
}

func TestValidateAction_PlayerChecks(t *testing.T) {
	state := makeValidatorTestState()
	// 玩家不在对局中
	err := ValidateAction(state, "ghost", "forfeit")
	if !errors.Is(err, ErrActionPlayerNotFound) {
		t.Fatalf("ValidateAction(ghost forfeit) = %v, want ErrActionPlayerNotFound", err)
	}
	// 已淘汰玩家被拒绝
	state.Players[1].Eliminated = true
	err = ValidateAction(state, "p2", "forfeit")
	if !errors.Is(err, ErrActionPlayerEliminated) {
		t.Fatalf("ValidateAction(eliminated forfeit) = %v, want ErrActionPlayerEliminated", err)
	}
}

func TestValidateAction_UnknownActionPasses(t *testing.T) {
	state := makeValidatorTestState()
	// 未登记动作默认放行（由 dispatch 层/引擎兜底）
	if err := ValidateAction(state, "p1", "futureAction"); err != nil {
		t.Fatalf("ValidateAction(unknown action) = %v, want nil", err)
	}
}
