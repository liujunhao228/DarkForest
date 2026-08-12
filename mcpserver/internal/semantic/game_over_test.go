package semantic

import (
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// newGameOverState 构造 gameOver 状态的 ViewState。
func newGameOverState(winner string, replayID string, totalTurn int, eliminated ...string) *gamesdk.ViewState {
	state := &gamesdk.ViewState{
		Phase:         "gameOver",
		Winner:        winner,
		ReplayID:      replayID,
		TotalTurn:     totalTurn,
		LocalPlayerID: "p1",
	}
	elimSet := make(map[string]bool, len(eliminated))
	for _, id := range eliminated {
		elimSet[id] = true
	}
	for _, id := range []string{"p1", "p2", "p3"} {
		state.Players = append(state.Players, gamesdk.ViewPlayer{
			ID:         id,
			Eliminated: elimSet[id],
		})
	}
	return state
}

func TestProjectGameOver_NilState(t *testing.T) {
	view := ProjectGameOver(nil, "p1")
	if view.Result != GameResultDraw {
		t.Errorf("Result = %q, want %q", view.Result, GameResultDraw)
	}
	if view.Winner != "" {
		t.Errorf("Winner = %q, want empty", view.Winner)
	}
}

func TestProjectGameOver_Win(t *testing.T) {
	state := newGameOverState("p1", "replay-1", 12, "p2")
	view := ProjectGameOver(state, "p1")
	if view.Result != GameResultWin {
		t.Errorf("Result = %q, want %q", view.Result, GameResultWin)
	}
	if view.Winner != "p1" {
		t.Errorf("Winner = %q, want p1", view.Winner)
	}
	if view.ReplayID != "replay-1" {
		t.Errorf("ReplayID = %q, want replay-1", view.ReplayID)
	}
	if view.TotalTurn != 12 {
		t.Errorf("TotalTurn = %d, want 12", view.TotalTurn)
	}
	if len(view.Eliminated) != 1 || view.Eliminated[0] != "p2" {
		t.Errorf("Eliminated = %v, want [p2]", view.Eliminated)
	}
}

func TestProjectGameOver_Loss(t *testing.T) {
	state := newGameOverState("p2", "replay-2", 20, "p1", "p3")
	view := ProjectGameOver(state, "p1")
	if view.Result != GameResultLoss {
		t.Errorf("Result = %q, want %q", view.Result, GameResultLoss)
	}
	if view.Winner != "p2" {
		t.Errorf("Winner = %q, want p2", view.Winner)
	}
	if len(view.Eliminated) != 2 {
		t.Errorf("Eliminated len = %d, want 2", len(view.Eliminated))
	}
}

func TestProjectGameOver_Draw(t *testing.T) {
	// 全灭：Winner 空串（omitempty），不是字段缺失。
	state := newGameOverState("", "replay-3", 15, "p1", "p2", "p3")
	view := ProjectGameOver(state, "p1")
	if view.Result != GameResultDraw {
		t.Errorf("Result = %q, want %q (all eliminated)", view.Result, GameResultDraw)
	}
	if view.Winner != "" {
		t.Errorf("Winner = %q, want empty", view.Winner)
	}
	if len(view.Eliminated) != 3 {
		t.Errorf("Eliminated len = %d, want 3", len(view.Eliminated))
	}
}

func TestProjectGameOver_NoEliminated(t *testing.T) {
	// 终局但无 Eliminated 玩家（如实名状态时 p1 自称胜者未录淘汰）时列表应为空。
	state := newGameOverState("p1", "", 8)
	view := ProjectGameOver(state, "p1")
	if view.Eliminated != nil {
		t.Errorf("Eliminated = %v, want nil", view.Eliminated)
	}
}
