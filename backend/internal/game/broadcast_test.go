package game

import (
	"fmt"
	"strings"
	"testing"
)

// =============================================================================
// 测试辅助函数
// =============================================================================

// makeBroadcastCard 构造一张广播牌（指定 subtype / range / energy）。
func makeBroadcastCard(uid string, subtype BroadcastSubtype, rangeVal, energy int) Card {
	return Card{
		UID:   uid,
		DefID: fmt.Sprintf("broadcast_test_%s", subtype),
		Name:  "测试广播卡",
		Type:  CardTypeBroadcast,
		Energy: energy,
		Subtype: &subtype,
		Range:   &rangeVal,
	}
}

// makeMonitoringStationCard 构造一张监听基地设施牌（ability=detect_broadcast）。
func makeMonitoringStationCard(uid string) Card {
	ability := "detect_broadcast"
	return Card{
		UID:     uid,
		DefID:   "facility_monitoring_station",
		Name:    "监听基地",
		Type:    CardTypeFacility,
		Energy:  2,
		Ability: &ability,
	}
}

// makeBroadcastTestState 构造广播测试用 GameState。
// playerCount 名玩家占据星系 1-playerCount，p1 当前回合，能量 5。
// 各测试自行向 p1.Hand 添加所需的广播牌。
func makeBroadcastTestState(playerCount int) *GameState {
	players := make([]Player, playerCount)
	for i := 0; i < playerCount; i++ {
		id := fmt.Sprintf("p%d", i+1)
		players[i] = Player{
			ID:               id,
			Name:             id,
			Color:            playerColors[i%len(playerColors)],
			Position:         i + 1,
			Energy:           5,
			Hand:             []Card{},
			FaceUpCards:      []Card{},
			Eliminated:       false,
			BroadcastHistory: []struct{ SystemID int; Turn int }{},
		}
	}

	return &GameState{
		Phase:              GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        playerCount,
		Players:            players,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:    "p1",
		LocalPlayerID:      "p1",
		DrawPile:           []Card{},
		DiscardPile:        []Card{},
		FlyingStrikes:      []FlyingStrike{},
		TurnPhase:          TurnPhaseActionPhase,
		Logs: []LogEntry{
			{ID: "log-init", Turn: 0, Phase: "system", Message: "游戏开始！", Type: LogEntryTypeSystem},
		},
		Leftovers: []StarLeftover{},
		GameMode:  GameModeClassic,
	}
}

// cardInDiscardPile 检查指定 UID 的卡牌是否在弃牌堆中。
func cardInDiscardPile(state *GameState, uid string) bool {
	for _, c := range state.DiscardPile {
		if c.UID == uid {
			return true
		}
	}
	return false
}

// cardInHand 检查指定 UID 的卡牌是否在玩家手牌中。
func cardInHand(p *Player, uid string) bool {
	for _, c := range p.Hand {
		if c.UID == uid {
			return true
		}
	}
	return false
}

// findBroadcastResponse 在 state.Broadcast.Responses 中查找指定玩家 ID 的响应指针。
func findBroadcastResponse(state *GameState, playerID string) *BroadcastResponse {
	if state.Broadcast == nil {
		return nil
	}
	for i := range state.Broadcast.Responses {
		if state.Broadcast.Responses[i].PlayerID == playerID {
			return &state.Broadcast.Responses[i]
		}
	}
	return nil
}

// =============================================================================
// TestInitiateBroadcast
// =============================================================================

