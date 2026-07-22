package game

import (
	"strings"
	"testing"
)

// makeViewStateTestState 构造用于测试的 GameState（含两个玩家与一个未揭示广播）
func makeViewStateTestState() *GameState {
	coop := BroadcastSubtypeCooperation
	card := Card{UID: "card-1", DefID: "def-1", Name: "广播卡", Type: CardTypeBroadcast}
	respCard := Card{UID: "resp-1", DefID: "def-2", Name: "回应卡", Type: CardTypeDefense}
	selResponder := "p2"
	return &GameState{
		Phase:              GamePhasePlaying,
		TotalTurn:          3,
		PlayerCount:        2,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:    "p1",
		LocalPlayerID:      "p1",
		Players: []Player{
			{ID: "p1", Name: "玩家1", Color: PlayerColorRed, Position: 5, Energy: 10, Hand: []Card{card}, FaceUpCards: []Card{}},
			{ID: "p2", Name: "玩家2", Color: PlayerColorBlue, Position: 8, Energy: 7, Hand: []Card{respCard}, FaceUpCards: []Card{}},
		},
		Broadcast: &BroadcastState{
			BroadcasterID: "p1",
			CardUID:       "card-1",
			Card:          card,
			TargetSystem:  1,
			Range:         2,
			Subtype:       coop,
			Responses: []BroadcastResponse{
				{PlayerID: "p2", PlayerName: "玩家2", CanRespond: true, MustRespond: true, ResponseCard: &respCard},
			},
			Phase:               BroadcastPhaseSelect,
			SelectedResponderID: &selResponder,
			ResponseCard:        &respCard,
		},
	}
}

func TestCreateViewState_HidesOpponentPosition(t *testing.T) {
	state := makeViewStateTestState()
	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})

	if len(vs.Players) != 2 {
		t.Fatalf("expected 2 players, got %d", len(vs.Players))
	}
	// 自己位置可见
	if vs.Players[0].Position != 5 {
		t.Errorf("viewer position = %d, want 5 (real)", vs.Players[0].Position)
	}
	// 对手位置隐藏为 -1
	if vs.Players[1].Position != -1 {
		t.Errorf("opponent position = %d, want -1 (hidden)", vs.Players[1].Position)
	}
}

func TestCreateViewState_ReplayShowsAllPositions(t *testing.T) {
	state := makeViewStateTestState()
	vs := CreateViewState(state, ViewOptions{Role: ViewRoleReplay, PlayerID: "p1"})

	if vs.Players[0].Position != 5 {
		t.Errorf("replay p1 position = %d, want 5", vs.Players[0].Position)
	}
	if vs.Players[1].Position != 8 {
		t.Errorf("replay p2 position = %d, want 8", vs.Players[1].Position)
	}
}

func TestCreateViewState_HidesOpponentHand(t *testing.T) {
	state := makeViewStateTestState()
	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})

	// 自己手牌可见
	if len(vs.Players[0].Hand) != 1 {
		t.Errorf("viewer hand len = %d, want 1", len(vs.Players[0].Hand))
	}
	// 对手手牌内容隐藏为 nil，但手牌数量保持可见
	if vs.Players[1].Hand != nil {
		t.Errorf("opponent hand = %v, want nil", vs.Players[1].Hand)
	}
	if vs.Players[1].HandCount != 1 {
		t.Errorf("opponent handCount = %d, want 1", vs.Players[1].HandCount)
	}
}

func TestCreateViewState_BroadcastGatedBeforeReveal(t *testing.T) {
	state := makeViewStateTestState()
	// 非广播者 p2 视角，phase=select（未揭示）
	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p2"})

	bc := vs.Broadcast
	if bc == nil {
		t.Fatal("expected non-nil broadcast")
	}
	if bc.Card != nil {
		t.Errorf("non-broadcaster pre-reveal Card = %v, want nil", bc.Card)
	}
	if bc.Subtype != nil {
		t.Errorf("non-broadcaster pre-reveal Subtype = %v, want nil", *bc.Subtype)
	}
	if bc.ResponseCard != nil {
		t.Errorf("non-broadcaster pre-reveal top ResponseCard = %v, want nil", bc.ResponseCard)
	}
	// 非回应者看不到 responses[].ResponseCard；p2 是回应者，应可见自己的 ResponseCard
	if len(bc.Responses) != 1 {
		t.Fatalf("expected 1 response, got %d", len(bc.Responses))
	}
	if bc.Responses[0].ResponseCard == nil {
		t.Error("responder pre-reveal own ResponseCard = nil, want visible")
	}
}

