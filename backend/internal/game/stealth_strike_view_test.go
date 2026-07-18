package game

import "testing"

// TestStrikeOriginConstants_VerifyStealthVariantRegistered 确认 StrikeOriginStealthOwnerPlanet
// 常量存在且与 Direct / OwnerPlanet 互斥（值不同）。
func TestStrikeOriginConstants_VerifyStealthVariantRegistered(t *testing.T) {
	if StrikeOriginStealthOwnerPlanet == StrikeOriginDirect {
		t.Error("StrikeOriginStealthOwnerPlanet == StrikeOriginDirect, expected distinct")
	}
	if StrikeOriginStealthOwnerPlanet == StrikeOriginOwnerPlanet {
		t.Error("StrikeOriginStealthOwnerPlanet == StrikeOriginOwnerPlanet, expected distinct")
	}
	// 确保三个常量在 iota 序列中：Direct=0, OwnerPlanet=1, StealthOwnerPlanet=2
	if StrikeOriginDirect != 0 {
		t.Errorf("StrikeOriginDirect = %d, want 0", StrikeOriginDirect)
	}
	if StrikeOriginOwnerPlanet != 1 {
		t.Errorf("StrikeOriginOwnerPlanet = %d, want 1", StrikeOriginOwnerPlanet)
	}
	if StrikeOriginStealthOwnerPlanet != 2 {
		t.Errorf("StrikeOriginStealthOwnerPlanet = %d, want 2", StrikeOriginStealthOwnerPlanet)
	}
}

// TestLookupStrikeOwner_FindsOwnerByUID 验证 PendingAction 脱敏 helper 能按 UID 找到拥有者。
func TestLookupStrikeOwner_FindsOwnerByUID(t *testing.T) {
	state := &GameState{
		FlyingStrikes: []FlyingStrike{
			{UID: "s1", OwnerID: "p1", Position: 3, TargetSystem: 5},
			{UID: "s2", OwnerID: "p2", Position: 4, TargetSystem: 6},
		},
	}
	if got := lookupStrikeOwner(state, "s1"); got != "p1" {
		t.Errorf("lookupStrikeOwner(s1) = %q, want p1", got)
	}
	if got := lookupStrikeOwner(state, "s2"); got != "p2" {
		t.Errorf("lookupStrikeOwner(s2) = %q, want p2", got)
	}
	if got := lookupStrikeOwner(state, "nonexistent"); got != "" {
		t.Errorf("lookupStrikeOwner(nonexistent) = %q, want empty", got)
	}
}

// TestProjectFlyingStrike_StealthRedactsNonOwner 验证隐逐跳模式下，非拥有者观察者
// 仅可见 TargetSystem + Distance，Position 被脱敏为 -1。
func TestProjectFlyingStrike_StealthRedactsNonOwner(t *testing.T) {
	// 打击从星系 3 出发，目标星系 8（图最短跳数 3：3→5→7→8 或 3→4→6→8）
	s := FlyingStrike{
		UID: "s1", OwnerID: "p1", Position: 3, TargetSystem: 8,
		Level: 1, Speed: 1, StrikeName: "热核打击",
	}
	view := projectFlyingStrike(s, true /*stealthMode*/, false /*revealAll*/, "p2" /*viewer*/)

	if view.Position != -1 {
		t.Errorf("non-owner Position = %d, want -1 (redacted)", view.Position)
	}
	if view.TargetSystem != 8 {
		t.Errorf("non-owner TargetSystem = %d, want 8 (revealed)", view.TargetSystem)
	}
	if view.Distance == nil {
		t.Fatal("non-owner Distance = nil, want populated")
	}
	if *view.Distance != 3 {
		t.Errorf("non-owner Distance = %d, want 3", *view.Distance)
	}
	// StrikeName / Level / Speed 等非位置信息应保留
	if view.StrikeName != "热核打击" {
		t.Errorf("non-owner StrikeName = %q, want 热核打击", view.StrikeName)
	}
}

// TestProjectFlyingStrike_StealthOwnerSeesFullPath 验证隐逐跳模式下，拥有者可见完整路径。
func TestProjectFlyingStrike_StealthOwnerSeesFullPath(t *testing.T) {
	s := FlyingStrike{
		UID: "s1", OwnerID: "p1", Position: 3, TargetSystem: 8,
		Level: 1, Speed: 1, StrikeName: "热核打击",
	}
	view := projectFlyingStrike(s, true /*stealthMode*/, false /*revealAll*/, "p1" /*viewer=owner*/)

	if view.Position != 3 {
		t.Errorf("owner Position = %d, want 3 (full)", view.Position)
	}
	if view.TargetSystem != 8 {
		t.Errorf("owner TargetSystem = %d, want 8", view.TargetSystem)
	}
	if view.Distance != nil {
		t.Errorf("owner Distance = %v, want nil (Position 已暴露)", *view.Distance)
	}
}

// TestProjectFlyingStrike_StealthReplaySeesFullPath 验证隐逐跳模式下，回放观察者可见完整路径。
func TestProjectFlyingStrike_StealthReplaySeesFullPath(t *testing.T) {
	s := FlyingStrike{
		UID: "s1", OwnerID: "p1", Position: 3, TargetSystem: 8,
		Level: 1, Speed: 1, StrikeName: "热核打击",
	}
	view := projectFlyingStrike(s, true /*stealthMode*/, true /*revealAll=REPLAY*/, "p2" /*viewer*/)

	if view.Position != 3 {
		t.Errorf("replay Position = %d, want 3 (full)", view.Position)
	}
	if view.Distance != nil {
		t.Errorf("replay Distance = %v, want nil (Position 已暴露)", *view.Distance)
	}
}

// TestProjectFlyingStrike_NonStealthNoRedaction 验证非隐逐跳模式（OwnerPlanet / Direct）
// 不触发脱敏：所有观察者可见 Position，Distance 始终为 nil。
func TestProjectFlyingStrike_NonStealthNoRedaction(t *testing.T) {
	s := FlyingStrike{
		UID: "s1", OwnerID: "p1", Position: 3, TargetSystem: 8,
		Level: 1, Speed: 1, StrikeName: "热核打击",
	}
	// 非拥有者 + 非 stealth → 完整字段
	view := projectFlyingStrike(s, false /*stealthMode*/, false /*revealAll*/, "p2")
	if view.Position != 3 {
		t.Errorf("non-stealth non-owner Position = %d, want 3 (no redaction)", view.Position)
	}
	if view.Distance != nil {
		t.Errorf("non-stealth Distance = %v, want nil", *view.Distance)
	}
}
