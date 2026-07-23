package game

import (
	"encoding/json"
	"testing"
)

// TestGetAllRules_ReturnsCompleteData 验证 GetAllRules 返回完整数据且 JSON 结构合法。
func TestGetAllRules_ReturnsCompleteData(t *testing.T) {
	rules := GetAllRules()

	// 核心数据不为空
	if len(rules.CardDefinitions) == 0 {
		t.Error("CardDefinitions should not be empty")
	}
	if len(rules.RuleConfigs) == 0 {
		t.Error("RuleConfigs should not be empty")
	}
	if len(rules.ModePresets) != 2 {
		t.Errorf("ModePresets count = %d, want 2", len(rules.ModePresets))
	}
	if len(rules.StarMap.Nodes) == 0 {
		t.Error("StarMap.Nodes should not be empty")
	}
	if len(rules.StarMap.Edges) == 0 {
		t.Error("StarMap.Edges should not be empty")
	}

	// 验证 JSON 序列化不报错
	data, err := json.Marshal(rules)
	if err != nil {
		t.Fatalf("Failed to marshal RulesResponse: %v", err)
	}
	if len(data) == 0 {
		t.Error("Marshaled JSON should not be empty")
	}

	// 验证可以反序列化回结构体
	var decoded RulesResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal RulesResponse: %v", err)
	}

	// 验证 RuleConfig 数量
	if len(decoded.RuleConfigs) != 9 {
		t.Errorf("RuleConfigs count = %d, want 9", len(decoded.RuleConfigs))
	}
}

