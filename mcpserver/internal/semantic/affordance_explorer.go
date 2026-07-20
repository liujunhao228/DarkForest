package semantic

import (
	"encoding/json"
	"fmt"
	"strconv"

	"darkforest/mcpserver/internal/gamesdk"
)

// Affordance 是当前合法动作集，回答"现在能做什么"。
//
// 由 ExploreAffordance 从 gamesdk.ViewState 派生：
//   - PendingAction 非空时仅填充 PendingActionOption（强制动作优先），
//     LegalActions 留空（强制动作必须先处理）。
//   - 否则当 TurnPhase == "actionPhase" 且 IsMyTurn 时推导自由动作集
//     （play_card / strike / deploy_card / lightspeed_ship / end_turn / recycle_card）。
type Affordance struct {
	PendingAction *PendingActionOption `json:"pendingAction,omitempty"` // 强制挂起动作（若有）
	LegalActions  []ActionOption       `json:"legalActions,omitempty"`  // 自由动作集
}

// PendingActionOption 强制挂起动作选项。
type PendingActionOption struct {
	Type         string   `json:"type"`                   // 对齐后端 PendingAction.Type
	Description  string   `json:"description"`            // 人话描述（事实陈述，禁用行动指导词）
	LegalTargets []Target `json:"legalTargets,omitempty"` // 合法目标集
	LegalOptions []string `json:"legalOptions,omitempty"` // 无目标时的合法选项（如 skip/discard）
}

// ActionOption 单个合法动作选项。
type ActionOption struct {
	Action         string     `json:"action"`                   // play_card/strike/deploy_card/lightspeed_ship/end_turn/recycle_card
	Description    string     `json:"description"`              // 人话描述（事实陈述）
	Cost           ActionCost `json:"cost"`                     // 动作成本
	LegalTargets   []Target   `json:"legalTargets,omitempty"`   // 合法目标集（卡牌 UID/星系 ID/玩家 ID）
	Precondition   string     `json:"precondition,omitempty"`   // 人话描述前提条件
	ExpectedEffect string     `json:"expectedEffect,omitempty"` // 人话描述预期后果（复用 StrikeView/BroadcastView 的 explain）
	RiskNote       string     `json:"riskNote,omitempty"`       // 副作用提示（事实陈述）
}

// ActionCost 动作成本。负数 Energy 表示返还。
type ActionCost struct {
	Energy         int `json:"energy,omitempty"`
	CardsDiscarded int `json:"cardsDiscarded,omitempty"`
}

// Target 合法目标（判别式，通过 Type 区分）。
//
// Type 取值：
//   - "cardUid"   : Value 为卡牌 UID
//   - "systemId"  : Value 为星系 ID（已转为 string）
//   - "playerId"  : Value 为玩家 ID
//   - "strikeUid" : Value 为飞行打击 UID
//   - "option"    : Value 为选项字符串（如 retarget/skip/discard）
type Target struct {
	Type  string `json:"type"`
	Value string `json:"value"` // 统一用 string 表示（systemId 也转 string）
}

// affordancePendingAction 是 PendingAction 的本地反序列化结构。
//
// strike_view.go 中已有 localPendingAction，但仅含 Type/StrikeUID/StrikeUIDs/
// TargetSystem/TargetPlayerIDs 五个字段。此处定义扩展结构以携带 ValidMoves/
// Responders/CardUID/ValidTargets/RefundEnergy 等字段，供 AffordanceExplorer 使用。
//
// 字段对齐后端 game.PendingAction（e:\DarkForest\backend\internal\game\types.go:186-202），
// 省略 BroadcastState / PlayerID / BroadcastOnInherit（AffordanceExplorer 不需要）。
type affordancePendingAction struct {
	Type            string   `json:"type,omitempty"`
	StrikeUID       string   `json:"strikeUid,omitempty"`
	StrikeUIDs      []string `json:"strikeUids,omitempty"`
	ValidMoves      []int    `json:"validMoves,omitempty"`
	TargetSystem    int      `json:"targetSystem,omitempty"`
	TargetPlayerIDs []string `json:"targetPlayerIds,omitempty"`
	Responders      []string `json:"responders,omitempty"`
	CardUID         string   `json:"cardUid,omitempty"`
	ValidTargets    []int    `json:"validTargets,omitempty"`
	RefundEnergy    int      `json:"refundEnergy,omitempty"`
}

