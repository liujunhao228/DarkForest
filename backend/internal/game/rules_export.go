package game

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

// ============================================================================
// 规则导出类型 — 这些结构体通过 HTTP API 暴露给前端，用于游戏规则展示
// ============================================================================

// EnumOption 枚举类型的可选值（替代旧版 []string 形式的 enumValues）。
type EnumOption struct {
	ID          string `json:"id"`          // 程序标识符，如 "direct"
	Label       string `json:"label"`       // 玩家友好标签，如 "即刻判定"
	Description string `json:"description"` // 该选项的独立玩家向说明
}

// GameConstantItem 游戏基础常量项（替代旧版 GameConstants 结构体）。
type GameConstantItem struct {
	Key         string `json:"key"`         // 程序标识符，如 "totalCards"
	Name        string `json:"name"`        // 玩家友好名，如 "总卡牌数"
	Value       any    `json:"value"`       // 实际值，如 72
	Unit        string `json:"unit,omitempty"` // 单位，如 "张" / "点" / "轮"
	Description string `json:"description"` // 玩家向说明，如 "本局游戏使用的卡牌总数"
}

// RuleConfigItem 描述一个可配置的游戏规则项，每种模式有独立的取值。
type RuleConfigItem struct {
	Key   string `json:"key"`
	Name  string `json:"name"`   // 玩家向概念名，如 "光速飞船使用方式"
	Type  string `json:"type"`   // "boolean" | "integer" | "enum"
	Category string `json:"category"` // "lightspeed" | "relic" | "strike"
	Values map[string]any `json:"values"` // {"classic": ..., "civilization_relics": ...}

	// 弃用字段 — 保留仅用于前端平滑迁移
	LegacyDescription string `json:"legacyDescription,omitempty"`

	// 新增玩家向展示字段
	ValueLabels   map[string]string `json:"valueLabels,omitempty"`   // 布尔/枚举值的玩家标签
	Descriptions  map[string]string `json:"descriptions"`            // 二维 key: "{mode}:{value}" → 玩家文案
	ValueTemplate string            `json:"valueTemplate,omitempty"` // 自定义房间改值时的兜底模板
	Unit          string            `json:"unit,omitempty"`          // integer 单位，如 "能量"
	EnumOptions   []EnumOption      `json:"enumOptions,omitempty"`   // type=enum 时的可选值列表

	// 房间 API 专用（仅 GET /api/rooms/:roomId/rules 时填充）
	ActiveValue any `json:"activeValue,omitempty"` // 当前模式下的取值
}

// ModePreset 描述一个游戏模式的预设信息。
type ModePreset struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// RelicComboExport 遗迹组合的可导出形式（不含 Card 结构体，仅含设施名称和 defId）。
type RelicComboExport struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Strength       string   `json:"strength"`
	Lore           string   `json:"lore"`
	Energy         int      `json:"energy"`
	FacilityNames  []string `json:"facilityNames"`
	FacilityDefIDs []string `json:"facilityDefIds"`
}

// StarNodeExport 星图节点的可导出形式。
type StarNodeExport struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// StarEdgeExport 星图边的可导出形式。
type StarEdgeExport struct {
	From int `json:"from"`
	To   int `json:"to"`
}

// StarMapExport 星图的可导出形式。
type StarMapExport struct {
	Nodes []StarNodeExport `json:"nodes"`
	Edges []StarEdgeExport `json:"edges"`
}

// MechanismDescription 单个机制的说明。
type MechanismDescription struct {
	Description string   `json:"description"`
	Phases      []string `json:"phases,omitempty"`
}

// StrikeMechanism 打击机制的说明。
type StrikeMechanism struct {
	Description   string   `json:"description"`
	OriginModes   []string `json:"originModes"`
	MissBehaviors []string `json:"missBehaviors"`
}

// SettlementMechanism 设施产能结算机制的说明。
type SettlementMechanism struct {
	Description             string   `json:"description"`
	StarDependentFacilities []string `json:"starDependentFacilities"`
}

// WinConditionMechanism 胜负条件说明。
type WinConditionMechanism struct {
	Description string `json:"description"`
}

// GameMechanisms 各游戏机制的说明。
type GameMechanisms struct {
	Broadcast   *MechanismDescription   `json:"broadcast,omitempty"`
	Strike      *StrikeMechanism        `json:"strike,omitempty"`
	Settlement  *SettlementMechanism    `json:"settlement,omitempty"`
	WinCondition *WinConditionMechanism `json:"winCondition,omitempty"`
}

