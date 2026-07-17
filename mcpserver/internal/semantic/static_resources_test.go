package semantic

import (
	"testing"
)

// static_resources_test.go 验证 Task 14 新增的静态知识数据正确性:
//   - GetStarMapTopology: 9 节点 + 14 边 + 邻接矩阵
//   - GetModeRules / ListModeRules: 2 套模式规则字段对齐后端
//   - GetMechanismRule / ListMechanismNames: 4 个机制文本非空且禁用行动指导词
//
// 禁用词检查复用 strike_view_test.go 中的 assertNoForbiddenWords(t, text)
// 与 strikeForbiddenWords 列表(同一份 Spec 约定的禁用词)。

// TestGetStarMapTopology 验证星图拓扑数据完整性。
func TestGetStarMapTopology(t *testing.T) {
	topo := GetStarMapTopology()

	// 节点数 = 9
	if len(topo.Nodes) != 9 {
		t.Fatalf("节点数 = %d, 期望 9", len(topo.Nodes))
	}
	// 边数 = 14
	if len(topo.Edges) != 14 {
		t.Fatalf("边数 = %d, 期望 14", len(topo.Edges))
	}
	// 邻接矩阵维度 = 9x9
	if len(topo.AdjacencyMatrix) != 9 {
		t.Fatalf("邻接矩阵行数 = %d, 期望 9", len(topo.AdjacencyMatrix))
	}

	// 验证节点 1 的字段(对齐后端 StarNodes[0])
	first := topo.Nodes[0]
	if first.ID != 1 || first.X != 10 || first.Y != 12 || first.Name != "星系 1" {
		t.Errorf("节点 1 = %+v, 期望 {ID:1 X:10 Y:12 Name:星系 1}", first)
	}
	// 验证节点 9 的字段
	last := topo.Nodes[8]
	if last.ID != 9 || last.X != 86 || last.Y != 86 || last.Name != "星系 9" {
		t.Errorf("节点 9 = %+v, 期望 {ID:9 X:86 Y:86 Name:星系 9}", last)
	}

	// 验证第一条边(1->2)
	if topo.Edges[0].From != 1 || topo.Edges[0].To != 2 {
		t.Errorf("边 0 = %+v, 期望 {From:1 To:2}", topo.Edges[0])
	}
	// 验证最后一条边(8->9)
	if topo.Edges[13].From != 8 || topo.Edges[13].To != 9 {
		t.Errorf("边 13 = %+v, 期望 {From:8 To:9}", topo.Edges[13])
	}

	// 验证邻接矩阵:节点 1 与节点 2 相邻(边 1->2)
	if !topo.AdjacencyMatrix[0][1] {
		t.Error("邻接矩阵[0][1] = false, 期望 true(节点 1-2 相邻)")
	}
	// 邻接矩阵对称性:AdjacencyMatrix[i][j] == AdjacencyMatrix[j][i]
	for i := 0; i < 9; i++ {
		for j := 0; j < 9; j++ {
			if topo.AdjacencyMatrix[i][j] != topo.AdjacencyMatrix[j][i] {
				t.Errorf("邻接矩阵不对称: [%d][%d]=%v vs [%d][%d]=%v",
					i, j, topo.AdjacencyMatrix[i][j], j, i, topo.AdjacencyMatrix[j][i])
			}
		}
	}
	// 节点与自身不相邻(对角线为 false)
	for i := 0; i < 9; i++ {
		if topo.AdjacencyMatrix[i][i] {
			t.Errorf("邻接矩阵[%d][%d] = true, 期望 false(节点不自环)", i, i)
		}
	}
	// 节点 1 与节点 9 不相邻(距离最远)
	if topo.AdjacencyMatrix[0][8] {
		t.Error("邻接矩阵[0][8] = true, 期望 false(节点 1-9 不相邻)")
	}
}

// TestGetStarMapTopology_Deterministic 验证多次调用返回相同结果(数据恒定)。
func TestGetStarMapTopology_Deterministic(t *testing.T) {
	a := GetStarMapTopology()
	b := GetStarMapTopology()
	if a != b {
		t.Error("GetStarMapTopology 两次调用结果不一致")
	}
}

