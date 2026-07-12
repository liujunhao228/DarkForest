package game

import (
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
