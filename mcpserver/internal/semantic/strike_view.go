package semantic

import (
	"encoding/json"
	"fmt"
	"strings"

	"darkforest/mcpserver/internal/gamesdk"
)

// StrikeView 是打击体系的决策视角投影，由 ProjectStrike 从 gamesdk.ViewState
// 中的 FlyingStrikes 派生。把原始打击列表按"飞向我的 / 我发出的 / 第三方的"
// 三分类拆解，并补充 ETA、威胁等级、事实陈述等决策所需派生字段。
//
// ResolvesThisTurn / MissedStrikes 依赖 ViewState.PendingAction 推断：
// gamesdk.FlyingStrike 已脱敏（不含 Missed/Delayed/RetargetedThisTurn 字段），
// 必须从 PendingAction.Type 反推当前需 Agent 处理的打击 UID。
type StrikeView struct {
	Inbound          []InboundStrike    `json:"inbound,omitempty"`
	Outbound         []OutboundStrike   `json:"outbound,omitempty"`
	ThirdParty       []ThirdPartyStrike `json:"thirdParty,omitempty"`
	ResolvesThisTurn []StrikeResolve    `json:"resolvesThisTurn,omitempty"`
	MissedStrikes    []MissedStrike     `json:"missedStrikes,omitempty"`
}

// ThreatLevel 威胁等级，描述入站打击对观察者的潜在影响。
type ThreatLevel string

const (
	// ThreatLevelHigh 将淘汰观察者（穿透防御或降维打击）。
	ThreatLevelHigh ThreatLevel = "high"
	// ThreatLevelMedium 将摧毁设施/恒星或弃置手牌，但不直接淘汰。
	ThreatLevelMedium ThreatLevel = "medium"
	// ThreatLevelLow 将被观察者防御挡住。
	ThreatLevelLow ThreatLevel = "low"
	// ThreatLevelNone 无威胁（保留档位，当前投影逻辑不主动产出）。
	ThreatLevelNone ThreatLevel = "none"
)

// InboundStrike 入站打击（飞向观察者所在星系）。
type InboundStrike struct {
	UID          string      `json:"uid"`
	StrikeName   string      `json:"strikeName"`
	DefID        string      `json:"defId"`
	Level        int         `json:"level"`
	OwnerID      string      `json:"ownerId"`
	Position     int         `json:"position"`
	TargetSystem int         `json:"targetSystem"`
	Arrived      bool        `json:"arrived"`
	ETATurns     int         `json:"etaTurns"`
	ThreatLevel  ThreatLevel `json:"threatLevel"`
	Explain      string      `json:"explain"`
}

// OutboundStrike 出站打击（观察者发出的，无论目标）。
type OutboundStrike struct {
	UID             string   `json:"uid"`
	StrikeName      string   `json:"strikeName"`
	DefID           string   `json:"defId"`
	Level           int      `json:"level"`
	Position        int      `json:"position"`
	TargetSystem    int      `json:"targetSystem"`
	Arrived         bool     `json:"arrived"`
	ETATurns        int      `json:"etaTurns"`
	TargetPlayerIDs []string `json:"targetPlayerIds,omitempty"`
}

// ThirdPartyStrike 第三方打击（既非观察者发出也不飞向观察者）。
type ThirdPartyStrike struct {
	UID          string `json:"uid"`
	StrikeName   string `json:"strikeName"`
	Level        int    `json:"level"`
	OwnerID      string `json:"ownerId"`
	Position     int    `json:"position"`
	TargetSystem int    `json:"targetSystem"`
	Arrived      bool   `json:"arrived"`
}

// StrikeResolve 本回合需观察者 announce 的打击生效。
// 由 PendingAction.Type=="announceStrike" 推断。
type StrikeResolve struct {
	UID          string `json:"uid"`
	StrikeName   string `json:"strikeName"`
	Level        int    `json:"level"`
	TargetSystem int    `json:"targetSystem"`
	Explain      string `json:"explain"`
}

// MissedStrike 落空打击（需 retarget/skip/discard）。
// gamesdk.FlyingStrike 已脱敏不含 Missed 字段，必须由 PendingAction 推断。
type MissedStrike struct {
	UID        string   `json:"uid"`
	StrikeName string   `json:"strikeName"`
	Level      int      `json:"level"`
	Position   int      `json:"position"`
	Options    []string `json:"options"`
}

