package tools

import (
	"encoding/json"
	"testing"

	"darkforest/mcpserver/internal/persistence"
)

// makeEliminationReasonRow 构造一个 ReplayRow：3 玩家，2 个 action，
// 在 turn 2 的 timeout action 中 p2 新被淘汰（eliminationReason=timeout）。
// states 索引对齐 computeDeltas 语义：states[0]=初始，states[k]=应用 actions[k-1] 后。
func makeEliminationReasonRow() *persistence.ReplayRow {
	playerState := func(eliminated bool, reason string, current string, turn int) map[string]any {
		return map[string]any{
			"phase":           "playing",
			"totalTurn":       turn,
			"currentPlayerId": current,
			"players": []any{
				map[string]any{"id": "p1", "name": "Alice", "energy": 5, "hand": []any{}, "faceUpCards": []any{}, "eliminated": false},
				map[string]any{"id": "p2", "name": "Bob", "energy": 3, "hand": []any{}, "faceUpCards": []any{}, "eliminated": eliminated, "eliminationReason": reason},
				map[string]any{"id": "p3", "name": "Carol", "energy": 4, "hand": []any{}, "faceUpCards": []any{}, "eliminated": false},
			},
			"drawPile":      []any{},
			"discardPile":   []any{},
			"flyingStrikes": []any{},
		}
	}
	states := []any{
		playerState(false, "", "p1", 1),
		playerState(false, "", "p2", 1),
		playerState(true, "timeout", "p3", 2),
	}
	statesJSON, _ := json.Marshal(states)

	actions := []any{
		map[string]any{"playerId": "p1", "action": "endTurn", "data": map[string]any{}, "turn": 1},
		map[string]any{"playerId": "p2", "action": "timeout", "data": nil, "turn": 2},
	}
	actionsJSON, _ := json.Marshal(actions)

	return &persistence.ReplayRow{
		ID:          "replay-test-1",
		PlayerIDs:   `["p1","p2","p3"]`,
		PlayerNames: `["Alice","Bob","Carol"]`,
		ActionsJSON: string(actionsJSON),
		StatesJSON:  string(statesJSON),
	}
}

// TestComputeDeltas_EliminationReason 验证 computeDeltas 的 PlayerChange 淘汰原因填充：
// 新淘汰回合（turn 2）PlayerChange.EliminationReason 非空且等于 timeout；
// 非淘汰回合（turn 1）EliminationReason 为空。
func TestComputeDeltas_EliminationReason(t *testing.T) {
	row := makeEliminationReasonRow()
	deltas, err := computeDeltas(row, 1, 2)
	if err != nil {
		t.Fatalf("computeDeltas failed: %v", err)
	}
	if len(deltas) != 2 {
		t.Fatalf("expected 2 deltas, got %d", len(deltas))
	}

	// turn 1：p2 未淘汰 → PlayerChange.Eliminated=false 且 reason 为空
	t1 := deltas[0]
	if t1.Turn != 1 {
		t.Fatalf("deltas[0].Turn = %d, want 1", t1.Turn)
	}
	for _, pc := range t1.Changes.Players {
		if pc.PlayerID == "p2" {
			if pc.Eliminated {
				t.Errorf("turn1 p2 Eliminated = true, want false")
			}
			if pc.EliminationReason != "" {
				t.Errorf("turn1 p2 EliminationReason = %q, want empty", pc.EliminationReason)
			}
		}
	}

	// turn 2：p2 新被淘汰 → Eliminated=true 且 reason=timeout
	t2 := deltas[1]
	if t2.Turn != 2 {
		t.Fatalf("deltas[1].Turn = %d, want 2", t2.Turn)
	}
	found := false
	for _, pc := range t2.Changes.Players {
		if pc.PlayerID == "p2" {
			found = true
			if !pc.Eliminated {
				t.Errorf("turn2 p2 Eliminated = false, want true")
			}
			if pc.EliminationReason != "timeout" {
				t.Errorf("turn2 p2 EliminationReason = %q, want %q", pc.EliminationReason, "timeout")
			}
		}
	}
	if !found {
		t.Errorf("turn2 PlayerChange 中未找到 p2")
	}
}

// TestComputeDeltas_EliminationReason_NonEliminationPlayers 验证非淘汰回合的其他玩家
// reason 均为空（omitempty 不输出）。
func TestComputeDeltas_EliminationReason_NonEliminationPlayers(t *testing.T) {
	row := makeEliminationReasonRow()
	deltas, err := computeDeltas(row, 1, 2)
	if err != nil {
		t.Fatalf("computeDeltas failed: %v", err)
	}
	for _, d := range deltas {
		for _, pc := range d.Changes.Players {
			if !pc.Eliminated && pc.EliminationReason != "" {
				t.Errorf("turn%d %s: 未淘汰但 EliminationReason = %q, want empty",
					d.Turn, pc.PlayerID, pc.EliminationReason)
			}
		}
	}
}