// PayoffEntry 广播收益矩阵的单个条目。
type PayoffEntry struct {
	Broadcaster int `json:"broadcaster"`
	Responder   int `json:"responder"`
}

// BroadcastMechanism 含收益矩阵的广播机制说明。
type BroadcastMechanism struct {
	Description  string                  `json:"description"`
	Phases       []string                `json:"phases"`
	PayoffMatrix map[string]PayoffEntry  `json:"payoffMatrix"`
}

// RulesResponse 是 GET /api/game/rules 的完整响应结构。
type RulesResponse struct {
	CardDefinitions []CardDef              `json:"cardDefinitions"`
	RuleConfigs     []RuleConfigItem       `json:"ruleConfigs"`
	ModePresets     []ModePreset           `json:"modePresets"`
	RelicCombos     []RelicComboExport     `json:"relicCombos"`
	StarMap         StarMapExport          `json:"starMap"`
	GameConstants   []GameConstantItem     `json:"gameConstants"` // v1.1: 改为数组形式，每项含 description
	Mechanisms      GameMechanisms         `json:"mechanisms"`
	// 以下字段仅 GET /api/rooms/:roomId/rules 时填充
	RoomID      string         `json:"roomId,omitempty"`
	GameMode    string         `json:"gameMode,omitempty"`
	ActiveValues map[string]any `json:"activeValues,omitempty"`
}

// ============================================================================
// 规则导出函数
// ============================================================================

// buildRuleConfigs 从规则常量和面向玩家的文案组装配置项列表。
// 规则常量来自 mode_rules.go（Values），文案来自 rules_descriptions.go（Name/Descriptions等）。
// 文案与规则常量严格解耦。
func buildRuleConfigs() []RuleConfigItem {
	keys := []string{
		"lightspeed.one_time",
		"lightspeed.deploy_cost",
		"lightspeed.random_cost",
		"lightspeed.specified_cost",
		"lightspeed.carry_cap",
		"lightspeed.message_enabled",
		"relic.distribution_enabled",
		"strike.origin",
		"strike.miss_behavior",
		"strike.can_destroy_relic",
	}
	items := make([]RuleConfigItem, 0, len(keys))
	for _, k := range keys {
		items = append(items, buildSingleRuleConfig(k))
	}
	return items
}

// buildSingleRuleConfig 根据 config key 组装单个 RuleConfigItem。
func buildSingleRuleConfig(key string) RuleConfigItem {
	// Values 来自 mode_rules.go 的规则常量
	vals := computeRuleValues(key)

	// 类型和分类从 values 推导 / 硬编码
	typ := ""
	cat := ""
	switch {
	case strings.HasPrefix(key, "lightspeed."):
		cat = "lightspeed"
	case strings.HasPrefix(key, "relic."):
		cat = "relic"
	case strings.HasPrefix(key, "strike."):
		cat = "strike"
	}
	switch key {
	case "lightspeed.one_time", "lightspeed.message_enabled",
		"relic.distribution_enabled", "strike.can_destroy_relic":
		typ = "boolean"
	case "lightspeed.deploy_cost", "lightspeed.random_cost",
		"lightspeed.specified_cost", "lightspeed.carry_cap":
		typ = "integer"
	case "strike.origin", "strike.miss_behavior":
		typ = "enum"
	}

	// 从 rules_descriptions.go 取文案（解耦）
	descs := copyStringMap(ruleConfigDescriptions[key])
	valueLabels := copyStringMap(ruleConfigValueLabels[key])
	valueTmpl := ruleConfigValueTemplates[key]
	enumOpts := ruleConfigEnumOptions[key]
	legacyDesc := ruleConfigLegacyDescriptions[key]
	name := ruleConfigNames[key]

	// unit 硬编码（小型，不额外拆分文件）
	unit := ""
	switch key {
	case "lightspeed.deploy_cost", "lightspeed.random_cost",
		"lightspeed.specified_cost", "lightspeed.carry_cap":
		unit = "能量"
	}

	return RuleConfigItem{
		Key:                key,
		Name:               name,
		Type:               typ,
		Category:           cat,
		Values:             vals,
		LegacyDescription:  legacyDesc,
		ValueLabels:        valueLabels,
		Descriptions:       descs,
		ValueTemplate:      valueTmpl,
		Unit:               unit,
		EnumOptions:        enumOpts,
	}
}

