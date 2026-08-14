package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"darkforest/mcpserver/internal/persistence"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// 样本 GameState 构造工具：一个 2 玩家 3 frame 的最小回放。
// states[0] = totalTurn=0 初始
// states[1] = totalTurn=1, p1 出了一张牌后
// states[2] = totalTurn=2, p2 回合
func makeSampleReplayRow(id string) persistence.ReplayRow {
	miniState := func(turn int, cpi int, cpID string, handSize [2]int) map[string]any {
		players := []any{
			map[string]any{
				"id": "p1", "name": "Alice", "color": "red", "position": 1, "energy": 5 - turn,
				"hand": []any{
					map[string]any{"uid": "h1_" + id, "defId": "d_broadcast_1", "name": "广播协议", "type": "broadcast", "energy": 1},
				},
				"faceUpCards": []any{
					map[string]any{"uid": "f1", "defId": "d_defense_2", "name": "防御基地", "type": "defense", "energy": 2, "protectionLevel": 2},
				},
				"eliminated": false,
			},
			map[string]any{
				"id": "p2", "name": "Bob", "color": "blue", "position": 6, "energy": 3,
				"hand": []any{
					map[string]any{"uid": "h2_" + id, "defId": "d_strike_light", "name": "光粒打击", "type": "strike", "energy": 2, "level": 1, "speed": 2},
				},
				"faceUpCards": []any{
					map[string]any{"uid": "f2", "defId": "d_facility_energy_sm", "name": "小型电站", "type": "facility", "energy": 1, "energyPerTurn": 1},
				},
				"eliminated": false,
			},
		}
		return map[string]any{
			"phase":              "playing",
			"totalTurn":          turn,
			"playerCount":        2,
			"currentPlayerIndex": cpi,
			"currentPlayerId":    cpID,
			"localPlayerId":      cpID,
			"turnPhase":          "actionPhase",
			"gameMode":           "classic",
			"players":            players,
			"drawPile": []any{
				map[string]any{"uid": "d1", "defId": "dp1", "name": "抽1", "type": "strike", "energy": 1},
			},
			"discardPile":    []any{},
			"flyingStrikes":  []any{},
			"destroyedStars": []int{},
			"starEffects":    []any{},
			"logs":           []any{},
		}
	}
	states := []any{
		miniState(0, 0, "p1", [2]int{3, 2}),
		miniState(1, 1, "p2", [2]int{2, 2}),
		miniState(2, 0, "p1", [2]int{2, 1}),
	}
	statesJSON, _ := json.Marshal(states)
	actions := []any{
		map[string]any{"turn": 1, "playerId": "p1", "type": "playCard", "cardUid": "h1_x"},
		map[string]any{"turn": 2, "playerId": "p2", "type": "playCard", "cardUid": "h2_x"},
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
		Winner:      "",
		TotalTurns:  2,
		CreatedAt:   1_700_000_000,
		FetchedAt:   1_700_000_000,
	}
}

func openTempDB(t *testing.T) *persistence.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := persistence.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open temp DB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close(); _ = os.RemoveAll(dir) })
	return db
}

