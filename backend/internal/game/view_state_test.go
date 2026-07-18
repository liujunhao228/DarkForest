package game

import "testing"

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
