package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"darkforest/mcpserver/internal/persistence"
)

// makeTurnAnalysisRow 构造 get_turn_analysis 专用样本行（老记录，3 帧全量 states）。
//   - states[0]: 初始（totalTurn=0，p1 手牌 2，p2 手牌 2，无飞行打击）
//   - states[1]: turn1 末帧（totalTurn=1，p1/p2 手牌不变，飞行打击数不变 → strike 为 no-op）
//   - states[2]: turn2 末帧（totalTurn=2，p2 手牌 2→1 → playCard 有效）
//
// actions:
//   - a0: turn1 p1 strike（data 带 cardName/cardDefId/cardUid）
//   - a1: turn2 p2 playCard（data 带 cardName/cardDefId/cardUid）
func makeTurnAnalysisRow(id string) persistence.ReplayRow {
	makeHand := func(n int) []any {
		out := make([]any, 0, n)
		for i := 0; i < n; i++ {
			out = append(out, map[string]any{
				"uid": "h", "defId": "d_x", "name": "卡", "type": "strike", "energy": 1,
			})
		}
		return out
	}
	playerState := func(turn, p1Hand, p2Hand, strikes int) map[string]any {
		return map[string]any{
			"phase":              "playing",
			"totalTurn":          turn,
			"currentPlayerId":    "p1",
			"currentPlayerIndex": 0,
			"players": []any{
				map[string]any{"id": "p1", "name": "Alice", "energy": 10, "hand": makeHand(p1Hand), "faceUpCards": []any{}, "eliminated": false},
				map[string]any{"id": "p2", "name": "Bob", "energy": 8, "hand": makeHand(p2Hand), "faceUpCards": []any{}, "eliminated": false},
			},
			"drawPile":      []any{},
			"discardPile":   []any{},
			"flyingStrikes": make([]any, strikes),
			"logs":          []any{},
		}
	}
	states := []any{
		playerState(0, 2, 2, 0),
		playerState(1, 2, 2, 0), // strike 未生效
		playerState(2, 2, 1, 0), // playCard 生效（p2 手牌 -1）
	}
	statesJSON, _ := json.Marshal(states)
	actions := []any{
		map[string]any{"playerId": "p1", "action": "strike", "turn": 1,
			"data": map[string]any{"cardName": "光粒打击", "cardDefId": "d_strike_light", "cardUid": "s1"}},
		map[string]any{"playerId": "p2", "action": "playCard", "turn": 2,
			"data": map[string]any{"cardName": "广播协议", "cardDefId": "d_broadcast_1", "cardUid": "h2"}},
	}
	actionsJSON, _ := json.Marshal(actions)
	playerIDs, _ := json.Marshal([]string{"p1", "p2"})
	playerNames, _ := json.Marshal([]string{"Alice", "Bob"})
	return persistence.ReplayRow{
		ID:          id,
		MatchID:     "m_" + id,
		PlayerIDs:   string(playerIDs),
		PlayerNames: string(playerNames),
		ActionsJSON: string(actionsJSON),
		StatesJSON:  string(statesJSON),
		TotalTurns:  2,
	}
}

func TestHandleGetTurnAnalysis_StrikeNoOp(t *testing.T) {
	db := openTempDB(t)
	if err := db.Replay.SaveReplay(makeTurnAnalysisRow("ta1")); err != nil {
		t.Fatalf("SaveReplay: %v", err)
	}
	handler := handleGetTurnAnalysis(nil, db)
	_, out, err := handler(context.Background(), fakeCallToolRequest(), GetTurnAnalysisInput{ReplayID: "ta1", Turn: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !out.Found {
		t.Fatalf("expected Found=true")
	}
	if len(out.Actions) != 1 {
		t.Fatalf("expected 1 action for turn1, got %d", len(out.Actions))
	}
	a := out.Actions[0]
	if a.Action != "strike" {
		t.Errorf("action = %q, want strike", a.Action)
	}
	if a.CardName != "光粒打击" {
		t.Errorf("cardName = %q, want 光粒打击", a.CardName)
	}
	if !a.WasNoOp {
		t.Errorf("expected WasNoOp=true (飞行打击数未增加)")
	}
	if a.NoOpReason == "" {
		t.Errorf("expected non-empty NoOpReason")
	}
	if !strings.Contains(a.ExpectedEffect, "打击") {
		t.Errorf("expected ExpectedEffect 提及打击, got %q", a.ExpectedEffect)
	}
}

func TestHandleGetTurnAnalysis_PlayCardEffect(t *testing.T) {
	db := openTempDB(t)
	if err := db.Replay.SaveReplay(makeTurnAnalysisRow("ta2")); err != nil {
		t.Fatalf("SaveReplay: %v", err)
	}
	handler := handleGetTurnAnalysis(nil, db)
	_, out, err := handler(context.Background(), fakeCallToolRequest(), GetTurnAnalysisInput{ReplayID: "ta2", Turn: 2})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !out.Found {
		t.Fatalf("expected Found=true")
	}
	if len(out.Actions) != 1 {
		t.Fatalf("expected 1 action for turn2, got %d", len(out.Actions))
	}
	a := out.Actions[0]
	if a.Action != "playCard" {
		t.Errorf("action = %q, want playCard", a.Action)
	}
	if a.WasNoOp {
		t.Errorf("expected WasNoOp=false (p2 手牌从 2 减至 1)")
	}
	if !strings.Contains(a.ActualEffect, "手牌") {
		t.Errorf("expected ActualEffect 提及手牌, got %q", a.ActualEffect)
	}
}

func TestHandleGetTurnAnalysis_TurnOutOfRange(t *testing.T) {
	db := openTempDB(t)
	if err := db.Replay.SaveReplay(makeTurnAnalysisRow("ta3")); err != nil {
		t.Fatalf("SaveReplay: %v", err)
	}
	handler := handleGetTurnAnalysis(nil, db)
	_, _, err := handler(context.Background(), fakeCallToolRequest(), GetTurnAnalysisInput{ReplayID: "ta3", Turn: 99})
	if err == nil {
		t.Fatalf("expected error for out-of-range turn")
	}
	if !strings.Contains(err.Error(), "超出范围") {
		t.Errorf("expected error 提及超范围, got %q", err.Error())
	}
}

func TestHandleGetTurnAnalysis_NotFound(t *testing.T) {
	db := openTempDB(t)
	handler := handleGetTurnAnalysis(nil, db)
	_, _, err := handler(context.Background(), fakeCallToolRequest(), GetTurnAnalysisInput{ReplayID: "nope", Turn: 1})
	if err == nil {
		t.Fatalf("expected error for missing replay")
	}
}
