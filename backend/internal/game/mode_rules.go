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

// LightspeedUsage 描述光速飞船使用方式。
type LightspeedUsage int

const (
	// LightspeedUsageOneTime 光速飞船为一次性牌，从手牌跃迁后进弃牌堆（Classic 模式）。
	LightspeedUsageOneTime LightspeedUsage = iota // "oneTime"
	// LightspeedUsageReusable 光速飞船为可复用的设施，部署后保留（Relics 模式）。
	LightspeedUsageReusable // "reusable"
)

// MarshalJSON 将 LightspeedUsage 序列化为前端约定的字符串。
func (u LightspeedUsage) MarshalJSON() ([]byte, error) {
	return json.Marshal(lightspeedUsageToString(u))
}

// UnmarshalJSON 从 JSON 反序列化 LightspeedUsage，同时支持字符串（前端约定）、
// 整数（旧数据兼容）和布尔值（旧 lightspeedOneTime 字段兼容：true→oneTime, false→reusable）。
func (u *LightspeedUsage) UnmarshalJSON(data []byte) error {
	// 尝试作为字符串解析
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		*u = stringToLightspeedUsage(str)
		return nil
	}
	// 回退：作为整数解析（兼容旧格式）
	var i int
	if err := json.Unmarshal(data, &i); err == nil {
		*u = LightspeedUsage(i)
		return nil
	}
	// 回退：作为布尔值解析（兼容旧 lightspeedOneTime 字段）
	var b bool
	if err := json.Unmarshal(data, &b); err == nil {
		if b {
			*u = LightspeedUsageOneTime
		} else {
			*u = LightspeedUsageReusable
		}
		return nil
	}
	return fmt.Errorf("invalid LightspeedUsage: %s", string(data))
}

// stringToLightspeedUsage 将字符串转为 LightspeedUsage 枚举。
func stringToLightspeedUsage(s string) LightspeedUsage {
	switch s {
	case "oneTime":
		return LightspeedUsageOneTime
	case "reusable":
		return LightspeedUsageReusable
	default:
		return LightspeedUsageOneTime
	}
}

// ModeRules 描述特定游戏模式的规则差异。字段为编译期常量，不序列化进 GameState。
type ModeRules struct {
	// 光速飞船
	LightspeedUsage                       LightspeedUsage `json:"lightspeedUsage"`                       // 光速飞船使用方式
	LightspeedCombinedActionCost          int             `json:"lightspeedCombinedActionCost"`          // Classic 合并动作成本(random)
	LightspeedCombinedActionCostSpecified int             `json:"lightspeedCombinedActionCostSpecified"` // Classic 合并动作成本(specified)
	LightspeedDeployCost                  int             `json:"lightspeedDeployCost"`                  // Relics 部署成本
	LightspeedJumpCostRandom              int             `json:"lightspeedJumpCostRandom"`              // Relics 跃迁成本(random)
	LightspeedJumpCostSpecified           int             `json:"lightspeedJumpCostSpecified"`           // Relics 跃迁成本(specified)
	LightspeedCarryCap                    int             `json:"lightspeedCarryCap"`                    // 携带能量上限
	LightspeedMessageEnabled              bool            `json:"lightspeedMessageEnabled"`              // 是否启用留言
	// 遗迹
	RelicDistributionEnabled bool `json:"relicDistributionEnabled"` // 是否启用遗迹分布
	// 打击
	StrikeOrigin          StrikeOrigin         `json:"strikeOrigin"`          // 打击出现位置
	StrikeMissBehavior    StrikeMissBehavior   `json:"strikeMissBehavior"`    // 打击落空处理
	StrikeCanDestroyRelic bool                 `json:"strikeCanDestroyRelic"` // 打击可否摧毁遗留物
}

