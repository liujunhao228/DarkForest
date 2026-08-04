package game

import (
	"fmt"
	"sort"
)

// 地图校验阈值常量（P2 锁定，P3/P4 复用）。
const (
	MinNodeCount = 3
	MaxNodeCount = 20
	MinCoord     = 0.0
	MaxCoord     = 100.0
)

// ValidateMap 校验地图布局的合法性。
// 规则：
//  1. 节点数在 [MinNodeCount, MaxNodeCount] 范围内
//  2. 每个节点坐标 x/y 在 [MinCoord, MaxCoord] 范围内
//  3. 节点 ID 唯一且非负
//  4. 边的 from/to 引用存在的节点 ID
//  5. 禁止重复边（同 from/to 对，无序）
//  6. 强制连通图（BFS 从任意节点出发可达所有节点）
//
// 返回 error 描述具体违规；返回 nil 表示合法。
func ValidateMap(nodes []StarNode, edges []StarEdge) error {
	if len(nodes) < MinNodeCount {
		return fmt.Errorf("节点数 %d 少于下限 %d", len(nodes), MinNodeCount)
	}
	if len(nodes) > MaxNodeCount {
		return fmt.Errorf("节点数 %d 超过上限 %d", len(nodes), MaxNodeCount)
	}

	// 节点 ID 唯一性 + 坐标范围 + 非负 ID
	idSet := make(map[int]struct{}, len(nodes))
	for _, n := range nodes {
		if n.ID < 0 {
			return fmt.Errorf("节点 ID %d 为负数", n.ID)
		}
		if _, dup := idSet[n.ID]; dup {
			return fmt.Errorf("节点 ID %d 重复", n.ID)
		}
		idSet[n.ID] = struct{}{}
		if n.X < MinCoord || n.X > MaxCoord {
			return fmt.Errorf("节点 %d 的 x 坐标 %g 超出范围 [%g, %g]", n.ID, n.X, MinCoord, MaxCoord)
		}
		if n.Y < MinCoord || n.Y > MaxCoord {
			return fmt.Errorf("节点 %d 的 y 坐标 %g 超出范围 [%g, %g]", n.ID, n.Y, MinCoord, MaxCoord)
		}
	}

	// 边引用合法性 + 重复边检测
	edgeSet := make(map[[2]int]struct{}, len(edges))
	for _, e := range edges {
		if _, ok := idSet[e.From]; !ok {
			return fmt.Errorf("边 (%d → %d) 的 from 引用不存在的节点", e.From, e.To)
		}
		if _, ok := idSet[e.To]; !ok {
			return fmt.Errorf("边 (%d → %d) 的 to 引用不存在的节点", e.From, e.To)
		}
		if e.From == e.To {
			return fmt.Errorf("边 (%d → %d) 为自环", e.From, e.To)
		}
		// 无序键：小 ID 在前
		key := edgeKey(e.From, e.To)
		if _, dup := edgeSet[key]; dup {
			return fmt.Errorf("重复边 (%d ↔ %d)", e.From, e.To)
		}
		edgeSet[key] = struct{}{}
	}

	// 连通性：BFS 从第一个节点出发，验证可达所有节点
	if !isConnected(nodes, edges) {
		return fmt.Errorf("地图不连通")
	}

	return nil
}

// edgeKey 生成无序边键（小 ID 在前）。
func edgeKey(a, b int) [2]int {
	if a < b {
		return [2]int{a, b}
	}
	return [2]int{b, a}
}

// isConnected 用 BFS 验证图是否连通。
func isConnected(nodes []StarNode, edges []StarEdge) bool {
	if len(nodes) == 0 {
		return true
	}

	adj := make(map[int][]int)
	for _, n := range nodes {
		adj[n.ID] = []int{}
	}
	for _, e := range edges {
		adj[e.From] = append(adj[e.From], e.To)
		adj[e.To] = append(adj[e.To], e.From)
	}

	start := nodes[0].ID
	visited := map[int]bool{start: true}
	queue := []int{start}

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, next := range adj[cur] {
			if !visited[next] {
				visited[next] = true
				queue = append(queue, next)
			}
		}
	}

	// 所有节点都必须被访问到
	for _, n := range nodes {
		if !visited[n.ID] {
			return false
		}
	}
	return true
}

// SortedNodeIDs 返回节点 ID 的升序切片（辅助函数）。
func SortedNodeIDs(nodes []StarNode) []int {
	ids := make([]int, 0, len(nodes))
	for _, n := range nodes {
		ids = append(ids, n.ID)
	}
	sort.Ints(ids)
	return ids
}