func TestCreateViewState_BroadcasterSeesOwnCard(t *testing.T) {
	state := makeViewStateTestState()
	// 广播者 p1 视角，phase=select（未揭示）
	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})

	bc := vs.Broadcast
	if bc == nil {
		t.Fatal("expected non-nil broadcast")
	}
	if bc.Card == nil {
		t.Error("broadcaster pre-reveal Card = nil, want visible")
	}
	if bc.Subtype == nil {
		t.Error("broadcaster pre-reveal Subtype = nil, want visible")
	}
}

func TestCreateViewState_BroadcastRevealedAfterReveal(t *testing.T) {
	state := makeViewStateTestState()
	state.Broadcast.Phase = BroadcastPhaseReveal
	// 非广播者 p2 视角，已揭示
	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p2"})

	bc := vs.Broadcast
	if bc == nil {
		t.Fatal("expected non-nil broadcast")
	}
	if bc.Card == nil {
		t.Error("revealed Card = nil, want visible")
	}
	if bc.Subtype == nil {
		t.Error("revealed Subtype = nil, want visible")
	}
	if bc.ResponseCard == nil {
		t.Error("revealed top ResponseCard = nil, want visible")
	}
}

func TestCreateViewState_ReplaySeesAllBroadcast(t *testing.T) {
	state := makeViewStateTestState()
	vs := CreateViewState(state, ViewOptions{Role: ViewRoleReplay, PlayerID: "p1"})

	bc := vs.Broadcast
	if bc == nil {
		t.Fatal("expected non-nil broadcast")
	}
	if bc.Card == nil {
		t.Error("replay Card = nil, want visible")
	}
	if bc.Subtype == nil {
		t.Error("replay Subtype = nil, want visible")
	}
	if bc.ResponseCard == nil {
		t.Error("replay top ResponseCard = nil, want visible")
	}
}

// TestCreateViewState_PropagatesGameMode 验证 CreateViewState 将 state.GameMode
// 透传到 ViewState，使前端可据 modeRules 正确切换光速飞船等模式相关 UI。
// 修复背景：此前 ViewState 无 GameMode 字段，导致在线「文明遗迹」对局的前端
// `'gameMode' in gameState` 守卫失效，回退到 classicModeRules，光速飞船误用 Classic UI。
func TestCreateViewState_PropagatesGameMode(t *testing.T) {
	// Classic 模式
	stateClassic := &GameState{GameMode: GameModeClassic}
	vsClassic := CreateViewState(stateClassic, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})
	if vsClassic.GameMode != GameModeClassic {
		t.Errorf("Classic: vs.GameMode = %q, want %q", vsClassic.GameMode, GameModeClassic)
	}

	// Civilization Relics 模式
	stateRelics := &GameState{GameMode: GameModeCivilizationRelics}
	vsRelics := CreateViewState(stateRelics, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})
	if vsRelics.GameMode != GameModeCivilizationRelics {
		t.Errorf("Relics: vs.GameMode = %q, want %q", vsRelics.GameMode, GameModeCivilizationRelics)
	}

	// 零值 GameMode（视为 Classic）
	stateZero := &GameState{}
	vsZero := CreateViewState(stateZero, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})
	// omitempty：零值 "" 不会出现在 JSON 中，但 Go 结构体字段仍为 ""
	if vsZero.GameMode != GameModeClassic && vsZero.GameMode != "" {
		t.Errorf("Zero-value: vs.GameMode = %q, want %q or empty", vsZero.GameMode, GameModeClassic)
	}
}

