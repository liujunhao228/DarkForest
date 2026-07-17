package semantic

import (
	"encoding/json"
	"strings"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// TestProjectRelic_NilState 验证 nil ViewState 返回零值 RelicView。
func TestProjectRelic_NilState(t *testing.T) {
	view := ProjectRelic(nil, "p1", "civilization_relics")
	if view.Mode != "" {
		t.Errorf("Mode = %q, want empty", view.Mode)
	}
	if view.MyDiscovery != nil {
		t.Errorf("MyDiscovery = %v, want nil", view.MyDiscovery)
	}
	if len(view.KnownRelics) != 0 {
		t.Errorf("KnownRelics len = %d, want 0", len(view.KnownRelics))
	}
	if len(view.InheritableNow) != 0 {
		t.Errorf("InheritableNow len = %d, want 0", len(view.InheritableNow))
	}
}

// TestProjectRelic_ClassicMode 验证 Classic 模式仅返回 {Mode: gameMode}，其余字段为空。
// 这是 spec 的强约束：Classic 模式下不投影遗迹信息。
func TestProjectRelic_ClassicMode(t *testing.T) {
	systemID := 5
	state := &gamesdk.ViewState{
		Kind:  "view",
		Phase: "playing",
		Logs: []gamesdk.LogEntry{
			{
				ID:       "l1",
				Turn:     3,
				Phase:    "actionPhase",
				Type:     "action",
				Message:  "Alice 在星系 5 继承了遗迹「戴森之墓」",
				SystemID: &systemID,
			},
		},
	}

	view := ProjectRelic(state, "p1", "classic")

	if view.Mode != "classic" {
		t.Errorf("Mode = %q, want %q", view.Mode, "classic")
	}
	if view.MyDiscovery != nil {
		t.Errorf("Classic 模式 MyDiscovery 应为 nil, got %v", view.MyDiscovery)
	}
	if len(view.KnownRelics) != 0 {
		t.Errorf("Classic 模式 KnownRelics 应为空, got %v", view.KnownRelics)
	}
	if len(view.InheritableNow) != 0 {
		t.Errorf("Classic 模式 InheritableNow 应为空, got %v", view.InheritableNow)
	}
}

// TestProjectRelic_ClassicMode_IgnoresRelicDiscovery 验证 Classic 模式下即使
// LastRelicDiscovery 已设置（理论上后端 Relics 模式才会设置，但防御性测试）
// 也不会投影 MyDiscovery / KnownRelics。Mode 仍为 "classic"。
func TestProjectRelic_ClassicMode_IgnoresRelicDiscovery(t *testing.T) {
	rd := &gamesdk.RelicDiscovery{
		PlayerID: "p1",
		SystemID: 9,
		IsRelic:  true,
		Name:     "戴森之墓",
		Energy:   8,
	}
	state := &gamesdk.ViewState{
		Kind:               "view",
		Phase:              "playing",
		LastRelicDiscovery: rd,
	}

	view := ProjectRelic(state, "p1", "classic")

	if view.Mode != "classic" {
		t.Errorf("Mode = %q, want %q", view.Mode, "classic")
	}
	if view.MyDiscovery != nil {
		t.Errorf("Classic 模式不应填充 MyDiscovery, got %v", view.MyDiscovery)
	}
	if len(view.KnownRelics) != 0 {
		t.Errorf("Classic 模式不应填充 KnownRelics, got %v", view.KnownRelics)
	}
}

// TestProjectRelic_RelicsMode_MyDiscoverySelf 验证 Relics 模式下
// 当 LastRelicDiscovery.PlayerID == viewerID 时，MyDiscovery 被填充。
func TestProjectRelic_RelicsMode_MyDiscoverySelf(t *testing.T) {
	rd := &gamesdk.RelicDiscovery{
		PlayerID:      "p1",
		SystemID:      9,
		IsRelic:       true,
		Name:          "戴森之墓",
		Lore:          "一颗戴森球笼罩着早已熄灭的恒星...",
		Energy:        8,
		FacilityNames: []string{"戴森球", "监听基地"},
	}
	state := &gamesdk.ViewState{
		Kind:               "view",
		Phase:              "playing",
		LastRelicDiscovery: rd,
	}

	view := ProjectRelic(state, "p1", "civilization_relics")

	if view.Mode != "civilization_relics" {
		t.Errorf("Mode = %q, want %q", view.Mode, "civilization_relics")
	}
	if view.MyDiscovery == nil {
		t.Fatalf("MyDiscovery 应非 nil (viewer == discoverer)")
	}
	if view.MyDiscovery.PlayerID != "p1" {
		t.Errorf("MyDiscovery.PlayerID = %q, want %q", view.MyDiscovery.PlayerID, "p1")
	}
	if view.MyDiscovery.SystemID != 9 {
		t.Errorf("MyDiscovery.SystemID = %d, want 9", view.MyDiscovery.SystemID)
	}
	if !view.MyDiscovery.IsRelic {
		t.Errorf("MyDiscovery.IsRelic = false, want true")
	}
	if view.MyDiscovery.Name != "戴森之墓" {
		t.Errorf("MyDiscovery.Name = %q, want %q", view.MyDiscovery.Name, "戴森之墓")
	}
	if view.MyDiscovery.Energy != 8 {
		t.Errorf("MyDiscovery.Energy = %d, want 8", view.MyDiscovery.Energy)
	}
	if len(view.MyDiscovery.FacilityNames) != 2 {
		t.Errorf("MyDiscovery.FacilityNames len = %d, want 2", len(view.MyDiscovery.FacilityNames))
	}

	// KnownRelics 应包含 MyDiscovery 转换的完整条目
	if len(view.KnownRelics) != 1 {
		t.Fatalf("KnownRelics len = %d, want 1 (from MyDiscovery)", len(view.KnownRelics))
	}
	kr := view.KnownRelics[0]
	if kr.SystemID != 9 {
		t.Errorf("KnownRelics[0].SystemID = %d, want 9", kr.SystemID)
	}
	if kr.Name != "戴森之墓" {
		t.Errorf("KnownRelics[0].Name = %q, want %q", kr.Name, "戴森之墓")
	}
	if kr.Energy != 8 {
		t.Errorf("KnownRelics[0].Energy = %d, want 8", kr.Energy)
	}
	if len(kr.FacilityNames) != 2 {
		t.Errorf("KnownRelics[0].FacilityNames len = %d, want 2", len(kr.FacilityNames))
	}
}

// TestProjectRelic_RelicsMode_MyDiscoveryOther 验证 Relics 模式下
// 当 LastRelicDiscovery.PlayerID != viewerID 时，MyDiscovery 为 nil（spec 信息不对称契约）。
func TestProjectRelic_RelicsMode_MyDiscoveryOther(t *testing.T) {
	rd := &gamesdk.RelicDiscovery{
		PlayerID: "p2", // 不是 p1
		SystemID: 9,
		IsRelic:  true,
		Name:     "戴森之墓",
		Energy:   8,
	}
	state := &gamesdk.ViewState{
		Kind:               "view",
		Phase:              "playing",
		LastRelicDiscovery: rd,
	}

	view := ProjectRelic(state, "p1", "civilization_relics") // viewerID = p1, 但 discoverer = p2

	if view.Mode != "civilization_relics" {
		t.Errorf("Mode = %q, want %q", view.Mode, "civilization_relics")
	}
	if view.MyDiscovery != nil {
		t.Errorf("MyDiscovery 应为 nil (viewer != discoverer), got %v", view.MyDiscovery)
	}
	// MyDiscovery 为 nil → KnownRelics 也应为空（无自身来源）
	if len(view.KnownRelics) != 0 {
		t.Errorf("KnownRelics 应为空 (无 MyDiscovery), got %v", view.KnownRelics)
	}
}

// TestProjectRelic_RelicsMode_NoDiscovery 验证 Relics 模式下
// LastRelicDiscovery 为 nil 时，MyDiscovery / KnownRelics 均为空。
func TestProjectRelic_RelicsMode_NoDiscovery(t *testing.T) {
	state := &gamesdk.ViewState{
		Kind:  "view",
		Phase: "playing",
	}

	view := ProjectRelic(state, "p1", "civilization_relics")

	if view.Mode != "civilization_relics" {
		t.Errorf("Mode = %q, want %q", view.Mode, "civilization_relics")
	}
	if view.MyDiscovery != nil {
		t.Errorf("MyDiscovery 应为 nil, got %v", view.MyDiscovery)
	}
	if len(view.KnownRelics) != 0 {
		t.Errorf("KnownRelics 应为空, got %v", view.KnownRelics)
	}
	if view.InheritableNow != nil {
		t.Errorf("InheritableNow 应为 nil (后端未暴露 Leftovers), got %v", view.InheritableNow)
	}
}

// TestProjectRelic_RelicsMode_KnownRelicsFromLogs 验证 KnownRelics 从 logs 推断。
// 场景：
//   - 玩家 p1 在星系 9 继承了遗迹「戴森之墓」（MyDiscovery 来源，完整内容）
//   - 公共日志记录：p1 在星系 9 继承了遗迹（含遗迹名）→ 应去重，不重复加入
//   - 公共日志记录：p2 在星系 5 继承了 4 点能量（含"继承"关键词）→ 加入 SystemID=5，内容未知
//   - 公共日志记录：与遗迹无关的日志（如出牌）→ 不应加入 KnownRelics
func TestProjectRelic_RelicsMode_KnownRelicsFromLogs(t *testing.T) {
	system9 := 9
	system5 := 5
	system3 := 3
	rd := &gamesdk.RelicDiscovery{
		PlayerID:      "p1",
		SystemID:      9,
		IsRelic:       true,
		Name:          "戴森之墓",
		Lore:          "戴森球笼罩着早已熄灭的恒星...",
		Energy:        8,
		FacilityNames: []string{"戴森球", "监听基地"},
	}
	state := &gamesdk.ViewState{
		Kind:               "view",
		Phase:              "playing",
		LastRelicDiscovery: rd,
		Logs: []gamesdk.LogEntry{
			{
				ID:       "l1",
				Turn:     3,
				Phase:    "actionPhase",
				Type:     "action",
				Message:  "Alice 在星系 9 继承了遗迹「戴森之墓」（8点能量，2个设施）",
				SystemID: &system9, // 与 MyDiscovery.SystemID 相同 → 应去重
			},
			{
				ID:       "l2",
				Turn:     5,
				Phase:    "actionPhase",
				Type:     "action",
				Message:  "Bob 在星系 5 继承了 4 点能量与 1 个设施",
				SystemID: &system5, // 含"继承"关键词 → 加入，仅 SystemID
			},
			{
				ID:       "l3",
				Turn:     6,
				Phase:    "actionPhase",
				Type:     "action",
				Message:  "Alice 在星系 3 出牌打击",
				SystemID: &system3, // 不含"遗迹"/"继承"关键词 → 不应加入
			},
			{
				ID:       "l4",
				Turn:     7,
				Phase:    "actionPhase",
				Type:     "action",
				Message:  "Bob 在星系 5 继承了 2 点能量与 1 个设施",
				SystemID: &system5, // 与 l2 SystemID 相同 → 应去重
			},
		},
	}

	view := ProjectRelic(state, "p1", "civilization_relics")

	if view.MyDiscovery == nil {
		t.Fatalf("MyDiscovery 应非 nil")
	}

	// KnownRelics 应包含 2 条：
	//   - SystemID=9（来自 MyDiscovery，内容完整）
	//   - SystemID=5（来自 log l2/l4，内容未知）
	// SystemID=3 不应出现（不含关键词）
	if len(view.KnownRelics) != 2 {
		t.Fatalf("KnownRelics len = %d, want 2 (systemId 9 from MyDiscovery + systemId 5 from log):\n%+v",
			len(view.KnownRelics), view.KnownRelics)
	}

	// 第一条：来自 MyDiscovery，内容完整
	kr0 := view.KnownRelics[0]
	if kr0.SystemID != 9 {
		t.Errorf("KnownRelics[0].SystemID = %d, want 9", kr0.SystemID)
	}
	if kr0.Name != "戴森之墓" {
		t.Errorf("KnownRelics[0].Name = %q, want %q", kr0.Name, "戴森之墓")
	}
	if kr0.Energy != 8 {
		t.Errorf("KnownRelics[0].Energy = %d, want 8", kr0.Energy)
	}

	// 第二条：来自 logs，内容未知（Name 应为空）
	kr1 := view.KnownRelics[1]
	if kr1.SystemID != 5 {
		t.Errorf("KnownRelics[1].SystemID = %d, want 5", kr1.SystemID)
	}
	if kr1.Name != "" {
		t.Errorf("KnownRelics[1].Name = %q, want empty (内容未知)", kr1.Name)
	}
	if kr1.Energy != 0 {
		t.Errorf("KnownRelics[1].Energy = %d, want 0 (内容未知)", kr1.Energy)
	}
	if len(kr1.FacilityNames) != 0 {
		t.Errorf("KnownRelics[1].FacilityNames len = %d, want 0 (内容未知)", len(kr1.FacilityNames))
	}
}

// TestProjectRelic_RelicsMode_KnownRelicsOnlyFromLogs 验证 MyDiscovery 为 nil 时
// KnownRelics 仍可从 logs 推断（观察者非继承者，仅看公共日志）。
func TestProjectRelic_RelicsMode_KnownRelicsOnlyFromLogs(t *testing.T) {
	system5 := 5
	system9 := 9
	state := &gamesdk.ViewState{
		Kind:  "view",
		Phase: "playing",
		// LastRelicDiscovery 为 nil（观察者 p1 不是继承者）
		Logs: []gamesdk.LogEntry{
			{
				ID:       "l1",
				Turn:     3,
				Phase:    "actionPhase",
				Type:     "action",
				Message:  "Bob 在星系 9 继承了遗迹「寂静堡垒」",
				SystemID: &system9,
			},
			{
				ID:       "l2",
				Turn:     5,
				Phase:    "actionPhase",
				Type:     "action",
				Message:  "Carol 在星系 5 继承了 4 点能量与 1 个设施",
				SystemID: &system5,
			},
		},
	}

	// viewerID=p1, LastRelicDiscovery=nil → MyDiscovery 应为 nil
	view := ProjectRelic(state, "p1", "civilization_relics")

	if view.MyDiscovery != nil {
		t.Fatalf("MyDiscovery 应为 nil (无 LastRelicDiscovery), got %v", view.MyDiscovery)
	}

	// KnownRelics 应有 2 条（仅 SystemID，内容未知）
	if len(view.KnownRelics) != 2 {
		t.Fatalf("KnownRelics len = %d, want 2:\n%+v", len(view.KnownRelics), view.KnownRelics)
	}
	for i, kr := range view.KnownRelics {
		if kr.Name != "" {
			t.Errorf("KnownRelics[%d].Name = %q, want empty (内容未知)", i, kr.Name)
		}
		if kr.Energy != 0 {
			t.Errorf("KnownRelics[%d].Energy = %d, want 0 (内容未知)", i, kr.Energy)
		}
	}
	// SystemID 应为 9 和 5（顺序按 logs 出现顺序）
	if view.KnownRelics[0].SystemID != 9 {
		t.Errorf("KnownRelics[0].SystemID = %d, want 9", view.KnownRelics[0].SystemID)
	}
	if view.KnownRelics[1].SystemID != 5 {
		t.Errorf("KnownRelics[1].SystemID = %d, want 5", view.KnownRelics[1].SystemID)
	}
}

// TestProjectRelic_RelicsMode_LogsNoSystemID 验证 logs 中含关键词但 SystemID 为 nil 的条目
// 不应加入 KnownRelics（spec 要求 SystemID 非空）。
func TestProjectRelic_RelicsMode_LogsNoSystemID(t *testing.T) {
	state := &gamesdk.ViewState{
		Kind:  "view",
		Phase: "playing",
		Logs: []gamesdk.LogEntry{
			{
				ID:      "l1",
				Turn:    3,
				Phase:   "actionPhase",
				Type:    "action",
				Message: "Alice 继承了某个遗迹", // SystemID 为 nil
			},
		},
	}

	view := ProjectRelic(state, "p1", "civilization_relics")

	if view.MyDiscovery != nil {
		t.Errorf("MyDiscovery 应为 nil, got %v", view.MyDiscovery)
	}
	if len(view.KnownRelics) != 0 {
		t.Errorf("KnownRelics 应为空 (log 中 SystemID 为 nil), got %v", view.KnownRelics)
	}
}

// TestProjectRelic_RelicsMode_JSONSerialize 验证 RelicView 能正确序列化为 JSON。
// 重点验证：
//   - Classic 模式仅 mode 字段出现
//   - Relics 模式 omitempty 字段在空时省略
//   - KnownRelic.Name 为空时省略（表示内容未知）
func TestProjectRelic_RelicsMode_JSONSerialize(t *testing.T) {
	t.Run("classic", func(t *testing.T) {
		state := &gamesdk.ViewState{Kind: "view", Phase: "playing"}
		view := ProjectRelic(state, "p1", "classic")
		data, err := json.Marshal(view)
		if err != nil {
			t.Fatalf("json.Marshal failed: %v", err)
		}
		got := string(data)
		want := `{"mode":"classic"}`
		if got != want {
			t.Errorf("Classic JSON = %s, want %s", got, want)
		}
	})

	t.Run("relics_with_discovery", func(t *testing.T) {
		rd := &gamesdk.RelicDiscovery{
			PlayerID: "p1",
			SystemID: 9,
			IsRelic:  true,
			Name:     "戴森之墓",
			Energy:   8,
		}
		system5 := 5
		state := &gamesdk.ViewState{
			Kind:               "view",
			Phase:              "playing",
			LastRelicDiscovery: rd,
			Logs: []gamesdk.LogEntry{
				{
					ID:       "l1",
					Turn:     5,
					Phase:    "actionPhase",
					Type:     "action",
					Message:  "Bob 在星系 5 继承了 4 点能量与 1 个设施",
					SystemID: &system5,
				},
			},
		}
		view := ProjectRelic(state, "p1", "civilization_relics")
		data, err := json.Marshal(view)
		if err != nil {
			t.Fatalf("json.Marshal failed: %v", err)
		}
		got := string(data)
		// 应包含 mode / myDiscovery / knownRelics；InheritableNow 应被 omitempty 省略
		if !strings.Contains(got, `"mode":"civilization_relics"`) {
			t.Errorf("JSON 缺少 mode 字段: %s", got)
		}
		if !strings.Contains(got, `"myDiscovery":`) {
			t.Errorf("JSON 缺少 myDiscovery 字段: %s", got)
		}
		if !strings.Contains(got, `"knownRelics":`) {
			t.Errorf("JSON 缺少 knownRelics 字段: %s", got)
		}
		if strings.Contains(got, `"inheritableNow":`) {
			t.Errorf("JSON 不应包含 inheritableNow (omitempty), got: %s", got)
		}
		t.Logf("RelicView JSON: %s", got)
	})
}