func TestGetReplaySemanticView_NotFound(t *testing.T) {
	db := openTempDB(t)
	handler := handleGetReplaySemanticView(nil, db)
	req := fakeCallToolRequest()
	in := GetReplaySemanticViewInput{ReplayID: "non-existent", Turn: 1}
	_, out, err := handler(context.Background(), req, in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Found {
		t.Errorf("expected Found=false for missing replay, got true")
	}
	if out.Error == "" {
		t.Errorf("expected non-empty Error for missing replay")
	}
}

// TestGetReplaySemanticView_TurnOutOfRange_Clamped 验证越界回合（turn > TotalTurns）
// clamp 到末帧并置 Clamped=true，而非返回错误（Step 7 语义变更）。
func TestGetReplaySemanticView_TurnOutOfRange_Clamped(t *testing.T) {
	db := openTempDB(t)
	row := makeSampleReplayRow("turnOOO")
	if err := db.Replay.SaveReplay(row); err != nil {
		t.Fatalf("SaveReplay: %v", err)
	}
	handler := handleGetReplaySemanticView(nil, db)
	// turn=99 越界（TotalTurns=2）→ clamp 到末帧
	in := GetReplaySemanticViewInput{ReplayID: "turnOOO", Turn: 99}
	_, out, err := handler(context.Background(), fakeCallToolRequest(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !out.Found {
		t.Fatalf("expected Found=true (clamped to final frame), err=%s", out.Error)
	}
	if !out.Clamped {
		t.Errorf("expected Clamped=true for out-of-range turn")
	}
	if out.OmniscientView == nil {
		t.Fatal("expected OmniscientView non-nil when clamped")
	}
	// clamp 到末帧：makeSampleReplayRow TotalTurns=2，末帧 Turn=2
	if out.OmniscientView.Turn != 2 {
		t.Errorf("expected clamped turn=2, got %d", out.OmniscientView.Turn)
	}
}

func TestGetReplaySemanticView_TurnZeroOK(t *testing.T) {
	db := openTempDB(t)
	row := makeSampleReplayRow("turn0")
	if err := db.Replay.SaveReplay(row); err != nil {
		t.Fatalf("SaveReplay: %v", err)
	}
	handler := handleGetReplaySemanticView(nil, db)
	// turn=0 = 初始状态
	in := GetReplaySemanticViewInput{ReplayID: "turn0", Turn: 0}
	_, out, err := handler(context.Background(), fakeCallToolRequest(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !out.Found {
		t.Fatalf("expected Found=true for turn 0, err=%s", out.Error)
	}
	if out.OmniscientView == nil {
		t.Fatal("expected OmniscientView non-nil when Found=true")
	}
	if out.OmniscientView.Turn != 0 {
		t.Errorf("expected OmniscientView.Turn=0, got %d", out.OmniscientView.Turn)
	}
	if out.OmniscientView.CurrentPlayerID != "p1" {
		t.Errorf("expected CurrentPlayerID=p1, got %s", out.OmniscientView.CurrentPlayerID)
	}
}

func TestGetReplaySemanticView_TurnOneOmniscient(t *testing.T) {
	db := openTempDB(t)
	row := makeSampleReplayRow("turn1")
	if err := db.Replay.SaveReplay(row); err != nil {
		t.Fatalf("SaveReplay: %v", err)
	}
	handler := handleGetReplaySemanticView(nil, db)
	in := GetReplaySemanticViewInput{ReplayID: "turn1", Turn: 1}
	_, out, err := handler(context.Background(), fakeCallToolRequest(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !out.Found {
		t.Fatalf("expected Found=true for turn 1, err=%s", out.Error)
	}
	v := out.OmniscientView
	if v == nil {
		t.Fatal("OmniscientView nil")
	}
	// 全知：2 玩家手牌都可见，p1 有 1 张，p2 有 1 张（miniState 简化为各 1）
	if len(v.Players) != 2 {
		t.Fatalf("players count got %d", len(v.Players))
	}
	if len(v.Players[1].Hand) != 1 {
		t.Errorf("p2 hand omniscient expected visible 1 card, got %d", len(v.Players[1].Hand))
	}
	if v.CurrentPlayerID != "p2" {
		t.Errorf("turn1 current player p2, got %s", v.CurrentPlayerID)
	}
	if v.GameMode != "classic" {
		t.Errorf("GameMode classic, got %s", v.GameMode)
	}
	// DrawPile
	if v.DrawPile.Count != 1 || len(v.DrawPile.CardNames) != 1 {
		t.Errorf("DrawPile expected count=1 + 1 name, got count=%d names=%d",
			v.DrawPile.Count, len(v.DrawPile.CardNames))
	}
}

// fakeCallToolRequest 构造一个最小可用的 *mcp.CallToolRequest（工具 handler 不使用它）。
func fakeCallToolRequest() *mcp.CallToolRequest {
	return &mcp.CallToolRequest{Params: &mcp.CallToolParamsRaw{}}
}