// TestGetAllRules_RuleConfigValues 验证 RuleConfigs 中各配置项的取值与预期一致，
// 并检查 v1.1 新增字段（Descriptions、EnumOptions、ValueLabels 等）。
func TestGetAllRules_RuleConfigValues(t *testing.T) {
	rules := GetAllRules()

	// 构建 key -> config 的映射
	configMap := make(map[string]RuleConfigItem)
	for _, c := range rules.RuleConfigs {
		configMap[c.Key] = c
	}

	tests := []struct {
		key              string
		expectedType     string
		expectedCategory string
		expectedName     string // v1.1: 期望的玩家向概念名
	}{
		{key: "lightspeed.usage", expectedType: "enum", expectedCategory: "lightspeed", expectedName: "光速飞船使用方式"},
		{key: "lightspeed.deploy_cost", expectedType: "integer", expectedCategory: "lightspeed", expectedName: "光速飞船部署能量"},
		{key: "lightspeed.random_cost", expectedType: "integer", expectedCategory: "lightspeed", expectedName: "随机跃迁成本"},
		{key: "lightspeed.carry_cap", expectedType: "integer", expectedCategory: "lightspeed", expectedName: "跃迁携带能量上限"},
		{key: "lightspeed.message_enabled", expectedType: "boolean", expectedCategory: "lightspeed", expectedName: "跃迁留言"},
		{key: "relic.distribution_enabled", expectedType: "boolean", expectedCategory: "relic", expectedName: "遗迹分布"},
		{key: "strike.origin", expectedType: "enum", expectedCategory: "strike", expectedName: "打击出现位置"},
		{key: "strike.miss_behavior", expectedType: "enum", expectedCategory: "strike", expectedName: "打击落空处理"},
		{key: "strike.can_destroy_relic", expectedType: "boolean", expectedCategory: "strike", expectedName: "打击遗留物命中"},
	}

	for _, tt := range tests {
		cfg, ok := configMap[tt.key]
		if !ok {
			t.Errorf("RuleConfig %s not found", tt.key)
			continue
		}
		if cfg.Type != tt.expectedType {
			t.Errorf("RuleConfig %s type = %s, want %s", tt.key, cfg.Type, tt.expectedType)
		}
		if cfg.Category != tt.expectedCategory {
			t.Errorf("RuleConfig %s category = %s, want %s", tt.key, cfg.Category, tt.expectedCategory)
		}
		if cfg.Name != tt.expectedName {
			t.Errorf("RuleConfig %s name = %q, want %q", tt.key, cfg.Name, tt.expectedName)
		}
		if _, ok := cfg.Values["classic"]; !ok {
			t.Errorf("RuleConfig %s missing classic value", tt.key)
		}
		if _, ok := cfg.Values["civilization_relics"]; !ok {
			t.Errorf("RuleConfig %s missing civilization_relics value", tt.key)
		}
		// v1.1: 验证 descriptions 非空
		if len(cfg.Descriptions) == 0 {
			t.Errorf("RuleConfig %s descriptions should not be empty", tt.key)
		}
		// v1.1: 验证 legacyDescription 非空（向后兼容）
		if cfg.LegacyDescription == "" {
			t.Errorf("RuleConfig %s legacyDescription should not be empty", tt.key)
		}
	}

	// v1.1: 验证 enum 类型的 EnumOptions
	strikeOrigin, ok := configMap["strike.origin"]
	if !ok {
		t.Fatal("strike.origin not found")
	}
	if len(strikeOrigin.EnumOptions) != 3 {
		t.Errorf("strike.origin EnumOptions count = %d, want 3", len(strikeOrigin.EnumOptions))
	}
	expectedOptions := []struct {
		id    string
		label string
	}{
		{id: "direct", label: "即刻判定"},
		{id: "ownerPlanet", label: "逐跳飞行"},
		{id: "stealthOwnerPlanet", label: "隐式飞行"},
	}
	for i, exp := range expectedOptions {
		if strikeOrigin.EnumOptions[i].ID != exp.id {
			t.Errorf("strike.origin EnumOptions[%d].id = %s, want %s", i, strikeOrigin.EnumOptions[i].ID, exp.id)
		}
		if strikeOrigin.EnumOptions[i].Label != exp.label {
			t.Errorf("strike.origin EnumOptions[%d].label = %s, want %s", i, strikeOrigin.EnumOptions[i].Label, exp.label)
		}
		if strikeOrigin.EnumOptions[i].Description == "" {
			t.Errorf("strike.origin EnumOptions[%d].description should not be empty", i)
		}
	}

	// v1.1: 验证 Descriptions 的 mode:value 二维 key 格式
	for key, cfg := range configMap {
		for descKey := range cfg.Descriptions {
			// 格式校验：必须包含 "."
			hasDot := false
			for _, ch := range descKey {
				if ch == '.' {
					hasDot = true
					break
				}
			}
			if !hasDot {
				t.Errorf("RuleConfig %s description key %q should contain '.' (mode:value format)", key, descKey)
			}
		}
	}

	// v1.1: 验证 valueLabels 字段（enum 类型应有）
	usageCfg := configMap["lightspeed.usage"]
	if len(usageCfg.ValueLabels) != 2 {
		t.Errorf("lightspeed.usage ValueLabels count = %d, want 2", len(usageCfg.ValueLabels))
	}
	if usageCfg.ValueLabels["oneTime"] != "一次性消耗" {
		t.Errorf("lightspeed.usage ValueLabels[oneTime] = %q, want 一次性消耗", usageCfg.ValueLabels["oneTime"])
	}
	if usageCfg.ValueLabels["reusable"] != "可复用设施" {
		t.Errorf("lightspeed.usage ValueLabels[reusable] = %q, want 可复用设施", usageCfg.ValueLabels["reusable"])
	}

	// v1.1: 验证 integer 类型的 unit 字段
	deployCost := configMap["lightspeed.deploy_cost"]
	if deployCost.Unit != "能量" {
		t.Errorf("lightspeed.deploy_cost Unit = %q, want 能量", deployCost.Unit)
	}

	// v1.1: 验证 valueTemplate 字段
	if deployCost.ValueTemplate == "" {
		t.Error("lightspeed.deploy_cost ValueTemplate should not be empty")
	}
	if deployCost.ValueTemplate != "部署光速飞船需消耗 {value} 能量" {
		t.Errorf("lightspeed.deploy_cost ValueTemplate = %q, want 部署光速飞船需消耗 {value} 能量", deployCost.ValueTemplate)
	}

	// v1.1: 验证 ActiveValue 未填充（仅房间 API 填充）
	for _, cfg := range rules.RuleConfigs {
		if cfg.ActiveValue != nil {
			t.Errorf("RuleConfig %s ActiveValue should be nil in GetAllRules, got %v", cfg.Key, cfg.ActiveValue)
		}
	}
}

// TestGetAllRules_AllModesPresent 验证 ModePresets 包含经典模式和文明遗迹模式。
func TestGetAllRules_AllModesPresent(t *testing.T) {
	rules := GetAllRules()

	modeMap := make(map[string]ModePreset)
	for _, m := range rules.ModePresets {
		modeMap[m.ID] = m
	}

	if _, ok := modeMap["classic"]; !ok {
		t.Error("ModePreset 'classic' not found")
	}
	if _, ok := modeMap["civilization_relics"]; !ok {
		t.Error("ModePreset 'civilization_relics' not found")
	}
}