// ExploreAffordance 把 ViewState 投影为当前合法动作集。
//
// viewerID 是当前观察者玩家 ID。
// gameMode 是当前游戏模式（"classic" / "civilization_relics"）。
//
// 投影优先级：
//  1. PendingAction 非空（json.RawMessage 非 nil 且非 "null"）→ 仅填充
//     PendingActionOption，LegalActions 留空（强制动作必须先处理）。
//  2. 否则，若 TurnPhase == "actionPhase" 且 CurrentPlayerID == viewerID，
//     推导自由动作集。
//  3. 其他情况（非自己回合 / 非 actionPhase / 无 viewer）→ 返回零值 Affordance。
//
// state 为 nil 时返回零值 Affordance。
func ExploreAffordance(state *gamesdk.ViewState, viewerID string, gameMode string) Affordance {
	var aff Affordance
	if state == nil {
		return aff
	}

	pa := parseAffordancePendingAction(state.PendingAction)
	if pa != nil {
		aff.PendingAction = projectPendingActionOption(pa, state, viewerID)
		// PendingAction 非空时强制动作必须先处理，自由动作集为空。
		return aff
	}

	// 自由动作集仅当 IsMyTurn 且 TurnPhase == "actionPhase" 时推导。
	if state.CurrentPlayerID != viewerID {
		return aff
	}
	if state.TurnPhase != "actionPhase" {
		return aff
	}

	var self *gamesdk.ViewPlayer
	for i := range state.Players {
		if state.Players[i].ID == viewerID {
			self = &state.Players[i]
			break
		}
	}
	if self == nil {
		return aff
	}

	aff.LegalActions = projectLegalActions(state, self, gameMode)
	return aff
}

// parseAffordancePendingAction 反序列化 PendingAction json.RawMessage。
// 空 raw 或 "null" 或 Type 为空时返回 nil。
func parseAffordancePendingAction(raw json.RawMessage) *affordancePendingAction {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var pa affordancePendingAction
	if err := json.Unmarshal(raw, &pa); err != nil {
		return nil
	}
	if pa.Type == "" {
		return nil
	}
	return &pa
}

// projectPendingActionOption 按 PendingAction.Type 映射 Description 与 LegalTargets/LegalOptions。
//
// Description 全部为事实陈述，禁用 strikeForbiddenWords 中的行动指导词。
// LegalTargets/LegalOptions 派生规则：
//   - strikeSelect              : StrikeUIDs → strikeUid 目标
//   - strikeMove                : ValidMoves → systemId 目标
//   - announceStrike            : StrikeUIDs 优先，回退 StrikeUID → strikeUid 目标
//   - strikeMissedFree / RequireTarget : LegalOptions=[retarget,skip,discard]
//   - respondBroadcast          : LegalOptions=[agree,refuse]
//   - selectBroadcastResponder  : Responders → playerId 目标
//   - endTurnDiscard / discardCards : LegalOptions=手牌 UID 列表
//   - 其他                      : Description=Type，无 LegalTargets/LegalOptions
func projectPendingActionOption(pa *affordancePendingAction, state *gamesdk.ViewState, viewerID string) *PendingActionOption {
	opt := &PendingActionOption{Type: pa.Type}

	switch pa.Type {
	case "strikeSelect":
		opt.Description = "存在多个待处理打击需选择"
		opt.LegalTargets = strikeUidSliceToTargets(pa.StrikeUIDs)
	case "strikeMove":
		opt.Description = "打击需移动"
		opt.LegalTargets = intSliceToTargets(pa.ValidMoves, "systemId")
	case "announceStrike":
		opt.Description = "打击已抵达需宣布生效"
		uids := pa.StrikeUIDs
		if len(uids) == 0 && pa.StrikeUID != "" {
			uids = []string{pa.StrikeUID}
		}
		opt.LegalTargets = strikeUidSliceToTargets(uids)
	case "strikeMissedFree", "strikeMissedRequireTarget":
		opt.Description = "打击落空，可重定向/跳过/废弃"
		opt.LegalOptions = []string{"retarget", "skip", "discard"}
	case "respondBroadcast":
		opt.Description = "广播需回应"
		opt.LegalOptions = []string{"agree", "refuse"}
	case "selectBroadcastResponder":
		opt.Description = "需选择广播回应者"
		opt.LegalTargets = stringSliceToTargets(pa.Responders, "playerId")
	case "endTurnDiscard", "discardCards":
		opt.Description = "回合结束需弃牌"
		opt.LegalOptions = handUidOptions(state, viewerID)
	default:
		// 未知 Type：Description=Type，无 LegalTargets/LegalOptions
		opt.Description = pa.Type
	}
	return opt
}

