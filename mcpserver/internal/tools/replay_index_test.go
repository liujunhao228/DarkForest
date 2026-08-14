package tools

import (
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// TestBuildReplayIndex 验证 3 actions 跨 2 回合的索引构建：
// TurnLastActionIdx 映射、MaxTurn、FrameCount。
func TestBuildReplayIndex(t *testing.T) {
	actions := []gamesdk.ActionRecord{
		{PlayerID: "p1", Action: "playCard", Turn: 1},
		{PlayerID: "p1", Action: "endTurn", Turn: 1},
		{PlayerID: "p2", Action: "endTurn", Turn: 2},
	}
	idx := BuildReplayIndex(actions, 2, 4)
	if idx.MaxTurn != 2 {
		t.Errorf("MaxTurn = %d, want 2", idx.MaxTurn)
	}
	if idx.FrameCount != 4 {
		t.Errorf("FrameCount = %d, want 4", idx.FrameCount)
	}
	if idx.TurnLastActionIdx[1] != 1 {
		t.Errorf("TurnLastActionIdx[1] = %d, want 1 (最后一条 turn1 action 下标)", idx.TurnLastActionIdx[1])
	}
	if idx.TurnLastActionIdx[2] != 2 {
		t.Errorf("TurnLastActionIdx[2] = %d, want 2", idx.TurnLastActionIdx[2])
	}
	if len(idx.TurnLastActionIdx) != 2 {
		t.Errorf("TurnLastActionIdx 长度 = %d, want 2", len(idx.TurnLastActionIdx))
	}
}

// TestResolveStateIndexForTurn 验证回合数→states 下标映射：
// turn=0→0；turn 有 action→lastIdx+1；无 action 回合回落到上一个有 action 回合。
func TestResolveStateIndexForTurn(t *testing.T) {
	actions := []gamesdk.ActionRecord{
		{PlayerID: "p1", Action: "playCard", Turn: 1},
		{PlayerID: "p1", Action: "endTurn", Turn: 1},
		{PlayerID: "p2", Action: "endTurn", Turn: 2},
	}
	idx := BuildReplayIndex(actions, 2, 4)

	cases := []struct {
		turn int
		want int
	}{
		{0, 0},  // 初始帧
		{1, 2},  // turn1 末帧 = TurnLastActionIdx[1]+1 = 2
		{2, 3},  // turn2 末帧 = TurnLastActionIdx[2]+1 = 3
		{3, 3},  // turn3 无 action，回落到 turn2 → 3
		{99, 3}, // 远越界，回落最后一个有 action 回合 → 3
	}
	for _, c := range cases {
		if got := idx.resolveStateIndexForTurn(c.turn); got != c.want {
			t.Errorf("resolveStateIndexForTurn(%d) = %d, want %d", c.turn, got, c.want)
		}
	}
}

// TestResolveStateIndexForTurn_EmptyTurnFallback 验证连续空回合回落：
// turn1/turn2 有 action，turn3/turn4 无 action → turn4 回落 turn2 末帧。
func TestResolveStateIndexForTurn_EmptyTurnFallback(t *testing.T) {
	actions := []gamesdk.ActionRecord{
		{PlayerID: "p1", Action: "endTurn", Turn: 1},
		{PlayerID: "p2", Action: "endTurn", Turn: 2},
	}
	idx := BuildReplayIndex(actions, 4, 5)
	if got := idx.resolveStateIndexForTurn(4); got != 2 {
		t.Errorf("resolveStateIndexForTurn(4) = %d, want 2 (回落 turn2 末帧)", got)
	}
}