// UnmarshalJSON 从 JSON 反序列化 ModeRules，并处理向后兼容：
// 若新字段 lightspeedUsage 不存在但旧字段 lightspeedOneTime（bool）存在，自动转换。
func (m *ModeRules) UnmarshalJSON(data []byte) error {
	// 先检测原始 JSON 中各键的存在情况
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(data, &keys); err != nil {
		return err
	}

	// 使用别名避免递归
	type alias ModeRules
	a := (*alias)(m)
	if err := json.Unmarshal(data, a); err != nil {
		return err
	}

	// 向后兼容：若 lightspeedUsage 不存在但 lightspeedOneTime 存在，转换旧 bool 值
	_, hasNew := keys["lightspeedUsage"]
	legacyRaw, hasLegacy := keys["lightspeedOneTime"]
	if !hasNew && hasLegacy {
		var b bool
		if err := json.Unmarshal(legacyRaw, &b); err == nil {
			if b {
				m.LightspeedUsage = LightspeedUsageOneTime
			} else {
				m.LightspeedUsage = LightspeedUsageReusable
			}
		}
	}
	return nil
}

// classicModeRules 是 Classic 模式的规则常量。
var classicModeRules = ModeRules{
	LightspeedUsage:                       LightspeedUsageOneTime,
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
	LightspeedUsage:                       LightspeedUsageReusable,
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

// ============================================================================
// 代码生成导出 — 供 backend/cmd/codegen 生成 mcpserver mode_rules_gen.go
// ============================================================================

// ModeRulesExport 是 ModeRules 的字符串化导出形式（枚举已转为字符串），供代码生成器使用。
// mcpserver 的 ModeRules 使用字符串枚举，后端使用 int iota，此类型桥接差异。
type ModeRulesExport struct {
	Mode string
	LightspeedUsage                       string
	LightspeedCombinedActionCost          int
	LightspeedCombinedActionCostSpecified int
	LightspeedDeployCost                  int
	LightspeedJumpCostRandom              int
	LightspeedJumpCostSpecified           int
	LightspeedCarryCap                    int
	LightspeedMessageEnabled              bool
	RelicDistributionEnabled              bool
	StrikeOrigin          string
	StrikeMissBehavior    string
	StrikeCanDestroyRelic bool
	Description           string
}

// ClassicModePresetExport 返回经典模式预设规则（字符串化形式），用于代码生成。
func ClassicModePresetExport() ModeRulesExport {
	return toExport(classicModeRules, GameModeClassic, modePresetDescriptions["classic"].Description)
}

// RelicsModePresetExport 返回文明遗迹模式预设规则（字符串化形式），用于代码生成。
func RelicsModePresetExport() ModeRulesExport {
	return toExport(relicsModeRules, GameModeCivilizationRelics, modePresetDescriptions["civilization_relics"].Description)
}

func toExport(r ModeRules, mode GameMode, desc string) ModeRulesExport {
	return ModeRulesExport{
		Mode:                         string(mode),
		LightspeedUsage:              lightspeedUsageToString(r.LightspeedUsage),
		LightspeedCombinedActionCost: r.LightspeedCombinedActionCost,
		LightspeedCombinedActionCostSpecified: r.LightspeedCombinedActionCostSpecified,
		LightspeedDeployCost:         r.LightspeedDeployCost,
		LightspeedJumpCostRandom:     r.LightspeedJumpCostRandom,
		LightspeedJumpCostSpecified:  r.LightspeedJumpCostSpecified,
		LightspeedCarryCap:           r.LightspeedCarryCap,
		LightspeedMessageEnabled:     r.LightspeedMessageEnabled,
		RelicDistributionEnabled:     r.RelicDistributionEnabled,
		StrikeOrigin:                 strikeOriginToString(r.StrikeOrigin),
		StrikeMissBehavior:           strikeMissBehaviorToString(r.StrikeMissBehavior),
		StrikeCanDestroyRelic:        r.StrikeCanDestroyRelic,
		Description:                  desc,
	}
}

// lightspeedUsageToString 将 LightspeedUsage 枚举转为字符串。
func lightspeedUsageToString(u LightspeedUsage) string {
	switch u {
	case LightspeedUsageOneTime:
		return "oneTime"
	case LightspeedUsageReusable:
		return "reusable"
	default:
		return "oneTime"
	}
}
