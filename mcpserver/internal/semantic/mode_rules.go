package semantic

// mode_rules.go — MCP Server 侧的模式规则类型与查询函数。
//
// 设计：
//   - ModeRules 结构体与后端 backend/internal/game/mode_rules.go 对齐。
//   - 规则常量值由 mode_rules_gen.go（代码生成产物）提供，数据源为后端 game 包，
//     确保三处文案一致。运行 "go run ../../backend/cmd/codegen" 在 mcpserver/ 下重新生成。
//   - 字符串枚举常量（StrikeOriginDirect 等）保留在此（mcpserver 独有设计）。
//   - MCP Server 是独立进程，不能依赖后端运行时；生成产物保证无后端连接时仍可工作。
//
// 与后端的差异：
//   - 后端 StrikeOrigin / StrikeMissBehavior 使用私有 iota 枚举，
//     此处改为 string 常量，便于 JSON 序列化与跨进程消费。
//   - 增加 Mode 与 Description 字段，供 Resource 消费者识别模式与理解差异。

// StrikeOriginDirect 表示打击直接在 TargetSystem 出现并即刻判定(Classic 模式)。
const StrikeOriginDirect = "direct"

// StrikeOriginOwnerPlanet 表示打击从 owner 星球出现,逐跳飞行到达 TargetSystem 后判定(Relics 模式)。
const StrikeOriginOwnerPlanet = "ownerPlanet"

// StrikeOriginStealthOwnerPlanet 表示「隐逐跳」:行为同 OwnerPlanet,
// 但飞行路径仅拥有者可见;对其他玩家仅揭露 TargetSystem 与当前位置到目标的图最短跳数距离。
// 回放(REPLAY)观察者可见完整路径。
const StrikeOriginStealthOwnerPlanet = "stealthOwnerPlanet"

// StrikeMissDiscard 表示打击落空时废弃到弃牌堆(Classic / Relics 模式)。
const StrikeMissDiscard = "discard"

// StrikeMissFreeControl 表示打击落空时保留为 Missed 飞行打击,玩家自由重定向/跳过/废弃。
const StrikeMissFreeControl = "freeControl"

// StrikeMissRequireTarget 表示打击落空时保留为 Missed 飞行打击,玩家必须指定新 TargetSystem 或废弃。
const StrikeMissRequireTarget = "requireTarget"

// ModeClassic 是经典模式标识,对齐后端 game.GameModeClassic。
const ModeClassic = "classic"

// ModeCivilizationRelics 是文明遗迹模式标识,对齐后端 game.GameModeCivilizationRelics。
const ModeCivilizationRelics = "civilization_relics"

// ModeRules 描述特定游戏模式的规则差异,镜像后端 game.ModeRules。
// 字段为编译期常量,运行时不变。
type ModeRules struct {
	// Mode 是模式标识(classic / civilization_relics)。
	Mode string `json:"mode"`

	// 光速飞船规则
	// LightspeedOneTime: true=一次性(Classic), false=可复用(Relics)
	LightspeedOneTime                     bool `json:"lightspeedOneTime"`
	LightspeedCombinedActionCost          int  `json:"lightspeedCombinedActionCost"`          // Classic 合并动作成本(random)
	LightspeedCombinedActionCostSpecified int  `json:"lightspeedCombinedActionCostSpecified"` // Classic 合并动作成本(specified)
	LightspeedDeployCost                  int  `json:"lightspeedDeployCost"`                  // Relics 部署成本
	LightspeedJumpCostRandom              int  `json:"lightspeedJumpCostRandom"`              // Relics 跃迁成本(random)
	LightspeedJumpCostSpecified           int  `json:"lightspeedJumpCostSpecified"`           // Relics 跃迁成本(specified)
	LightspeedCarryCap                    int  `json:"lightspeedCarryCap"`                    // 携带能量上限
	LightspeedMessageEnabled              bool `json:"lightspeedMessageEnabled"`              // 是否启用留言

	// 遗迹规则
	RelicDistributionEnabled bool `json:"relicDistributionEnabled"` // 是否启用遗迹分布

	// 打击规则
	StrikeOrigin          string `json:"strikeOrigin"`          // 打击出现位置: direct / ownerPlanet
	StrikeMissBehavior    string `json:"strikeMissBehavior"`    // 打击落空处理: discard / freeControl / requireTarget
	StrikeCanDestroyRelic bool   `json:"strikeCanDestroyRelic"` // 打击可否摧毁遗留物

	// Description 是模式的人类可读摘要(中文,事实陈述)。
	Description string `json:"description"`
}



// GetModeRules 按 mode 标识返回对应 ModeRules。
// 对齐前端 modeRules.ts:72-75 的回退语义：未知模式（含空串）回退到 Classic。
// mode 取值: classic / civilization_relics / 其他（回退 Classic）。
// 第二个返回值始终为 true（向后兼容签名，未来可移除）。
func GetModeRules(mode string) (ModeRules, bool) {
	switch mode {
	case ModeCivilizationRelics:
		return relicsModeRules, true
	default:
		// 包括 ModeClassic 与所有未知模式（含空串）
		return classicModeRules, true
	}
}

// ListModeRules 返回全部模式规则(2 套:Classic + Civilization Relics)。
// 用于 Resource 消费者枚举所有可用模式。
func ListModeRules() []ModeRules {
	return []ModeRules{classicModeRules, relicsModeRules}
}