func TestInitiateBroadcast(t *testing.T) {
	t.Run("正常发起", func(t *testing.T) {
		state := makeBroadcastTestState(3)
		// p1 在星系 1，持恒星广播卡(cooperation, range=1, energy=0)
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)}
		// p2 在星系 2（距离 1），持有一张广播卡以便 CanRespond=true
		state.Players[1].Hand = []Card{makeBroadcastCard("bc-2", BroadcastSubtypeCooperation, 1, 0)}
		state.Players[1].Energy = 5

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if !ok {
			t.Fatal("InitiateBroadcast returned false, want true")
		}
		p1 := &state.Players[0]
		// 能量扣除（cooperation card energy=0）
		if p1.Energy != 5 {
			t.Errorf("p1 Energy = %d, want 5 (no deduction for energy=0 card)", p1.Energy)
		}
		// 卡牌从手牌移除
		if cardInHand(p1, "bc-1") {
			t.Errorf("bc-1 should be removed from p1's hand")
		}
		// 写入 BroadcastHistory
		if len(p1.BroadcastHistory) != 1 {
			t.Fatalf("BroadcastHistory len = %d, want 1", len(p1.BroadcastHistory))
		}
		if p1.BroadcastHistory[0].SystemID != 2 || p1.BroadcastHistory[0].Turn != state.TotalTurn {
			t.Errorf("BroadcastHistory[0] = %+v, want {SystemID:2, Turn:%d}", p1.BroadcastHistory[0], state.TotalTurn)
		}
		// state.Broadcast 已设置，Phase=waiting，Responses 非空
		if state.Broadcast == nil {
			t.Fatal("expected non-nil state.Broadcast")
		}
		if state.Broadcast.Phase != BroadcastPhaseWaiting {
			t.Errorf("Phase = %s, want %s", state.Broadcast.Phase, BroadcastPhaseWaiting)
		}
		if len(state.Broadcast.Responses) == 0 {
			t.Errorf("Responses empty, want non-empty")
		}
		// 因有 possible responder，回合中断
		if state.TurnPhase != TurnPhaseInterrupted {
			t.Errorf("TurnPhase = %s, want %s", state.TurnPhase, TurnPhaseInterrupted)
		}
	})

	t.Run("卡牌类型错误", func(t *testing.T) {
		state := makeBroadcastTestState(3)
		// p1 持有一张打击牌（非广播牌）
		state.Players[0].Hand = []Card{makeStrikeCard("strike-1", "strike_thermal", "热核打击", 4, 1, 1)}

		ok := InitiateBroadcast(state, "p1", "strike-1", 2)
		if ok {
			t.Error("InitiateBroadcast returned true, want false (wrong card type)")
		}
		if state.Broadcast != nil {
			t.Errorf("expected nil state.Broadcast on rejection")
		}
		// 卡牌仍在手牌
		if !cardInHand(&state.Players[0], "strike-1") {
			t.Errorf("strike-1 should still be in p1's hand on rejection")
		}
	})

	t.Run("能量不足", func(t *testing.T) {
		state := makeBroadcastTestState(3)
		// p1 持有宇宙广播（energy=1），但能量为 0
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 2, 1)}
		state.Players[0].Energy = 0

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if ok {
			t.Error("InitiateBroadcast returned true, want false (insufficient energy)")
		}
		if state.Broadcast != nil {
			t.Errorf("expected nil state.Broadcast on rejection")
		}
		// 卡牌仍在手牌
		if !cardInHand(&state.Players[0], "bc-1") {
			t.Errorf("bc-1 should still be in p1's hand on rejection")
		}
	})

	t.Run("2回合冷却", func(t *testing.T) {
		state := makeBroadcastTestState(3)
		// p1 在星系 1，持恒星广播卡，能量充足
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)}
		// 模拟：在 Turn=1 时已对星系 2 发起过广播；当前 TotalTurn=2，2-1=1 < 2 → 拒绝
		state.TotalTurn = 2
		state.Players[0].BroadcastHistory = []struct{ SystemID int; Turn int }{
			{SystemID: 2, Turn: 1},
		}

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if ok {
			t.Error("InitiateBroadcast returned true, want false (2-turn cooldown)")
		}
		if state.Broadcast != nil {
			t.Errorf("expected nil state.Broadcast on cooldown rejection")
		}
		// 卡牌仍在手牌
		if !cardInHand(&state.Players[0], "bc-1") {
			t.Errorf("bc-1 should still be in p1's hand on cooldown rejection")
		}
	})

	t.Run("无人可回应", func(t *testing.T) {
		state := makeBroadcastTestState(3)
		// p1 持恒星广播卡（energy=0）
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)}
		state.Players[0].Energy = 5
		// p2、p3 在范围内但都没有广播牌 → CanRespond=false
		// 因此 possibleResponders 为空 → 进入"无人回应"分支

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if !ok {
			t.Fatal("InitiateBroadcast returned false, want true")
		}
		p1 := &state.Players[0]
		// 退 1 点能量（Q1 设计意图：固定退 1 点，即使原卡牌能量为 0 也退 1）
		if p1.Energy != 6 {
			t.Errorf("p1 Energy = %d, want 6 (5 - 0 + 1 refund)", p1.Energy)
		}
		// 卡牌进弃牌堆
		if !cardInDiscardPile(state, "bc-1") {
			t.Errorf("bc-1 should be in DiscardPile")
		}
		// state.Broadcast 应为 nil（已取消）
		if state.Broadcast != nil {
			t.Errorf("expected nil state.Broadcast (no responders → cancelled)")
		}
	})

	t.Run("mustRespond强制", func(t *testing.T) {
		state := makeBroadcastTestState(3)
		// p1 持恒星广播卡
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)}
		// p2 在星系 2（target），持有有效广播卡，无监测站
		state.Players[1].Hand = []Card{makeBroadcastCard("bc-2", BroadcastSubtypeCooperation, 1, 0)}
		state.Players[1].Energy = 5

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if !ok {
			t.Fatal("InitiateBroadcast returned false, want true")
		}
		// p2 应 MustRespond=true（at target + hasValidBroadcastCard + no monitoring station）
		p2Resp := findBroadcastResponse(state, "p2")
		if p2Resp == nil {
			t.Fatal("p2 not found in Responses")
		}
		if !p2Resp.CanRespond {
			t.Errorf("p2 CanRespond = false, want true")
		}
		if !p2Resp.MustRespond {
			t.Errorf("p2 MustRespond = false, want true (at target with valid broadcast card and no monitoring station)")
		}
	})

	t.Run("有监测站玩家", func(t *testing.T) {
		state := makeBroadcastTestState(3)
		// p1 持恒星广播卡
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)}
		// p2 在星系 2（target），持有效广播卡 + 监听基地（FaceUpCards）
		state.Players[1].Hand = []Card{makeBroadcastCard("bc-2", BroadcastSubtypeCooperation, 1, 0)}
		state.Players[1].FaceUpCards = []Card{makeMonitoringStationCard("mon-1")}
		state.Players[1].Energy = 5

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if !ok {
			t.Fatal("InitiateBroadcast returned false, want true")
		}
		p2Resp := findBroadcastResponse(state, "p2")
		if p2Resp == nil {
			t.Fatal("p2 not found in Responses")
		}
		if !p2Resp.CanRespond {
			t.Errorf("p2 CanRespond = false, want true (has valid broadcast card)")
		}
		if p2Resp.MustRespond {
			t.Errorf("p2 MustRespond = true, want false (has monitoring station)")
		}
	})
}

