package game

import (
	"encoding/json"
	"fmt"
)

// StrikeOrigin 描述打击牌的出现位置规则。
type StrikeOrigin int

const (
	// StrikeOriginDirect 直接在 TargetSystem 出现并即刻判定（Classic 模式）。
	StrikeOriginDirect StrikeOrigin = iota
	// StrikeOriginOwnerPlanet 从 owner 星球出现，逐跳飞行到达 TargetSystem 后判定（Relics 模式）。
	StrikeOriginOwnerPlanet
	// StrikeOriginStealthOwnerPlanet 「隐逐跳」：行为同 OwnerPlanet（从 owner 星球逐跳飞行），
	// 但飞行路径仅拥有者可见；对其他玩家仅揭露 TargetSystem 与打击当前位置到目标的图最短跳数距离。
	// 回放（REPLAY）观察者可见完整路径，用于复盘。
	StrikeOriginStealthOwnerPlanet
)

// MarshalJSON 将 StrikeOrigin 序列化为前端约定的字符串。
func (s StrikeOrigin) MarshalJSON() ([]byte, error) {
	return json.Marshal(strikeOriginToString(s))
}

// UnmarshalJSON 从 JSON 反序列化 StrikeOrigin，同时支持字符串（前端约定）和整数（旧数据兼容）。
func (s *StrikeOrigin) UnmarshalJSON(data []byte) error {
	// 尝试作为字符串解析
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		*s = stringToStrikeOrigin(str)
		return nil
	}
	// 回退：作为整数解析（兼容旧格式）
	var i int
	if err := json.Unmarshal(data, &i); err != nil {
		return fmt.Errorf("invalid StrikeOrigin: %s", string(data))
	}
	*s = StrikeOrigin(i)
	return nil
}

// stringToStrikeOrigin 将字符串转为 StrikeOrigin 枚举。
func stringToStrikeOrigin(s string) StrikeOrigin {
	switch s {
	case "direct":
		return StrikeOriginDirect
	case "ownerPlanet":
		return StrikeOriginOwnerPlanet
	case "stealthOwnerPlanet":
		return StrikeOriginStealthOwnerPlanet
	default:
		return StrikeOriginDirect
	}
}

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

// MarshalJSON 将 StrikeMissBehavior 序列化为前端约定的字符串。
func (b StrikeMissBehavior) MarshalJSON() ([]byte, error) {
	return json.Marshal(strikeMissBehaviorToString(b))
}

// UnmarshalJSON 从 JSON 反序列化 StrikeMissBehavior，同时支持字符串（前端约定）和整数（旧数据兼容）。
func (b *StrikeMissBehavior) UnmarshalJSON(data []byte) error {
	// 尝试作为字符串解析
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		*b = stringToStrikeMissBehavior(str)
		return nil
	}
	// 回退：作为整数解析（兼容旧格式）
	var i int
	if err := json.Unmarshal(data, &i); err != nil {
		return fmt.Errorf("invalid StrikeMissBehavior: %s", string(data))
	}
	*b = StrikeMissBehavior(i)
	return nil
}

// stringToStrikeMissBehavior 将字符串转为 StrikeMissBehavior 枚举。
func stringToStrikeMissBehavior(s string) StrikeMissBehavior {
	switch s {
	case "discard":
		return StrikeMissDiscard
	case "freeControl":
		return StrikeMissFreeControl
	case "requireTarget":
		return StrikeMissRequireTarget
	default:
		return StrikeMissDiscard
	}
}

// ModeRules 描述特定游戏模式的规则差异。字段为编译期常量，不序列化进 GameState。
type ModeRules struct {
	// 光速飞船
	LightspeedOneTime                     bool `json:"lightspeedOneTime"`                     // true=一次性(Classic), false=可复用(Relics)
	LightspeedCombinedActionCost          int  `json:"lightspeedCombinedActionCost"`          // Classic 合并动作成本(random)
	LightspeedCombinedActionCostSpecified int  `json:"lightspeedCombinedActionCostSpecified"` // Classic 合并动作成本(specified)
	LightspeedDeployCost                  int  `json:"lightspeedDeployCost"`                  // Relics 部署成本
	LightspeedJumpCostRandom              int  `json:"lightspeedJumpCostRandom"`              // Relics 跃迁成本(random)
	LightspeedJumpCostSpecified           int  `json:"lightspeedJumpCostSpecified"`           // Relics 跃迁成本(specified)
	LightspeedCarryCap                    int  `json:"lightspeedCarryCap"`                    // 携带能量上限
	LightspeedMessageEnabled              bool `json:"lightspeedMessageEnabled"`              // 是否启用留言
	// 遗迹
	RelicDistributionEnabled bool `json:"relicDistributionEnabled"` // 是否启用遗迹分布
	// 打击
	StrikeOrigin          StrikeOrigin         `json:"strikeOrigin"`          // 打击出现位置
	StrikeMissBehavior    StrikeMissBehavior   `json:"strikeMissBehavior"`    // 打击落空处理
	StrikeCanDestroyRelic bool                 `json:"strikeCanDestroyRelic"` // 打击可否摧毁遗留物
}

// classicModeRules 是 Classic 模式的规则常量。
var classicModeRules = ModeRules{
	LightspeedOneTime:                     true,
	LightspeedCombinedActionCost:          10,
	LightspeedCombinedActionCostSpecified: 13,
	LightspeedDeployCost:                  0,
	LightspeedJumpCostRandom:              0,
	LightspeedJumpCostSpecified:           0,
	LightspeedCarryCap:                    0,
	LightspeedMessageEnabled:              false,
	RelicDistributionEnabled:              false,
	StrikeOrigin:                          StrikeOriginDirect,
	StrikeMissBehavior:                    StrikeMissDiscard,
	StrikeCanDestroyRelic:                 false,
}

// relicsModeRules 是文明遗迹模式的规则常量。
var relicsModeRules = ModeRules{
	LightspeedOneTime:                     false,
	LightspeedCombinedActionCost:          0,
	LightspeedCombinedActionCostSpecified: 0,
	LightspeedDeployCost:                  10,
	LightspeedJumpCostRandom:              3,
	LightspeedJumpCostSpecified:           5,
	LightspeedCarryCap:                    5,
	LightspeedMessageEnabled:              true,
	RelicDistributionEnabled:              true,
	StrikeOrigin:                          StrikeOriginOwnerPlanet,
	StrikeMissBehavior:                    StrikeMissDiscard,
	StrikeCanDestroyRelic:                 true,
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

// StateRules 返回 state 当前实际生效的规则。
// 当 state.ModeRules 非空（自定义房间覆盖）时返回该覆盖值；否则回退到
// GetModeRules(state.GameMode) 的预设。
// 向后兼容：旧回放 state.ModeRules 为 nil（未序列化字段），自动回退到预设规则。
func StateRules(state *GameState) ModeRules {
	if state == nil {
		return GetModeRules("")
	}
	if state.ModeRules != nil {
		return *state.ModeRules
	}
	return GetModeRules(state.GameMode)
}
