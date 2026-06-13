package game

import "sort"

var StarNodes []StarNode = []StarNode{
	{ID: 1, X: 15, Y: 12, Name: "星系 1"},
	{ID: 2, X: 85, Y: 12, Name: "星系 2"},
	{ID: 3, X: 85, Y: 88, Name: "星系 3"},
	{ID: 4, X: 50, Y: 12, Name: "星系 4"},
	{ID: 5, X: 50, Y: 50, Name: "星系 5"},
	{ID: 6, X: 85, Y: 50, Name: "星系 6"},
	{ID: 7, X: 15, Y: 50, Name: "星系 7"},
	{ID: 8, X: 15, Y: 88, Name: "星系 8"},
	{ID: 9, X: 50, Y: 88, Name: "星系 9"},
}

var StarEdges []StarEdge = []StarEdge{
	{From: 1, To: 2},
	{From: 1, To: 4},
	{From: 1, To: 7},
	{From: 2, To: 4},
	{From: 2, To: 6},
	{From: 3, To: 5},
	{From: 3, To: 6},
	{From: 3, To: 9},
	{From: 4, To: 5},
	{From: 4, To: 7},
	{From: 5, To: 6},
	{From: 5, To: 8},
	{From: 7, To: 8},
	{From: 8, To: 9},
}

var Adjacency map[int][]int
var distanceCache map[int]map[int]int

func init() {
	Adjacency = make(map[int][]int)
	distanceCache = make(map[int]map[int]int)

	for i := 1; i <= 9; i++ {
		Adjacency[i] = []int{}
		distanceCache[i] = make(map[int]int)
	}

	for _, edge := range StarEdges {
		if !containsInt(Adjacency[edge.From], edge.To) {
			Adjacency[edge.From] = append(Adjacency[edge.From], edge.To)
		}
		if !containsInt(Adjacency[edge.To], edge.From) {
			Adjacency[edge.To] = append(Adjacency[edge.To], edge.From)
		}
	}

	for key := range Adjacency {
		sort.Ints(Adjacency[key])
	}

	for i := 1; i <= 9; i++ {
		for j := 1; j <= 9; j++ {
			distanceCache[i][j] = computeDistance(i, j)
		}
	}
}

func containsInt(arr []int, val int) bool {
	for _, v := range arr {
		if v == val {
			return true
		}
	}
	return false
}

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

		for _, neighbor := range Adjacency[item.node] {
			if neighbor == to {
				return item.dist + 1
			}
			if !visited[neighbor] {
				visited[neighbor] = true
				queue = append(queue, struct{ node, dist int }{node: neighbor, dist: item.dist + 1})
			}
		}
	}

	return 1000000
}

func GetDistance(from, to int) int {
	return distanceCache[from][to]
}

func GetSystemsInRange(center, rangeDist int) []int {
	var result []int
	for i := 1; i <= 9; i++ {
		if i != center && GetDistance(center, i) <= rangeDist {
			result = append(result, i)
		}
	}
	return result
}

func AreAdjacent(a, b int) bool {
	return containsInt(Adjacency[a], b)
}