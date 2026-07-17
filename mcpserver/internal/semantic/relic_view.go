package semantic

import (
	"strings"

	"darkforest/mcpserver/internal/gamesdk"
)

// RelicView 是遗迹体系的决策视角投影。
// Classic 模式下仅 mode 字段有值；Civilization Relics 模式下填充其余字段。
//
// 来源契约：
//   - Mode：直接来自 gameMode 参数（"classic" / "civilization_relics"）。
//   - MyDiscovery：仅当 viewerID == state.LastRelicDiscovery.PlayerID 时填充
//     （后端 view_state.go 已按 viewer 身份门控，此处二次确认以保证不泄露）。
//   - KnownRelics：玩家自己刚继承过的遗迹（来自 MyDiscovery，内容完整）+
//     从公共 logs 启发式扫描得到的"已知存在但内容未知"的星系（仅 SystemID）。
//   - InheritableNow：后端 ViewState 不暴露 Leftovers，当前无法填充。
type RelicView struct {
	Mode           string                   `json:"mode"`                     // "classic" / "civilization_relics"
	KnownRelics    []KnownRelic             `json:"knownRelics,omitempty"`    // 已揭示过的遗迹
	MyDiscovery    *gamesdk.RelicDiscovery  `json:"myDiscovery,omitempty"`    // 我刚继承的私有揭示（仅本人）
	InheritableNow []int                    `json:"inheritableNow,omitempty"` // 当前可继承的星系
}

// KnownRelic 已揭示过的遗迹摘要。
// 当 Name 为空时，表示"已知存在但内容未知"（仅从 logs 推断出 SystemID，
// 后端 ViewState 未暴露该遗迹的 Name/Lore/Energy/FacilityNames）。
type KnownRelic struct {
	SystemID      int      `json:"systemId"`
	Name          string   `json:"name,omitempty"`
	Lore          string   `json:"lore,omitempty"`
	Energy        int      `json:"energy"`
	FacilityNames []string `json:"facilityNames,omitempty"`
}

// ProjectRelic 把 ViewState 投影为遗迹决策视角的 RelicView。
//
// viewerID 是当前观察者玩家 ID。
// gameMode 是当前游戏模式（"classic" / "civilization_relics"）。
//
// Classic 模式（gameMode != "civilization_relics"）：
// 仅返回 {Mode: gameMode}，其余字段为空。
//
// Relics 模式（gameMode == "civilization_relics"）：
//   - MyDiscovery：仅当 state.LastRelicDiscovery 非空且 PlayerID == viewerID 时填充。
//   - KnownRelics：MyDiscovery 优先（内容完整）+ logs 启发式扫描（仅 SystemID）。
//   - InheritableNow：暂为 nil（后端未暴露 Leftovers）。
//
// 若 state 为 nil，返回零值 RelicView。
func ProjectRelic(state *gamesdk.ViewState, viewerID string, gameMode string) RelicView {
	if state == nil {
		return RelicView{}
	}

	view := RelicView{Mode: gameMode}

	// Classic 模式（及所有非 civilization_relics 模式）：仅返回 mode 字段
	if gameMode != "civilization_relics" {
		return view
	}

	// MyDiscovery：仅当 LastRelicDiscovery 属于当前 viewer 时填充。
	// 后端 view_state.go 已按 viewer 身份门控，此处二次确认以防数据意外泄露。
	if state.LastRelicDiscovery != nil && state.LastRelicDiscovery.PlayerID == viewerID {
		// 浅拷贝一份，避免返回的 RelicView 与输入 ViewState 共享指针。
		rd := *state.LastRelicDiscovery
		view.MyDiscovery = &rd
	}

	view.KnownRelics = projectKnownRelics(state.Logs, view.MyDiscovery)

	// InheritableNow：后端 ViewState 不暴露 Leftovers 字段（view_state.go 仅含
	// LastRelicDiscovery），无法直接知道哪些星系当前有遗留物可继承。
	// 暂留 nil（与 omitempty 配合省略 JSON 输出）。
	// TODO: 待后端 view_state 扩展暴露 Leftovers 后，可填充为当前仍有遗留物的星系列表。
	view.InheritableNow = nil

	return view
}

// projectKnownRelics 从 logs 与 MyDiscovery 推断已知存在的遗迹列表。
//
// 降级方案：后端 ViewState 不暴露 Leftovers 列表，无法直接拿到完整遗迹清单。
// 此处采用启发式扫描：
//  1. 若 MyDiscovery 非空，将其转换为 KnownRelic 加入列表（玩家刚继承的遗迹自然已知，
//     且 Name/Lore/Energy/FacilityNames 完整）。
//  2. 扫描 state.Logs，找 Message 含"遗迹"/"继承"关键词且 SystemID 非空的条目，
//     去重后加入 KnownRelics（仅 SystemID，Name/Lore/Energy/FacilityNames 留空，
//     表示"已知存在但内容未知"）。
//
// 注意：logs 文本启发式不可靠（存在误报可能），但当前是后端未暴露 Leftovers 时的
// 唯一可行方案。MyDiscovery 来源的条目内容可信（直接来自后端私有揭示）。
func projectKnownRelics(logs []gamesdk.LogEntry, myDiscovery *gamesdk.RelicDiscovery) []KnownRelic {
	if len(logs) == 0 && myDiscovery == nil {
		return nil
	}

	// seenSystemIDs 记录已经加入 KnownRelics 的 SystemID，用于跨源去重。
	seen := make(map[int]bool)
	var out []KnownRelic

	// 1. MyDiscovery 来源：玩家刚继承的遗迹，内容完整（Name/Lore/Energy/FacilityNames）。
	if myDiscovery != nil {
		out = append(out, KnownRelic{
			SystemID:      myDiscovery.SystemID,
			Name:          myDiscovery.Name,
			Lore:          myDiscovery.Lore,
			Energy:        myDiscovery.Energy,
			FacilityNames: myDiscovery.FacilityNames,
		})
		seen[myDiscovery.SystemID] = true
	}

	// 2. logs 来源：含"遗迹"/"继承"关键词且 SystemID 非空的条目，仅填充 SystemID。
	for i := range logs {
		l := &logs[i]
		if l.SystemID == nil {
			continue
		}
		if !relicRelatedLog(l.Message) {
			continue
		}
		sid := *l.SystemID
		if seen[sid] {
			continue
		}
		seen[sid] = true
		// 已知存在但内容未知：仅 SystemID，其余字段留空（Name=""）
		out = append(out, KnownRelic{SystemID: sid})
	}

	return out
}

// relicRelatedLog 报告日志 Message 是否与遗迹/继承相关。
// 关键词命中即视为相关；这是启发式推断，存在误报可能（详见 projectKnownRelics 注释）。
func relicRelatedLog(message string) bool {
	if message == "" {
		return false
	}
	return strings.Contains(message, "遗迹") ||
		strings.Contains(message, "继承")
}
