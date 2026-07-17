package semantic

// starmap_topology.go 导出星图拓扑的结构化数据,供 starmap://topology Resource 消费。
//
// 设计理由:starmap.go 中的 StarNodes / StarEdges 是匿名 struct 数组,
// 直接序列化会丢失字段名语义;且缺乏邻接矩阵的导出形式。
// 本文件在 semantic 包内复用 StarNodes / StarEdges / AreAdjacent,
// 构造 JSON 友好的强类型 Topology 结构,避免修改已有的 starmap.go。
//
// 数据源对齐:
//   - 节点:backend/internal/game/starmap.go StarNodes(9 个,ID 1-9)
//   - 边:backend/internal/game/starmap.go StarEdges(14 条无向边)
//   - 邻接矩阵:由 AreAdjacent 派生(9x9 对称矩阵)

// StarMapNode 是星系节点的强类型投影,字段名与 JSON 标签对齐后端 game.StarNode。
type StarMapNode struct {
	ID   int    `json:"id"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
	Name string `json:"name"`
}

// StarMapEdge 是星系间无向边的强类型投影,字段名与 JSON 标签对齐后端 game.StarEdge。
type StarMapEdge struct {
	From int `json:"from"`
	To   int `json:"to"`
}

// StarMapTopology 是星图拓扑的完整结构化数据,用于 Resource 输出。
//
// 字段:
//   - Nodes: 9 个星系节点(id/x/y/name)
//   - Edges: 14 条无向边(from/to)
//   - AdjacencyMatrix: 9x9 邻接矩阵,bool 表示两节点是否直接相连
//     索引约定:AdjacencyMatrix[i][j] 表示节点 (i+1) 与节点 (j+1) 是否相邻
//     (节点 ID 从 1 开始,矩阵索引从 0 开始)
type StarMapTopology struct {
	Nodes           StarMapNodeArray `json:"nodes"`
	Edges           StarMapEdgeArray `json:"edges"`
	AdjacencyMatrix [9][9]bool       `json:"adjacencyMatrix"`
}

// StarMapNodeArray 是 9 元素定长数组,编译期保证节点数恰好为 9。
type StarMapNodeArray = [9]StarMapNode

// StarMapEdgeArray 是 14 元素定长数组,编译期保证边数恰好为 14。
type StarMapEdgeArray = [14]StarMapEdge

// GetStarMapTopology 返回星图拓扑的完整结构化数据。
//
// 节点与边直接镜像 StarNodes / StarEdges;邻接矩阵由 AreAdjacent 派生。
// 由于 StarNodes / StarEdges 是编译期常量,本函数结果恒定,无副作用。
func GetStarMapTopology() StarMapTopology {
	var topo StarMapTopology

	// 填充节点(StarNodes 是 [9]struct{ID,X,Y int; Name string})
	for i, n := range StarNodes {
		topo.Nodes[i] = StarMapNode{
			ID:   n.ID,
			X:    n.X,
			Y:    n.Y,
			Name: n.Name,
		}
	}

	// 填充边(StarEdges 是 [14]struct{From,To int})
	for i, e := range StarEdges {
		topo.Edges[i] = StarMapEdge{
			From: e.From,
			To:   e.To,
		}
	}

	// 构造邻接矩阵:AdjacencyMatrix[i][j] 表示节点 (i+1) 与 (j+1) 是否相邻。
	// 节点 ID 范围 1-9,矩阵索引 0-8。
	for i := 0; i < 9; i++ {
		for j := 0; j < 9; j++ {
			topo.AdjacencyMatrix[i][j] = AreAdjacent(i+1, j+1)
		}
	}

	return topo
}
