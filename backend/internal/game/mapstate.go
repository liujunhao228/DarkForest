package game

import "sort"

// unreachableDistance 表示 BFS 未连通时的距离哨兵值。
// 与旧 computeDistance 行为一致（返回 1000000）。
const unreachableDistance = 1000000

// MapState 是单张地图的引擎状态：节点、边、邻接表与预计算的最短距离缓存。
//
// 重构自旧包级全局 StarNodes / StarEdges / Adjacency / distanceCache。
// 对局实例通过 GameState.Map 持有 *MapState；引擎调用方使用 state.Map.GetDistance(...)
// 等方法替代旧的包级 GetDistance(...) 函数。
type MapState struct {
	Nodes         []StarNode
	Edges         []StarEdge
	Adjacency     map[int][]int
	DistanceCache map[int]map[int]int
}

// NewMapState 从节点与边构造 MapState：构建邻接表（去重+排序）并预计算所有节点对的最短距离。
// nodes 必须非空；edges 中出现但 nodes 中不存在的 ID 仍会被纳入邻接表（与旧 init 行为一致）。
func NewMapState(nodes []StarNode, edges []StarEdge) *MapState {
	adjacency := make(map[int][]int)
	distanceCache := make(map[int]map[int]int)

	// 先为每个节点初始化空切片与距离缓存
	for _, n := range nodes {
		if _, ok := adjacency[n.ID]; !ok {
			adjacency[n.ID] = []int{}
		}
		if _, ok := distanceCache[n.ID]; !ok {
			distanceCache[n.ID] = make(map[int]int)
		}
	}

	// 由边填充邻接表（无向，去重）
	for _, e := range edges {
		if _, ok := adjacency[e.From]; !ok {
			adjacency[e.From] = []int{}
		}
		if _, ok := adjacency[e.To]; !ok {
			adjacency[e.To] = []int{}
		}
		if !containsInt(adjacency[e.From], e.To) {
			adjacency[e.From] = append(adjacency[e.From], e.To)
		}
		if !containsInt(adjacency[e.To], e.From) {
			adjacency[e.To] = append(adjacency[e.To], e.From)
		}
	}

	// 排序邻接表，保证遍历顺序确定（与旧 init 一致）
	for key := range adjacency {
		sort.Ints(adjacency[key])
	}

	// 为每个节点补全距离缓存（含未在 nodes 中显式列出但出现在 edges 中的节点）
	for from := range adjacency {
		if _, ok := distanceCache[from]; !ok {
			distanceCache[from] = make(map[int]int)
		}
		for to := range adjacency {
			distanceCache[from][to] = computeDistanceBFS(adjacency, from, to)
		}
	}

	return &MapState{
		Nodes:         nodes,
		Edges:         edges,
		Adjacency:     adjacency,
		DistanceCache: distanceCache,
	}
}

// computeDistanceBFS 用 BFS 计算从 from 到 to 的最短跳数。
// 同节点返回 0，不连通返回 unreachableDistance。
func computeDistanceBFS(adjacency map[int][]int, from, to int) int {
	if from == to {
		return 0
	}

	visited := make(map[int]bool)
	queue := []struct{ node, dist int }{{node: from, dist: 0}}
	visited[from] = true

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		for _, neighbor := range adjacency[item.node] {
			if neighbor == to {
				return item.dist + 1
			}
			if !visited[neighbor] {
				visited[neighbor] = true
				queue = append(queue, struct{ node, dist int }{node: neighbor, dist: item.dist + 1})
			}
		}
	}

	return unreachableDistance
}

// GetDistance 返回两节点间的 BFS 最短距离（同节点为 0，不连通为 unreachableDistance）。
// 节点越界（不在图中）按不连通处理。
func (m *MapState) GetDistance(from, to int) int {
	if m == nil {
		return unreachableDistance
	}
	row, ok := m.DistanceCache[from]
	if !ok {
		return unreachableDistance
	}
	dist, ok := row[to]
	if !ok {
		return unreachableDistance
	}
	return dist
}

// GetSystemsInRange 返回与 center 距离 <= rangeDist 的所有节点（不含 center 自身）。
// 节点越界或 rangeDist < 0 时返回 nil。
// 直接读 DistanceCache 而非 GetDistance，避免不可达哨兵被误判为"距离很近"。
func (m *MapState) GetSystemsInRange(center, rangeDist int) []int {
	if m == nil || rangeDist < 0 {
		return nil
	}
	row, ok := m.DistanceCache[center]
	if !ok {
		return nil
	}
	var result []int
	for neighbor, dist := range row {
		if neighbor == center {
			continue
		}
		if dist <= rangeDist {
			result = append(result, neighbor)
		}
	}
	sort.Ints(result)
	return result
}

// AreAdjacent 判断两节点是否相邻（直接由一条边相连）。
// 节点越界返回 false。
func (m *MapState) AreAdjacent(a, b int) bool {
	if m == nil {
		return false
	}
	return containsInt(m.Adjacency[a], b)
}

// GetShortestPath 返回从 from 到 to 的最短路径节点数组（含两端）。
// 不可达返回空数组。
func (m *MapState) GetShortestPath(from, to int) []int {
	if m == nil {
		return nil
	}
	if from == to {
		// 单节点路径仅当该节点存在于图中
		if _, ok := m.Adjacency[from]; ok {
			return []int{from}
		}
		return nil
	}

	visited := make(map[int]bool)
	queue := []struct {
		node int
		path []int
	}{{node: from, path: []int{from}}}
	visited[from] = true

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		for _, neighbor := range m.Adjacency[item.node] {
			if neighbor == to {
				return append(item.path, neighbor)
			}
			if !visited[neighbor] {
				visited[neighbor] = true
				queue = append(queue, struct {
					node int
					path []int
				}{node: neighbor, path: append(append([]int{}, item.path...), neighbor)})
			}
		}
	}
	return nil
}

// NodeIDs 返回图中所有节点 ID 的升序切片。
// 替代引擎内的硬编码 []int{1..9}。
func (m *MapState) NodeIDs() []int {
	if m == nil {
		return nil
	}
	ids := make([]int, 0, len(m.Adjacency))
	for id := range m.Adjacency {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return ids
}

// NodeByID 按 ID 查找节点；存在返回 (node, true)，不存在返回 (零值, false)。
// 替代前端的 STAR_NODE_MAP.get。
func (m *MapState) NodeByID(id int) (StarNode, bool) {
	if m == nil {
		return StarNode{}, false
	}
	for _, n := range m.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return StarNode{}, false
}

// MapLayoutSnapshot 是地图布局的可序列化快照，与 DB layout_json schema 一致。
// 仅含 Nodes 和 Edges（不含邻接表/距离缓存等派生数据），用于：
//   - DB 持久化（maps.layout_json）
//   - Replay initial_state 内嵌（GameState.MapSnapshot 字段）
//
// 回放或加载时调用 ToMapState 重建含缓存的 MapState。
type MapLayoutSnapshot struct {
	Nodes []StarNode `json:"nodes"`
	Edges []StarEdge `json:"edges"`
}

// ToMapState 从快照重建含邻接表与距离缓存的 MapState。
func (s *MapLayoutSnapshot) ToMapState() *MapState {
	if s == nil {
		return nil
	}
	return NewMapState(s.Nodes, s.Edges)
}

// SnapshotFromMapState 从 MapState 提取可序列化快照（仅 Nodes + Edges）。
func SnapshotFromMapState(m *MapState) *MapLayoutSnapshot {
	if m == nil {
		return nil
	}
	return &MapLayoutSnapshot{
		Nodes: m.Nodes,
		Edges: m.Edges,
	}
}