// projectLegalActions 推导自由动作集。
// 仅在无 PendingAction 且 TurnPhase == "actionPhase" 且 IsMyTurn 时调用。
//
// 推导顺序（与前端 ActionType 枚举对齐）：
//  1. 手牌扫描 → play_card（广播牌）/ strike（打击牌）/ deploy_card（设施/防御牌）
//     Classic 模式下 escape 牌（光速飞船）不可单独部署，须由 step 2 通过 lightspeed_ship 发动。
//  2. lightspeed_ship：检查 escape 牌（Classic 在手牌，Relics 在 FaceUpCards）
//  3. recycle_card：遍历 FaceUpCards
//  4. end_turn：始终可选
func projectLegalActions(state *gamesdk.ViewState, self *gamesdk.ViewPlayer, gameMode string) []ActionOption {
	rules, _ := GetModeRules(gameMode)
	var actions []ActionOption

	// 1. 手牌扫描：play_card / strike / deploy_card
	for i := range self.Hand {
		card := &self.Hand[i]
		switch card.Type {
		case "broadcast":
			if self.Energy < card.Energy {
				continue
			}
			targets := broadcastCardTargets(state, self, card)
			if len(targets) == 0 {
				continue
			}
			actions = append(actions, ActionOption{
				Action:         "play_card",
				Description:    fmt.Sprintf("出牌：%s（广播牌）", card.Name),
				Cost:           ActionCost{Energy: card.Energy},
				LegalTargets:   targets,
				Precondition:   fmt.Sprintf("需在手牌、能量≥%d、目标星系在范围内", card.Energy),
				ExpectedEffect: "向目标星系发起广播",
			})
		case "strike":
			if self.Energy < card.Energy {
				continue
			}
			actions = append(actions, ActionOption{
				Action:         "strike",
				Description:    fmt.Sprintf("出牌：%s（打击牌）", card.Name),
				Cost:           ActionCost{Energy: card.Energy},
				LegalTargets:   strikeCardTargets(state),
				Precondition:   fmt.Sprintf("需在手牌、能量≥%d", card.Energy),
				ExpectedEffect: buildHandStrikeExpectedEffect(card),
			})
		case "facility", "defense":
			// Classic 模式下光速飞船（ability=escape）为一次性牌，仅可通过 lightspeed_ship 发动；
			// 后端 DeployCard 会拒绝部署（cards_actions.go:55），此处跳过避免向 Agent 暴露会被拒绝的 deploy_card 路径。
			if rules.LightspeedUsage == LightspeedUsageOneTime && card.Ability == "escape" {
				continue
			}
			if self.Energy < card.Energy {
				continue
			}
			actions = append(actions, ActionOption{
				Action:       "deploy_card",
				Description:  fmt.Sprintf("部署：%s", card.Name),
				Cost:         ActionCost{Energy: card.Energy},
				LegalTargets: []Target{{Type: "cardUid", Value: card.UID}},
				Precondition: fmt.Sprintf("需在手牌、能量≥%d", card.Energy),
			})
		}
	}

	// 2. lightspeed_ship：检查 escape 牌（Hand 或 FaceUpCards）
	if hasEscapeCard(self) {
		reachable := computeReachable(state, self.Position)
		if len(reachable) > 0 {
			targets := make([]Target, 0, len(reachable))
			for _, sys := range reachable {
				targets = append(targets, Target{Type: "systemId", Value: strconv.Itoa(sys)})
			}
			// 成本取 random 模式下限（specified 模式更高，由 Agent 查询 rules://mechanism/lightspeed 复核）。
			// Classic=10/13 一次性合并动作；Relics=3/5 跃迁费（不含留言+1、携带不影响能量消耗）。
			minCost := rules.LightspeedJumpCostRandom
			if rules.LightspeedUsage == LightspeedUsageOneTime {
				minCost = rules.LightspeedCombinedActionCost
			}
			actions = append(actions, ActionOption{
				Action:         "lightspeed_ship",
				Description:    "光速飞船跃迁",
				Cost:           ActionCost{Energy: minCost},
				LegalTargets:   targets,
				Precondition:   fmt.Sprintf("拥有光速飞船、能量≥%d（random 模式下限，specified 模式更高）", minCost),
				ExpectedEffect: "跃迁至目标星系",
			})
		}
	}

	// 3. recycle_card：遍历 FaceUpCards（返还一半能量）
	for i := range self.FaceUpCards {
		card := &self.FaceUpCards[i]
		refund := card.Energy / 2
		actions = append(actions, ActionOption{
			Action:       "recycle_card",
			Description:  fmt.Sprintf("回收设施：%s", card.Name),
			Cost:         ActionCost{Energy: -refund},
			LegalTargets: []Target{{Type: "cardUid", Value: card.UID}},
			Precondition: "设施在场上",
			RiskNote:     "返还能量、失去设施效果",
		})
	}

	// 4. end_turn：始终可选（在 actionPhase 且无 pending 时）
	actions = append(actions, ActionOption{
		Action:      "end_turn",
		Description: "结束当前回合",
	})

	return actions
}

