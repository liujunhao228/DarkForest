package game

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestGetModeRules_Classic 验证 Classic 模式所有字段。
func TestGetModeRules_Classic(t *testing.T) {
	r := GetModeRules(GameModeClassic)

	if r.LightspeedUsage != LightspeedUsageOneTime {
		t.Errorf("LightspeedUsage = %v, want LightspeedUsageOneTime", r.LightspeedUsage)
	}
	if r.LightspeedCombinedActionCost != 10 {
		t.Errorf("LightspeedCombinedActionCost = %d, want 10", r.LightspeedCombinedActionCost)
	}
	if r.LightspeedDeployCost != 0 {
		t.Errorf("LightspeedDeployCost = %d, want 0", r.LightspeedDeployCost)
	}
	if r.LightspeedJumpCost != 0 {
		t.Errorf("LightspeedJumpCost = %d, want 0", r.LightspeedJumpCost)
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

	if r.LightspeedUsage != LightspeedUsageReusable {
		t.Errorf("LightspeedUsage = %v, want LightspeedUsageReusable", r.LightspeedUsage)
	}
	if r.LightspeedCombinedActionCost != 0 {
		t.Errorf("LightspeedCombinedActionCost = %d, want 0", r.LightspeedCombinedActionCost)
	}
	if r.LightspeedDeployCost != 10 {
		t.Errorf("LightspeedDeployCost = %d, want 10", r.LightspeedDeployCost)
	}
	if r.LightspeedJumpCost != 3 {
		t.Errorf("LightspeedJumpCost = %d, want 3", r.LightspeedJumpCost)
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

// TestGetModeRules_Consistency 综合断言：两模式的 LightspeedUsage 必须不同，
// 避免后续配置错误导致两个模式行为相同。
func TestGetModeRules_Consistency(t *testing.T) {
	classic := GetModeRules(GameModeClassic)
	relics := GetModeRules(GameModeCivilizationRelics)

	if classic.LightspeedUsage == relics.LightspeedUsage {
		t.Errorf(
			"LightspeedUsage 应在两模式间不同: classic=%v relics=%v",
			classic.LightspeedUsage, relics.LightspeedUsage,
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

// TestStateRules_NilModeRules_FallsBackToPreset 验证 state.ModeRules 为 nil 时
// StateRules 回退到 GetModeRules(state.GameMode) 的预设。
// 这是旧回放（无 ModeRules 字段）的兼容路径。
func TestStateRules_NilModeRules_FallsBackToPreset(t *testing.T) {
	cases := []struct {
		mode     GameMode
		expected ModeRules
	}{
		{GameModeClassic, GetModeRules(GameModeClassic)},
		{GameModeCivilizationRelics, GetModeRules(GameModeCivilizationRelics)},
		{GameMode(""), GetModeRules(GameModeClassic)},
		{GameMode("unknown"), GetModeRules(GameModeClassic)},
	}
	for _, c := range cases {
		state := &GameState{GameMode: c.mode}
		got := StateRules(state)
		if got != c.expected {
			t.Errorf("StateRules(mode=%q) = %+v, want %+v", c.mode, got, c.expected)
		}
	}
}

// TestStateRules_CustomOverridesPreset 验证 state.ModeRules 非 nil 时
// StateRules 返回自定义值（忽略 GameMode）。这是自定义房间的核心语义。
func TestStateRules_CustomOverridesPreset(t *testing.T) {
	custom := ModeRules{
		LightspeedUsage:              LightspeedUsageReusable, // 故意改 classic 预设的 oneTime
		LightspeedCombinedActionCost: 7,
		LightspeedDeployCost:         4,
		LightspeedJumpCost:           1,
		LightspeedCarryCap:           3,
		LightspeedMessageEnabled:     true,
		RelicDistributionEnabled:     true,
		StrikeOrigin:                 StrikeOriginStealthOwnerPlanet,
		StrikeMissBehavior:           StrikeMissFreeControl,
		StrikeCanDestroyRelic:        true,
	}
	// 故意让 GameMode=Classic（应回退 classic 预设），但 ModeRules 自定义，
	// 验证 ModeRules 优先级高于 GameMode 预设。
	state := &GameState{GameMode: GameModeClassic, ModeRules: &custom}
	got := StateRules(state)
	if got != custom {
		t.Errorf("StateRules 应返回自定义值，got=%+v want=%+v", got, custom)
	}
}

// TestStateRules_NilState_FallsBackToClassic 验证 state 指针为 nil 时
// 回退到 classic 预设（防御性兜底）。
func TestStateRules_NilState_FallsBackToClassic(t *testing.T) {
	got := StateRules(nil)
	want := GetModeRules(GameModeClassic)
	if got != want {
		t.Errorf("StateRules(nil) = %+v, want classic fallback %+v", got, want)
	}
}

// TestModeRulesTurnTimeoutSecondsSerialization 验证 TurnTimeoutSeconds 字段的
// JSON 序列化/反序列化与向后兼容性（旧回放未序列化此字段时为 0）。
func TestModeRulesTurnTimeoutSecondsSerialization(t *testing.T) {
	t.Run("非零值序列化包含字段", func(t *testing.T) {
		r := ModeRules{TurnTimeoutSeconds: 60}
		data, err := json.Marshal(r)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}
		s := string(data)
		if !strings.Contains(s, `"turnTimeoutSeconds":60`) {
			t.Errorf("序列化后 JSON 应包含 turnTimeoutSeconds:60, got %s", s)
		}
	})

	t.Run("零值序列化省略字段 omitempty", func(t *testing.T) {
		r := ModeRules{}
		data, err := json.Marshal(r)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}
		s := string(data)
		if strings.Contains(s, "turnTimeoutSeconds") {
			t.Errorf("零值 TurnTimeoutSeconds 应被 omitempty 省略, got %s", s)
		}
	})

	t.Run("反序列化非零值", func(t *testing.T) {
		var r ModeRules
		if err := json.Unmarshal([]byte(`{"turnTimeoutSeconds":30}`), &r); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}
		if r.TurnTimeoutSeconds != 30 {
			t.Errorf("TurnTimeoutSeconds = %d, want 30", r.TurnTimeoutSeconds)
		}
	})

	t.Run("反序列化空对象向后兼容", func(t *testing.T) {
		// 旧回放未序列化此字段
		var r ModeRules
		if err := json.Unmarshal([]byte(`{}`), &r); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}
		if r.TurnTimeoutSeconds != 0 {
			t.Errorf("TurnTimeoutSeconds = %d, want 0 (向后兼容)", r.TurnTimeoutSeconds)
		}
	})

	t.Run("StateRules 自定义 ModeRules 透传", func(t *testing.T) {
		custom := &ModeRules{TurnTimeoutSeconds: 60}
		state := &GameState{GameMode: GameModeClassic, ModeRules: custom}
		got := StateRules(state)
		if got.TurnTimeoutSeconds != 60 {
			t.Errorf("StateRules(custom).TurnTimeoutSeconds = %d, want 60", got.TurnTimeoutSeconds)
		}
	})

	t.Run("StateRules ModeRules=nil 回退到预设零值", func(t *testing.T) {
		// 旧回放 ModeRules 为 nil，回退到 classicModeRules，TurnTimeoutSeconds 应为 0
		state := &GameState{GameMode: GameModeClassic}
		got := StateRules(state)
		if got.TurnTimeoutSeconds != 0 {
			t.Errorf("StateRules(classic fallback).TurnTimeoutSeconds = %d, want 0", got.TurnTimeoutSeconds)
		}
	})
}
