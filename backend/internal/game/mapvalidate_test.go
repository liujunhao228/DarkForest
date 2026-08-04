package game

import (
	"strings"
	"testing"
)

// validTestMap 返回一个合法的 3 节点测试地图。
func validTestMap() ([]StarNode, []StarEdge) {
	nodes := []StarNode{
		{ID: 1, X: 10, Y: 10, Name: "A"},
		{ID: 2, X: 50, Y: 50, Name: "B"},
		{ID: 3, X: 90, Y: 90, Name: "C"},
	}
	edges := []StarEdge{
		{From: 1, To: 2},
		{From: 2, To: 3},
	}
	return nodes, edges
}

func TestValidateMap_LegalMap(t *testing.T) {
	nodes, edges := validTestMap()
	if err := ValidateMap(nodes, edges); err != nil {
		t.Fatalf("合法地图不应返回错误: %v", err)
	}
}

func TestValidateMap_TooFewNodes(t *testing.T) {
	nodes := []StarNode{
		{ID: 1, X: 10, Y: 10},
		{ID: 2, X: 50, Y: 50},
	}
	edges := []StarEdge{{From: 1, To: 2}}
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "少于下限") {
		t.Fatalf("期望节点数不足错误, got: %v", err)
	}
}

func TestValidateMap_TooManyNodes(t *testing.T) {
	nodes := make([]StarNode, MaxNodeCount+1)
	for i := range nodes {
		nodes[i] = StarNode{ID: i + 1, X: 1, Y: 1}
	}
	// 连环边
	edges := make([]StarEdge, len(nodes)-1)
	for i := 0; i < len(nodes)-1; i++ {
		edges[i] = StarEdge{From: i + 1, To: i + 2}
	}
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "超过上限") {
		t.Fatalf("期望节点数超限错误, got: %v", err)
	}
}

func TestValidateMap_CoordOutOfRange(t *testing.T) {
	nodes, edges := validTestMap()
	nodes[0].X = 101
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "x 坐标") {
		t.Fatalf("期望坐标越界错误, got: %v", err)
	}

	nodes, edges = validTestMap()
	nodes[1].Y = -1
	err = ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "y 坐标") {
		t.Fatalf("期望坐标越界错误, got: %v", err)
	}
}

func TestValidateMap_DuplicateNodeID(t *testing.T) {
	nodes, edges := validTestMap()
	nodes = append(nodes, StarNode{ID: 1, X: 20, Y: 20})
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "重复") {
		t.Fatalf("期望重复 ID 错误, got: %v", err)
	}
}

func TestValidateMap_NegativeNodeID(t *testing.T) {
	nodes, edges := validTestMap()
	nodes[0].ID = -1
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "负数") {
		t.Fatalf("期望负数 ID 错误, got: %v", err)
	}
}

func TestValidateMap_DuplicateEdge(t *testing.T) {
	nodes, edges := validTestMap()
	// 添加与已存在边相同的边（无序）
	edges = append(edges, StarEdge{From: 2, To: 1}) // 与 1→2 等价
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "重复边") {
		t.Fatalf("期望重复边错误, got: %v", err)
	}
}

func TestValidateMap_SelfLoop(t *testing.T) {
	nodes, edges := validTestMap()
	edges = append(edges, StarEdge{From: 1, To: 1})
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "自环") {
		t.Fatalf("期望自环错误, got: %v", err)
	}
}

func TestValidateMap_EdgeReferencesNonexistentNode(t *testing.T) {
	nodes, edges := validTestMap()
	edges = append(edges, StarEdge{From: 1, To: 99})
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "不存在的节点") {
		t.Fatalf("期望引用不存在节点错误, got: %v", err)
	}
}

func TestValidateMap_DisconnectedGraph(t *testing.T) {
	nodes := []StarNode{
		{ID: 1, X: 10, Y: 10},
		{ID: 2, X: 20, Y: 20},
		{ID: 3, X: 30, Y: 30},
		{ID: 4, X: 40, Y: 40},
	}
	// 1-2 连通, 3-4 连通, 但两组之间不连通
	edges := []StarEdge{
		{From: 1, To: 2},
		{From: 3, To: 4},
	}
	err := ValidateMap(nodes, edges)
	if err == nil || !strings.Contains(err.Error(), "不连通") {
		t.Fatalf("期望不连通错误, got: %v", err)
	}
}

func TestValidateMap_DefaultMapIsValid(t *testing.T) {
	// 默认硬编码地图应通过校验
	if err := ValidateMap(StarNodes, StarEdges); err != nil {
		t.Fatalf("默认地图应通过校验: %v", err)
	}
}