// localPendingAction 是 PendingAction 的本地反序列化结构。
// gamesdk.ViewState.PendingAction 为 json.RawMessage，这里按需提取字段，
// 不依赖后端未导出的 PendingAction 类型。
type localPendingAction struct {
	Type            string   `json:"type,omitempty"`
	StrikeUID       string   `json:"strikeUid,omitempty"`
	StrikeUIDs      []string `json:"strikeUids,omitempty"`
	TargetSystem    int      `json:"targetSystem,omitempty"`
	TargetPlayerIDs []string `json:"targetPlayerIds,omitempty"`
}

// strikeForbiddenWords 是 explain 字段禁用的行动指导词。
// explain 仅陈述事实，不得引导 Agent 采取具体行动。
var strikeForbiddenWords = []string{
	"建议", "应当", "推荐", "可以", "不妨", "最好", "应该", "需要", "务必",
}

// ProjectStrike 把 ViewState 中的 FlyingStrikes 投影为决策视角的 StrikeView。
//
// viewerID 是当前观察者玩家 ID；myPosition 是观察者所在星系，
// 用于判断入站/出站/第三方分类。state 为 nil 时返回零值 StrikeView。
func ProjectStrike(state *gamesdk.ViewState, viewerID string, myPosition int) StrikeView {
	var view StrikeView
	if state == nil {
		return view
	}

	myMaxProtection := computeMyMaxProtection(state, viewerID)
	pa := parseLocalPendingAction(state.PendingAction)

	for i := range state.FlyingStrikes {
		s := &state.FlyingStrikes[i]
		eta := computeStrikeETA(s)

		isInbound := s.TargetSystem == myPosition && s.OwnerID != viewerID
		isOutbound := s.OwnerID == viewerID

		switch {
		case isInbound:
			view.Inbound = append(view.Inbound, InboundStrike{
				UID:          s.UID,
				StrikeName:   s.StrikeName,
				DefID:        s.DefID,
				Level:        s.Level,
				OwnerID:      s.OwnerID,
				Position:     s.Position,
				TargetSystem: s.TargetSystem,
				Arrived:      s.Arrived,
				ETATurns:     eta,
				ThreatLevel:  computeThreatLevel(s.Level, s.Effect, myMaxProtection),
				Explain:      buildInboundExplain(s, myPosition, myMaxProtection),
			})
		case isOutbound:
			view.Outbound = append(view.Outbound, OutboundStrike{
				UID:             s.UID,
				StrikeName:      s.StrikeName,
				DefID:           s.DefID,
				Level:           s.Level,
				Position:        s.Position,
				TargetSystem:    s.TargetSystem,
				Arrived:         s.Arrived,
				ETATurns:        eta,
				TargetPlayerIDs: collectTargetPlayerIDs(state, s),
			})
		default:
			view.ThirdParty = append(view.ThirdParty, ThirdPartyStrike{
				UID:          s.UID,
				StrikeName:   s.StrikeName,
				Level:        s.Level,
				OwnerID:      s.OwnerID,
				Position:     s.Position,
				TargetSystem: s.TargetSystem,
				Arrived:      s.Arrived,
			})
		}
	}

	view.ResolvesThisTurn = projectResolvesThisTurn(state, pa)
	view.MissedStrikes = projectMissedStrikes(state, pa)

	return view
}

// computeMyMaxProtection 遍历 viewerID 玩家的 FaceUpCards，
// 取 type=="defense" 卡牌的最高 protectionLevel。无防御牌时返回 0。
func computeMyMaxProtection(state *gamesdk.ViewState, viewerID string) int {
	if state == nil {
		return 0
	}
	for i := range state.Players {
		p := &state.Players[i]
		if p.ID != viewerID {
			continue
		}
		maxProtection := 0
		for _, c := range p.FaceUpCards {
			if c.Type == "defense" && c.ProtectionLevel > maxProtection {
				maxProtection = c.ProtectionLevel
			}
		}
		return maxProtection
	}
	return 0
}

