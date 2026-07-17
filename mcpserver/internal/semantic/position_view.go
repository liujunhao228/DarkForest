package semantic

import "darkforest/mcpserver/internal/gamesdk"

// PositionView 是位置/光速飞船体系的决策视角投影。
//
// 由 ProjectPosition 从 gamesdk.ViewState 派生，把"我在哪 / 一次跃迁能去哪 /
// 哪些星系安全 / 哪些星系危险 / 已知对手在哪"五类决策信息收拢为强类型结构。
//
// 不含 inferredFoePositions（服务端不做推断，由 strategy_primer prompt
// 提示 Agent 自行推断未知位置对手的可能藏身点）。
type PositionView struct {
	MyPosition        MyPositionInfo `json:"myPosition"`
	Reachable         []int          `json:"reachable,omitempty"`         // 一次光速飞船可达星系
	SafeZones         []int          `json:"safeZones,omitempty"`         // 安全星系
	DangerZones       []SystemRisk   `json:"dangerZones,omitempty"`       // 危险星系
	KnownFoePositions map[string]int `json:"knownFoePositions,omitempty"` // 已知位置的对手 playerId → systemId
}

// MyPositionInfo 我的位置信息。
type MyPositionInfo struct {
	System               int  `json:"system"`
	IsPublic             bool `json:"isPublic"`             // 位置是否已公开
	IsExposedByBroadcast bool `json:"isExposedByBroadcast"` // 是否被广播照亮
}

// SystemRisk 星系风险标签。
type SystemRisk struct {
	System int      `json:"system"`
	Risks  []string `json:"risks"` // inbound_strike / broadcast_exposed / occupied / destroyed
}

// broadcastPhaseDone 是广播会话"已结束"阶段的字符串哨兵。
// gamesdk.BroadcastPhase 当前仅定义 waiting/select/reveal，无 "done"；
// semantic.BroadcastPhase（见 broadcast_view.go）则显式定义 BroadcastPhaseDone="done"。
// 此处对 "done" 字符串做防御性判断，兼容未来 gamesdk 协议扩展。
const broadcastPhaseDone = "done"

// ProjectPosition 把 ViewState 投影为位置/光速飞船决策视角的 PositionView。
//
// viewerID 是当前观察者玩家 ID；gameMode 是当前游戏模式
// （"classic" / "civilization_relics"）。
//
// 当前两种模式下光速飞船均为"跃迁"语义（不受距离限制），Reachable 计算相同；
// gameMode 参数保留以便未来支持模式差异（如引入距离限制变体）。
//
// state 为 nil 时返回零值 PositionView。
func ProjectPosition(state *gamesdk.ViewState, viewerID string, gameMode string) PositionView {
	var view PositionView
	if state == nil {
		return view
	}

	var myPosition int
	var myPlayer *gamesdk.ViewPlayer
	for i := range state.Players {
		if state.Players[i].ID == viewerID {
			myPlayer = &state.Players[i]
			break
		}
	}
	if myPlayer != nil {
		myPosition = myPlayer.Position
		view.MyPosition = MyPositionInfo{
			System:               myPosition,
			IsPublic:             inferMyPositionIsPublic(myPlayer),
			IsExposedByBroadcast: isExposedByBroadcast(state.Broadcast, myPosition),
		}
	}

	view.Reachable = computeReachable(state, myPosition)
	view.SafeZones = computeSafeZones(state, view.Reachable)
	view.DangerZones = computeDangerZones(state, view.Reachable)
	view.KnownFoePositions = computeKnownFoePositions(state.Players, viewerID)

	return view
}

// inferMyPositionIsPublic 启发式判断：有 BroadcastHistory 即视为位置曾公开。
// 广播会暴露广播者所在星系；光速飞船公开跃迁同理（无显式标志位，此处为近似）。
func inferMyPositionIsPublic(p *gamesdk.ViewPlayer) bool {
	return len(p.BroadcastHistory) > 0
}

// isExposedByBroadcast 判断当前是否有指向 myPosition 的活跃广播。
// 广播 Phase == "done" 视为已结束（当前 gamesdk 协议未定义 done，
// 作防御性兼容；广播结束后 state.Broadcast 通常被置为 nil）。
func isExposedByBroadcast(b *gamesdk.BroadcastStateView, myPosition int) bool {
	if b == nil {
		return false
	}
	if b.TargetSystem != myPosition {
		return false
	}
	if string(b.Phase) == broadcastPhaseDone {
		return false
	}
	return true
}

