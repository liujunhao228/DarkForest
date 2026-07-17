package semantic

import (
	"encoding/json"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// TestProjectObject_CompileCheck 用手工构造的 ViewState 调用 ProjectObject，
// 验证编译通过且基本投影逻辑正确。这是 Phase A 的冒烟测试，
// 完整单测在后续 Task 统一补齐。
func TestProjectObject_CompileCheck(t *testing.T) {
	systemID := 7
	cardDefID := "d-action-1"
	state := &gamesdk.ViewState{
		Kind:               "view",
		Phase:              "playing",
		TotalTurn:          5,
		PlayerCount:        2,
		CurrentPlayerID:    "p1",
		CurrentPlayerIndex: 0,
		LocalPlayerID:      "p1",
		TurnPhase:          "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{
				ID:       "p1",
				Name:     "Alice",
				Color:    "red",
				Position: 3,
				Energy:   5,
				Hand: []gamesdk.Card{
					{UID: "h1", DefID: "d1", Name: "手牌卡", Type: "broadcast"},
				},
				FaceUpCards: []gamesdk.Card{
					{UID: "f1", DefID: "d2", Name: "防御站", Type: "defense", ProtectionLevel: 2},
					{UID: "f2", DefID: "d3", Name: "产能站", Type: "facility", EnergyPerTurn: 1},
				},
				Eliminated: false,
			},
			{
				ID:          "p2",
				Name:        "Bob",
				Color:       "blue",
				Position:    -1,
				Energy:      3,
				HandCount:   4,
				FaceUpCards: []gamesdk.Card{
					{UID: "f3", DefID: "d4", Name: "监听基地", Type: "facility", Ability: "detect_broadcast"},
				},
				Eliminated: false,
			},
		},
		DestroyedStars: []int{7},
		Logs: []gamesdk.LogEntry{
			{
				ID:        "l1",
				Turn:      5,
				Phase:     "actionPhase",
				Type:      "action",
				Message:   "Alice 出牌",
				SystemID:  &systemID,
				CardDefID: &cardDefID,
				PlayerIDs: []string{"p1", "p2"},
			},
		},
	}

	view := ProjectObject(state, "p1", "classic")

	// GameMode 透传
	if view.GameMode != "classic" {
		t.Errorf("GameMode = %q, want %q", view.GameMode, "classic")
	}
	// Self 基本字段
	if view.Self.ID != "p1" {
		t.Errorf("Self.ID = %q, want %q", view.Self.ID, "p1")
	}
	if view.Self.Position != 3 {
		t.Errorf("Self.Position = %d, want 3", view.Self.Position)
	}
	// 无广播历史 → PositionIsPublic 应为 false
	if view.Self.PositionIsPublic {
		t.Errorf("Self.PositionIsPublic = true, want false (no broadcast history)")
	}
	// FaceUpCards 按 role 分类
	if len(view.Self.FaceUpCards) != 2 {
		t.Fatalf("Self.FaceUpCards len = %d, want 2", len(view.Self.FaceUpCards))
	}
	if view.Self.FaceUpCards[0].Role != CardRoleDefense {
		t.Errorf("Self.FaceUpCards[0].Role = %q, want %q", view.Self.FaceUpCards[0].Role, CardRoleDefense)
	}
	if view.Self.FaceUpCards[0].Output != "防御Lv.2" {
		t.Errorf("Self.FaceUpCards[0].Output = %q, want %q", view.Self.FaceUpCards[0].Output, "防御Lv.2")
	}
	if view.Self.FaceUpCards[1].Role != CardRoleEnergy {
		t.Errorf("Self.FaceUpCards[1].Role = %q, want %q", view.Self.FaceUpCards[1].Role, CardRoleEnergy)
	}
	if view.Self.FaceUpCards[1].Output != "+1能量/回合" {
		t.Errorf("Self.FaceUpCards[1].Output = %q, want %q", view.Self.FaceUpCards[1].Output, "+1能量/回合")
	}

	// Foes
	if len(view.Foes) != 1 {
		t.Fatalf("Foes len = %d, want 1", len(view.Foes))
	}
	foe := view.Foes[0]
	if foe.ID != "p2" {
		t.Errorf("Foe.ID = %q, want %q", foe.ID, "p2")
	}
	if foe.HandCount != 4 {
		t.Errorf("Foe.HandCount = %d, want 4", foe.HandCount)
	}
	// Position == -1 → PositionUnknown
	pos, ok := foe.Position.(PositionUnknown)
	if !ok {
		t.Fatalf("Foe.Position type = %T, want PositionUnknown", foe.Position)
	}
	if pos.Known {
		t.Errorf("Foe.Position.Known = true, want false")
	}
	if pos.Hint == "" {
		t.Errorf("Foe.Position.Hint is empty")
	}
	// 对手设施牌 Ability=detect_broadcast → utility / 监听基地
	if len(foe.FaceUpCards) != 1 {
		t.Fatalf("Foe.FaceUpCards len = %d, want 1", len(foe.FaceUpCards))
	}
	if foe.FaceUpCards[0].Role != CardRoleUtility {
		t.Errorf("Foe.FaceUpCards[0].Role = %q, want %q", foe.FaceUpCards[0].Role, CardRoleUtility)
	}
	if foe.FaceUpCards[0].Output != "监听基地" {
		t.Errorf("Foe.FaceUpCards[0].Output = %q, want %q", foe.FaceUpCards[0].Output, "监听基地")
	}

	// Field
	if len(view.Field.DestroyedStars) != 1 || view.Field.DestroyedStars[0] != 7 {
		t.Errorf("Field.DestroyedStars = %v, want [7]", view.Field.DestroyedStars)
	}

	// Cursor
	if !view.Cursor.IsMyTurn {
		t.Errorf("Cursor.IsMyTurn = false, want true")
	}
	if view.Cursor.TotalTurn != 5 {
		t.Errorf("Cursor.TotalTurn = %d, want 5", view.Cursor.TotalTurn)
	}
	if view.Cursor.TurnPhase != "actionPhase" {
		t.Errorf("Cursor.TurnPhase = %q, want %q", view.Cursor.TurnPhase, "actionPhase")
	}

	// Events：基础字段 + 可选字段透传
	if len(view.Events.Entries) != 1 {
		t.Fatalf("Events.Entries len = %d, want 1", len(view.Events.Entries))
	}
	entry := view.Events.Entries[0]
	if entry.Turn != 5 {
		t.Errorf("Events.Entries[0].Turn = %d, want 5", entry.Turn)
	}
	if entry.SystemID == nil || *entry.SystemID != 7 {
		t.Errorf("Events.Entries[0].SystemID = %v, want 7", entry.SystemID)
	}
	if entry.CardDefID == nil || *entry.CardDefID != "d-action-1" {
		t.Errorf("Events.Entries[0].CardDefID = %v, want d-action-1", entry.CardDefID)
	}
	if len(entry.PlayerIDs) != 2 || entry.PlayerIDs[0] != "p1" || entry.PlayerIDs[1] != "p2" {
		t.Errorf("Events.Entries[0].PlayerIDs = %v, want [p1 p2]", entry.PlayerIDs)
	}

	// JSON 序列化冒烟测试（验证 FoePosition 接口能正确序列化为 tagged union）
	data, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	t.Logf("AgentView JSON: %s", data)
}