// TestCreateViewState_LogsRedactsPositionForOpponent 验证对手视角下，
// 含 PositionOwnerID 的日志被脱敏（SystemID 置 nil、Message 中星系编号替换为 ???）。
// 修复背景：Logs 原样透传会双通道泄露玩家位置，破坏黑暗森林核心机制。
func TestCreateViewState_LogsRedactsPositionForOpponent(t *testing.T) {
	ownerID := "p1"
	systemID := 7
	state := &GameState{
		Phase: GamePhasePlaying,
		Players: []Player{
			{ID: "p1", Name: "玩家1", Color: PlayerColorRed, Position: 7, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}},
			{ID: "p2", Name: "玩家2", Color: PlayerColorBlue, Position: 3, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}},
		},
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Logs: []LogEntry{
			{
				ID:              "log-1",
				Turn:            1,
				Phase:           "actionPhase",
				Message:         "玩家1 跃迁至星系 7",
				Type:            LogEntryTypeAction,
				SystemID:        &systemID,
				PositionOwnerID: &ownerID,
			},
		},
	}

	// 对手 p2 视角
	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p2"})
	if len(vs.Logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(vs.Logs))
	}
	if vs.Logs[0].SystemID != nil {
		t.Errorf("opponent view SystemID = %v, want nil (redacted)", *vs.Logs[0].SystemID)
	}
	if !strings.Contains(vs.Logs[0].Message, "星系 ???") {
		t.Errorf("opponent view Message = %q, want contains '星系 ???'", vs.Logs[0].Message)
	}
	if strings.Contains(vs.Logs[0].Message, "星系 7") {
		t.Errorf("opponent view Message = %q, must NOT contain original '星系 7'", vs.Logs[0].Message)
	}
}

// TestCreateViewState_LogsVisibleForOwner 验证位置所属玩家视角下，日志完整可见。
func TestCreateViewState_LogsVisibleForOwner(t *testing.T) {
	ownerID := "p1"
	systemID := 7
	state := &GameState{
		Phase: GamePhasePlaying,
		Players: []Player{
			{ID: "p1", Name: "玩家1", Color: PlayerColorRed, Position: 7, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}},
		},
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Logs: []LogEntry{
			{
				ID:              "log-1",
				Turn:            1,
				Phase:           "actionPhase",
				Message:         "玩家1 跃迁至星系 7",
				Type:            LogEntryTypeAction,
				SystemID:        &systemID,
				PositionOwnerID: &ownerID,
			},
		},
	}

	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})
	if len(vs.Logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(vs.Logs))
	}
	if vs.Logs[0].SystemID == nil || *vs.Logs[0].SystemID != 7 {
		t.Errorf("owner view SystemID = %v, want 7", vs.Logs[0].SystemID)
	}
	if !strings.Contains(vs.Logs[0].Message, "星系 7") {
		t.Errorf("owner view Message = %q, want contains '星系 7'", vs.Logs[0].Message)
	}
}

// TestCreateViewState_LogsVisibleForReplay 验证 REPLAY 视角下，所有日志完整可见（含他人位置）。
func TestCreateViewState_LogsVisibleForReplay(t *testing.T) {
	ownerID := "p1"
	systemID := 7
	state := &GameState{
		Phase: GamePhasePlaying,
		Players: []Player{
			{ID: "p1", Name: "玩家1", Color: PlayerColorRed, Position: 7, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}},
		},
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Logs: []LogEntry{
			{
				ID:              "log-1",
				Turn:            1,
				Phase:           "actionPhase",
				Message:         "玩家1 跃迁至星系 7",
				Type:            LogEntryTypeAction,
				SystemID:        &systemID,
				PositionOwnerID: &ownerID,
			},
		},
	}

	vs := CreateViewState(state, ViewOptions{Role: ViewRoleReplay, PlayerID: "observer"})
	if len(vs.Logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(vs.Logs))
	}
	if vs.Logs[0].SystemID == nil || *vs.Logs[0].SystemID != 7 {
		t.Errorf("replay view SystemID = %v, want 7", vs.Logs[0].SystemID)
	}
	if !strings.Contains(vs.Logs[0].Message, "星系 7") {
		t.Errorf("replay view Message = %q, want contains '星系 7'", vs.Logs[0].Message)
	}
}