// TestGetAllRules_GameConstants 验证 GameConstants 为数组形式，每项含 key/name/value/unit/description。
func TestGetAllRules_GameConstants(t *testing.T) {
	rules := GetAllRules()
	gc := rules.GameConstants

	// v1.1: 验证数组长度
	if len(gc) != 10 {
		t.Errorf("GameConstants count = %d, want 10", len(gc))
	}

	// v1.1: 按 key 构建索引，验证值
	constMap := make(map[string]GameConstantItem)
	for _, item := range gc {
		constMap[item.Key] = item
	}

	expected := []struct {
		key     string
		name    string
		value   float64 // 用 float64 统一比较
		unit    string
	}{
		{key: "totalCards", name: "总卡牌数", value: 72, unit: "张"},
		{key: "initialHand", name: "初始手牌数", value: 4, unit: "张"},
		{key: "handLimit", name: "手牌上限", value: 4, unit: "张"},
		{key: "initialEnergy", name: "初始能量", value: 3, unit: "点"},
		{key: "baseEnergyPerTurn", name: "回合基础能量", value: 1, unit: "点"},
		{key: "maxPlayers", name: "最大玩家数", value: 5, unit: "人"},
		{key: "eliminationEnergyPerAlive", name: "淘汰奖励系数", value: 3, unit: "点"},
		{key: "broadcastCooldownTurns", name: "广播冷却轮数", value: 2, unit: "轮"},
		{key: "broadcastRefundOnMiss", name: "广播退还能量", value: 1, unit: "点"},
		{key: "recycleRefundRatio", name: "回收返还比例", value: 0.5, unit: ""},
	}

	for _, exp := range expected {
		item, ok := constMap[exp.key]
		if !ok {
			t.Errorf("GameConstant %s not found", exp.key)
			continue
		}
		if item.Name != exp.name {
			t.Errorf("GameConstant %s name = %q, want %q", exp.key, item.Name, exp.name)
		}
		if item.Description == "" {
			t.Errorf("GameConstant %s description should not be empty", exp.key)
		}
		if item.Unit != exp.unit {
			t.Errorf("GameConstant %s unit = %q, want %q", exp.key, item.Unit, exp.unit)
		}
	}
}

// TestGetRoomRules_ClassicMode 验证经典模式的 GetRoomRules 行为，
// 包括 v1.1 的 descriptions 过滤和 activeValue 填充。
func TestGetRoomRules_ClassicMode(t *testing.T) {
	rules := GetRoomRules("test-room-1", GameModeClassic)

	if rules.RoomID != "test-room-1" {
		t.Errorf("RoomID = %s, want test-room-1", rules.RoomID)
	}
	if rules.GameMode != "classic" {
		t.Errorf("GameMode = %s, want classic", rules.GameMode)
	}

	// 经典模式不返回遗迹组合
	if rules.RelicCombos != nil {
		t.Error("Classic mode should have nil RelicCombos")
	}

	// 验证 activeValues 是经典模式的取值
	if v, ok := rules.ActiveValues["lightspeed.usage"]; !ok || v != "oneTime" {
		t.Errorf("lightspeed.usage = %v, want oneTime (classic)", v)
	}
	if v, ok := rules.ActiveValues["lightspeed.deploy_cost"]; !ok || v != 0 {
		t.Errorf("lightspeed.deploy_cost = %v, want 0 (classic)", v)
	}
	if v, ok := rules.ActiveValues["strike.origin"]; !ok || v != "direct" {
		t.Errorf("strike.origin = %v, want direct (classic)", v)
	}

	// v1.1: 验证每条 config 的 descriptions 仅含一条
	for _, c := range rules.RuleConfigs {
		if len(c.Descriptions) != 1 {
			t.Errorf("RuleConfig %s descriptions should have exactly 1 entry in RoomRules, got %d", c.Key, len(c.Descriptions))
		}
		// 验证 key 以 "classic." 开头
		for k := range c.Descriptions {
			if len(k) < 8 || k[:8] != "classic." {
				t.Errorf("RuleConfig %s description key %q should start with 'classic.'", c.Key, k)
			}
		}
	}

	// v1.1: 验证每条 config 的 activeValue 已填充且等于 values["classic"]
	for _, c := range rules.RuleConfigs {
		if c.ActiveValue == nil {
			t.Errorf("RuleConfig %s ActiveValue should be set in RoomRules", c.Key)
		}
		expectedVal, ok := c.Values["classic"]
		if !ok {
			t.Errorf("RuleConfig %s missing classic value", c.Key)
			continue
		}
		if c.ActiveValue != expectedVal {
			t.Errorf("RuleConfig %s ActiveValue = %v, want %v", c.Key, c.ActiveValue, expectedVal)
		}
	}
}