// parseLocalPendingAction 反序列化 PendingAction json.RawMessage。
// 空 raw 或 "null" 或 Type 为空时返回 nil。
func parseLocalPendingAction(raw json.RawMessage) *localPendingAction {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var pa localPendingAction
	if err := json.Unmarshal(raw, &pa); err != nil {
		return nil
	}
	if pa.Type == "" {
		return nil
	}
	return &pa
}

// computeStrikeETA 计算打击预计抵达回合数。
//   - Arrived=true → 0
//   - Speed<=0 或 Position→TargetSystem 不连通 → -1（异常标记）
//   - 否则 ceil(dist/speed)，用 (dist+speed-1)/speed 整数运算向上取整
func computeStrikeETA(s *gamesdk.FlyingStrike) int {
	if s.Arrived {
		return 0
	}
	if s.Speed <= 0 {
		return -1
	}
	dist := GetDistance(s.Position, s.TargetSystem)
	if dist >= unreachableDistance {
		return -1
	}
	if dist == 0 {
		return 0
	}
	return (dist + s.Speed - 1) / s.Speed
}

// computeThreatLevel 判定入站打击的威胁等级。
//
// 判定优先级（对齐后端 strike.go ResolveStrike 的结算逻辑）：
//  1. level==4 && effect=="discard_hand" → Medium（科技锁死，弃手牌不淘汰）
//  2. level==4 && effect!="discard_hand" → High（降维打击，无视防御淘汰）
//  3. myMaxProtection==0 && level>=1 → High（无防御，将被淘汰）
//  4. level > myMaxProtection → High（穿透防御淘汰）
//  5. level <= myMaxProtection → Low（被防御挡住，含等于与小于两档）
func computeThreatLevel(level int, effect string, myMaxProtection int) ThreatLevel {
	if level == 4 && effect == "discard_hand" {
		return ThreatLevelMedium
	}
	if level == 4 && effect != "discard_hand" {
		return ThreatLevelHigh
	}
	if myMaxProtection == 0 {
		if level >= 1 {
			return ThreatLevelHigh
		}
		return ThreatLevelNone
	}
	if level > myMaxProtection {
		return ThreatLevelHigh
	}
	return ThreatLevelLow
}

// buildInboundExplain 构造 InboundStrike.Explain。
// N 用 myPosition 替换（Inbound 场景下 myPosition == strike.TargetSystem）。
func buildInboundExplain(s *gamesdk.FlyingStrike, myPosition int, myMaxProtection int) string {
	return buildStrikeExplain(s, myPosition, myMaxProtection, true)
}

// buildResolveExplain 构造 StrikeResolve.Explain。
// N 用 strike.TargetSystem 替换；不附加防御判定后缀（目标非观察者）。
func buildResolveExplain(s *gamesdk.FlyingStrike) string {
	return buildStrikeExplain(s, s.TargetSystem, 0, false)
}

// buildStrikeExplain 生成事实陈述，禁用行动指导词（strikeForbiddenWords）。
//
// 模板优先级（参考后端 strike.go ResolveStrike 结算分支）：
//  1. level==4 && effect!="discard_hand"：降维打击，无视防御淘汰
//  2. effect=="discard_hand"：科技锁死，弃置目标玩家全部手牌
//  3. DefID=="strike_light_particle"：光粒打击，摧毁星系恒星
//  4. DefID=="strike_annihilation"：湮灭打击，摧毁星系恒星与所有设施
//  5. 普通打击：抵达星系{N}，可选附防御判定后缀
//
// includeDefenseSuffix=true 时（仅 Inbound），附加：
//   - level > myMaxProtection → "；将穿透防御淘汰目标玩家"
//   - 否则 → "；将被防御挡住"
func buildStrikeExplain(s *gamesdk.FlyingStrike, systemN int, myMaxProtection int, includeDefenseSuffix bool) string {
	name := s.StrikeName
	if name == "" {
		name = s.DefID
	}
	level := s.Level

	if level == 4 && s.Effect != "discard_hand" {
		return fmt.Sprintf("%s(Lv%d) 将无视防御淘汰目标星系玩家", name, level)
	}
	if s.Effect == "discard_hand" {
		return fmt.Sprintf("%s(Lv%d) 将弃置目标玩家全部手牌", name, level)
	}
	if s.DefID == "strike_light_particle" {
		return fmt.Sprintf("%s(Lv%d) 将摧毁星系%d的恒星", name, level, systemN)
	}
	if s.DefID == "strike_annihilation" {
		return fmt.Sprintf("%s(Lv%d) 将摧毁星系%d的恒星与所有设施", name, level, systemN)
	}

	base := fmt.Sprintf("%s(Lv%d) 将抵达星系%d", name, level, systemN)
	if includeDefenseSuffix {
		if level > myMaxProtection {
			base += "；将穿透防御淘汰目标玩家"
		} else {
			base += "；将被防御挡住"
		}
	}
	return base
}