// computeRuleValues 根据 key 从 mode_rules.go 的规则常量中计算出两模式的取值。
func computeRuleValues(key string) map[string]any {
	m := map[string]any{}
	switch key {
	case "lightspeed.one_time":
		m["classic"] = classicModeRules.LightspeedOneTime
		m["civilization_relics"] = relicsModeRules.LightspeedOneTime
	case "lightspeed.deploy_cost":
		m["classic"] = classicModeRules.LightspeedDeployCost
		m["civilization_relics"] = relicsModeRules.LightspeedDeployCost
	case "lightspeed.random_cost":
		m["classic"] = classicModeRules.LightspeedCombinedActionCost
		m["civilization_relics"] = relicsModeRules.LightspeedJumpCostRandom
	case "lightspeed.specified_cost":
		m["classic"] = classicModeRules.LightspeedCombinedActionCostSpecified
		m["civilization_relics"] = relicsModeRules.LightspeedJumpCostSpecified
	case "lightspeed.carry_cap":
		m["classic"] = classicModeRules.LightspeedCarryCap
		m["civilization_relics"] = relicsModeRules.LightspeedCarryCap
	case "lightspeed.message_enabled":
		m["classic"] = classicModeRules.LightspeedMessageEnabled
		m["civilization_relics"] = relicsModeRules.LightspeedMessageEnabled
	case "relic.distribution_enabled":
		m["classic"] = classicModeRules.RelicDistributionEnabled
		m["civilization_relics"] = relicsModeRules.RelicDistributionEnabled
	case "strike.origin":
		m["classic"] = strikeOriginToString(classicModeRules.StrikeOrigin)
		m["civilization_relics"] = strikeOriginToString(relicsModeRules.StrikeOrigin)
	case "strike.miss_behavior":
		m["classic"] = strikeMissBehaviorToString(classicModeRules.StrikeMissBehavior)
		m["civilization_relics"] = strikeMissBehaviorToString(relicsModeRules.StrikeMissBehavior)
	case "strike.can_destroy_relic":
		m["classic"] = classicModeRules.StrikeCanDestroyRelic
		m["civilization_relics"] = relicsModeRules.StrikeCanDestroyRelic
	}
	return m
}