// =============================================================================
// TestRespondToBroadcast
// =============================================================================

func TestRespondToBroadcast(t *testing.T) {
	t.Run("全部拒绝", func(t *testing.T) {
		state := makeBroadcastTestState(2)
		// p1 持恒星广播卡
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)}
		state.Players[0].Energy = 5
		// p2 在星系 2，持有效广播卡
		state.Players[1].Hand = []Card{makeBroadcastCard("bc-2", BroadcastSubtypeCooperation, 1, 0)}
		state.Players[1].Energy = 5

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if !ok {
			t.Fatal("InitiateBroadcast returned false")
		}
		// p2 拒绝
		RespondToBroadcast(state, "p2", false, nil)
		// 全部拒绝 → 自动 CancelBroadcast
		if state.Broadcast != nil {
			t.Errorf("expected nil state.Broadcast (all rejected → CancelBroadcast)")
		}
		// 广播者退 1 点能量（Q1 设计意图：固定退 1 点）
		if state.Players[0].Energy != 6 {
			t.Errorf("p1 Energy = %d, want 6 (5 - 0 + 1 refund)", state.Players[0].Energy)
		}
		// 卡牌进弃牌堆
		if !cardInDiscardPile(state, "bc-1") {
			t.Errorf("bc-1 should be in DiscardPile")
		}
	})

	t.Run("至少1同意", func(t *testing.T) {
		state := makeBroadcastTestState(3)
		// p1 持宇宙广播（range=2，可达星系 2 与 3）
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 2, 1)}
		state.Players[0].Energy = 5
		// p2 在星系 2（target），持有效广播卡（range=2 >= 广播者 range=2）
		state.Players[1].Hand = []Card{makeBroadcastCard("bc-2", BroadcastSubtypeCooperation, 2, 0)}
		state.Players[1].Energy = 5
		// p3 在星系 3（distance 1 from target 2，range 2 内），持有效广播卡（range=2）
		state.Players[2].Hand = []Card{makeBroadcastCard("bc-3", BroadcastSubtypeCooperation, 2, 0)}
		state.Players[2].Energy = 5

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if !ok {
			t.Fatal("InitiateBroadcast returned false")
		}
		if state.Broadcast == nil {
			t.Fatal("expected non-nil state.Broadcast")
		}
		// p2 拒绝（先响应）
		RespondToBroadcast(state, "p2", false, nil)
		// 此时不应进入 select 阶段（p3 还没响应）
		if state.Broadcast == nil || state.Broadcast.Phase != BroadcastPhaseWaiting {
			t.Errorf("after p2 reject: Broadcast=%+v, want non-nil Phase=waiting", state.Broadcast)
		}
		// p3 同意（提供 cardUID）
		p3CardUID := "bc-3"
		RespondToBroadcast(state, "p3", true, &p3CardUID)
		// 全部响应后 anyAgreed=true → Phase=select
		if state.Broadcast == nil {
			t.Fatal("expected non-nil state.Broadcast (Phase=select)")
		}
		if state.Broadcast.Phase != BroadcastPhaseSelect {
			t.Errorf("Phase = %s, want %s", state.Broadcast.Phase, BroadcastPhaseSelect)
		}
	})

	t.Run("同意但cardUID为nil", func(t *testing.T) {
		state := makeBroadcastTestState(2)
		// p1 持恒星广播卡
		state.Players[0].Hand = []Card{makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)}
		state.Players[0].Energy = 5
		// p2 在星系 2，持有效广播卡
		state.Players[1].Hand = []Card{makeBroadcastCard("bc-2", BroadcastSubtypeCooperation, 1, 0)}
		state.Players[1].Energy = 5

		ok := InitiateBroadcast(state, "p1", "bc-1", 2)
		if !ok {
			t.Fatal("InitiateBroadcast returned false")
		}

		logsBefore := len(state.Logs)
		// p2 同意但 cardUID 为 nil（S3 修复：应记日志并直接返回，不记录 Agreed=true）
		RespondToBroadcast(state, "p2", true, nil)
		// 应有日志记录
		if len(state.Logs) <= logsBefore {
			t.Errorf("expected log entry for 'agreed without cardUID', got %d logs (was %d)", len(state.Logs), logsBefore)
		}
		// 验证 p2 的 Agreed 与 Responded 均仍为 false（S3 修复：不应记录）
		p2Resp := findBroadcastResponse(state, "p2")
		if p2Resp == nil {
			t.Fatal("p2 not found in Responses")
		}
		if p2Resp.Agreed {
			t.Errorf("p2 Agreed = true, want false (S3 fix: agreed without cardUID should not record Agreed=true)")
		}
		if p2Resp.Responded {
			t.Errorf("p2 Responded = true, want false (S3 fix: agreed without cardUID should not mark Responded)")
		}
	})
}