// broadcastCardTargets 计算广播牌的合法目标星系。
//
// 规则（对齐前端 OnlinePlayerHand.tsx 与后端 broadcast.go InitiateBroadcast，
// 后者不校验目标星系是否已摧毁）：
//   - 候选 = GetSystemsInRange(self.Position, card.Range) ∪ {self.Position}
//   - 允许向自身所在星系广播：广播者自身不作为回应者（后端 broadcast.go 跳过 self），
//     若自身星系无其他玩家则触发"无人回应"分支（消耗卡牌换 1 能量）
//   - 其他星系仅保留含其他玩家（未淘汰、非 self）的星系
//   - 已摧毁星系不排除（其上的玩家仍可响应广播；无玩家的已摧毁星系
//     会被 systemHasOtherPlayer 自然过滤）
func broadcastCardTargets(state *gamesdk.ViewState, self *gamesdk.ViewPlayer, card *gamesdk.Card) []Target {
	candidates := GetSystemsInRange(self.Position, card.Range)
	// 允许向自身所在星系广播
	candidates = append(candidates, self.Position)

	var out []Target
	for _, sys := range candidates {
		if sys == self.Position {
			// 自身星系：无前置条件，即使无其他玩家也允许广播（触发无人回应分支）
			out = append(out, Target{Type: "systemId", Value: strconv.Itoa(sys)})
			continue
		}
		if !systemHasOtherPlayer(state.Players, self.ID, sys) {
			continue
		}
		out = append(out, Target{Type: "systemId", Value: strconv.Itoa(sys)})
	}
	return out
}

// strikeCardTargets 计算打击牌的合法目标星系。
//
// 对齐前端 OnlinePlayerHand.tsx:175 validStrikeTargets=[1..9]（无过滤），
// 后端 cards_actions.go PlayStrikeCard 不校验目标星系是否已摧毁。
// 打击可指向任何星系（含 self.Position、已占用星系、已摧毁星系）。
func strikeCardTargets(state *gamesdk.ViewState) []Target {
	out := make([]Target, 0, 9)
	for sys := 1; sys <= 9; sys++ {
		out = append(out, Target{Type: "systemId", Value: strconv.Itoa(sys)})
	}
	return out
}