// TestGetRoomRules_RelicsMode 验证文明遗迹模式的 GetRoomRules 行为，
// 包括 v1.1 的 descriptions 过滤和 activeValue 填充。
func TestGetRoomRules_RelicsMode(t *testing.T) {
	rules := GetRoomRules("test-room-2", GameModeCivilizationRelics)

	if rules.RoomID != "test-room-2" {
		t.Errorf("RoomID = %s, want test-room-2", rules.RoomID)
	}
	if rules.GameMode != "civilization_relics" {
		t.Errorf("GameMode = %s, want civilization_relics", rules.GameMode)
	}

	// 遗迹模式应返回遗迹组合
	if len(rules.RelicCombos) == 0 {
		t.Error("Relics mode should have non-empty RelicCombos")
	}

	// 验证 activeValues 是遗迹模式的取值
	if v, ok := rules.ActiveValues["lightspeed.usage"]; !ok || v != "reusable" {
		t.Errorf("lightspeed.usage = %v, want reusable (relics)", v)
	}
	if v, ok := rules.ActiveValues["lightspeed.deploy_cost"]; !ok || v != 10 {
		t.Errorf("lightspeed.deploy_cost = %v, want 10 (relics)", v)
	}
	if v, ok := rules.ActiveValues["strike.origin"]; !ok || v != "ownerPlanet" {
		t.Errorf("strike.origin = %v, want ownerPlanet (relics)", v)
	}
	if v, ok := rules.ActiveValues["strike.can_destroy_relic"]; !ok || v != true {
		t.Errorf("strike.can_destroy_relic = %v, want true (relics)", v)
	}

	// v1.1: 验证每条 config 的 descriptions 仅含一条
	for _, c := range rules.RuleConfigs {
		if len(c.Descriptions) != 1 {
			t.Errorf("RuleConfig %s descriptions should have exactly 1 entry in RoomRules, got %d", c.Key, len(c.Descriptions))
		}
		// 验证 key 以 "civilization_relics." 开头
		for k := range c.Descriptions {
			prefix := "civilization_relics."
			if len(k) < len(prefix) || k[:len(prefix)] != prefix {
				t.Errorf("RuleConfig %s description key %q should start with 'civilization_relics.'", c.Key, k)
			}
		}
	}
}

// TestGetRoomRules_RelicCombos_Structure 验证遗迹组合的结构完整性。
func TestGetRoomRules_RelicCombos_Structure(t *testing.T) {
	rules := GetRoomRules("test-room-3", GameModeCivilizationRelics)

	if len(rules.RelicCombos) != 11 {
		t.Errorf("RelicCombos count = %d, want 11", len(rules.RelicCombos))
	}

	for i, rc := range rules.RelicCombos {
		if rc.ID == "" {
			t.Errorf("RelicCombo[%d] missing ID", i)
		}
		if rc.Name == "" {
			t.Errorf("RelicCombo[%d] missing Name", i)
		}
		if rc.Strength != "弱" && rc.Strength != "中" && rc.Strength != "强" {
			t.Errorf("RelicCombo[%d] invalid Strength = %s", i, rc.Strength)
		}
		if rc.Energy <= 0 {
			t.Errorf("RelicCombo[%d] Energy = %d, want > 0", i, rc.Energy)
		}
		if len(rc.FacilityNames) == 0 {
			t.Errorf("RelicCombo[%d] has no facilities", i)
		}
		if len(rc.FacilityDefIDs) != len(rc.FacilityNames) {
			t.Errorf("RelicCombo[%d] FacilityNames and FacilityDefIDs lengths differ", i)
		}
	}
}