// =============================================================================
// TestSelectBroadcastResponder
// =============================================================================

// makeSelectPhaseBroadcastState 构造一个已进入 select 阶段的广播状态：
// p1 广播，p2 同意（CanRespond=true, Responded=true, Agreed=true, ResponseCard 设置）。
// 用于直接测试 SelectBroadcastResponder。
func makeSelectPhaseBroadcastState() *GameState {
	state := makeBroadcastTestState(2)
	bcCard := makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)
	respCard := makeBroadcastCard("resp-1", BroadcastSubtypeCooperation, 1, 0)
	state.Players[0].Hand = []Card{}
	state.Players[1].Hand = []Card{respCard}
	state.Players[1].Energy = 5
	// 预填 DrawPile 1 张牌（rAgreed 时 responder 会抽 1 张）
	state.DrawPile = []Card{makeBroadcastCard("draw-1", BroadcastSubtypeCooperation, 1, 0)}

	state.Broadcast = &BroadcastState{
		BroadcasterID: "p1",
		CardUID:       "bc-1",
		Card:          bcCard,
		TargetSystem:  2,
		Range:         1,
		Subtype:       BroadcastSubtypeCooperation,
		Responses: []BroadcastResponse{
			{
				PlayerID:     "p2",
				PlayerName:   "p2",
				CanRespond:   true,
				MustRespond:  false,
				Responded:    true,
				Agreed:       true,
				ResponseCard: &respCard,
			},
		},
		Phase: BroadcastPhaseSelect,
	}
	return state
}

