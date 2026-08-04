package game

import (
	"reflect"
	"testing"
)

// TestNewMapState_DefaultMap 验证 DefaultMapState 的默认地图拓扑正确构建：
// 9 节点、14 边、邻接表填充正确。
func TestNewMapState_DefaultMap(t *testing.T) {
	m := DefaultMapState
	if m == nil {
		t.Fatal("DefaultMapState 不应为 nil")
	}
	if len(m.Nodes) != 9 {
		t.Fatalf("Nodes 长度 = %d, 期望 9", len(m.Nodes))
	}
	if len(m.Edges) != 14 {
		t.Fatalf("Edges 长度 = %d, 期望 14", len(m.Edges))
	}
	if len(m.Adjacency) != 9 {
		t.Fatalf("Adjacency 长度 = %d, 期望 9", len(m.Adjacency))
	}
	// 抽样校验邻接表：节点 1 应与 {2,3} 相邻
	if got := m.Adjacency[1]; !reflect.DeepEqual(got, []int{2, 3}) {
		t.Errorf("Adjacency[1] = %v, 期望 [2 3]", got)
	}
	// 节点 5 居中，应与 {3,4,6,7} 相邻
	if got := m.Adjacency[5]; !reflect.DeepEqual(got, []int{3, 4, 6, 7}) {
		t.Errorf("Adjacency[5] = %v, 期望 [3 4 6 7]", got)
	}
	// 节点 9 仅与 8 相邻（叶子节点）
	if got := m.Adjacency[9]; !reflect.DeepEqual(got, []int{8}) {
		t.Errorf("Adjacency[9] = %v, 期望 [8]", got)
	}
}

// TestMapState_GetDistance 覆盖相邻、跨图、同节点三种情况。
func TestMapState_GetDistance(t *testing.T) {
	m := DefaultMapState
	cases := []struct {
		name string
		from int
		to   int
		want int
	}{
		{"相邻节点 1-2", 1, 2, 1},
		{"跨图 1-9", 1, 9, 5},
		{"同节点 5-5", 5, 5, 0},
		{"反向 9-1", 9, 1, 5},
		{"越界节点 0", 0, 1, unreachableDistance},
		{"越界节点 100", 1, 100, unreachableDistance},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := m.GetDistance(c.from, c.to); got != c.want {
				t.Errorf("GetDistance(%d, %d) = %d, 期望 %d", c.from, c.to, got, c.want)
			}
		})
	}
}

// TestMapState_GetSystemsInRange 覆盖 range=0/1/2。
func TestMapState_GetSystemsInRange(t *testing.T) {
	m := DefaultMapState
	cases := []struct {
		name    string
		center  int
		rangeIn int
		want    []int
	}{
		{"节点 5 range=0", 5, 0, nil},
		{"节点 5 range=1", 5, 1, []int{3, 4, 6, 7}},
		{"节点 5 range=2", 5, 2, []int{1, 2, 3, 4, 6, 7, 8}},
		{"节点 9 range=1", 9, 1, []int{8}},
		{"越界 center=100 range=1", 100, 1, nil},
		{"负 range", 5, -1, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := m.GetSystemsInRange(c.center, c.rangeIn)
			if c.want == nil {
				if got != nil {
					t.Errorf("GetSystemsInRange(%d, %d) = %v, 期望 nil", c.center, c.rangeIn, got)
				}
				return
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("GetSystemsInRange(%d, %d) = %v, 期望 %v", c.center, c.rangeIn, got, c.want)
			}
		})
	}
}

// TestMapState_AreAdjacent 覆盖相邻/不相邻/越界。
func TestMapState_AreAdjacent(t *testing.T) {
	m := DefaultMapState
	cases := []struct {
		a, b int
		want bool
	}{
		{1, 2, true},
		{2, 1, true}, // 无向边对称
		{1, 9, false},
		{5, 3, true},
		{9, 8, true},
		{0, 1, false}, // 越界
	}
	for _, c := range cases {
		if got := m.AreAdjacent(c.a, c.b); got != c.want {
			t.Errorf("AreAdjacent(%d, %d) = %v, 期望 %v", c.a, c.b, got, c.want)
		}
	}
}

// TestMapState_GetShortestPath 覆盖直连、多跳、同节点、不可达。
func TestMapState_GetShortestPath(t *testing.T) {
	m := DefaultMapState
	cases := []struct {
		name string
		from int
		to   int
		want []int
	}{
		{"直连 1-2", 1, 2, []int{1, 2}},
		{"多跳 1-9", 1, 9, []int{1, 2, 4, 6, 8, 9}},
		{"同节点 5-5", 5, 5, []int{5}},
		{"反向 9-1", 9, 1, []int{9, 8, 6, 4, 2, 1}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := m.GetShortestPath(c.from, c.to)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("GetShortestPath(%d, %d) = %v, 期望 %v", c.from, c.to, got, c.want)
			}
		})
	}
}