// TestGetAllRules_Mechanisms 验证 mechanisms 字段结构完整。
func TestGetAllRules_Mechanisms(t *testing.T) {
	rules := GetAllRules()

	if rules.Mechanisms.Broadcast == nil {
		t.Error("Mechanisms.Broadcast should not be nil")
	}
	if rules.Mechanisms.Broadcast.Description == "" {
		t.Error("Mechanisms.Broadcast.Description should not be empty")
	}
	if len(rules.Mechanisms.Broadcast.Phases) == 0 {
		t.Error("Mechanisms.Broadcast.Phases should not be empty")
	}

	if rules.Mechanisms.Strike == nil {
		t.Error("Mechanisms.Strike should not be nil")
	}
	if rules.Mechanisms.Strike.Description == "" {
		t.Error("Mechanisms.Strike.Description should not be empty")
	}
	if len(rules.Mechanisms.Strike.OriginModes) == 0 {
		t.Error("Mechanisms.Strike.OriginModes should not be empty")
	}

	if rules.Mechanisms.Settlement == nil {
		t.Error("Mechanisms.Settlement should not be nil")
	}
	if len(rules.Mechanisms.Settlement.StarDependentFacilities) != 2 {
		t.Errorf("Settlement.StarDependentFacilities count = %d, want 2",
			len(rules.Mechanisms.Settlement.StarDependentFacilities))
	}

	if rules.Mechanisms.WinCondition == nil {
		t.Error("Mechanisms.WinCondition should not be nil")
	}
	if rules.Mechanisms.WinCondition.Description == "" {
		t.Error("Mechanisms.WinCondition.Description should not be empty")
	}
}

// TestGetAllRules_StarMap 验证星图包含 9 个节点和 14 条边。
func TestGetAllRules_StarMap(t *testing.T) {
	rules := GetAllRules()

	if len(rules.StarMap.Nodes) != 9 {
		t.Errorf("StarMap.Nodes count = %d, want 9", len(rules.StarMap.Nodes))
	}
	if len(rules.StarMap.Edges) != 14 {
		t.Errorf("StarMap.Edges count = %d, want 14", len(rules.StarMap.Edges))
	}

	// 验证节点 ID 为 1-9 且名称不空
	idSet := make(map[int]bool)
	for _, n := range rules.StarMap.Nodes {
		if n.Name == "" {
			t.Errorf("StarNode %d has empty name", n.ID)
		}
		if n.ID < 1 || n.ID > 9 {
			t.Errorf("StarNode ID = %d, want 1-9", n.ID)
		}
		idSet[n.ID] = true
	}
	if len(idSet) != 9 {
		t.Errorf("StarNode unique IDs = %d, want 9", len(idSet))
	}
}

// TestGetRoomRules_UnknownMode 验证未知模式回退到经典行为。
func TestGetRoomRules_UnknownMode(t *testing.T) {
	rules := GetRoomRules("test-unknown", GameMode("unknown_mode"))

	if rules.RelicCombos != nil {
		t.Error("Unknown mode should have nil RelicCombos (like classic)")
	}
	if v, ok := rules.ActiveValues["strike.origin"]; !ok || v != "direct" {
		t.Errorf("Unknown mode should fallback to classic strike.origin='direct', got %v", v)
	}
	if v, ok := rules.ActiveValues["lightspeed.usage"]; !ok || v != "oneTime" {
		t.Errorf("Unknown mode should fallback to classic lightspeed.usage=oneTime, got %v", v)
	}
}

// ============================================================================
// v1.1 新测试 — 核心新增功能
// ============================================================================