func TestSelectBroadcastResponder(t *testing.T) {
	t.Run("选择合法responder", func(t *testing.T) {
		state := makeSelectPhaseBroadcastState()
		// 选择 p2 作为合法 responder（CanRespond && Responded && Agreed 均 true）
		SelectBroadcastResponder(state, "p2")
		// 进入 ResolveBroadcast，结算后 state.Broadcast 应为 nil
		if state.Broadcast != nil {
			t.Errorf("expected nil state.Broadcast after resolving, got %+v", state.Broadcast)
		}
	})

	t.Run("选择不在Responses中的ID", func(t *testing.T) {
		state := makeSelectPhaseBroadcastState()
		// 选择一个不存在的 responder ID（S2 修复：不应修改状态）
		SelectBroadcastResponder(state, "bogus-id")
		// state.Broadcast 应仍非 nil，Phase 仍为 select
		if state.Broadcast == nil {
			t.Fatal("expected non-nil state.Broadcast (S2 fix: invalid responder does not modify state)")
		}
		if state.Broadcast.Phase != BroadcastPhaseSelect {
			t.Errorf("Phase = %s, want %s (S2 fix: no transition)", state.Broadcast.Phase, BroadcastPhaseSelect)
		}
		// 应有日志记录"无效的回应者选择"
		found := false
		for _, l := range state.Logs {
			if strings.Contains(l.Message, "无效的回应者选择") {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected log '无效的回应者选择', not found")
		}
	})

	t.Run("选择Agreed=false的responder", func(t *testing.T) {
		state := makeSelectPhaseBroadcastState()
		// 修改 p2 的 Agreed=false
		state.Broadcast.Responses[0].Agreed = false
		// 选择 p2 应被拒绝（valid 校验要求 Agreed=true）
		SelectBroadcastResponder(state, "p2")
		// state.Broadcast 应仍非 nil
		if state.Broadcast == nil {
			t.Fatal("expected non-nil state.Broadcast (Agreed=false responder should not be selected)")
		}
		if state.Broadcast.Phase != BroadcastPhaseSelect {
			t.Errorf("Phase = %s, want %s (no transition)", state.Broadcast.Phase, BroadcastPhaseSelect)
		}
	})
}

// =============================================================================
// TestResolveBroadcast
// =============================================================================

// makeResolveTestState 构造一个可直接调用 ResolveBroadcast 的 GameState：
// p1 广播者，p2 回应者，p2 已同意并选定 ResponseCard；Phase=select，SelectedResponderID=p2。
// bSubtype 与 rSubtype 控制博弈矩阵；resp card energy=1 以验证能量扣除。
func makeResolveTestState(bSubtype, rSubtype BroadcastSubtype) *GameState {
	state := makeBroadcastTestState(2)
	bcCard := makeBroadcastCard("bc-1", bSubtype, 1, 0)
	respCard := makeBroadcastCard("resp-1", rSubtype, 1, 1) // 回应卡 energy=1
	state.Players[0].Energy = 5
	state.Players[1].Hand = []Card{respCard}
	state.Players[1].Energy = 5
	// 预填 DrawPile 1 张牌（rAgreed 时 responder 会抽 1 张）
	state.DrawPile = []Card{makeBroadcastCard("draw-1", BroadcastSubtypeCooperation, 1, 0)}

	selID := "p2"
	state.Broadcast = &BroadcastState{
		BroadcasterID: "p1",
		CardUID:       "bc-1",
		Card:          bcCard,
		TargetSystem:  2,
		Range:         1,
		Subtype:       bSubtype,
		Responses: []BroadcastResponse{
			{
				PlayerID:     "p2",
				PlayerName:   "p2",
				CanRespond:   true,
				MustRespond:  false,
				Responded:    true,
				Agreed:       true,
				ResponseCard: &respCard,
			},
		},
		Phase:               BroadcastPhaseSelect,
		SelectedResponderID: &selID,
	}
	return state
}

func TestResolveBroadcast(t *testing.T) {
	t.Run("cooperation_cooperation", func(t *testing.T) {
		state := makeResolveTestState(BroadcastSubtypeCooperation, BroadcastSubtypeCooperation)
		// 初始 p1=5, p2=5；resp card energy=1
		ResolveBroadcast(state)
		// 双方合作：bEnergy=3, rEnergy=3；responder 扣 1 能量（resp card）→ p1=8, p2=5-1+3=7
		if state.Players[0].Energy != 8 {
			t.Errorf("p1 Energy = %d, want 8 (5 + 3)", state.Players[0].Energy)
		}
		if state.Players[1].Energy != 7 {
			t.Errorf("p2 Energy = %d, want 7 (5 - 1 + 3)", state.Players[1].Energy)
		}
	})

	t.Run("disguise_cooperation", func(t *testing.T) {
		state := makeResolveTestState(BroadcastSubtypeDisguise, BroadcastSubtypeCooperation)
		ResolveBroadcast(state)
		// 广播者伪装成功：bEnergy=5, rEnergy=0；responder 扣 1 能量 → p1=10, p2=5-1+0=4
		if state.Players[0].Energy != 10 {
			t.Errorf("p1 Energy = %d, want 10 (5 + 5)", state.Players[0].Energy)
		}
		if state.Players[1].Energy != 4 {
			t.Errorf("p2 Energy = %d, want 4 (5 - 1 + 0)", state.Players[1].Energy)
		}
	})

	t.Run("cooperation_disguise", func(t *testing.T) {
		state := makeResolveTestState(BroadcastSubtypeCooperation, BroadcastSubtypeDisguise)
		ResolveBroadcast(state)
		// 回应者伪装成功：bEnergy=0, rEnergy=5；responder 扣 1 能量 → p1=5, p2=5-1+5=9
		if state.Players[0].Energy != 5 {
			t.Errorf("p1 Energy = %d, want 5 (5 + 0)", state.Players[0].Energy)
		}
		if state.Players[1].Energy != 9 {
			t.Errorf("p2 Energy = %d, want 9 (5 - 1 + 5)", state.Players[1].Energy)
		}
	})

	t.Run("disguise_disguise", func(t *testing.T) {
		state := makeResolveTestState(BroadcastSubtypeDisguise, BroadcastSubtypeDisguise)
		ResolveBroadcast(state)
		// 双方伪装：bEnergy=0, rEnergy=0；responder 扣 1 能量 → p1=5, p2=5-1+0=4
		if state.Players[0].Energy != 5 {
			t.Errorf("p1 Energy = %d, want 5 (5 + 0)", state.Players[0].Energy)
		}
		if state.Players[1].Energy != 4 {
			t.Errorf("p2 Energy = %d, want 4 (5 - 1 + 0)", state.Players[1].Energy)
		}
	})

	t.Run("结算后状态", func(t *testing.T) {
		state := makeResolveTestState(BroadcastSubtypeCooperation, BroadcastSubtypeCooperation)
		p2HandBefore := len(state.Players[1].Hand)
		ResolveBroadcast(state)
		p1 := &state.Players[0]
		p2 := &state.Players[1]
		// 回应者消耗 1 张响应卡 + 抽 1 张 → 手牌数量保持
		if len(p2.Hand) != p2HandBefore-1+1 {
			t.Errorf("p2 Hand len = %d, want %d (consumed 1 response card, drew 1)", len(p2.Hand), p2HandBefore-1+1)
		}
		// 响应卡从手牌移除
		if cardInHand(p2, "resp-1") {
			t.Errorf("resp-1 should be consumed from p2's hand")
		}
		// 抽到的卡（draw-1）应在 p2 手牌中
		if !cardInHand(p2, "draw-1") {
			t.Errorf("draw-1 should be in p2's hand after drawing")
		}
		// 广播卡进弃牌堆
		if !cardInDiscardPile(state, "bc-1") {
			t.Errorf("bc-1 (broadcast card) should be in DiscardPile")
		}
		// state.Broadcast == nil
		if state.Broadcast != nil {
			t.Errorf("expected nil state.Broadcast after resolve")
		}
		// PendingAction == nil
		if state.PendingAction != nil {
			t.Errorf("expected nil PendingAction after resolve")
		}
		// Q2: broadcaster.BroadcastSuccessCount == 1
		if p1.BroadcastSuccessCount != 1 {
			t.Errorf("p1 BroadcastSuccessCount = %d, want 1 (Q2: increments on successful resolve)", p1.BroadcastSuccessCount)
		}
	})

	t.Run("GameOver触发", func(t *testing.T) {
		state := makeBroadcastTestState(2)
		bcCard := makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)
		respCard := makeBroadcastCard("resp-1", BroadcastSubtypeCooperation, 1, 0)
		// p1 alive, p2 已淘汰（在广播发起前已被淘汰；测试通过手动构造 Broadcast 模拟）
		state.Players[1].Eliminated = true
		state.Players[1].Hand = []Card{respCard}
		state.Players[0].Energy = 5
		// 手动构造 Broadcast 指向 p2（ResolveBroadcast 不会因 p2 淘汰而拒绝处理）
		selID := "p2"
		state.Broadcast = &BroadcastState{
			BroadcasterID: "p1",
			CardUID:       "bc-1",
			Card:          bcCard,
			TargetSystem:  2,
			Range:         1,
			Subtype:       BroadcastSubtypeCooperation,
			Responses: []BroadcastResponse{
				{
					PlayerID:     "p2",
					PlayerName:   "p2",
					CanRespond:   true,
					MustRespond:  false,
					Responded:    true,
					Agreed:       true,
					ResponseCard: &respCard,
				},
			},
			Phase:               BroadcastPhaseSelect,
			SelectedResponderID: &selID,
		}
		state.DrawPile = []Card{} // 不抽牌

		ResolveBroadcast(state)
		// 存活玩家仅 p1 → GameOver + Winner=p1
		if state.Phase != GamePhaseGameOver {
			t.Errorf("Phase = %s, want %s", state.Phase, GamePhaseGameOver)
		}
		if state.Winner == nil || *state.Winner != "p1" {
			t.Errorf("Winner = %v, want p1", state.Winner)
		}
	})
}

