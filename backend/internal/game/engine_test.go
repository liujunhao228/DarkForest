package game

import (
	"sort"
	"testing"
)

// TestNewGame_DefaultMap_NilConfigMap 验证 InitConfig.Map 为 nil 时 NewGame 回落 DefaultMapState：
// state.Map 非 nil 且节点数 = 9；MapSnapshot 同步填充且节点数一致；
// 所有玩家位置都来自 DefaultMapState.NodeIDs()。
func TestNewGame_DefaultMap_NilConfigMap(t *testing.T) {
	config := InitConfig{
		PlayerCount: 4,
		PlayerSeeds: []PlayerSeed{
			{ID: "p1", Name: "Player 1"},
			{ID: "p2", Name: "Player 2"},
			{ID: "p3", Name: "Player 3"},
			{ID: "p4", Name: "Player 4"},
		},
		GameMode: GameModeClassic,
		// Map 字段刻意留 nil：期望 NewGame 用 DefaultMapState
	}

	state := NewGame(config)

	if state == nil {
		t.Fatal("NewGame 返回 nil state")
	}

	// state.Map 必须非 nil 且与 DefaultMapState 节点数一致
	if state.Map == nil {
		t.Fatal("state.Map 不应为 nil（NewGame 应 SetMap DefaultMapState）")
	}
	if got, want := len(state.Map.Nodes), len(DefaultMapState.Nodes); got != want {
		t.Errorf("state.Map.Nodes 长度 = %d, 期望 %d（DefaultMapState）", got, want)
	}

	// MapSnapshot 必须同步填充
	if state.MapSnapshot == nil {
		t.Fatal("state.MapSnapshot 不应为 nil（SetMap 应同时填充快照）")
	}
	if got, want := len(state.MapSnapshot.Nodes), len(DefaultMapState.Nodes); got != want {
		t.Errorf("state.MapSnapshot.Nodes 长度 = %d, 期望 %d", got, want)
	}
	if got, want := len(state.MapSnapshot.Edges), len(DefaultMapState.Edges); got != want {
		t.Errorf("state.MapSnapshot.Edges 长度 = %d, 期望 %d", got, want)
	}

	// 验证玩家位置全部来自 DefaultMapState.NodeIDs()
	validIDs := make(map[int]struct{}, len(DefaultMapState.Nodes))
	for _, n := range DefaultMapState.Nodes {
		validIDs[n.ID] = struct{}{}
	}
	for i, p := range state.Players {
		if _, ok := validIDs[p.Position]; !ok {
			t.Errorf("Players[%d].Position = %d 不在 DefaultMapState.NodeIDs() 中", i, p.Position)
		}
	}

	// 验证玩家位置互不重复（Shuffle 后取前 PlayerCount 个，应唯一）
	seen := make(map[int]struct{}, len(state.Players))
	for i, p := range state.Players {
		if _, dup := seen[p.Position]; dup {
			t.Errorf("Players[%d].Position = %d 与前序玩家位置重复", i, p.Position)
		}
		seen[p.Position] = struct{}{}
	}
}

