package game

// 视觉字段（Size/Tint）与前端原 frontend/src/lib/game/starmap.ts 硬编码值完全一致。
// P1 阶段保留作为数据源；P2 引入 DB 后由 maps.layout_json 提供。
var StarNodes []StarNode = []StarNode{
	{ID: 1, X: 10, Y: 12, Name: "星系 1", Size: "md", Tint: "#6366f1"},
	{ID: 2, X: 24, Y: 8, Name: "星系 2", Size: "sm", Tint: "#0ea5e9"},
	{ID: 3, X: 16, Y: 28, Name: "星系 3", Size: "sm", Tint: "#14b8a6"},
	{ID: 4, X: 38, Y: 20, Name: "星系 4", Size: "md", Tint: "#6366f1"},
	{ID: 5, X: 30, Y: 42, Name: "星系 5", Size: "lg", Tint: "#a855f7"},
	{ID: 6, X: 52, Y: 38, Name: "星系 6", Size: "lg", Tint: "#a855f7"},
	{ID: 7, X: 46, Y: 58, Name: "星系 7", Size: "md", Tint: "#6366f1"},
	{ID: 8, X: 72, Y: 64, Name: "星系 8", Size: "md", Tint: "#f59e0b"},
	{ID: 9, X: 86, Y: 86, Name: "星系 9", Size: "md", Tint: "#ef4444"},
}

var StarEdges []StarEdge = []StarEdge{
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

// DefaultMapState 是从 StarNodes/StarEdges 构建的官方默认地图状态。
// 由 init() 在包加载时构建；NewGame 默认注入此实例（P2 后改为从 DB 加载）。
var DefaultMapState *MapState

// Adjacency 保留为包级变量，作为 DefaultMapState.Adjacency 的别名引用。
// 供未迁移的调用方（strike.go/turn.go 等）在 Step 6-10 迁移期间继续工作；
// 这些调用方迁移完成后会改读 state.Map.Adjacency，本变量随之移除。
var Adjacency map[int][]int

func init() {
	DefaultMapState = NewMapState(StarNodes, StarEdges)
	Adjacency = DefaultMapState.Adjacency
}

// containsInt 报告 val 是否出现在 arr 中。
// 由 mapstate.go 与 deprecated shim 共用；P3 删除 deprecated shim 后可下沉到 mapstate.go。
func containsInt(arr []int, val int) bool {
	for _, v := range arr {
		if v == val {
			return true
		}
	}
	return false
}

// Deprecated: 使用 (*MapState).GetDistance；本函数转发到 DefaultMapState，
// 仅供过渡期 MCP server 副本与未迁移调用方使用，P3 完成后删除。
func GetDistance(from, to int) int {
	return DefaultMapState.GetDistance(from, to)
}

// Deprecated: 使用 (*MapState).GetSystemsInRange；转发到 DefaultMapState。
func GetSystemsInRange(center, rangeDist int) []int {
	return DefaultMapState.GetSystemsInRange(center, rangeDist)
}

// Deprecated: 使用 (*MapState).AreAdjacent；转发到 DefaultMapState。
func AreAdjacent(a, b int) bool {
	return DefaultMapState.AreAdjacent(a, b)
}
