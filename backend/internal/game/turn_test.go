package game

import (
	"strings"
	"testing"
)

// newTurnTestState 构造一个可配置玩家存活状态的测试 GameState。
// playerCount 决定玩家数量，所有玩家初始未淘汰，当前玩家为 index 0。
func newTurnTestState(playerCount int) *GameState {
	seeds := make([]PlayerSeed, playerCount)
	for i := 0; i < playerCount; i++ {
		seeds[i] = PlayerSeed{
			ID:   playerName(i),
			Name: playerName(i),
		}
	}
	state := NewGame(InitConfig{
		PlayerCount: playerCount,
		PlayerSeeds: seeds,
	})
	return state
}

func playerName(i int) string {
	return []string{"p1", "p2", "p3", "p4", "p5"}[i]
}

// TestAdvanceToNextPlayer_NoElimination_NoWraparound 验证无淘汰时正常推进（不回绕）。
// p1 -> p2，TotalTurn 不变。
func TestAdvanceToNextPlayer_NoElimination_NoWraparound(t *testing.T) {
	state := newTurnTestState(3)
	state.CurrentPlayerIndex = 0
	initialTurn := state.TotalTurn

	AdvanceToNextPlayer(state)

	if state.CurrentPlayerID != "p2" {
		t.Errorf("expected p2, got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn {
		t.Errorf("expected TotalTurn %d (no increment on forward advance), got %d",
			initialTurn, state.TotalTurn)
	}
}

// TestAdvanceToNextPlayer_NoElimination_Wraparound 验证无淘汰回绕时 TotalTurn +1。
// 这是原 bug 的核心场景：p3 -> p1（回绕），TotalTurn 应增加。
func TestAdvanceToNextPlayer_NoElimination_Wraparound(t *testing.T) {
	state := newTurnTestState(3)
	state.CurrentPlayerIndex = 2 // p3
	initialTurn := state.TotalTurn

	AdvanceToNextPlayer(state)

	if state.CurrentPlayerID != "p1" {
		t.Errorf("expected p1 (wraparound), got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn+1 {
		t.Errorf("expected TotalTurn %d (increment on wraparound), got %d",
			initialTurn+1, state.TotalTurn)
	}
}

// TestAdvanceToNextPlayer_NoElimination_FullRound 验证完整一轮后 TotalTurn +1。
func TestAdvanceToNextPlayer_NoElimination_FullRound(t *testing.T) {
	state := newTurnTestState(3)
	state.CurrentPlayerIndex = 0
	initialTurn := state.TotalTurn

	// p1 -> p2 -> p3 -> p1
	AdvanceToNextPlayer(state) // p1 -> p2
	AdvanceToNextPlayer(state) // p2 -> p3
	AdvanceToNextPlayer(state) // p3 -> p1 (wraparound)

	if state.CurrentPlayerID != "p1" {
		t.Errorf("expected p1 after full round, got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn+1 {
		t.Errorf("expected TotalTurn %d after full round, got %d",
			initialTurn+1, state.TotalTurn)
	}
}

// TestAdvanceToNextPlayer_WithElimination_ForwardAdvance 验证淘汰玩家时正向跳过。
// 4 人，p2 淘汰，p1 -> p3（跳过 p2），不回绕，TotalTurn 不变。
func TestAdvanceToNextPlayer_WithElimination_ForwardAdvance(t *testing.T) {
	state := newTurnTestState(4)
	state.Players[1].Eliminated = true // p2 淘汰
	state.CurrentPlayerIndex = 0       // p1
	initialTurn := state.TotalTurn

	AdvanceToNextPlayer(state)

	if state.CurrentPlayerID != "p3" {
		t.Errorf("expected p3 (skip eliminated p2), got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn {
		t.Errorf("expected TotalTurn %d (forward advance), got %d",
			initialTurn, state.TotalTurn)
	}
}

// TestAdvanceToNextPlayer_WithElimination_Wraparound 验证淘汰玩家时回绕 +1。
// 4 人，p2 淘汰，p4 -> p1（回绕，跳过无人），TotalTurn +1。
func TestAdvanceToNextPlayer_WithElimination_Wraparound(t *testing.T) {
	state := newTurnTestState(4)
	state.Players[1].Eliminated = true // p2 淘汰
	state.CurrentPlayerIndex = 3       // p4
	initialTurn := state.TotalTurn

	AdvanceToNextPlayer(state)

	if state.CurrentPlayerID != "p1" {
		t.Errorf("expected p1 (wraparound), got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn+1 {
		t.Errorf("expected TotalTurn %d (wraparound with elimination), got %d",
			initialTurn+1, state.TotalTurn)
	}
}

// TestAdvanceToNextPlayer_WithElimination_WraparoundSkipEliminated
// 验证回绕时跳过淘汰玩家且 TotalTurn +1。
// 4 人，p2、p4 淘汰，p3 -> p1（回绕跳过 p4），TotalTurn +1。
func TestAdvanceToNextPlayer_WithElimination_WraparoundSkipEliminated(t *testing.T) {
	state := newTurnTestState(4)
	state.Players[1].Eliminated = true // p2 淘汰
	state.Players[3].Eliminated = true // p4 淘汰
	state.CurrentPlayerIndex = 2       // p3
	initialTurn := state.TotalTurn

	AdvanceToNextPlayer(state)

	if state.CurrentPlayerID != "p1" {
		t.Errorf("expected p1 (wraparound skipping p4), got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn+1 {
		t.Errorf("expected TotalTurn %d (wraparound with skip), got %d",
			initialTurn+1, state.TotalTurn)
	}
}

// TestAdvanceToNextPlayer_TwoPlayers_WraparoundEveryOtherTurn
// 验证 2 人游戏每次切换都回绕（交替 +1）。
func TestAdvanceToNextPlayer_TwoPlayers_WraparoundEveryOtherTurn(t *testing.T) {
	state := newTurnTestState(2)
	state.CurrentPlayerIndex = 0
	initialTurn := state.TotalTurn

	// p1 -> p2 (forward)
	AdvanceToNextPlayer(state)
	if state.CurrentPlayerID != "p2" {
		t.Fatalf("expected p2, got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn {
		t.Errorf("forward advance: expected TotalTurn %d, got %d",
			initialTurn, state.TotalTurn)
	}

	// p2 -> p1 (wraparound)
	AdvanceToNextPlayer(state)
	if state.CurrentPlayerID != "p1" {
		t.Fatalf("expected p1, got %s", state.CurrentPlayerID)
	}
	if state.TotalTurn != initialTurn+1 {
		t.Errorf("wraparound: expected TotalTurn %d, got %d",
			initialTurn+1, state.TotalTurn)
	}
}

// TestAdvanceToNextPlayer_GameOverWhenOneAlive 验证仅 1 人存活时游戏结束。
func TestAdvanceToNextPlayer_GameOverWhenOneAlive(t *testing.T) {
	state := newTurnTestState(3)
	state.Players[1].Eliminated = true // p2 淘汰
	state.Players[2].Eliminated = true // p3 淘汰
	state.CurrentPlayerIndex = 0       // p1

	AdvanceToNextPlayer(state)

	if state.Phase != GamePhaseGameOver {
		t.Errorf("expected GamePhaseGameOver, got %s", state.Phase)
	}
	if state.Winner == nil || *state.Winner != "p1" {
		t.Errorf("expected winner p1, got %v", state.Winner)
	}
}

// TestAdvanceToNextPlayer_GameOverWhenNoneAlive 验证无人存活时游戏结束。
func TestAdvanceToNextPlayer_GameOverWhenNoneAlive(t *testing.T) {
	state := newTurnTestState(3)
	state.Players[0].Eliminated = true
	state.Players[1].Eliminated = true
	state.Players[2].Eliminated = true
	state.CurrentPlayerIndex = 0

	AdvanceToNextPlayer(state)

	if state.Phase != GamePhaseGameOver {
		t.Errorf("expected GamePhaseGameOver, got %s", state.Phase)
	}
	if state.Winner != nil {
		t.Errorf("expected nil winner, got %v", *state.Winner)
	}
}

// TestEliminatePlayerForTimeout 验证因回合空闲超时淘汰当前玩家的逻辑。
// 覆盖：Eliminated 标记、EliminatedTurn、手牌/设施入弃牌堆、FlyingStrikes 回收、
// 系统日志记录、不调用 AdvanceToNextPlayer（由 Room 层负责推进）。
func TestEliminatePlayerForTimeout(t *testing.T) {
	state := newTurnTestState(3)

	// 定位 p1（当前玩家）
	var p1 *Player
	var p1Idx int
	for i := range state.Players {
		if state.Players[i].ID == "p1" {
			p1 = &state.Players[i]
			p1Idx = i
			break
		}
	}
	if p1 == nil {
		t.Fatalf("p1 not found")
	}

	// 构造 p1 持有 2 张手牌 + 1 张 FaceUpCard + 1 个 FlyingStrike
	p1.Hand = []Card{
		{UID: "card_hand_1", DefID: "def1", Name: "hand1"},
		{UID: "card_hand_2", DefID: "def2", Name: "hand2"},
	}
	p1.FaceUpCards = []Card{
		{UID: "card_faceup_1", DefID: "def3", Name: "faceup1"},
	}
	state.FlyingStrikes = []FlyingStrike{
		{UID: "strike_test_1", DefID: "strike_def1", OwnerID: "p1", StrikeName: "testStrike"},
	}

	// 记录 p2/p3 的初始状态用于断言"不变"
	p2HandBefore := len(state.Players[1].Hand)
	p2FaceUpBefore := len(state.Players[1].FaceUpCards)
	p3HandBefore := len(state.Players[2].Hand)
	p3FaceUpBefore := len(state.Players[2].FaceUpCards)

	discardBefore := len(state.DiscardPile)
	totalTurnBefore := state.TotalTurn
	logsBefore := len(state.Logs)
	currentPlayerIDBefore := state.CurrentPlayerID

	// 调用被测函数
	EliminatePlayerForTimeout(state, "p1")

	// 1. Eliminated 标记
	if !state.Players[p1Idx].Eliminated {
		t.Errorf("p1.Eliminated = false, want true")
	}
	// 2. EliminatedTurn
	if state.Players[p1Idx].EliminatedTurn != totalTurnBefore {
		t.Errorf("p1.EliminatedTurn = %d, want %d", state.Players[p1Idx].EliminatedTurn, totalTurnBefore)
	}
	// 3. 手牌与 FaceUpCards 清空
	if len(state.Players[p1Idx].Hand) != 0 {
		t.Errorf("p1.Hand len = %d, want 0", len(state.Players[p1Idx].Hand))
	}
	if len(state.Players[p1Idx].FaceUpCards) != 0 {
		t.Errorf("p1.FaceUpCards len = %d, want 0", len(state.Players[p1Idx].FaceUpCards))
	}
	// 4. 手牌 + FaceUpCards + 打击牌入弃牌堆（共 4 张：2 hand + 1 faceup + 1 strike）
	if len(state.DiscardPile) != discardBefore+4 {
		t.Errorf("DiscardPile len = %d, want %d (+4)", len(state.DiscardPile), discardBefore)
	}
	discardTail := state.DiscardPile[len(state.DiscardPile)-4:]
	foundHand1, foundHand2, foundFaceUp1 := false, false, false
	for _, c := range discardTail {
		switch c.UID {
		case "card_hand_1":
			foundHand1 = true
		case "card_hand_2":
			foundHand2 = true
		case "card_faceup_1":
			foundFaceUp1 = true
		}
	}
	if !foundHand1 || !foundHand2 || !foundFaceUp1 {
		t.Errorf("p1 的手牌与 FaceUpCards 未全部入弃牌堆, tail=%+v", discardTail)
	}
	// 5. FlyingStrikes 已回收（不含 OwnerID == p1）
	for _, s := range state.FlyingStrikes {
		if s.OwnerID == "p1" {
			t.Errorf("FlyingStrikes 仍含 OwnerID=p1 的打击: %+v", s)
		}
	}
	// 6. 该打击入弃牌堆
	foundStrikeInDiscard := false
	for _, c := range state.DiscardPile {
		if c.UID == "strike_test_1" {
			foundStrikeInDiscard = true
		}
	}
	if !foundStrikeInDiscard {
		t.Errorf("strike_test_1 未入 DiscardPile")
	}
	// 7. 末尾日志包含 "因长时间未操作被淘汰"
	if len(state.Logs) <= logsBefore {
		t.Fatalf("Logs len = %d, want > %d (未新增日志)", len(state.Logs), logsBefore)
	}
	lastLog := state.Logs[len(state.Logs)-1]
	if lastLog.Type != LogEntryTypeSystem {
		t.Errorf("last log Type = %v, want %v", lastLog.Type, LogEntryTypeSystem)
	}
	if !strings.Contains(lastLog.Message, "因长时间未操作被淘汰") {
		t.Errorf("last log Message = %q, want contains '因长时间未操作被淘汰'", lastLog.Message)
	}
	// 8. 倒数第二条日志包含 "回收进弃牌堆"（CleanupPlayerStrikes 的日志）
	if len(state.Logs) < 2 {
		t.Fatalf("Logs len = %d, want >= 2", len(state.Logs))
	}
	secondLastLog := state.Logs[len(state.Logs)-2]
	if !strings.Contains(secondLastLog.Message, "回收进弃牌堆") {
		t.Errorf("second last log Message = %q, want contains '回收进弃牌堆'", secondLastLog.Message)
	}
	// 9. p2/p3 未受影响
	if state.Players[1].Eliminated {
		t.Errorf("p2.Eliminated = true, want false")
	}
	if state.Players[2].Eliminated {
		t.Errorf("p3.Eliminated = true, want false")
	}
	if len(state.Players[1].Hand) != p2HandBefore {
		t.Errorf("p2.Hand len changed: %d -> %d", p2HandBefore, len(state.Players[1].Hand))
	}
	if len(state.Players[1].FaceUpCards) != p2FaceUpBefore {
		t.Errorf("p2.FaceUpCards len changed: %d -> %d", p2FaceUpBefore, len(state.Players[1].FaceUpCards))
	}
	if len(state.Players[2].Hand) != p3HandBefore {
		t.Errorf("p3.Hand len changed: %d -> %d", p3HandBefore, len(state.Players[2].Hand))
	}
	if len(state.Players[2].FaceUpCards) != p3FaceUpBefore {
		t.Errorf("p3.FaceUpCards len changed: %d -> %d", p3FaceUpBefore, len(state.Players[2].FaceUpCards))
	}
	// 10. 不推进回合（CurrentPlayerID 不变）
	if state.CurrentPlayerID != currentPlayerIDBefore {
		t.Errorf("CurrentPlayerID = %s, want %s (EliminatePlayerForTimeout 不应推进回合)",
			state.CurrentPlayerID, currentPlayerIDBefore)
	}
}

// TestEliminatePlayerForForfeit 验证主动弃权淘汰逻辑。
// 与 TestEliminatePlayerForTimeout 行为一致，仅日志文案不同（"弃权，已被淘汰"）。
// 覆盖：Eliminated 标记、手牌/设施入弃牌堆、FlyingStrikes 回收、不推进回合。
func TestEliminatePlayerForForfeit(t *testing.T) {
	state := newTurnTestState(3)

	var p1 *Player
	var p1Idx int
	for i := range state.Players {
		if state.Players[i].ID == "p1" {
			p1 = &state.Players[i]
			p1Idx = i
			break
		}
	}
	if p1 == nil {
		t.Fatalf("p1 not found")
	}

	p1.Hand = []Card{
		{UID: "card_hand_1", DefID: "def1", Name: "hand1"},
	}
	p1.FaceUpCards = []Card{
		{UID: "card_faceup_1", DefID: "def3", Name: "faceup1"},
	}
	state.FlyingStrikes = []FlyingStrike{
		{UID: "strike_test_1", DefID: "strike_def1", OwnerID: "p1", StrikeName: "testStrike"},
	}

	discardBefore := len(state.DiscardPile)
	logsBefore := len(state.Logs)
	currentPlayerIDBefore := state.CurrentPlayerID

	EliminatePlayerForForfeit(state, "p1")

	// 1. Eliminated 标记
	if !state.Players[p1Idx].Eliminated {
		t.Errorf("p1.Eliminated = false, want true")
	}
	// 2. 手牌与 FaceUpCards 清空
	if len(state.Players[p1Idx].Hand) != 0 {
		t.Errorf("p1.Hand len = %d, want 0", len(state.Players[p1Idx].Hand))
	}
	if len(state.Players[p1Idx].FaceUpCards) != 0 {
		t.Errorf("p1.FaceUpCards len = %d, want 0", len(state.Players[p1Idx].FaceUpCards))
	}
	// 3. 手牌 + FaceUpCards + 打击牌入弃牌堆（共 3 张）
	if len(state.DiscardPile) != discardBefore+3 {
		t.Errorf("DiscardPile len = %d, want %d (+3)", len(state.DiscardPile), discardBefore)
	}
	// 4. FlyingStrikes 已回收
	for _, s := range state.FlyingStrikes {
		if s.OwnerID == "p1" {
			t.Errorf("FlyingStrikes 仍含 OwnerID=p1 的打击: %+v", s)
		}
	}
	// 5. 末尾日志包含 "弃权，已被淘汰"（不含超时文案）
	if len(state.Logs) <= logsBefore {
		t.Fatalf("Logs len = %d, want > %d (未新增日志)", len(state.Logs), logsBefore)
	}
	lastLog := state.Logs[len(state.Logs)-1]
	if lastLog.Type != LogEntryTypeSystem {
		t.Errorf("last log Type = %v, want %v", lastLog.Type, LogEntryTypeSystem)
	}
	if !strings.Contains(lastLog.Message, "弃权，已被淘汰") {
		t.Errorf("last log Message = %q, want contains '弃权，已被淘汰'", lastLog.Message)
	}
	if strings.Contains(lastLog.Message, "因长时间未操作") {
		t.Errorf("last log Message = %q, should not contain timeout text", lastLog.Message)
	}
	// 6. 不推进回合
	if state.CurrentPlayerID != currentPlayerIDBefore {
		t.Errorf("CurrentPlayerID = %s, want %s (EliminatePlayerForForfeit 不应推进回合)",
			state.CurrentPlayerID, currentPlayerIDBefore)
	}
}

// TestEliminatePlayerForForfeit_AlreadyEliminated 验证对已淘汰玩家调用为 no-op。
func TestEliminatePlayerForForfeit_AlreadyEliminated(t *testing.T) {
	state := newTurnTestState(3)
	state.Players[0].Eliminated = true
	logsBefore := len(state.Logs)

	EliminatePlayerForForfeit(state, "p1")

	// 不新增日志、不改变状态
	if len(state.Logs) != logsBefore {
		t.Errorf("Logs len = %d, want %d (no-op for already eliminated)",
			len(state.Logs), logsBefore)
	}
}

// TestEliminatePlayerForForfeit_UnknownPlayer 验证对不存在玩家调用为 no-op。
func TestEliminatePlayerForForfeit_UnknownPlayer(t *testing.T) {
	state := newTurnTestState(3)
	logsBefore := len(state.Logs)

	EliminatePlayerForForfeit(state, "nonexistent")

	if len(state.Logs) != logsBefore {
		t.Errorf("Logs len = %d, want %d (no-op for unknown player)",
			len(state.Logs), logsBefore)
	}
}