// TestProjectObject_KnownFoePosition 验证 PositionKnown 的派生字段
// （DistanceFromMe / ReachableInOneJump）。
// self@5 / foe@6：5-6 在后端邻接表中直接相连，distance=1, adjacent=true。
func TestProjectObject_KnownFoePosition(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		TotalTurn:       3,
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Color: "red", Position: 5, Energy: 5},
			{ID: "p2", Name: "Bob", Color: "blue", Position: 6, Energy: 3, HandCount: 2},
		},
	}

	view := ProjectObject(state, "p1", "classic")
	foe := view.Foes[0]
	pos, ok := foe.Position.(PositionKnown)
	if !ok {
		t.Fatalf("Foe.Position type = %T, want PositionKnown", foe.Position)
	}
	if !pos.Known {
		t.Errorf("Position.Known = false, want true")
	}
	if pos.System != 6 {
		t.Errorf("Position.System = %d, want 6", pos.System)
	}
	if pos.DistanceFromMe != 1 {
		t.Errorf("Position.DistanceFromMe = %d, want 1", pos.DistanceFromMe)
	}
	if !pos.ReachableInOneJump {
		t.Errorf("Position.ReachableInOneJump = false, want true")
	}
}

// TestProjectObject_RealStarmapDistance 验证 DistanceFromMe 使用真实 BFS 星图距离，
// 而非系统编号差的近似。
//
// 后端邻接表（e:\DarkForest\backend\internal\game\starmap.go:17-32）中 1-3 直接相连：
//   {From: 1, To: 3} —— 故 BFS 距离 = 1，但系统编号差 |3-1| = 2。
// 旧实现（absInt 差值）会得到 2，新实现（GetDistance）应得到 1。
func TestProjectObject_RealStarmapDistance(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:           "playing",
		TotalTurn:       3,
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Color: "red", Position: 1, Energy: 5},
			{ID: "p2", Name: "Bob", Color: "blue", Position: 3, Energy: 3, HandCount: 2},
		},
	}

	// 先直接断言底层星图：1→3 的真实 BFS 距离应为 1（邻接），不是编号差 2。
	if got := GetDistance(1, 3); got != 1 {
		t.Fatalf("starmap GetDistance(1,3) = %d, want 1 (1-3 are directly adjacent)", got)
	}
	if !AreAdjacent(1, 3) {
		t.Fatalf("starmap AreAdjacent(1,3) = false, want true")
	}

	view := ProjectObject(state, "p1", "classic")
	foe := view.Foes[0]
	pos, ok := foe.Position.(PositionKnown)
	if !ok {
		t.Fatalf("Foe.Position type = %T, want PositionKnown", foe.Position)
	}
	if pos.System != 3 {
		t.Errorf("Position.System = %d, want 3", pos.System)
	}
	// 关键断言：真实距离=1，而非编号差|3-1|=2
	if pos.DistanceFromMe != 1 {
		t.Errorf("Position.DistanceFromMe = %d, want 1 (real BFS distance, not |3-1|=2)", pos.DistanceFromMe)
	}
	if !pos.ReachableInOneJump {
		t.Errorf("Position.ReachableInOneJump = false, want true (1-3 adjacent in starmap)")
	}
}

// TestProjectObject_NilState 验证 nil ViewState 返回零值 AgentView。
func TestProjectObject_NilState(t *testing.T) {
	view := ProjectObject(nil, "p1", "classic")
	if view.Self.ID != "" {
		t.Errorf("Self.ID = %q, want empty", view.Self.ID)
	}
	if len(view.Foes) != 0 {
		t.Errorf("Foes len = %d, want 0", len(view.Foes))
	}
}