// TestFormatConfigValue 验证 formatConfigValue 正确处理 bool / int / string 三种类型。
func TestFormatConfigValue(t *testing.T) {
	tests := []struct {
		input    any
		expected string
	}{
		{input: true, expected: "true"},
		{input: false, expected: "false"},
		{input: 0, expected: "0"},
		{input: 10, expected: "10"},
		{input: -3, expected: "-3"},
		{input: "direct", expected: "direct"},
		{input: "ownerPlanet", expected: "ownerPlanet"},
		{input: "discard", expected: "discard"},
		{input: 3.14, expected: "3.14"}, // 兜底到 fmt.Sprintf
	}

	for _, tt := range tests {
		result := formatConfigValue(tt.input)
		if result != tt.expected {
			t.Errorf("formatConfigValue(%v) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

// TestFilterRoomRuleConfigs_DescriptionsFiltered 验证 filterRoomRuleConfigs
// 将 descriptions 过滤为仅含一条 mode:activeValue 的记录。
// 注意：每个模式测试使用独立的 buildRuleConfigs() 调用，避免 filterRoomRuleConfigs
// 原地修改 descriptions 污染后续测试。
func TestFilterRoomRuleConfigs_DescriptionsFiltered(t *testing.T) {
	// 经典模式过滤
	filteredClassic := filterRoomRuleConfigs(buildRuleConfigs(), GameModeClassic)
	for _, c := range filteredClassic {
		if len(c.Descriptions) != 1 {
			t.Errorf("Classic filter: RuleConfig %s descriptions count = %d, want 1", c.Key, len(c.Descriptions))
		}
		for k := range c.Descriptions {
			if len(k) < 8 || k[:8] != "classic." {
				t.Errorf("Classic filter: RuleConfig %s key %q should start with 'classic.'", c.Key, k)
			}
		}
		if c.ActiveValue == nil {
			t.Errorf("Classic filter: RuleConfig %s ActiveValue should be set", c.Key)
		}
	}

	// 遗迹模式过滤（独立 buildRuleConfigs）
	filteredRelics := filterRoomRuleConfigs(buildRuleConfigs(), GameModeCivilizationRelics)
	for _, c := range filteredRelics {
		if len(c.Descriptions) != 1 {
			t.Errorf("Relics filter: RuleConfig %s descriptions count = %d, want 1", c.Key, len(c.Descriptions))
		}
		for k := range c.Descriptions {
			prefix := "civilization_relics."
			if len(k) < len(prefix) || k[:len(prefix)] != prefix {
				t.Errorf("Relics filter: RuleConfig %s key %q should start with 'civilization_relics.'", c.Key, k)
			}
		}
		if c.ActiveValue == nil {
			t.Errorf("Relics filter: RuleConfig %s ActiveValue should be set", c.Key)
		}
	}

	// 未知模式应回退到经典（独立 buildRuleConfigs）
	filteredUnknown := filterRoomRuleConfigs(buildRuleConfigs(), GameMode("unknown"))
	for _, c := range filteredUnknown {
		if len(c.Descriptions) != 1 {
			t.Errorf("Unknown filter: RuleConfig %s descriptions count = %d, want 1", c.Key, len(c.Descriptions))
		}
		for k := range c.Descriptions {
			if len(k) < 8 || k[:8] != "classic." {
				t.Errorf("Unknown filter: RuleConfig %s key %q should start with 'classic.'", c.Key, k)
			}
		}
	}
}

// TestFilterRoomRuleConfigs_MissingKeyFallback 验证 descriptions 缺失时三种兜底行为：
// 1. 有 ValueTemplate → 模板渲染
// 2. 无 ValueTemplate → 清空 descriptions（不崩溃）
func TestFilterRoomRuleConfigs_MissingKeyFallback(t *testing.T) {
	// 构造一个自定义场景：遗物模式的 random_cost 被设为 7（不在 descriptions 中）
	config := RuleConfigItem{
		Key:           "lightspeed.random_cost",
		Name:          "随机跃迁成本",
		Type:          "integer",
		Category:      "lightspeed",
		Values:        map[string]any{"classic": 10, "civilization_relics": 7},
		Descriptions: map[string]string{
			"classic.10":            "classic description",
			"civilization_relics.3": "standard relics description",
		},
		ValueTemplate: "随机跃迁消耗 {value} 能量",
		Unit:          "能量",
	}

	result := filterRoomRuleConfigs([]RuleConfigItem{config}, GameModeCivilizationRelics)
	if len(result) != 1 {
		t.Fatal("Expected 1 result")
	}
	r := result[0]

	// 自定义值 7 不在 descriptions 中 → 应使用 ValueTemplate 兜底
	if len(r.Descriptions) != 1 {
		t.Errorf("Descriptions count = %d, want 1", len(r.Descriptions))
	}
	expectedDesc := "随机跃迁消耗 7 能量"
	actualDesc := r.Descriptions["civilization_relics.7"]
	if actualDesc != expectedDesc {
		t.Errorf("Fallback description = %q, want %q", actualDesc, expectedDesc)
	}
	if r.ActiveValue != 7 {
		t.Errorf("ActiveValue = %v, want 7", r.ActiveValue)
	}

	// 无 ValueTemplate 的极端兜底
	noTemplateConfig := RuleConfigItem{
		Key:      "strike.can_destroy_relic",
		Name:     "打击遗留物命中",
		Type:     "boolean",
		Category: "strike",
		Values:   map[string]any{"classic": false, "civilization_relics": true},
		Descriptions: map[string]string{
			"classic.false": "classic no",
			"classic.true":  "（本模式不适用）",
		},
		// ValueTemplate 为空
	}
	noTemplateResult := filterRoomRuleConfigs([]RuleConfigItem{noTemplateConfig}, GameModeCivilizationRelics)
	if len(noTemplateResult) != 1 {
		t.Fatal("Expected 1 result")
	}
	nt := noTemplateResult[0]
	// civilization_relics.true 不存在 → ValueTemplate 也不存在 → 清空
	if len(nt.Descriptions) != 0 {
		t.Errorf("No-template fallback should have empty descriptions, got %d entries", len(nt.Descriptions))
	}
}

// TestRuleConfigNames_AllKeysCovered 验证 ruleConfigNames 覆盖了所有 buildRuleConfigs 的 key。
func TestRuleConfigNames_AllKeysCovered(t *testing.T) {
	configs := buildRuleConfigs()
	for _, c := range configs {
		if _, ok := ruleConfigNames[c.Key]; !ok {
			t.Errorf("ruleConfigNames missing key: %s", c.Key)
		}
		if _, ok := ruleConfigDescriptions[c.Key]; !ok {
			t.Errorf("ruleConfigDescriptions missing key: %s", c.Key)
		}
	}
}

// TestGameConstants_JSON 验证 gameConstants 的 JSON 输出为数组且包含 description 字段。
func TestGameConstants_JSON(t *testing.T) {
	rules := GetAllRules()
	data, err := json.Marshal(rules)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	// 解析为泛型 map 验证 gameConstants 结构
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	gcRaw, ok := raw["gameConstants"]
	if !ok {
		t.Fatal("gameConstants field missing in JSON output")
	}

	gcArr, ok := gcRaw.([]any)
	if !ok {
		t.Fatalf("gameConstants should be a JSON array, got %T", gcRaw)
	}
	if len(gcArr) != 10 {
		t.Errorf("gameConstants array length = %d, want 10", len(gcArr))
	}

	// 验证第一项含 description 字段
	firstItem, ok := gcArr[0].(map[string]any)
	if !ok {
		t.Fatal("First gameConstants item is not an object")
	}
	if _, hasDesc := firstItem["description"]; !hasDesc {
		t.Error("gameConstants item should have 'description' field in JSON")
	}
	if _, hasKey := firstItem["key"]; !hasKey {
		t.Error("gameConstants item should have 'key' field in JSON")
	}
	if _, hasName := firstItem["name"]; !hasName {
		t.Error("gameConstants item should have 'name' field in JSON")
	}
}

// TestDescriptions_NonApplicableEntriesExist 验证 "（本模式不适用）" 条目在应有的 config 中存在。
func TestDescriptions_NonApplicableEntriesExist(t *testing.T) {
	// 实际验证：对于 boolean 类型，如果某个值仅在某个模式下出现，
	// 另一个模式的同值应为"（本模式不适用）"
	configs := buildRuleConfigs()
	configMap := make(map[string]RuleConfigItem)
	for _, c := range configs {
		configMap[c.Key] = c
	}

	// 检查 lightspeed.message_enabled: classic.true 不存在 → 应标记为"（本模式不适用）"
	msgCfg := configMap["lightspeed.message_enabled"]
	if desc, ok := msgCfg.Descriptions["classic.false"]; ok {
		if desc == "" {
			t.Error("classic.false for message_enabled should not be empty")
		}
	}
	if desc, ok := msgCfg.Descriptions["classic.true"]; ok {
		if desc != "（本模式不适用）" {
			t.Errorf("classic.true for message_enabled should be '（本模式不适用）', got %q", desc)
		}
	}
}

// TestGetRoomRulesWithOverrides_NilRules 验证 customRules=nil 时等价于 GetRoomRules。
func TestGetRoomRulesWithOverrides_NilRules(t *testing.T) {
	base := GetRoomRules("room-1", GameModeClassic)
	overrides := GetRoomRulesWithOverrides("room-1", "classic", nil)
	// RoomID/GameMode 应一致
	if overrides.RoomID != base.RoomID {
		t.Errorf("RoomID 不一致: %s vs %s", overrides.RoomID, base.RoomID)
	}
	if overrides.GameMode != base.GameMode {
		t.Errorf("GameMode 不一致: %s vs %s", overrides.GameMode, base.GameMode)
	}
	// 规则项 ActiveValue 应与基础一致（未发生覆盖）
	for i, c := range overrides.RuleConfigs {
		if c.ActiveValue != base.RuleConfigs[i].ActiveValue {
			t.Errorf("RuleConfig %s ActiveValue 不一致: %v vs %v", c.Key, c.ActiveValue, base.RuleConfigs[i].ActiveValue)
		}
	}
}

// TestGetRoomRulesWithOverrides_AppliesCustomValues 验证自定义规则生效：
// 覆盖 lightspeed.carry_cap（整数）和 strike.origin（枚举），检查 ActiveValue 与 Descriptions 被重写。
func TestGetRoomRulesWithOverrides_AppliesCustomValues(t *testing.T) {
	custom := &ModeRules{
		LightspeedUsage:              classicModeRules.LightspeedUsage,
		LightspeedCombinedActionCost: classicModeRules.LightspeedCombinedActionCost,
		LightspeedDeployCost:         classicModeRules.LightspeedDeployCost,
		LightspeedJumpCost:           classicModeRules.LightspeedJumpCost,
		LightspeedCarryCap:           7, // 覆盖：classic 预设是 3
		LightspeedMessageEnabled:     classicModeRules.LightspeedMessageEnabled,
		RelicDistributionEnabled:     classicModeRules.RelicDistributionEnabled,
		StrikeOrigin:                 StrikeOriginOwnerPlanet, // 覆盖：classic 预设是 StrikeOriginStealthOwnerPlanet
		StrikeMissBehavior:           classicModeRules.StrikeMissBehavior,
		StrikeCanDestroyRelic:        classicModeRules.StrikeCanDestroyRelic,
	}
	overrides := GetRoomRulesWithOverrides("room-2", "classic", custom)

	// 索引
	configMap := make(map[string]RuleConfigItem)
	for _, c := range overrides.RuleConfigs {
		configMap[c.Key] = c
	}

	// 整数覆盖
	carryCap := configMap["lightspeed.carry_cap"]
	if carryCap.ActiveValue == nil {
		t.Fatal("lightspeed.carry_cap ActiveValue should not be nil")
	}
	if v, ok := carryCap.ActiveValue.(int); !ok || v != 7 {
		t.Errorf("lightspeed.carry_cap ActiveValue = %v, want int(7)", carryCap.ActiveValue)
	}
	if len(carryCap.Descriptions) != 1 {
		t.Errorf("lightspeed.carry_cap Descriptions 应仅保留一项，实际 %d 项", len(carryCap.Descriptions))
	}
	for k := range carryCap.Descriptions {
		if k != "classic.7" {
			t.Errorf("lightspeed.carry_cap Descriptions key = %q, want classic.7", k)
		}
	}

	// 枚举覆盖
	strikeOrigin := configMap["strike.origin"]
	if strikeOrigin.ActiveValue != "ownerPlanet" {
		t.Errorf("strike.origin ActiveValue = %v, want ownerPlanet", strikeOrigin.ActiveValue)
	}
	for k := range strikeOrigin.Descriptions {
		if k != "classic.ownerPlanet" {
			t.Errorf("strike.origin Descriptions key = %q, want classic.ownerPlanet", k)
		}
	}
}

// TestGetRoomRulesWithOverrides_UnchangedValueSkipped 验证当自定义值与预设相同时，
// 不修改 ActiveValue（保持原有的精确描述匹配）。
func TestGetRoomRulesWithOverrides_UnchangedValueSkipped(t *testing.T) {
	custom := &ModeRules{
		LightspeedUsage:              classicModeRules.LightspeedUsage,
		LightspeedCombinedActionCost: classicModeRules.LightspeedCombinedActionCost,
		LightspeedDeployCost:         classicModeRules.LightspeedDeployCost,
		LightspeedJumpCost:           classicModeRules.LightspeedJumpCost,
		LightspeedCarryCap:           classicModeRules.LightspeedCarryCap,
		LightspeedMessageEnabled:     classicModeRules.LightspeedMessageEnabled,
		RelicDistributionEnabled:     classicModeRules.RelicDistributionEnabled,
		StrikeOrigin:                 classicModeRules.StrikeOrigin,
		StrikeMissBehavior:           classicModeRules.StrikeMissBehavior,
		StrikeCanDestroyRelic:        classicModeRules.StrikeCanDestroyRelic,
	}
	overrides := GetRoomRulesWithOverrides("room-3", "classic", custom)
	base := GetRoomRules("room-3", GameModeClassic)
	// 所有项的 ActiveValue 应与基础一致
	for i, c := range overrides.RuleConfigs {
		if c.ActiveValue != base.RuleConfigs[i].ActiveValue {
			t.Errorf("RuleConfig %s ActiveValue 在无变化时不应被修改", c.Key)
		}
	}
}
