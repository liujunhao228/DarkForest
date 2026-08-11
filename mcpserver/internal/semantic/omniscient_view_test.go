package semantic

import (
	"encoding/json"
	"testing"
)

// TestProjectOmniscient_CompileCheck 构造一个全量 GameState JSON 样本，
// 验证 ProjectOmniscient 编译通过且核心字段投影正确。
// GameState JSON 字段对齐 backend/internal/game/types.go:296 GameState struct。
func TestProjectOmniscient_CompileCheck(t *testing.T) {
	// 样本说明：
	// - 2 玩家：p1(Alice, 星系1, 能量5, 3手牌, 1张防御Lv2 faceUp)
	//          p2(Bob,   星系6, 能量3, 2手牌, 1张产能 faceUp)
	// - DrawPile: 3 张卡（"抽1"/"抽2"/"抽3"）
	// - DiscardPile: 1 张卡（"弃1"）
	// - FlyingStrikes：2 个
	//   sA: owner=p1, 从星系1→星系6(距离3), 打击名称"降维打击", level=4, speed=2,
	//       effect=nil → Threat=high（Lv4 降维）
	//   sB: owner=p2, 从星系6→星系1(距离3), 打击名称"科技锁死", level=4, speed=2,
	//       effect="discard_hand" → Threat=medium
	// - DestroyedStars: [5]
	// - StarEffects: 星系5 降维锁定（appliedAtTurn=8, duration=-1）
	// - CurrentPlayerID=p1, TotalTurn=8, Phase=playing, TurnPhase=actionPhase
	rawState := map[string]any{
		"phase":              "playing",
		"totalTurn":          8,
		"playerCount":        2,
		"currentPlayerIndex": 0,
		"currentPlayerId":    "p1",
		"localPlayerId":      "p1",
		"turnPhase":          "actionPhase",
		"gameMode":           "classic",
		"players": []any{
			map[string]any{
				"id":       "p1",
				"name":     "Alice",
				"color":    "red",
				"position": 1,
				"energy":   5,
				"hand": []any{
					map[string]any{"uid": "h1", "defId": "d_broadcast_1", "name": "广播协议", "type": "broadcast", "energy": 1, "range": 3},
					map[string]any{"uid": "h2", "defId": "d_strike_light", "name": "光粒打击", "type": "strike", "energy": 2, "level": 1, "speed": 2},
					map[string]any{"uid": "h3", "defId": "d_defense_1", "name": "基础防御", "type": "defense", "energy": 1, "protectionLevel": 1},
				},
				"faceUpCards": []any{
					map[string]any{"uid": "f1", "defId": "d_defense_2", "name": "防御基地", "type": "defense", "energy": 2, "protectionLevel": 2},
				},
				"eliminated": false,
			},
			map[string]any{
				"id":       "p2",
				"name":     "Bob",
				"color":    "blue",
				"position": 6,
				"energy":   3,
				"hand": []any{
					map[string]any{"uid": "h4", "defId": "d_facility_energy", "name": "能量塔", "type": "facility", "energy": 1, "energyPerTurn": 2},
					map[string]any{"uid": "h5", "defId": "d_strike_anni", "name": "湮灭打击", "type": "strike", "energy": 3, "level": 3, "speed": 1},
				},
				"faceUpCards": []any{
					map[string]any{"uid": "f2", "defId": "d_facility_energy_sm", "name": "小型电站", "type": "facility", "energy": 1, "energyPerTurn": 1},
				},
				"eliminated": false,
			},
		},
		"drawPile": []any{
			map[string]any{"uid": "d1", "defId": "dp1", "name": "抽1", "type": "strike", "energy": 1},
			map[string]any{"uid": "d2", "defId": "dp2", "name": "抽2", "type": "defense", "energy": 1},
			map[string]any{"uid": "d3", "defId": "dp3", "name": "抽3", "type": "broadcast", "energy": 1},
		},
		"discardPile": []any{
			map[string]any{"uid": "x1", "defId": "xp1", "name": "弃1", "type": "strike", "energy": 1},
		},
		"flyingStrikes": []any{
			map[string]any{
				"uid":            "sA",
				"defId":          "strike_dimensional",
				"ownerId":        "p1",
				"position":       1,
				"targetSystem":   6,
				"level":          4,
				"speed":          2,
				"remainingMoves": 3,
				"strikeName":     "降维打击",
				"arrived":        false,
			},
			map[string]any{
				"uid":            "sB",
				"defId":          "strike_tech_lock",
				"ownerId":        "p2",
				"position":       6,
				"targetSystem":   1,
				"level":          4,
				"speed":          2,
				"effect":         "discard_hand",
				"remainingMoves": 3,
				"strikeName":     "科技锁死",
				"arrived":        false,
			},
		},
		"destroyedStars": []int{5},
		"starEffects": []any{
			map[string]any{"systemId": 5, "type": "dimensionalLock", "appliedAtTurn": 8, "duration": -1, "sourceStrikeUid": "sA_prev"},
		},
		"logs": []any{
			map[string]any{"id": "l1", "turn": 8, "phase": "actionPhase", "type": "action", "message": "Alice 打出光粒打击"},
		},
	}
	rawJSON, err := json.Marshal(rawState)
	if err != nil {
		t.Fatalf("marshal rawGameState: %v", err)
	}

	view, err := ProjectOmniscient(rawJSON, "classic")
	if err != nil {
		t.Fatalf("ProjectOmniscient returned error: %v", err)
	}

	// 1. 玩家数
	if len(view.Players) != 2 {
		t.Fatalf("expected 2 players, got %d", len(view.Players))
	}
	// 2. 全知：p2 手牌可见（2 张）
	p2 := view.Players[1]
	if p2.ID != "p2" {
		t.Fatalf("players[1] expected p2, got %s", p2.ID)
	}
	if len(p2.Hand) != 2 {
		t.Errorf("p2.Hand expected 2 cards (omniscient, full hand visible), got %d", len(p2.Hand))
	}
	// 3. p1 Hand 3 张可见
	p1 := view.Players[0]
	if len(p1.Hand) != 3 {
		t.Errorf("p1.Hand expected 3 cards, got %d", len(p1.Hand))
	}
	// 4. DrawPile：3 张，Count=3
	if view.DrawPile.Count != 3 {
		t.Errorf("DrawPile.Count expected 3, got %d", view.DrawPile.Count)
	}
	if len(view.DrawPile.CardNames) != 3 {
		t.Errorf("DrawPile.CardNames expected 3 names, got %d", len(view.DrawPile.CardNames))
	}
	// 5. DiscardPile: 1 张
	if len(view.DiscardPile) != 1 {
		t.Errorf("DiscardPile expected 1, got %d", len(view.DiscardPile))
	}
	// 6. FlyingStrikes：2 个
	if len(view.FlyingStrikes) != 2 {
		t.Fatalf("FlyingStrikes expected 2, got %d", len(view.FlyingStrikes))
	}
	// 7. ETA：星系1→6 距离=3，speed=2 → ceil(3/2) = 2
	var sA *OmniscientStrike
	for i := range view.FlyingStrikes {
		if view.FlyingStrikes[i].UID == "sA" {
			sA = &view.FlyingStrikes[i]
			break
		}
	}
	if sA == nil {
		t.Fatalf("strike sA not found in FlyingStrikes")
	}
	if sA.ETATurns != 2 {
		t.Errorf("sA ETA expected 2 (ceil(3/2)), got %d", sA.ETATurns)
	}
	// 8. sA 威胁：Lv4 effect!=discard_hand → high。目标星系 6 上 p2 最高防御=1（faceUp f2 无 defense；p2 防御仅在手牌 h3 不算）。
	//    计算逻辑：computeThreatLevel 看 defense—— 对目标星系上所有玩家的 faceUpCards。
	//    p2 星系 6，faceUpCards: f2 是 facility(energyPerTurn=1)，maxProtection=0。
	//    Lv4 降维打击(非 discard_hand)直接 ThreatLevelHigh，与 maxProtection 无关。
	if sA.ThreatLevel != ThreatLevelHigh {
		t.Errorf("sA ThreatLevel expected %s, got %s", ThreatLevelHigh, sA.ThreatLevel)
	}
	// 9. sB：Lv4 effect=discard_hand → medium
	var sB *OmniscientStrike
	for i := range view.FlyingStrikes {
		if view.FlyingStrikes[i].UID == "sB" {
			sB = &view.FlyingStrikes[i]
			break
		}
	}
	if sB == nil {
		t.Fatalf("strike sB not found in FlyingStrikes")
	}
	if sB.ThreatLevel != ThreatLevelMedium {
		t.Errorf("sB ThreatLevel expected %s (Lv4 discard_hand), got %s", ThreatLevelMedium, sB.ThreatLevel)
	}
	if sB.ETATurns != 2 {
		t.Errorf("sB ETA expected 2, got %d", sB.ETATurns)
	}
	// 10. DestroyedStars
	if len(view.DestroyedStars) != 1 || view.DestroyedStars[0] != 5 {
		t.Errorf("DestroyedStars expected [5], got %v", view.DestroyedStars)
	}
	// 11. StarEffects
	if len(view.StarEffects) != 1 {
		t.Errorf("StarEffects expected 1, got %d", len(view.StarEffects))
	}
	// 12. Turn/Phase/CurrentPlayerID
	if view.Turn != 8 {
		t.Errorf("Turn expected 8, got %d", view.Turn)
	}
	if view.CurrentPlayerID != "p1" {
		t.Errorf("CurrentPlayerID expected p1, got %s", view.CurrentPlayerID)
	}
	// 13. GameMode
	if view.GameMode != "classic" {
		t.Errorf("GameMode expected classic, got %s", view.GameMode)
	}
	// 14. FaceUpCards 简化：p1.f1(防御Lv2) → role=defense, output=防御Lv.2
	if len(p1.FaceUpCards) != 1 {
		t.Fatalf("p1.FaceUpCards expected 1, got %d", len(p1.FaceUpCards))
	}
	if p1.FaceUpCards[0].Role != CardRoleDefense {
		t.Errorf("p1 faceUp role expected %s, got %s", CardRoleDefense, p1.FaceUpCards[0].Role)
	}
	if p1.FaceUpCards[0].Output != "防御Lv.2" {
		t.Errorf("p1 faceUp output expected 防御Lv.2, got %q", p1.FaceUpCards[0].Output)
	}
}