// copyStringMap 返回 m 的浅拷贝，避免后续修改影响原始全局变量。
func copyStringMap(m map[string]string) map[string]string {
	if m == nil {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// strikeOriginToString 将 StrikeOrigin 枚举转为字符串。
func strikeOriginToString(o StrikeOrigin) string {
	switch o {
	case StrikeOriginDirect:
		return "direct"
	case StrikeOriginOwnerPlanet:
		return "ownerPlanet"
	case StrikeOriginStealthOwnerPlanet:
		return "stealthOwnerPlanet"
	default:
		return "direct"
	}
}

// strikeMissBehaviorToString 将 StrikeMissBehavior 枚举转为字符串。
func strikeMissBehaviorToString(b StrikeMissBehavior) string {
	switch b {
	case StrikeMissDiscard:
		return "discard"
	case StrikeMissFreeControl:
		return "freeControl"
	case StrikeMissRequireTarget:
		return "requireTarget"
	default:
		return "discard"
	}
}

// buildModePresets 返回两个游戏模式的预设描述。
// 文案来自 rules_descriptions.go 的 modePresetDescriptions，按固定顺序（classic 在前）返回。
func buildModePresets() []ModePreset {
	return []ModePreset{
		modePresetDescriptions["classic"],
		modePresetDescriptions["civilization_relics"],
	}
}

// exportableRelicCombos 将 RelicCombos 转为可序列化的导出形式。
func exportableRelicCombos() []RelicComboExport {
	result := make([]RelicComboExport, 0, len(RelicCombos))
	for _, c := range RelicCombos {
		strength := "弱"
		switch c.Strength {
		case RelicStrengthMedium:
			strength = "中"
		case RelicStrengthStrong:
			strength = "强"
		}
		facilityNames := make([]string, 0, len(c.Facilities))
		facilityDefIDs := make([]string, 0, len(c.Facilities))
		for _, f := range c.Facilities {
			facilityNames = append(facilityNames, f.Name)
			facilityDefIDs = append(facilityDefIDs, f.DefID)
		}
		result = append(result, RelicComboExport{
			ID:             c.ID,
			Name:           c.Name,
			Strength:       strength,
			Lore:           c.Lore,
			Energy:         c.Energy,
			FacilityNames:  facilityNames,
			FacilityDefIDs: facilityDefIDs,
		})
	}
	return result
}

// exportableStarMap 构建星图的可导出形式（不含坐标，仅供前端展示星图拓扑）。
func exportableStarMap() StarMapExport {
	nodes := make([]StarNodeExport, 0, len(StarNodes))
	for _, n := range StarNodes {
		nodes = append(nodes, StarNodeExport{
			ID:   n.ID,
			Name: n.Name,
		})
	}
	edges := make([]StarEdgeExport, 0, len(StarEdges))
	for _, e := range StarEdges {
		edges = append(edges, StarEdgeExport{
			From: e.From,
			To:   e.To,
		})
	}
	return StarMapExport{
		Nodes: nodes,
		Edges: edges,
	}
}

// exportConstants 返回游戏基础常量列表（带玩家向描述）。
func exportConstants() []GameConstantItem {
	// 返回拷贝，防止外部修改全局变量
	result := make([]GameConstantItem, len(gameConstantDescriptions))
	copy(result, gameConstantDescriptions)
	return result
}

// exportMechanisms 返回各游戏机制的说明。
// 文案来自 rules_descriptions.go 的 mechanismDescriptions；结构数据（phases / originModes / starDependentFacilities）保留在此。
func exportMechanisms() GameMechanisms {
	return GameMechanisms{
		Broadcast: &MechanismDescription{
			Description: mechanismDescriptions.Broadcast,
			Phases:      []string{"waiting", "select", "reveal", "resolve"},
		},
		Strike: &StrikeMechanism{
			Description:   mechanismDescriptions.Strike,
			OriginModes:   []string{"direct", "ownerPlanet", "stealthOwnerPlanet"},
			MissBehaviors: []string{"discard", "freeControl", "requireTarget"},
		},
		Settlement: &SettlementMechanism{
			Description:             mechanismDescriptions.Settlement,
			StarDependentFacilities: []string{"facility_solar_array", "facility_dyson_sphere"},
		},
		WinCondition: &WinConditionMechanism{
			Description: mechanismDescriptions.WinCondition,
		},
	}
}

// extractActiveValues 从 RuleConfigs 中提取指定模式的活跃值。
// 若 mode 不是已知模式（classic / civilization_relics），回退到 classic。
func extractActiveValues(configs []RuleConfigItem, mode GameMode) map[string]any {
	modeStr := string(mode)
	// 仅 "classic" 和 "civilization_relics" 为已知模式
	if modeStr != "classic" && modeStr != "civilization_relics" {
		modeStr = "classic"
	}
	values := make(map[string]any, len(configs))
	for _, c := range configs {
		if v, ok := c.Values[modeStr]; ok {
			values[c.Key] = v
		}
	}
	return values
}

// formatConfigValue 将配置值转为 descriptions map 中的 key 片段。
// 布尔 → "true"/"false"；整数 → 数字字符串；枚举 → 原字符串。
func formatConfigValue(v any) string {
	switch val := v.(type) {
	case bool:
		if val {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(val)
	case string:
		return val
	default:
		return fmt.Sprintf("%v", val)
	}
}

// filterRoomRuleConfigs 过滤每条 config 的 descriptions map，
// 仅保留 key 为 "{mode}:{activeValue}" 的那一条描述；
// 同时设置 ActiveValue 字段。
func filterRoomRuleConfigs(configs []RuleConfigItem, mode GameMode) []RuleConfigItem {
	modeStr := string(mode)
	if modeStr != "classic" && modeStr != "civilization_relics" {
		modeStr = "classic"
	}
	for i := range configs {
		c := &configs[i]
		activeVal, ok := c.Values[modeStr]
		if !ok {
			continue
		}
		c.ActiveValue = activeVal

		activeKey := modeStr + "." + formatConfigValue(activeVal)
		if desc, found := c.Descriptions[activeKey]; found {
			// 精确匹配：仅保留这一条
			c.Descriptions = map[string]string{activeKey: desc}
		} else if c.ValueTemplate != "" {
			// 自定义房间改值场景：用模板渲染兜底描述
			rendered := strings.ReplaceAll(c.ValueTemplate, "{value}", formatConfigValue(activeVal))
			c.Descriptions = map[string]string{activeKey: rendered}
		} else {
			// 极端兜底：清空 descriptions
			c.Descriptions = map[string]string{}
		}
	}
	return configs
}

// GetAllRules 聚合全部游戏规则数据，供 GET /api/game/rules 使用。
func GetAllRules() RulesResponse {
	return RulesResponse{
		CardDefinitions: CardDefinitions,
		RuleConfigs:     buildRuleConfigs(),
		ModePresets:     buildModePresets(),
		RelicCombos:     exportableRelicCombos(),
		StarMap:         exportableStarMap(),
		GameConstants:   exportConstants(),
		Mechanisms:      exportMechanisms(),
	}
}

// GetRoomRules 获取指定房间的游戏规则。
// 需要根据 gameMode 过滤数据。未知模式回退到 classic。
func GetRoomRules(roomID string, gameMode GameMode) RulesResponse {
	all := GetAllRules()
	all.RoomID = roomID
	all.GameMode = string(gameMode)
	all.ActiveValues = extractActiveValues(all.RuleConfigs, gameMode)
	// 过滤 descriptions：仅保留当前 mode:activeValue 的一条
	all.RuleConfigs = filterRoomRuleConfigs(all.RuleConfigs, gameMode)
	// 经典模式（包含未知模式回退）不返回遗迹列表
	if gameMode != GameModeCivilizationRelics {
		all.RelicCombos = nil
	}
	return all
}

// GetRoomRulesWithOverrides 获取指定房间的游戏规则，支持自定义规则覆盖。
// baseMode 为房主选定的模板（classic / civilization_relics）。
// customRules 为房主在模板之上逐项调整后的全量 ModeRules。
//
// 行为：
//   - customRules==nil：等价于 GetRoomRules(roomID, baseMode)
//   - customRules!=nil：以 baseMode 为基础，对 customRules 中与基础预设不同的项应用覆盖：
//     * 更新 RuleConfigItem.ActiveValue 为覆盖值
//     * 更新 ActiveValues map 中对应项
//     * 重新渲染 Descriptions（精确匹配 + valueTemplate 兜底）
//
// 与后端对局引擎的 StateRules(state) 语义一致：customRules 优先于 baseMode 预设。
func GetRoomRulesWithOverrides(roomID string, baseMode string, customRules *ModeRules) RulesResponse {
	base := GetRoomRules(roomID, GameMode(baseMode))
	if customRules == nil {
		return base
	}
	overrides := modeRulesToActiveValues(customRules)
	base.RuleConfigs = applyCustomOverrides(base.RuleConfigs, overrides, baseMode)
	// 同步 ActiveValues map
	for k, v := range overrides {
		base.ActiveValues[k] = v
	}
	return base
}

// modeRulesToActiveValues 将自定义 ModeRules 转为与 extractActiveValues 同 key 集的活动值映射。
// 用于在 API 层将 int 枚举（StrikeOrigin/StrikeMissBehavior）转为字符串，与前端约定一致。
func modeRulesToActiveValues(r *ModeRules) map[string]any {
	if r == nil {
		return nil
	}
	return map[string]any{
		"lightspeed.one_time":           r.LightspeedOneTime,
		"lightspeed.deploy_cost":        r.LightspeedDeployCost,
		"lightspeed.random_cost":        r.LightspeedCombinedActionCost,
		"lightspeed.specified_cost":     r.LightspeedCombinedActionCostSpecified,
		"lightspeed.carry_cap":          r.LightspeedCarryCap,
		"lightspeed.message_enabled":    r.LightspeedMessageEnabled,
		"relic.distribution_enabled":    r.RelicDistributionEnabled,
		"strike.origin":                 strikeOriginToString(r.StrikeOrigin),
		"strike.miss_behavior":          strikeMissBehaviorToString(r.StrikeMissBehavior),
		"strike.can_destroy_relic":      r.StrikeCanDestroyRelic,
	}
}

// applyCustomOverrides 对已由 baseMode 过滤过的 RuleConfigs 应用自定义覆盖。
// 对每个在 overrides 中且与 c.ActiveValue 不同的项，重写 ActiveValue + 重建 Descriptions。
// 与 filterRoomRuleConfigs 的 description 处理逻辑保持一致：精确匹配优先，valueTemplate 兜底。
func applyCustomOverrides(configs []RuleConfigItem, overrides map[string]any, baseMode string) []RuleConfigItem {
	if len(overrides) == 0 {
		return configs
	}
	for i := range configs {
		c := &configs[i]
		overrideVal, ok := overrides[c.Key]
		if !ok {
			continue
		}
		// 跳过无变化的覆盖（前端编辑后未实际修改）
		if reflect.DeepEqual(c.ActiveValue, overrideVal) {
			continue
		}
		c.ActiveValue = overrideVal
		activeKey := baseMode + "." + formatConfigValue(overrideVal)
		if desc, found := c.Descriptions[activeKey]; found {
			c.Descriptions = map[string]string{activeKey: desc}
		} else if c.ValueTemplate != "" {
			rendered := strings.ReplaceAll(c.ValueTemplate, "{value}", formatConfigValue(overrideVal))
			c.Descriptions = map[string]string{activeKey: rendered}
		} else {
			c.Descriptions = map[string]string{}
		}
	}
	return configs
}