// =============================================================================
// TestCancelBroadcast
// =============================================================================

// makeCancelTestState 构造一个手动设置的广播状态，用于直接测试 CancelBroadcast。
// p1 为广播者，broadcast card energy=2；模拟 InterruptTurn 后的 TurnPhase 状态：
// PrevTurnPhase=actionPhase, TurnPhase=interrupted。
func makeCancelTestState() *GameState {
	state := makeBroadcastTestState(2)
	bcCard := makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 2) // energy=2
	state.Players[0].Hand = []Card{}
	state.Players[0].Energy = 5
	state.Broadcast = &BroadcastState{
		BroadcasterID: "p1",
		CardUID:       "bc-1",
		Card:          bcCard,
		TargetSystem:  2,
		Range:         1,
		Subtype:       BroadcastSubtypeCooperation,
		Responses:     []BroadcastResponse{},
		Phase:         BroadcastPhaseWaiting,
	}
	// 模拟 InitiateBroadcast 调用 InterruptTurn 后的状态
	state.PrevTurnPhase = TurnPhaseActionPhase
	state.TurnPhase = TurnPhaseInterrupted
	return state
}

func TestCancelBroadcast(t *testing.T) {
	// Q1 设计意图：固定退还 1 点能量以防止刷广播试探，即使原卡牌能量为 2 也仅退 1 点
	t.Run("退还1点能量", func(t *testing.T) {
		state := makeCancelTestState()
		// 初始 p1 能量 5，broadcast card energy=2
		CancelBroadcast(state)
		if state.Players[0].Energy != 6 {
			t.Errorf("p1 Energy = %d, want 6 (Q1: fixed refund 1 regardless of card cost)", state.Players[0].Energy)
		}
	})

	t.Run("卡牌进弃牌堆", func(t *testing.T) {
		state := makeCancelTestState()
		CancelBroadcast(state)
		if !cardInDiscardPile(state, "bc-1") {
			t.Errorf("bc-1 should be in DiscardPile after cancel")
		}
	})

	t.Run("ResumeTurn后TurnPhase还原", func(t *testing.T) {
		// Q4: 中断前 TurnPhase=actionPhase，中断后置 interrupted，取消后还原为 actionPhase
		state := makeCancelTestState()
		// makeCancelTestState 已设置 PrevTurnPhase=actionPhase, TurnPhase=interrupted
		CancelBroadcast(state)
		if state.TurnPhase != TurnPhaseActionPhase {
			t.Errorf("TurnPhase = %s, want %s (Q4: restore to pre-interrupt phase)", state.TurnPhase, TurnPhaseActionPhase)
		}
		if state.PrevTurnPhase != "" {
			t.Errorf("PrevTurnPhase = %q, want empty (cleared after ResumeTurn)", state.PrevTurnPhase)
		}
	})

	t.Run("非actionPhase恢复", func(t *testing.T) {
		// Q4 关键修复：广播在 turnEnd 阶段触发时，取消后应还原为 turnEnd 而非 actionPhase
		state := makeBroadcastTestState(2)
		bcCard := makeBroadcastCard("bc-1", BroadcastSubtypeCooperation, 1, 0)
		state.Players[0].Hand = []Card{}
		state.Players[0].Energy = 5
		state.Broadcast = &BroadcastState{
			BroadcasterID: "p1",
			CardUID:       "bc-1",
			Card:          bcCard,
			TargetSystem:  2,
			Range:         1,
			Subtype:       BroadcastSubtypeCooperation,
			Responses:     []BroadcastResponse{},
			Phase:         BroadcastPhaseWaiting,
		}
		// 模拟广播在 turnEnd 阶段触发：先置 TurnPhase=turnEnd，再调 InterruptTurn
		state.TurnPhase = TurnPhaseTurnEnd
		InterruptTurn(state, "等待广播响应")
		// 验证 InterruptTurn 保存了 turnEnd
		if state.PrevTurnPhase != TurnPhaseTurnEnd {
			t.Fatalf("PrevTurnPhase = %s, want %s (InterruptTurn should save turnEnd)", state.PrevTurnPhase, TurnPhaseTurnEnd)
		}
		if state.TurnPhase != TurnPhaseInterrupted {
			t.Fatalf("TurnPhase = %s, want %s", state.TurnPhase, TurnPhaseInterrupted)
		}
		// 取消广播 → ResumeTurn 应还原为 turnEnd（而非 actionPhase）
		CancelBroadcast(state)
		if state.TurnPhase != TurnPhaseTurnEnd {
			t.Errorf("TurnPhase = %s, want %s (Q4 fix: restore to turnEnd, not actionPhase)", state.TurnPhase, TurnPhaseTurnEnd)
		}
	})
}