// collectTargetPlayerIDs 返回目标星系上的候选玩家 ID（排除已淘汰与打击拥有者）。
// 用于 OutboundStrike.TargetPlayerIDs，帮助 Agent 评估打击的可能目标。
func collectTargetPlayerIDs(state *gamesdk.ViewState, s *gamesdk.FlyingStrike) []string {
	if state == nil {
		return nil
	}
	var ids []string
	for i := range state.Players {
		p := &state.Players[i]
		if p.Eliminated {
			continue
		}
		if p.Position != s.TargetSystem {
			continue
		}
		if p.ID == s.OwnerID {
			continue
		}
		ids = append(ids, p.ID)
	}
	return ids
}

// projectResolvesThisTurn 从 PendingAction.Type=="announceStrike" 推断本回合待生效打击。
// PendingAction.StrikeUIDs 优先；为空时回退到 StrikeUID（singular，对齐后端 announceStrike）。
func projectResolvesThisTurn(state *gamesdk.ViewState, pa *localPendingAction) []StrikeResolve {
	if pa == nil || pa.Type != "announceStrike" {
		return nil
	}
	uids := pa.StrikeUIDs
	if len(uids) == 0 && pa.StrikeUID != "" {
		uids = []string{pa.StrikeUID}
	}
	if len(uids) == 0 {
		return nil
	}

	var out []StrikeResolve
	for _, uid := range uids {
		var matched *gamesdk.FlyingStrike
		for i := range state.FlyingStrikes {
			if state.FlyingStrikes[i].UID == uid {
				matched = &state.FlyingStrikes[i]
				break
			}
		}
		if matched == nil {
			continue
		}
		out = append(out, StrikeResolve{
			UID:          matched.UID,
			StrikeName:   matched.StrikeName,
			Level:        matched.Level,
			TargetSystem: matched.TargetSystem,
			Explain:      buildResolveExplain(matched),
		})
	}
	return out
}

// projectMissedStrikes 从 PendingAction.Type 含 "strikeMissed" 前缀推断落空打击。
//
// gamesdk.FlyingStrike 已脱敏不含 Missed 字段，必须依赖 PendingAction 暴露。
// options 映射（参考后端 types.go PendingAction.Type 与 strike.go handleStrikeMiss）：
//   - "strikeMissedFree"          → ["retarget","skip","discard"]
//   - "strikeMissedRequireTarget" → ["retarget","skip","discard"]
//   - 其他 strikeMissed*          → ["skip","discard"]
func projectMissedStrikes(state *gamesdk.ViewState, pa *localPendingAction) []MissedStrike {
	if pa == nil || !strings.HasPrefix(pa.Type, "strikeMissed") {
		return nil
	}
	uids := pa.StrikeUIDs
	if len(uids) == 0 && pa.StrikeUID != "" {
		uids = []string{pa.StrikeUID}
	}
	if len(uids) == 0 {
		return nil
	}

	options := []string{"skip", "discard"}
	if pa.Type == "strikeMissedFree" || pa.Type == "strikeMissedRequireTarget" {
		options = []string{"retarget", "skip", "discard"}
	}

	var out []MissedStrike
	for _, uid := range uids {
		var matched *gamesdk.FlyingStrike
		for i := range state.FlyingStrikes {
			if state.FlyingStrikes[i].UID == uid {
				matched = &state.FlyingStrikes[i]
				break
			}
		}
		if matched == nil {
			continue
		}
		out = append(out, MissedStrike{
			UID:        matched.UID,
			StrikeName: matched.StrikeName,
			Level:      matched.Level,
			Position:   matched.Position,
			Options:    options,
		})
	}
	return out
}