// TestMapState_GetShortestPath_Unreachable 验证不连通图返回空数组。
func TestMapState_GetShortestPath_Unreachable(t *testing.T) {
	// 构造不连通图：组件 A={1,2}, 组件 B={3,4}
	m := NewMapState(
		[]StarNode{{ID: 1}, {ID: 2}, {ID: 3}, {ID: 4}},
		[]StarEdge{{From: 1, To: 2}, {From: 3, To: 4}},
	)
	if got := m.GetShortestPath(1, 3); got != nil {
		t.Errorf("不连通图 GetShortestPath(1, 3) = %v, 期望 nil", got)
	}
	if got := m.GetDistance(1, 3); got != unreachableDistance {
		t.Errorf("不连通图 GetDistance(1, 3) = %d, 期望 %d", got, unreachableDistance)
	}
}

// TestMapState_NodeIDs 验证返回升序节点 ID 列表。
func TestMapState_NodeIDs(t *testing.T) {
	m := DefaultMapState
	want := []int{1, 2, 3, 4, 5, 6, 7, 8, 9}
	if got := m.NodeIDs(); !reflect.DeepEqual(got, want) {
		t.Errorf("NodeIDs() = %v, 期望 %v", got, want)
	}
}

// TestMapState_NodeByID 覆盖存在与不存在两种情况。
func TestMapState_NodeByID(t *testing.T) {
	m := DefaultMapState
	// 存在
	node, ok := m.NodeByID(5)
	if !ok {
		t.Fatal("NodeByID(5) ok=false, 期望 true")
	}
	if node.ID != 5 || node.Name != "星系 5" || node.Size != "lg" || node.Tint != "#a855f7" {
		t.Errorf("NodeByID(5) = %+v, 期望 ID=5 Name=星系 5 Size=lg Tint=#a855f7", node)
	}
	// 不存在
	_, ok = m.NodeByID(100)
	if ok {
		t.Error("NodeByID(100) ok=true, 期望 false")
	}
}

// TestMapState_DisconnectedGraph 构造不连通图验证哨兵 unreachableDistance。
func TestMapState_DisconnectedGraph(t *testing.T) {
	m := NewMapState(
		[]StarNode{{ID: 1}, {ID: 2}, {ID: 3}},
		[]StarEdge{{From: 1, To: 2}}, // 节点 3 孤立
	)
	if got := m.GetDistance(1, 3); got != unreachableDistance {
		t.Errorf("不连通图 GetDistance(1, 3) = %d, 期望 %d", got, unreachableDistance)
	}
	if got := m.GetDistance(2, 3); got != unreachableDistance {
		t.Errorf("不连通图 GetDistance(2, 3) = %d, 期望 %d", got, unreachableDistance)
	}
	// 但 1-2 仍相邻
	if got := m.GetDistance(1, 2); got != 1 {
		t.Errorf("连通部分 GetDistance(1, 2) = %d, 期望 1", got)
	}
	// NodeIDs 应包含所有 3 个节点
	if got := m.NodeIDs(); !reflect.DeepEqual(got, []int{1, 2, 3}) {
		t.Errorf("NodeIDs() = %v, 期望 [1 2 3]", got)
	}
}

// TestMapState_NilReceiver 验证 nil 接收者安全返回零值，避免 panic。
// 这是对游戏引擎健壮性的额外保障，调用方在 Map 尚未注入时不会崩溃。
func TestMapState_NilReceiver(t *testing.T) {
	var m *MapState // nil
	if got := m.GetDistance(1, 2); got != unreachableDistance {
		t.Errorf("nil.GetDistance = %d, 期望 %d", got, unreachableDistance)
	}
	if got := m.GetSystemsInRange(1, 1); got != nil {
		t.Errorf("nil.GetSystemsInRange = %v, 期望 nil", got)
	}
	if m.AreAdjacent(1, 2) {
		t.Error("nil.AreAdjacent = true, 期望 false")
	}
	if got := m.GetShortestPath(1, 2); got != nil {
		t.Errorf("nil.GetShortestPath = %v, 期望 nil", got)
	}
	if got := m.NodeIDs(); got != nil {
		t.Errorf("nil.NodeIDs = %v, 期望 nil", got)
	}
	if _, ok := m.NodeByID(1); ok {
		t.Error("nil.NodeByID ok=true, 期望 false")
	}
}
