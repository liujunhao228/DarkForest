package game

// StrikeOrigin 描述打击牌的出现位置规则。
type StrikeOrigin int

const (
	// StrikeOriginDirect 直接在 TargetSystem 出现并即刻判定（Classic 模式）。
	StrikeOriginDirect StrikeOrigin = iota
	// StrikeOriginOwnerPlanet 从 owner 星球出现，逐跳飞行到达 TargetSystem 后判定（Relics 模式）。
	StrikeOriginOwnerPlanet
)

// StrikeMissBehavior 描述打击落空（TargetSystem 无目标玩家）时的处理策略。
type StrikeMissBehavior int

const (
	// StrikeMissDiscard 将打击牌废弃到弃牌堆（Classic / Relics 模式）。
	StrikeMissDiscard StrikeMissBehavior = iota
	// StrikeMissFreeControl 保留为 Missed 飞行打击，玩家可重定向/跳过/废弃。
	StrikeMissFreeControl
	// StrikeMissRequireTarget 保留为 Missed 飞行打击，玩家必须先指定新 TargetSystem 或废弃。
	StrikeMissRequireTarget
)

// ModeRules 描述特定游戏模式的规则差异。字段为编译期常量，不序列化进 GameState。
type ModeRules struct {
	// 光速飞船
	LightspeedOneTime                  bool // true=一次性(Classic), false=可复用(Relics)
	LightspeedCombinedActionCost       int  // Classic 合并动作成本(random)
	LightspeedCombinedActionCostSpecified int // Classic 合并动作成本(specified)
	LightspeedDeployCost               int  // Relics 部署成本
	LightspeedJumpCostRandom           int  // Relics 跃迁成本(random)
	LightspeedJumpCostSpecified        int  // Relics 跃迁成本(specified)
	LightspeedCarryCap                 int  // 携带能量上限
	LightspeedMessageEnabled           bool // 是否启用留言
	// 遗迹
	RelicDistributionEnabled bool // 是否启用遗迹分布
	// 打击
	StrikeOrigin       StrikeOrigin       // 打击出现位置
	StrikeMissBehavior StrikeMissBehavior // 打击落空处理
}

// classicModeRules 是 Classic 模式的规则常量。
var classicModeRules = ModeRules{
	LightspeedOneTime:                     true,
	LightspeedCombinedActionCost:           10,
	LightspeedCombinedActionCostSpecified:  13,
	LightspeedDeployCost:                   0,
	LightspeedJumpCostRandom:               0,
	LightspeedJumpCostSpecified:            0,
	LightspeedCarryCap:                     0,
	LightspeedMessageEnabled:               false,
	RelicDistributionEnabled:               false,
	StrikeOrigin:                          StrikeOriginDirect,
	StrikeMissBehavior:                    StrikeMissDiscard,
}

// relicsModeRules 是文明遗迹模式的规则常量。
var relicsModeRules = ModeRules{
	LightspeedOneTime:                     false,
	LightspeedCombinedActionCost:           0,
	LightspeedCombinedActionCostSpecified:  0,
	LightspeedDeployCost:                   10,
	LightspeedJumpCostRandom:               3,
	LightspeedJumpCostSpecified:            5,
	LightspeedCarryCap:                     5,
	LightspeedMessageEnabled:               true,
	RelicDistributionEnabled:               true,
	StrikeOrigin:                          StrikeOriginOwnerPlanet,
	StrikeMissBehavior:                    StrikeMissDiscard,
}

// GetModeRules 根据游戏模式返回对应的 ModeRules。
// 未知模式（包括空串 GameMode("")）回退到 Classic 规则。
func GetModeRules(mode GameMode) ModeRules {
	switch mode {
	case GameModeCivilizationRelics:
		return relicsModeRules
	default:
		// 包括 GameModeClassic 与所有未知模式
		return classicModeRules
	}
}