// computeReachable 计算一次光速飞船可达星系。
//
// 光速飞船为"跃迁"语义，不受距离限制；可达 = 星图上所有合法星系
// 减去当前星系与被占用星系。已摧毁星系允许跃迁（对齐前端
// OnlinePlayerHand.tsx 与后端 turn.go ExecuteLightspeedShip 的实际行为）。
//
// 复用 starmap.GetSystemsInRange 枚举从 myPosition 出发连通的所有星系
// （9 节点全连通，range=100 等价于 1-9；myPosition 越界时返回 nil，
// 自动处理观察者位置未知/未揭示的边界）。
func computeReachable(state *gamesdk.ViewState, myPosition int) []int {
	candidates := GetSystemsInRange(myPosition, 100)
	if len(candidates) == 0 {
		return nil
	}

	occupied := collectOccupiedSystems(state.Players)

	var reachable []int
	for _, sys := range candidates {
		if sys == myPosition {
			continue
		}
		if occupied[sys] {
			continue
		}
		reachable = append(reachable, sys)
	}
	return reachable
}

// computeSafeZones 从 Reachable 中筛选安全星系：
// 不在任何飞行打击的 TargetSystem 上、未被活跃广播照亮、未被占用。
// occupied 为防御性双重保险（Reachable 已排除）。
// 已摧毁星系不排除（跃迁到已摧毁星系合法，是否"安全"由 DangerZones 的 destroyed 标签表达）。
func computeSafeZones(state *gamesdk.ViewState, reachable []int) []int {
	strikeTargets := collectStrikeTargets(state.FlyingStrikes)
	broadcastTarget := activeBroadcastTarget(state.Broadcast)
	occupied := collectOccupiedSystems(state.Players)

	var safe []int
	for _, sys := range reachable {
		if strikeTargets[sys] {
			continue
		}
		if sys == broadcastTarget {
			continue
		}
		if occupied[sys] {
			continue
		}
		safe = append(safe, sys)
	}
	return safe
}

// computeDangerZones 从 Reachable 中收集每个星系的风险标签。
// 仅保留 risks 非空的星系。destroyed 标签告知 Agent 目标星系已无恒星
// （Reachable 不排除已摧毁星系，destroyed 仍是有决策价值的风险信号）；
// occupied 为防御性双重保险（Reachable 已排除，正常情况下不会触发）。
func computeDangerZones(state *gamesdk.ViewState, reachable []int) []SystemRisk {
	strikeTargets := collectStrikeTargets(state.FlyingStrikes)
	broadcastTarget := activeBroadcastTarget(state.Broadcast)
	occupied := collectOccupiedSystems(state.Players)
	destroyed := collectDestroyedSet(state.DestroyedStars)

	var dangers []SystemRisk
	for _, sys := range reachable {
		var risks []string
		if strikeTargets[sys] {
			risks = append(risks, "inbound_strike")
		}
		if sys == broadcastTarget {
			risks = append(risks, "broadcast_exposed")
		}
		if destroyed[sys] {
			risks = append(risks, "destroyed")
		}
		if occupied[sys] {
			risks = append(risks, "occupied")
		}
		if len(risks) > 0 {
			dangers = append(dangers, SystemRisk{System: sys, Risks: risks})
		}
	}
	return dangers
}

// computeKnownFoePositions 收集已知位置的对手（Position > 0）。
// Position <= 0（如 -1 表示未知）的对手跳过，不放入 map，不做推断。
// 全部对手位置均未知时返回 nil（omitempty 生效）。
func computeKnownFoePositions(players []gamesdk.ViewPlayer, viewerID string) map[string]int {
	var foes map[string]int
	for i := range players {
		if players[i].ID == viewerID {
			continue
		}
		if players[i].Position <= 0 {
			continue
		}
		if foes == nil {
			foes = make(map[string]int)
		}
		foes[players[i].ID] = players[i].Position
	}
	return foes
}

// collectOccupiedSystems 返回所有 Position > 0 的玩家所在星系集合。
// 包含观察者自身（computeReachable 已单独排除 myPosition，此处不做二次过滤）。
func collectOccupiedSystems(players []gamesdk.ViewPlayer) map[int]bool {
	occupied := make(map[int]bool)
	for i := range players {
		if players[i].Position > 0 {
			occupied[players[i].Position] = true
		}
	}
	return occupied
}

// collectDestroyedSet 返回已摧毁星系集合。
func collectDestroyedSet(stars []int) map[int]bool {
	destroyed := make(map[int]bool, len(stars))
	for _, s := range stars {
		destroyed[s] = true
	}
	return destroyed
}

// collectStrikeTargets 返回所有飞行打击的 TargetSystem 集合。
func collectStrikeTargets(strikes []gamesdk.FlyingStrike) map[int]bool {
	targets := make(map[int]bool, len(strikes))
	for i := range strikes {
		targets[strikes[i].TargetSystem] = true
	}
	return targets
}

// activeBroadcastTarget 返回活跃广播的目标星系。
// 广播为 nil 或 Phase == "done" 时返回 -1（哨兵，星系 ID 均为正数）。
func activeBroadcastTarget(b *gamesdk.BroadcastStateView) int {
	if b == nil {
		return -1
	}
	if string(b.Phase) == broadcastPhaseDone {
		return -1
	}
	return b.TargetSystem
}