// TestCreateViewState_LogsPublicWithoutPositionOwnerID 验证 PositionOwnerID=nil 的日志
// （如广播日志，SystemID 为公开目标）对任意玩家完整可见，不脱敏。
func TestCreateViewState_LogsPublicWithoutPositionOwnerID(t *testing.T) {
	systemID := 3
	state := &GameState{
		Phase: GamePhasePlaying,
		Players: []Player{
			{ID: "p1", Name: "玩家1", Color: PlayerColorRed, Position: 5, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}},
			{ID: "p2", Name: "玩家2", Color: PlayerColorBlue, Position: 8, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}},
		},
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		Logs: []LogEntry{
			{
				ID:        "log-broadcast",
				Turn:      1,
				Phase:     "actionPhase",
				Message:   "玩家1 向星系 3 发动了广播",
				Type:      LogEntryTypeBroadcast,
				SystemID:  &systemID,
				// PositionOwnerID 故意留 nil（公开目标，不脱敏）
			},
		},
	}

	// p2 视角也应完整可见
	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p2"})
	if len(vs.Logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(vs.Logs))
	}
	if vs.Logs[0].SystemID == nil || *vs.Logs[0].SystemID != 3 {
		t.Errorf("public log SystemID = %v, want 3 (not redacted)", vs.Logs[0].SystemID)
	}
	if !strings.Contains(vs.Logs[0].Message, "星系 3") {
		t.Errorf("public log Message = %q, want contains '星系 3'", vs.Logs[0].Message)
	}
}

// TestCreateViewState_PlayerViewIncludesPenaltyTurn 验证 Player.PenaltyTurn 透传到 PlayerView。
// 修复背景：此前 PlayerView 无 PenaltyTurn 字段，在线模式跃迁惩罚限制功能失效。
func TestCreateViewState_PlayerViewIncludesPenaltyTurn(t *testing.T) {
	state := &GameState{
		Phase: GamePhasePlaying,
		Players: []Player{
			{ID: "p1", Name: "玩家1", Color: PlayerColorRed, Position: 5, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}, PenaltyTurn: true},
			{ID: "p2", Name: "玩家2", Color: PlayerColorBlue, Position: 8, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}, PenaltyTurn: false},
		},
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
	}

	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})
	if len(vs.Players) != 2 {
		t.Fatalf("expected 2 players, got %d", len(vs.Players))
	}
	if !vs.Players[0].PenaltyTurn {
		t.Error("players[0].PenaltyTurn = false, want true")
	}
	if vs.Players[1].PenaltyTurn {
		t.Error("players[1].PenaltyTurn = true, want false")
	}
}

// TestCreateViewState_PendingActionBroadcastStateRedacted 验证 PLAYER 视角下
// PendingAction.BroadcastState 被防御性置 nil，且原始 state 不被修改（防御性拷贝）。
// 修复背景：BroadcastState 为死字段（当前无代码填充），但若未来填充会绕过 filterBroadcastForView。
func TestCreateViewState_PendingActionBroadcastStateRedacted(t *testing.T) {
	card := Card{UID: "card-1", DefID: "def-1", Name: "广播卡", Type: CardTypeBroadcast}
	bcState := &BroadcastState{
		BroadcasterID: "p1",
		CardUID:       "card-1",
		Card:          card,
		TargetSystem:  3,
		Range:         2,
		Phase:         BroadcastPhaseSelect,
	}
	state := &GameState{
		Phase: GamePhasePlaying,
		Players: []Player{
			{ID: "p1", Name: "玩家1", Color: PlayerColorRed, Position: 5, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}},
			{ID: "p2", Name: "玩家2", Color: PlayerColorBlue, Position: 8, Energy: 5, Hand: []Card{}, FaceUpCards: []Card{}},
		},
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		PendingAction: &PendingAction{
			Type:           "strikeMove",
			StrikeUID:      "strike-1",
			BroadcastState: bcState,
		},
	}

	// PLAYER 视角应脱敏
	vs := CreateViewState(state, ViewOptions{Role: ViewRolePlayer, PlayerID: "p1"})
	if vs.PendingAction == nil {
		t.Fatal("expected non-nil PendingAction")
	}
	if vs.PendingAction.BroadcastState != nil {
		t.Errorf("PLAYER view PendingAction.BroadcastState = %v, want nil (redacted)", vs.PendingAction.BroadcastState)
	}

	// 原始 state 不应被修改（防御性拷贝）
	if state.PendingAction.BroadcastState == nil {
		t.Error("original state.PendingAction.BroadcastState was mutated to nil, want preserved")
	}
}