// TestNewGame_CustomMap_FromConfig 验证 InitConfig.Map 非 nil 时 NewGame 使用自定义地图：
// state.Map.Nodes 长度 = 3（不是 9）；MapSnapshot.Nodes 长度 = 3；
// positions 长度 = PlayerCount 且每个 position ∈ state.Map.NodeIDs()。
func TestNewGame_CustomMap_FromConfig(t *testing.T) {
	// 构造 3 节点 2 边的自定义地图（用 100/101/102 避免与 DefaultMapState 节点 ID 冲突）
	customNodes := []StarNode{
		{ID: 100, X: 10, Y: 10, Name: "自定义星系 A", Size: "md", Tint: "#6366f1"},
		{ID: 101, X: 50, Y: 10, Name: "自定义星系 B", Size: "md", Tint: "#0ea5e9"},
		{ID: 102, X: 50, Y: 50, Name: "自定义星系 C", Size: "md", Tint: "#14b8a6"},
	}
	customEdges := []StarEdge{
		{From: 100, To: 101},
		{From: 101, To: 102},
	}
	customMap := NewMapState(customNodes, customEdges)

	if got := len(customMap.Nodes); got != 3 {
		t.Fatalf("测试前置：customMap.Nodes 长度 = %d, 期望 3", got)
	}

	config := InitConfig{
		PlayerCount: 3,
		PlayerSeeds: []PlayerSeed{
			{ID: "p1", Name: "Player 1"},
			{ID: "p2", Name: "Player 2"},
			{ID: "p3", Name: "Player 3"},
		},
		GameMode: GameModeClassic,
		Map:      customMap,
	}

	state := NewGame(config)

	if state == nil {
		t.Fatal("NewGame 返回 nil state")
	}

	// state.Map 必须非 nil 且为自定义地图（节点数 3，不是 9）
	if state.Map == nil {
		t.Fatal("state.Map 不应为 nil（NewGame 应 SetMap 自定义地图）")
	}
	if got, want := len(state.Map.Nodes), 3; got != want {
		t.Errorf("state.Map.Nodes 长度 = %d, 期望 %d（自定义地图）", got, want)
	}
	if got, dontWant := len(state.Map.Nodes), len(DefaultMapState.Nodes); got == dontWant {
		t.Errorf("state.Map.Nodes 长度 = %d 等于 DefaultMapState 节点数，说明未使用自定义地图", got)
	}

	// MapSnapshot 必须同步填充且反映自定义地图
	if state.MapSnapshot == nil {
		t.Fatal("state.MapSnapshot 不应为 nil（SetMap 应同时填充快照）")
	}
	if got, want := len(state.MapSnapshot.Nodes), 3; got != want {
		t.Errorf("state.MapSnapshot.Nodes 长度 = %d, 期望 %d", got, want)
	}
	if got, want := len(state.MapSnapshot.Edges), 2; got != want {
		t.Errorf("state.MapSnapshot.Edges 长度 = %d, 期望 %d", got, want)
	}

	// positions 长度 = PlayerCount
	if got, want := len(state.Players), config.PlayerCount; got != want {
		t.Fatalf("Players 长度 = %d, 期望 %d", got, want)
	}

	// 每个玩家位置必须在自定义地图的 NodeIDs 中
	validIDs := make(map[int]struct{}, len(customNodes))
	for _, n := range customNodes {
		validIDs[n.ID] = struct{}{}
	}
	for i, p := range state.Players {
		if _, ok := validIDs[p.Position]; !ok {
			t.Errorf("Players[%d].Position = %d 不在自定义地图 NodeIDs() 中", i, p.Position)
		}
	}

	// 玩家位置互不重复
	seen := make(map[int]struct{}, len(state.Players))
	for i, p := range state.Players {
		if _, dup := seen[p.Position]; dup {
			t.Errorf("Players[%d].Position = %d 与前序玩家位置重复", i, p.Position)
		}
		seen[p.Position] = struct{}{}
	}

	// 验证 GetMap() 返回的也是自定义地图（确认 SetMap 把 Map 字段直接指向 customMap）
	if got := state.GetMap(); got == nil {
		t.Fatal("state.GetMap() 不应返回 nil")
	} else if gotLen := len(got.Nodes); gotLen != 3 {
		t.Errorf("state.GetMap().Nodes 长度 = %d, 期望 3", gotLen)
	}

	// 防御性：state.Map.NodeIDs() 排序后应为 [100, 101, 102]
	gotIDs := state.Map.NodeIDs()
	wantIDs := []int{100, 101, 102}
	if !sortIntsEqual(gotIDs, wantIDs) {
		t.Errorf("state.Map.NodeIDs() = %v, 期望 %v", gotIDs, wantIDs)
	}
}

// sortIntsEqual 比较两个 int 切片是否相等（已排序）。
func sortIntsEqual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	aCopy := append([]int(nil), a...)
	bCopy := append([]int(nil), b...)
	sort.Ints(aCopy)
	sort.Ints(bCopy)
	for i := range aCopy {
		if aCopy[i] != bCopy[i] {
			return false
		}
	}
	return true
}
