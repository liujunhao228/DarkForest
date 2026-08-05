package rooms

import (
	"log/slog"
	"testing"
	"time"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
	"github.com/google/uuid"
)

// TestRoomManager_LoadMapForRoom_NilRoom 测试 r=nil 时 loadMapForRoom 返回 nil。
func TestRoomManager_LoadMapForRoom_NilRoom(t *testing.T) {
	rm := newTestRoomManager()
	if ms := rm.loadMapForRoom(nil); ms != nil {
		t.Errorf("loadMapForRoom(nil) = %v, want nil", ms)
	}
}

// TestRoomManager_LoadMapForRoom_NilMapID 测试 r.MapID=nil 时 loadMapForRoom 返回 nil。
// 这是快匹配路径与未设置 MapID 的自定义房间的行为（NewGame 回落 DefaultMapState）。
func TestRoomManager_LoadMapForRoom_NilMapID(t *testing.T) {
	rm := newTestRoomManager()
	room := rm.GetOrCreateRoom("test-nil-mapid", 3)
	// room.MapID 默认为 nil
	if ms := rm.loadMapForRoom(room); ms != nil {
		t.Errorf("loadMapForRoom with nil MapID = %v, want nil", ms)
	}
}

// TestRoomManager_LoadMapForRoom_NilMapService 测试 r.MapID 非 nil 但 mapService 未注入时
// loadMapForRoom 返回 nil（打印 warning 并回落 DefaultMapState，保证对局仍能开局）。
func TestRoomManager_LoadMapForRoom_NilMapService(t *testing.T) {
	rm := newTestRoomManager()
	room := rm.GetOrCreateRoom("test-nil-mapservice", 3)
	mapID := uuid.New()
	room.MapID = &mapID
	// rm.mapService 默认为 nil
	if ms := rm.loadMapForRoom(room); ms != nil {
		t.Errorf("loadMapForRoom with nil mapService = %v, want nil (fallback)", ms)
	}
}

// TestRoomManager_LoadMapForRoom_DefaultMapFallback 测试完整 StartGameInRoomWithMatchInfo 流程：
// room.MapID=nil → loadMapForRoom 返回 nil → StartGame → NewGame 回落 DefaultMapState
// → state.Map.Nodes 长度 = 9（DefaultMapState 节点数）。
func TestRoomManager_LoadMapForRoom_DefaultMapFallback(t *testing.T) {
	withShortTurnTimeout(t, 500*time.Millisecond)
	rm := newTestRoomManager()
	roomID := "test-default-fallback"
	room := rm.GetOrCreateRoom(roomID, 3)
	for _, pid := range []string{"p1", "p2", "p3"} {
		room.AddPlayer(&hub.PlayerInfo{ID: pid, DisplayName: pid, Role: "player"})
	}
	t.Cleanup(func() { room.StopTimers() })

	// room.MapID 为 nil（默认），loadMapForRoom 返回 nil
	gs, err := rm.StartGameInRoomWithMatchInfo(roomID, "", "test")
	if err != nil {
		t.Fatalf("StartGameInRoomWithMatchInfo failed: %v", err)
	}

	if gs.Map == nil {
		t.Fatal("gs.Map 不应为 nil（NewGame 应 SetMap DefaultMapState）")
	}
	if got, want := len(gs.Map.Nodes), len(game.DefaultMapState.Nodes); got != want {
		t.Errorf("gs.Map.Nodes 长度 = %d, 期望 %d（DefaultMapState 回落）", got, want)
	}
	if gs.MapSnapshot == nil {
		t.Fatal("gs.MapSnapshot 不应为 nil")
	}
	if got, want := len(gs.MapSnapshot.Nodes), len(game.DefaultMapState.Nodes); got != want {
		t.Errorf("gs.MapSnapshot.Nodes 长度 = %d, 期望 %d", got, want)
	}
}

// TestRoomManager_LoadMapForRoom_CustomMapViaCache 测试 room.MapState 缓存被 StartGame 正确使用：
// 手动设置 room.MapState 为 3 节点自定义地图 → StartGame → state.Map.Nodes 长度 = 3。
// 此测试不经过 loadMapForRoom（直接设置缓存），验证 StartGame 与 InitConfig.Map 的契约。
// loadMapForRoom → LoadMapByID 的端到端链路由 Step 21 集成测试覆盖。
func TestRoomManager_LoadMapForRoom_CustomMapViaCache(t *testing.T) {
	withShortTurnTimeout(t, 500*time.Millisecond)

	// 构造 3 节点 2 边的自定义地图（节点 ID 用 100/101/102 避免与 DefaultMapState 冲突）
	customNodes := []game.StarNode{
		{ID: 100, X: 10, Y: 10, Name: "自定义星系 A", Size: "md", Tint: "#6366f1"},
		{ID: 101, X: 50, Y: 10, Name: "自定义星系 B", Size: "md", Tint: "#0ea5e9"},
		{ID: 102, X: 50, Y: 50, Name: "自定义星系 C", Size: "md", Tint: "#14b8a6"},
	}
	customEdges := []game.StarEdge{
		{From: 100, To: 101},
		{From: 101, To: 102},
	}
	customMap := game.NewMapState(customNodes, customEdges)

	room := NewRoom(
		"test-custom-map-cache",
		3,
		func(roomID string, msg hub.Message) {}, // no-op broadcast
		func(playerID string, msg hub.Message) {}, // no-op sendToPlayer
		nil,           // replayService
		slog.Default(),
		nil, // onGameFinish
	)
	for _, pid := range []string{"p1", "p2", "p3"} {
		room.AddPlayer(&hub.PlayerInfo{ID: pid, DisplayName: pid, Role: "player"})
	}
	// 手动设置 MapState 缓存（模拟 RoomManager.loadMapForRoom 成功后的结果）
	room.SetMapState(customMap)
	t.Cleanup(func() { room.StopTimers() })

	if !room.StartGame("test", "") {
		t.Fatal("StartGame failed")
	}

	gs := room.GameState
	if gs == nil {
		t.Fatal("GameState 不应为 nil")
	}
	if gs.Map == nil {
		t.Fatal("gs.Map 不应为 nil")
	}
	if got, want := len(gs.Map.Nodes), 3; got != want {
		t.Errorf("gs.Map.Nodes 长度 = %d, 期望 %d（自定义地图）", got, want)
	}
	if got, dontWant := len(gs.Map.Nodes), len(game.DefaultMapState.Nodes); got == dontWant {
		t.Errorf("gs.Map.Nodes 长度 = %d 等于 DefaultMapState 节点数，说明未使用自定义地图缓存", got)
	}
	// 验证 MapSnapshot 也同步填充且反映自定义地图
	if gs.MapSnapshot == nil {
		t.Fatal("gs.MapSnapshot 不应为 nil")
	}
	if got, want := len(gs.MapSnapshot.Nodes), 3; got != want {
		t.Errorf("gs.MapSnapshot.Nodes 长度 = %d, 期望 %d", got, want)
	}
	if got, want := len(gs.MapSnapshot.Edges), 2; got != want {
		t.Errorf("gs.MapSnapshot.Edges 长度 = %d, 期望 %d", got, want)
	}
}
