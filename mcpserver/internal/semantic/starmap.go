package semantic

import "sort"

// StarNodes 是 9 个星系的固定拓扑（ID 1-9），对齐后端 game.StarNodes
// （e:\DarkForest\backend\internal\game\starmap.go:5-32）。
// 使用定长数组形式，编译期保证节点数恰好为 9。
var StarNodes = [...]struct {
	ID, X, Y int
	Name     string
}{
	{ID: 1, X: 10, Y: 12, Name: "星系 1"},
	{ID: 2, X: 24, Y: 8, Name: "星系 2"},
	{ID: 3, X: 16, Y: 28, Name: "星系 3"},
	{ID: 4, X: 38, Y: 20, Name: "星系 4"},
	{ID: 5, X: 30, Y: 42, Name: "星系 5"},
	{ID: 6, X: 52, Y: 38, Name: "星系 6"},
	{ID: 7, X: 46, Y: 58, Name: "星系 7"},
	{ID: 8, X: 72, Y: 64, Name: "星系 8"},
	{ID: 9, X: 86, Y: 86, Name: "星系 9"},
}

// StarEdges 是 14 条无向边，对齐后端 game.StarEdges
// （e:\DarkForest\backend\internal\game\starmap.go:17-32）。
var StarEdges = [...]struct {
	From, To int
}{
	{From: 1, To: 2},
	{From: 1, To: 3},
	{From: 2, To: 3},
	{From: 2, To: 4},
	{From: 3, To: 4},
	{From: 3, To: 5},
	{From: 4, To: 5},
	{From: 4, To: 6},
	{From: 5, To: 6},
	{From: 5, To: 7},
	{From: 6, To: 7},
	{From: 6, To: 8},
	{From: 7, To: 8},
	{From: 8, To: 9},
}

// adjacency 是邻接表，init() 时由 StarEdges 构造。
var adjacency map[int][]int

// distanceCache 是 BFS 预计算的所有节点对最短距离。
var distanceCache map[int]map[int]int

// unreachableDistance 表示 BFS 未连通时的距离哨兵值。
// 与后端 game.computeDistance 保持一致（返回 1000000）。
const unreachableDistance = 1000000

func init() {
	adjacency = make(map[int][]int)
	distanceCache = make(map[int]map[int]int)

	for i := 1; i <= 9; i++ {
		adjacency[i] = []int{}
		distanceCache[i] = make(map[int]int)
	}

	for _, edge := range StarEdges {
		if !containsInt(adjacency[edge.From], edge.To) {
			adjacency[edge.From] = append(adjacency[edge.From], edge.To)
		}
		if !containsInt(adjacency[edge.To], edge.From) {
			adjacency[edge.To] = append(adjacency[edge.To], edge.From)
		}
	}

	for key := range adjacency {
		sort.Ints(adjacency[key])
	}

	for i := 1; i <= 9; i++ {
		for j := 1; j <= 9; j++ {
			distanceCache[i][j] = computeDistance(i, j)
		}
	}
}

// containsInt 报告 val 是否出现在 arr 中。
func containsInt(arr []int, val int) bool {
	for _, v := range arr {
		if v == val {
			return true
		}
	}
	return false
}

// computeDistance 用 BFS 计算从 from 到 to 的最短跳数。
// 同节点返回 0，不连通返回 unreachableDistance。
func computeDistance(from, to int) int {
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

// GetDistance 返回两个星系间的 BFS 最短距离（同节点为 0，不连通为 unreachableDistance）。
// 对齐后端 game.GetDistance 语义（不连通返回 1000000，不做 -1 哨兵转换）。
// 节点越界（< 1 或 > 9）按不连通处理返回 unreachableDistance。
func GetDistance(from, to int) int {
	if from < 1 || from > 9 || to < 1 || to > 9 {
		return unreachableDistance
	}
	return distanceCache[from][to]
}

// AreAdjacent 判断两个星系是否相邻（直接由一条边相连）。
// 节点越界返回 false。
func AreAdjacent(a, b int) bool {
	if a < 1 || a > 9 || b < 1 || b > 9 {
		return false
	}
	return containsInt(adjacency[a], b)
}

// GetSystemsInRange 返回与 center 距离 <= rangeDist 的所有星系（不含 center 自身）。
// 对齐前端 starmap.ts:86-94 与后端 starmap.go:106-114 的语义。
// 节点越界或 rangeDist < 0 时返回 nil。
func GetSystemsInRange(center, rangeDist int) []int {
	if center < 1 || center > 9 || rangeDist < 0 {
		return nil
	}
	var result []int
	for i := 1; i <= 9; i++ {
		if i == center {
			continue
		}
		// 直接用 distanceCache 而非 GetDistance，避免不可达哨兵
		// 被误判为"距离很近"（哨兵 <= rangeDist 恒为真）。
		if distanceCache[center][i] <= rangeDist {
			result = append(result, i)
		}
	}
	return result
}