// TestGetModeRules 验证两套模式规则字段对齐后端。
func TestGetModeRules(t *testing.T) {
	// Classic 模式
	classic, ok := GetModeRules(ModeClassic)
	if !ok {
		t.Fatalf("GetModeRules(%q) 未找到", ModeClassic)
	}
	if classic.Mode != ModeClassic {
		t.Errorf("Classic.Mode = %q, 期望 %q", classic.Mode, ModeClassic)
	}
	if !classic.LightspeedOneTime {
		t.Error("Classic.LightspeedOneTime = false, 期望 true")
	}
	if classic.LightspeedCombinedActionCost != 10 {
		t.Errorf("Classic.LightspeedCombinedActionCost = %d, 期望 10", classic.LightspeedCombinedActionCost)
	}
	if classic.LightspeedCombinedActionCostSpecified != 13 {
		t.Errorf("Classic.LightspeedCombinedActionCostSpecified = %d, 期望 13", classic.LightspeedCombinedActionCostSpecified)
	}
	if classic.RelicDistributionEnabled {
		t.Error("Classic.RelicDistributionEnabled = true, 期望 false")
	}
	if classic.StrikeOrigin != StrikeOriginDirect {
		t.Errorf("Classic.StrikeOrigin = %q, 期望 %q", classic.StrikeOrigin, StrikeOriginDirect)
	}
	if classic.LightspeedMessageEnabled {
		t.Error("Classic.LightspeedMessageEnabled = true, 期望 false")
	}

	// Relics 模式
	relics, ok := GetModeRules(ModeCivilizationRelics)
	if !ok {
		t.Fatalf("GetModeRules(%q) 未找到", ModeCivilizationRelics)
	}
	if relics.Mode != ModeCivilizationRelics {
		t.Errorf("Relics.Mode = %q, 期望 %q", relics.Mode, ModeCivilizationRelics)
	}
	if relics.LightspeedOneTime {
		t.Error("Relics.LightspeedOneTime = true, 期望 false")
	}
	if relics.LightspeedDeployCost != 10 {
		t.Errorf("Relics.LightspeedDeployCost = %d, 期望 10", relics.LightspeedDeployCost)
	}
	if relics.LightspeedJumpCostRandom != 3 {
		t.Errorf("Relics.LightspeedJumpCostRandom = %d, 期望 3", relics.LightspeedJumpCostRandom)
	}
	if relics.LightspeedJumpCostSpecified != 5 {
		t.Errorf("Relics.LightspeedJumpCostSpecified = %d, 期望 5", relics.LightspeedJumpCostSpecified)
	}
	if relics.LightspeedCarryCap != 5 {
		t.Errorf("Relics.LightspeedCarryCap = %d, 期望 5", relics.LightspeedCarryCap)
	}
	if !relics.LightspeedMessageEnabled {
		t.Error("Relics.LightspeedMessageEnabled = false, 期望 true")
	}
	if !relics.RelicDistributionEnabled {
		t.Error("Relics.RelicDistributionEnabled = false, 期望 true")
	}
	if relics.StrikeOrigin != StrikeOriginOwnerPlanet {
		t.Errorf("Relics.StrikeOrigin = %q, 期望 %q", relics.StrikeOrigin, StrikeOriginOwnerPlanet)
	}

	// 未知模式回退到 Classic（对齐前端/后端）
	if r, ok := GetModeRules("unknown"); !ok || r.Mode != ModeClassic {
		t.Errorf("GetModeRules(\"unknown\") = (Mode=%q, ok=%v), 期望 (Classic, true)", r.Mode, ok)
	}
	// 空串也回退到 Classic
	if r, ok := GetModeRules(""); !ok || r.Mode != ModeClassic {
		t.Errorf("GetModeRules(\"\") = (Mode=%q, ok=%v), 期望 (Classic, true)", r.Mode, ok)
	}

	// Description 禁用词检查(复用 strike_view_test.go 的 assertNoForbiddenWords)
	assertNoForbiddenWords(t, classic.Description)
	assertNoForbiddenWords(t, relics.Description)
}

// TestListModeRules 验证 ListModeRules 返回 2 套规则。
func TestListModeRules(t *testing.T) {
	list := ListModeRules()
	if len(list) != 2 {
		t.Fatalf("ListModeRules 返回 %d 套, 期望 2", len(list))
	}
	modes := map[string]bool{}
	for _, r := range list {
		modes[r.Mode] = true
	}
	if !modes[ModeClassic] {
		t.Errorf("ListModeRules 缺少 %q", ModeClassic)
	}
	if !modes[ModeCivilizationRelics] {
		t.Errorf("ListModeRules 缺少 %q", ModeCivilizationRelics)
	}
}

// TestGetMechanismRule 验证 4 个机制文本非空且禁用行动指导词。
func TestGetMechanismRule(t *testing.T) {
	for _, name := range ListMechanismNames() {
		text, ok := GetMechanismRule(name)
		if !ok {
			t.Errorf("GetMechanismRule(%q) 未找到", name)
			continue
		}
		if len(text) == 0 {
			t.Errorf("GetMechanismRule(%q) 返回空文本", name)
		}
		// 机制正文禁用行动指导词(复用 strike_view_test.go 的 assertNoForbiddenWords)
		assertNoForbiddenWords(t, text)
	}

	// 未知机制
	if _, ok := GetMechanismRule("unknown"); ok {
		t.Error("GetMechanismRule(\"unknown\") 应返回 false")
	}
}

// TestListMechanismNames 验证机制名列表完整性。
func TestListMechanismNames(t *testing.T) {
	names := ListMechanismNames()
	if len(names) != 4 {
		t.Fatalf("ListMechanismNames 返回 %d 个, 期望 4", len(names))
	}
	expected := map[string]bool{"strike": true, "broadcast": true, "lightspeed": true, "relic": true}
	for _, n := range names {
		if !expected[n] {
			t.Errorf("ListMechanismNames 含未知机制名 %q", n)
		}
	}
}