// hasEscapeCard 检查玩家手牌或已部署设施中是否含 Ability=="escape" 的牌。
//
// Classic 模式下 escape 牌在手牌；Relics 模式下 escape 牌在 FaceUpCards。
// 此处合并两路检查以简化判定（对齐任务约束）。
func hasEscapeCard(self *gamesdk.ViewPlayer) bool {
	for i := range self.Hand {
		if self.Hand[i].Ability == "escape" {
			return true
		}
	}
	for i := range self.FaceUpCards {
		if self.FaceUpCards[i].Ability == "escape" {
			return true
		}
	}
	return false
}

// buildHandStrikeExpectedEffect 为手牌中的打击牌生成 ExpectedEffect。
//
// 复用 strike_view.go buildStrikeExplain 的模板逻辑分支，但因手牌打击尚无具体
// 目标星系（LegalTargets 列出多个候选），将 "星系%d" 替换为 "目标星系"。
//
// 模板优先级（参考后端 strike.go ResolveStrike 结算分支）：
//  1. level==4 && effect!="discard_hand"：降维打击，无视防御淘汰
//  2. effect=="discard_hand"：科技锁死，弃置目标玩家全部手牌
//  3. DefID=="strike_light_particle"：光粒打击，摧毁目标星系恒星
//  4. DefID=="strike_annihilation"：湮灭打击，摧毁目标星系恒星与所有设施
//  5. 普通打击：抵达目标星系
func buildHandStrikeExpectedEffect(card *gamesdk.Card) string {
	name := card.Name
	if name == "" {
		name = card.DefID
	}
	level := card.Level

	if level == 4 && card.Effect != "discard_hand" {
		return fmt.Sprintf("%s(Lv%d) 将无视防御淘汰目标星系玩家", name, level)
	}
	if card.Effect == "discard_hand" {
		return fmt.Sprintf("%s(Lv%d) 将弃置目标玩家全部手牌", name, level)
	}
	if card.DefID == "strike_light_particle" {
		return fmt.Sprintf("%s(Lv%d) 将摧毁目标星系的恒星", name, level)
	}
	if card.DefID == "strike_annihilation" {
		return fmt.Sprintf("%s(Lv%d) 将摧毁目标星系的恒星与所有设施", name, level)
	}
	return fmt.Sprintf("%s(Lv%d) 将抵达目标星系", name, level)
}

// handUidOptions 返回 viewerID 玩家手牌 UID 列表。
// 用于 endTurnDiscard / discardCards 类 PendingAction 的 LegalOptions。
func handUidOptions(state *gamesdk.ViewState, viewerID string) []string {
	for i := range state.Players {
		p := &state.Players[i]
		if p.ID != viewerID {
			continue
		}
		if len(p.Hand) == 0 {
			return nil
		}
		out := make([]string, 0, len(p.Hand))
		for _, c := range p.Hand {
			out = append(out, c.UID)
		}
		return out
	}
	return nil
}

// systemHasOtherPlayer 报告 sys 是否有非 selfID、未淘汰的玩家。
func systemHasOtherPlayer(players []gamesdk.ViewPlayer, selfID string, sys int) bool {
	for i := range players {
		p := &players[i]
		if p.ID == selfID {
			continue
		}
		if p.Eliminated {
			continue
		}
		if p.Position == sys {
			return true
		}
	}
	return false
}

// strikeUidSliceToTargets 把 strike UID 列表转为 Target 切片（Type="strikeUid"）。
func strikeUidSliceToTargets(uids []string) []Target {
	if len(uids) == 0 {
		return nil
	}
	out := make([]Target, 0, len(uids))
	for _, uid := range uids {
		out = append(out, Target{Type: "strikeUid", Value: uid})
	}
	return out
}

// intSliceToTargets 把 int 列表转为 Target 切片（systemId 等）。
func intSliceToTargets(vals []int, targetType string) []Target {
	if len(vals) == 0 {
		return nil
	}
	out := make([]Target, 0, len(vals))
	for _, v := range vals {
		out = append(out, Target{Type: targetType, Value: strconv.Itoa(v)})
	}
	return out
}

// stringSliceToTargets 把 string 列表转为 Target 切片（playerId 等）。
func stringSliceToTargets(vals []string, targetType string) []Target {
	if len(vals) == 0 {
		return nil
	}
	out := make([]Target, 0, len(vals))
	for _, v := range vals {
		out = append(out, Target{Type: targetType, Value: v})
	}
	return out
}
