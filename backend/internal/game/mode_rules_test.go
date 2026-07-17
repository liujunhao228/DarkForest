package game

import "testing"

// TestGetModeRules_Classic 验证 Classic 模式所有字段。
func TestGetModeRules_Classic(t *testing.T) {
	r := GetModeRules(GameModeClassic)

	if r.LightspeedOneTime != true {
		t.Errorf("LightspeedOneTime = %v, want true", r.LightspeedOneTime)
	}
	if r.LightspeedCombinedActionCost != 10 {
		t.Errorf("LightspeedCombinedActionCost = %d, want 10", r.LightspeedCombinedActionCost)
	}
	if r.LightspeedCombinedActionCostSpecified != 13 {
		t.Errorf("LightspeedCombinedActionCostSpecified = %d, want 13", r.LightspeedCombinedActionCostSpecified)
	}
	if r.LightspeedDeployCost != 0 {
		t.Errorf("LightspeedDeployCost = %d, want 0", r.LightspeedDeployCost)
	}
	if r.LightspeedJumpCostRandom != 0 {
		t.Errorf("LightspeedJumpCostRandom = %d, want 0", r.LightspeedJumpCostRandom)
	}
	if r.LightspeedJumpCostSpecified != 0 {
		t.Errorf("LightspeedJumpCostSpecified = %d, want 0", r.LightspeedJumpCostSpecified)
	}
	if r.LightspeedCarryCap != 0 {
		t.Errorf("LightspeedCarryCap = %d, want 0", r.LightspeedCarryCap)
	}
	if r.LightspeedMessageEnabled != false {
		t.Errorf("LightspeedMessageEnabled = %v, want false", r.LightspeedMessageEnabled)
	}
	if r.RelicDistributionEnabled != false {
		t.Errorf("RelicDistributionEnabled = %v, want false", r.RelicDistributionEnabled)
	}
	if r.StrikeOrigin != StrikeOriginDirect {
		t.Errorf("StrikeOrigin = %v, want StrikeOriginDirect", r.StrikeOrigin)
	}
	if r.StrikeMissBehavior != StrikeMissDiscard {
		t.Errorf("StrikeMissBehavior = %v, want StrikeMissDiscard", r.StrikeMissBehavior)
	}
}

// TestGetModeRules_CivilizationRelics 验证 Relics 模式所有字段。
func TestGetModeRules_CivilizationRelics(t *testing.T) {
	r := GetModeRules(GameModeCivilizationRelics)

	if r.LightspeedOneTime != false {
		t.Errorf("LightspeedOneTime = %v, want false", r.LightspeedOneTime)
	}
	if r.LightspeedCombinedActionCost != 0 {
		t.Errorf("LightspeedCombinedActionCost = %d, want 0", r.LightspeedCombinedActionCost)
	}
	if r.LightspeedCombinedActionCostSpecified != 0 {
		t.Errorf("LightspeedCombinedActionCostSpecified = %d, want 0", r.LightspeedCombinedActionCostSpecified)
	}
	if r.LightspeedDeployCost != 10 {
		t.Errorf("LightspeedDeployCost = %d, want 10", r.LightspeedDeployCost)
	}
	if r.LightspeedJumpCostRandom != 3 {
		t.Errorf("LightspeedJumpCostRandom = %d, want 3", r.LightspeedJumpCostRandom)
	}
	if r.LightspeedJumpCostSpecified != 5 {
		t.Errorf("LightspeedJumpCostSpecified = %d, want 5", r.LightspeedJumpCostSpecified)
	}
	if r.LightspeedCarryCap != 5 {
		t.Errorf("LightspeedCarryCap = %d, want 5", r.LightspeedCarryCap)
	}
	if r.LightspeedMessageEnabled != true {
		t.Errorf("LightspeedMessageEnabled = %v, want true", r.LightspeedMessageEnabled)
	}
	if r.RelicDistributionEnabled != true {
		t.Errorf("RelicDistributionEnabled = %v, want true", r.RelicDistributionEnabled)
	}
	if r.StrikeOrigin != StrikeOriginOwnerPlanet {
		t.Errorf("StrikeOrigin = %v, want StrikeOriginOwnerPlanet", r.StrikeOrigin)
	}
	if r.StrikeMissBehavior != StrikeMissDiscard {
		t.Errorf("StrikeMissBehavior = %v, want StrikeMissDiscard", r.StrikeMissBehavior)
	}
}

// TestGetModeRules_UnknownModeFallsBackToClassic 验证空串与未知模式均回退到 Classic 规则。
func TestGetModeRules_UnknownModeFallsBackToClassic(t *testing.T) {
	classic := GetModeRules(GameModeClassic)

	cases := []GameMode{"", "unknown", "classic_typo", "Civilization_Relics"}
	for _, mode := range cases {
		r := GetModeRules(mode)
		if r != classic {
			t.Errorf("GetModeRules(%q) = %+v, want Classic fallback %+v", mode, r, classic)
		}
	}
}

// TestGetModeRules_Consistency 综合断言：两模式的 LightspeedOneTime 必须不同，
// 避免后续配置错误导致两个模式行为相同。
func TestGetModeRules_Consistency(t *testing.T) {
	classic := GetModeRules(GameModeClassic)
	relics := GetModeRules(GameModeCivilizationRelics)

	if classic.LightspeedOneTime == relics.LightspeedOneTime {
		t.Errorf(
			"LightspeedOneTime 应在两模式间不同: classic=%v relics=%v",
			classic.LightspeedOneTime, relics.LightspeedOneTime,
		)
	}
	if classic.RelicDistributionEnabled == relics.RelicDistributionEnabled {
		t.Errorf(
			"RelicDistributionEnabled 应在两模式间不同: classic=%v relics=%v",
			classic.RelicDistributionEnabled, relics.RelicDistributionEnabled,
		)
	}
	if classic.StrikeOrigin == relics.StrikeOrigin {
		t.Errorf(
			"StrikeOrigin 应在两模式间不同: classic=%v relics=%v",
			classic.StrikeOrigin, relics.StrikeOrigin,
		)
	}
}