// TestProjectOmniscient_EliminationReason 验证全知投影透传淘汰原因：
// 已淘汰且带 eliminationReason 的玩家输出该原因；未淘汰玩家不输出（omitempty）。
func TestProjectOmniscient_EliminationReason(t *testing.T) {
	rawState := map[string]any{
		"phase":              "playing",
		"totalTurn":          5,
		"playerCount":        2,
		"currentPlayerIndex": 0,
		"currentPlayerId":    "p1",
		"turnPhase":          "actionPhase",
		"gameMode":           "classic",
		"players": []any{
			map[string]any{
				"id": "p1", "name": "Alice", "color": "red", "position": 1, "energy": 5,
				"hand":        []any{},
				"faceUpCards": []any{},
				"eliminated":  false,
			},
			map[string]any{
				"id": "p2", "name": "Bob", "color": "blue", "position": 6, "energy": 0,
				"hand":              []any{},
				"faceUpCards":       []any{},
				"eliminated":        true,
				"eliminatedTurn":    4,
				"eliminationReason": "timeout",
			},
		},
		"drawPile":       []any{},
		"discardPile":    []any{},
		"flyingStrikes":  []any{},
		"destroyedStars": []any{},
		"starEffects":    []any{},
	}

	raw, err := json.Marshal(rawState)
	if err != nil {
		t.Fatalf("marshal rawState failed: %v", err)
	}
	view, err := ProjectOmniscient(raw, "classic")
	if err != nil {
		t.Fatalf("ProjectOmniscient failed: %v", err)
	}
	if len(view.Players) != 2 {
		t.Fatalf("expected 2 players, got %d", len(view.Players))
	}
	byID := map[string]OmniscientPlayer{}
	for _, p := range view.Players {
		byID[p.ID] = p
	}
	if got := byID["p2"].EliminationReason; got != "timeout" {
		t.Errorf("p2 EliminationReason = %q, want %q", got, "timeout")
	}
	if !byID["p2"].Eliminated {
		t.Errorf("p2 Eliminated = false, want true")
	}
	if got := byID["p1"].EliminationReason; got != "" {
		t.Errorf("p1 EliminationReason = %q, want empty (未淘汰玩家)", got)
	}
}
