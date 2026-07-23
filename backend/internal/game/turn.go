package game

import (
	"fmt"
	"math/rand"
	"strings"
)

func StartTurn(state *GameState) {
	player := GetCurrentPlayer(state)

	if player == nil || player.Eliminated {
		AdvanceToNextPlayer(state)
		return
	}

	// 检查 PenaltyTurn 标志（跃迁失败/湮灭余波导致的惩罚限制）
	if player.PenaltyTurn {
		player.PenaltyTurn = false
		AddStructuredLog(state, fmt.Sprintf("%s 受跃迁惩罚影响，本回合只能弃牌或直接结束回合", player.Name), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{player.ID},
		})
		// 不跳过回合，正常进入 turnBegin → drawPhase → actionPhase
		// 前端通过 penaltyTurn 字段限制可用操作
	}

	state.TurnPhase = TurnPhaseTurnBegin
	state.PendingAction = nil
	state.IsProcessing = false

	AddStructuredLog(state, fmt.Sprintf("--- %s 的回合 ---", player.Name), LogEntryTypeSystem, LogFields{
		PlayerIDs: []string{player.ID},
	})

	processTurnBegin(state)
}

func processTurnBegin(state *GameState) {
	player := GetCurrentPlayer(state)
	if player == nil {
		return
	}

	// 清理已过期的星系效果
	PurgeExpiredStarEffects(state)

	player.Energy += 1
	AddStructuredLog(state, fmt.Sprintf("%s 获得 1 点基础能量 (当前能量: %d)", player.Name, player.Energy), LogEntryTypeInfo, LogFields{
		PlayerIDs: []string{player.ID},
	})

	SettlementPhase(state)

	// 回合开始时重置当前玩家所有打击的剩余移动次数（速度 = 每回合可移动距离）
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].OwnerID == player.ID {
			state.FlyingStrikes[i].RemainingMoves = state.FlyingStrikes[i].Speed
		}
	}

	// 重置当前玩家所有打击的延迟标记，允许下回合重新宣布
	// 同时重置重新指定目标标记，允许下回合再次 retarget
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].OwnerID == player.ID {
			state.FlyingStrikes[i].Delayed = false
			state.FlyingStrikes[i].RetargetedThisTurn = false
		}
	}

	// 已 Arrived 的打击不再阻塞回合（支持长期悬停/威慑），直接进入打击移动阶段
	advanceToStrikeMovement(state)
}

func advanceToStrikeMovement(state *GameState) {
	state.TurnPhase = TurnPhaseStrikeMovement

	player := GetCurrentPlayer(state)
	if player == nil {
		return
	}

	// 收集当前玩家所有需要操作的打击：待移动（仍有移动次数且本回合未 retarget）+ 已 Arrived（可宣布生效）
	movingStrikes := Filter(state.FlyingStrikes, func(s FlyingStrike) bool {
		return s.OwnerID == player.ID && s.Position != s.TargetSystem && s.RemainingMoves > 0 && !s.RetargetedThisTurn
	})
	arrivedStrikes := Filter(state.FlyingStrikes, func(s FlyingStrike) bool {
		return s.OwnerID == player.ID && s.Arrived && !s.Delayed && !s.Missed
	})
	missedStrikes := Filter(state.FlyingStrikes, func(s FlyingStrike) bool {
		return s.OwnerID == player.ID && s.Missed && !s.Delayed
	})

	totalCount := len(movingStrikes) + len(arrivedStrikes) + len(missedStrikes)
	if totalCount == 0 {
		DrawPhase(state)
		return
	}

	// 合并打击 UID 列表
	strikeUIDs := make([]string, 0, totalCount)
	for _, s := range movingStrikes {
		strikeUIDs = append(strikeUIDs, s.UID)
	}
	for _, s := range arrivedStrikes {
		strikeUIDs = append(strikeUIDs, s.UID)
	}
	for _, s := range missedStrikes {
		strikeUIDs = append(strikeUIDs, s.UID)
	}

	if totalCount == 1 {
		// 只有一个打击：直接进入对应阶段
		strike := state.FlyingStrikes
		var target *FlyingStrike
		for i := range strike {
			if strike[i].UID == strikeUIDs[0] {
				target = &strike[i]
				break
			}
		}
		if target == nil {
			DrawPhase(state)
			return
		}
		enterStrikeAction(state, target)
	} else {
		// 多个打击：让玩家选择
		state.PendingAction = &PendingAction{
			Type:       "strikeSelect",
			StrikeUIDs: strikeUIDs,
		}
		AddStructuredLog(state, fmt.Sprintf("%s 有 %d 个打击待处理", player.Name, totalCount), LogEntryTypeCombat, LogFields{
			PlayerIDs: []string{player.ID},
		})
	}
}

// enterStrikeAction 根据打击状态设置对应的 PendingAction
func enterStrikeAction(state *GameState, strike *FlyingStrike) {
	if strike.Missed {
		// 落空打击：按 StrikeMissBehavior 设置对应 PendingAction，等待玩家重定向/跳过/废弃
		rules := StateRules(state)
		switch rules.StrikeMissBehavior {
		case StrikeMissFreeControl:
			state.PendingAction = &PendingAction{
				Type:      "strikeMissedFree",
				StrikeUID: strike.UID,
			}
		case StrikeMissRequireTarget:
			validTargets := make([]int, 0, 9)
			for s := 1; s <= 9; s++ {
				validTargets = append(validTargets, s)
			}
			state.PendingAction = &PendingAction{
				Type:         "strikeMissedRequireTarget",
				StrikeUID:    strike.UID,
				ValidTargets: validTargets,
			}
		default:
			// Discard 等：理论上 Missed 打击不应在 FlyingStrikes 中（Discard 落空已被 handleStrikeMiss 移除）；
			// 防御性兜底：不设 PendingAction，让流程继续推进。
		}
		return
	}
	if strike.Arrived {
		// 已到达目标：检查是否有目标玩家可被打击
		targets := Filter(state.Players, func(p Player) bool {
			return !p.Eliminated && p.Position == strike.TargetSystem && p.ID != strike.OwnerID
		})
		var targetPlayerIDs []string
		for _, t := range targets {
			targetPlayerIDs = append(targetPlayerIDs, t.ID)
		}
		state.PendingAction = &PendingAction{
			Type:            "announceStrike",
			StrikeUID:       strike.UID,
			TargetSystem:    strike.TargetSystem,
			TargetPlayerIDs: targetPlayerIDs,
		}
	} else {
		validMoves := Adjacency[strike.Position]
		state.PendingAction = &PendingAction{
			Type:       "strikeMove",
			StrikeUID:  strike.UID,
			ValidMoves: validMoves,
		}
	}
}

// SelectStrike 玩家从多个待处理打击中选择一个进行操作
func SelectStrike(state *GameState, strikeUID string) {
	if state.PendingAction == nil || state.PendingAction.Type != "strikeSelect" {
		return
	}
	var strike *FlyingStrike
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].UID == strikeUID {
			strike = &state.FlyingStrikes[i]
			break
		}
	}
	if strike == nil {
		return
	}
	enterStrikeAction(state, strike)
}

// SkipStrikeSelect 跳过所有待移动打击（仅当无已 Arrived 打击时允许），直接进入摸牌阶段
func SkipStrikeSelect(state *GameState) {
	if state.PendingAction == nil || state.PendingAction.Type != "strikeSelect" {
		return
	}
	state.PendingAction = nil
	DrawPhase(state)
}

// SkipStrikeMove 跳过当前打击的移动，留待下一回合继续
func SkipStrikeMove(state *GameState) {
	if state.PendingAction == nil || state.PendingAction.Type != "strikeMove" {
		return
	}
	state.PendingAction = nil
	AfterStrikeMove(state)
}

func DrawPhase(state *GameState) {
	state.TurnPhase = TurnPhaseDrawPhase

	player := GetCurrentPlayer(state)
	if player == nil {
		return
	}

	cardsNeeded := 4 - len(player.Hand)
	cardsToDraw := max(0, cardsNeeded)

	drawn := DrawCard(state, cardsToDraw)
	player.Hand = append(player.Hand, drawn...)
	AddStructuredLog(state, fmt.Sprintf("%s 补充了 %d 张牌", player.Name, len(drawn)), LogEntryTypeInfo, LogFields{
		PlayerIDs: []string{player.ID},
	})

	advanceToActionPhase(state)
}

func advanceToActionPhase(state *GameState) {
	state.TurnPhase = TurnPhaseActionPhase
}

func ActionPhase(state *GameState) {
	advanceToActionPhase(state)
}

func advanceToEndPhase(state *GameState) {
	state.TurnPhase = TurnPhaseTurnEnd
	state.PendingAction = nil

	AdvanceToNextPlayer(state)
}

func EndTurn(state *GameState, discardCardUIDs []string, publicDiscard bool) {
	player := GetCurrentPlayer(state)
	if player == nil {
		return
	}

	if len(discardCardUIDs) > 0 {
		DiscardHandCards(state, player.ID, discardCardUIDs, publicDiscard)
	}

	AddStructuredLog(state, fmt.Sprintf("%s 结束了回合。", player.Name), LogEntryTypeInfo, LogFields{
		PlayerIDs: []string{player.ID},
	})

	advanceToEndPhase(state)
}

func AdvanceToNextPlayer(state *GameState) {
	alivePlayers := Filter(state.Players, func(p Player) bool { return !p.Eliminated })

	if len(alivePlayers) <= 1 {
		state.Phase = GamePhaseGameOver
		if len(alivePlayers) == 1 {
			state.Winner = &alivePlayers[0].ID
			AddStructuredLog(state, fmt.Sprintf("游戏结束! %s 获胜!", alivePlayers[0].Name), LogEntryTypeSystem, LogFields{
				PlayerIDs: []string{alivePlayers[0].ID},
			})
		} else {
			state.Winner = nil
			AddLog(state, "游戏结束! 所有文明陨落,永恒黑暗降临。", LogEntryTypeSystem)
		}
		return
	}

	// 计算下一个存活玩家。前面的 alivePlayers >= 2 检查保证 for 循环不会死循环。
	nextIndex := (state.CurrentPlayerIndex + 1) % len(state.Players)
	for state.Players[nextIndex].Eliminated {
		nextIndex = (nextIndex + 1) % len(state.Players)
	}

	// 回绕到 CurrentPlayerIndex 之前代表新一轮，TotalTurn +1。
	// 注意：alivePlayers >= 2 保证 nextIndex 不会等于 CurrentPlayerIndex，
	// 故 nextIndex <= CurrentPlayerIndex 是回绕的充分条件。
	if nextIndex <= state.CurrentPlayerIndex {
		state.TotalTurn++
	}

	state.CurrentPlayerIndex = nextIndex
	state.CurrentPlayerID = state.Players[nextIndex].ID

	StartTurn(state)
}

func AfterStrikeMove(state *GameState) {
	player := GetCurrentPlayer(state)
	if player == nil {
		return
	}
	// 复用 advanceToStrikeMovement 的多打击选择逻辑（含已 Arrived 打击）
	advanceToStrikeMovement(state)
}

func InterruptTurn(state *GameState, reason string) {
	// 保存中断前的回合阶段，供 ResumeTurn 还原（避免硬编码 actionPhase）
	state.PrevTurnPhase = state.TurnPhase
	state.TurnPhase = TurnPhaseInterrupted
	AddLog(state, fmt.Sprintf("回合中断: %s", reason), LogEntryTypeSystem)
}

func ResumeTurn(state *GameState) {
	// 还原中断前的回合阶段；若 PrevTurnPhase 为空（异常路径），退化为 actionPhase 兜底
	if state.PrevTurnPhase != "" {
		state.TurnPhase = state.PrevTurnPhase
	} else {
		state.TurnPhase = TurnPhaseActionPhase
	}
	state.PrevTurnPhase = ""
	AddLog(state, "回合已恢复", LogEntryTypeSystem)
}

// resolveBroadcast 解析光速飞船遗留动作的 broadcastOnInherit 客户端可选项。
// nil（客户端省略）→ 默认 true，向后兼容经典模式公共继承日志；
// 非 nil 时返回指针指向的布尔值。
func resolveBroadcast(p *bool) bool {
	if p == nil {
		return true
	}
	return *p
}

// ExecuteLightspeedShip 是光速飞船跃迁的分派入口，按游戏模式调用对应实现：
//   - Relics 模式（LightspeedUsage=reusable）：调用 executeLightspeedShipRelics
//     （飞船作为可复用设施保留，部署与跃迁分两阶段）
//   - Classic 模式（LightspeedUsage=oneTime）：调用 executeLightspeedShipClassic
//     （一次性合并动作）
//
// 调用方（room.go / replay_engine.go / 测试）一律调用本函数；不应直接调用具体实现。
func ExecuteLightspeedShip(state *GameState, playerID string,
	carryEnergy int, message string, leaveBehind bool, broadcastOnInherit *bool) {
	if StateRules(state).LightspeedUsage == LightspeedUsageOneTime {
		executeLightspeedShipClassic(state, playerID,
			carryEnergy, message, leaveBehind, broadcastOnInherit)
		return
	}
	executeLightspeedShipRelics(state, playerID,
		carryEnergy, message, leaveBehind, broadcastOnInherit)
}

// executeLightspeedShipClassic 实现 Classic 模式下的光速飞船跃迁（一次性合并动作）。
//
// Classic 模式飞船是一次性牌，从手牌打出（不部署到 FaceUpCards），跃迁后进弃牌堆：
//   - 扣 LightspeedCombinedActionCost（=10）能量，跃迁至随机无文明星球（位置不公开）
//   - 不可携带能量（carry cap=0），玩家跃迁后能量归零（原能量按遗留/销毁处理）
//   - 无留言（message 字段被忽略，不额外扣能量）
//   - 飞船始终进弃牌堆（跃迁后从手牌移至 DiscardPile，无论遗留或销毁其他设施）
//
// carryEnergy 与 message 参数在 Classic 模式下被忽略。其他设施的遗留/销毁分支沿用 relics 逻辑，
// 但因飞船不在 FaceUpCards 中，其他设施即玩家全部 FaceUpCards。
func executeLightspeedShipClassic(state *GameState, playerID string,
	carryEnergy int, message string, leaveBehind bool, broadcastOnInherit *bool) {
	// 1. 玩家查找
	var player *Player
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			player = &state.Players[i]
			break
		}
	}
	if player == nil {
		return
	}

	// 2. 从手牌查找光速飞船（Classic 模式飞船在手牌，不在 FaceUpCards）
	shipIndex := IndexFunc(player.Hand, func(c Card) bool {
		return c.Ability != nil && *c.Ability == "escape"
	})
	if shipIndex == -1 {
		AddStructuredLog(state, fmt.Sprintf("%s 手牌中没有光速飞船,无法跃迁", player.Name), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{playerID},
		})
		return
	}

	// 3. 成本计算（Classic 模式固定 LightspeedCombinedActionCost）
	rules := StateRules(state)
	cost := rules.LightspeedCombinedActionCost

	// 4. 能量校验：player.Energy >= cost（Classic 无留言成本）
	if player.Energy < cost {
		AddStructuredLog(state, fmt.Sprintf("%s 能量不足,无法发动光速飞船(需要 %d 点,当前 %d)", player.Name, cost, player.Energy), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{playerID},
		})
		return
	}

	// 5. 可用星系校验
	occupied := make(map[int]bool)
	for i := range state.Players {
		p := &state.Players[i]
		if !p.Eliminated {
			occupied[p.Position] = true
		}
	}
	var available []int
	for s := 1; s <= 9; s++ {
		if !occupied[s] && !IsStarEffectActive(state, s, StarEffectDimensionalLock) {
			available = append(available, s)
		}
	}
	if len(available) == 0 {
		AddStructuredLog(state, fmt.Sprintf("没有可用的星系, %s 无法跃迁", player.Name), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{playerID},
		})
		return
	}

	var newPos int

	// 6. 扣能量、飞船从手牌移至弃牌堆（Classic 模式飞船始终废弃）
	player.Energy -= cost
	shipCard := player.Hand[shipIndex]
	player.Hand = append(player.Hand[:shipIndex], player.Hand[shipIndex+1:]...)
	state.DiscardPile = append(state.DiscardPile, shipCard)

	oldPos := player.Position

	// 7. 处理其他设施（FaceUpCards，飞船不在其中）与剩余能量（遗留/销毁分支）
	// Classic 模式 carry cap=0，玩家跃迁后能量归零，原能量按遗留/销毁处理
	otherFacilities := player.FaceUpCards
	remainingEnergy := player.Energy // 扣 cost 后的剩余
	player.Energy = 0                // carry=0

	if leaveBehind {
		if remainingEnergy > 0 || len(otherFacilities) > 0 {
			// 移除同 SystemID==oldPos 的旧遗留物，再 append 新的（无留言）
			filtered := state.Leftovers[:0]
			for _, l := range state.Leftovers {
				if l.SystemID != oldPos {
					filtered = append(filtered, l)
				}
			}
			state.Leftovers = append(filtered, StarLeftover{
				SystemID:           oldPos,
				Energy:             remainingEnergy,
				Facilities:         otherFacilities,
				LeftByPlayerID:     playerID,
				BroadcastOnInherit: resolveBroadcast(broadcastOnInherit),
			})
			AddStructuredLog(state, fmt.Sprintf("%s 选择将 %d 点能量与 %d 个设施遗留在星系 %d", player.Name, remainingEnergy, len(otherFacilities), oldPos), LogEntryTypeAction, LogFields{
				SystemID:        &oldPos,
				PlayerIDs:       []string{playerID},
				PositionOwnerID: &playerID,
			})
		}
	} else {
		// 销毁分支：otherFacilities 全部 append 到 DiscardPile；leftoverEnergy 流失
		if len(otherFacilities) > 0 {
			state.DiscardPile = append(state.DiscardPile, otherFacilities...)
		}
		AddStructuredLog(state, fmt.Sprintf("%s 选择销毁 %d 点能量与 %d 个设施", player.Name, remainingEnergy, len(otherFacilities)), LogEntryTypeAction, LogFields{
			PlayerIDs: []string{playerID},
		})
	}
	player.FaceUpCards = []Card{}

	// 8. 跃迁目标：从 available 随机
	newPos = available[rand.Intn(len(available))]
	player.Position = newPos

	// 9. 继承处理：若 target 星球有遗留物，继承能量与设施，构造私有揭示
	for i := range state.Leftovers {
		if state.Leftovers[i].SystemID == newPos {
			leftover := state.Leftovers[i]
			player.Energy += leftover.Energy
			player.FaceUpCards = append(player.FaceUpCards, leftover.Facilities...)
			state.Leftovers = append(state.Leftovers[:i], state.Leftovers[i+1:]...)

			// 构造私有揭示
			discovery := &RelicDiscovery{
				PlayerID: playerID,
				SystemID: newPos,
				IsRelic:  leftover.IsRelic,
				Energy:   leftover.Energy,
				Message:  leftover.Message,
			}
			if leftover.IsRelic {
				discovery.Name = leftover.Name
				discovery.Lore = leftover.Lore
			}
			if len(leftover.Facilities) > 0 {
				names := make([]string, 0, len(leftover.Facilities))
				for _, f := range leftover.Facilities {
					if f.Name != "" {
						names = append(names, f.Name)
					} else {
						names = append(names, f.DefID)
					}
				}
				discovery.FacilityNames = names
			}
			state.LastRelicDiscovery = discovery

			break
		}
	}

	// 检查湮灭打击余波（跃迁成功后触发）
	if IsStarEffectActive(state, newPos, StarEffectAnnihilationStun) {
		player.PenaltyTurn = true
		AddStructuredLog(state, fmt.Sprintf("%s 跃迁至星系 %d，受到湮灭打击余波影响，下回合无法行动", player.Name, newPos), LogEntryTypeSystem, LogFields{
			SystemID:        &newPos,
			PlayerIDs:       []string{playerID},
			PositionOwnerID: &playerID,
		})
	}

	// 10. 位置不公开（公共日志仅记录跃迁，不含星系编号）
	AddStructuredLog(state, fmt.Sprintf("%s 使用光速飞船跃迁", player.Name), LogEntryTypeAction, LogFields{
		PlayerIDs: []string{playerID},
	})
}

// executeLightspeedShipRelics 实现 Relics（文明遗迹）模式下的光速飞船跃迁：
// 飞船作为可复用设施保留，部署与跃迁分两阶段。
//
// 跃迁至随机无文明星系（不公开位置）。
// carryEnergy 为携带至新星球的能量（封顶 5），message 为 ≤10 字符的留言（额外 1 能量）。
// leaveBehind=true 时余下能量与设施遗留在原星球供继承；false 时销毁之。
// broadcastOnInherit 控制继承时的公共日志门控（nil → 默认 true）。
func executeLightspeedShipRelics(state *GameState, playerID string, carryEnergy int, message string, leaveBehind bool, broadcastOnInherit *bool) {
	// 1. 玩家查找
	var player *Player
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			player = &state.Players[i]
			break
		}
	}
	if player == nil {
		return
	}

	// 2. 飞船检索
	shipIndex := IndexFunc(player.FaceUpCards, func(c Card) bool {
		return c.Ability != nil && *c.Ability == "escape"
	})
	if shipIndex == -1 {
		AddStructuredLog(state, fmt.Sprintf("%s 没有光速飞船,无法跃迁", player.Name), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{playerID},
		})
		return
	}

	// 3. 计算 jumpCost（从 modeRules 读取）
	jumpCost := StateRules(state).LightspeedJumpCost

	// 4. 留言处理：trim message，非空则 messageCost=1
	trimmedMessage := strings.TrimSpace(message)
	messageCost := 0
	if trimmedMessage != "" {
		messageCost = 1
	}

	// 5. 留言长度防御性校验：按 rune 计数 > 10 截断至 10
	if runes := []rune(trimmedMessage); len(runes) > 10 {
		AddStructuredLog(state, fmt.Sprintf("%s 留言长度 %d 超过 10,已截断", player.Name, len(runes)), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{playerID},
		})
		trimmedMessage = string(runes[:10])
	}

	// 6. 留言敏感词过滤
	preFilterLen := len([]rune(trimmedMessage))
	filteredMessage := FilterMessage(trimmedMessage)
	postFilterLen := len([]rune(filteredMessage))
	if filteredMessage != trimmedMessage {
		AddStructuredLog(state, fmt.Sprintf("%s 留言已过滤敏感词(过滤前 %d 字符,过滤后 %d 字符)", player.Name, preFilterLen, postFilterLen), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{playerID},
		})
	}

	// 7. 能量校验：player.Energy >= jumpCost + messageCost
	if player.Energy < jumpCost+messageCost {
		AddStructuredLog(state, fmt.Sprintf("%s 能量不足,无法发动光速飞船(需要 %d 点,当前 %d)", player.Name, jumpCost+messageCost, player.Energy), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{playerID},
		})
		return
	}

	// 8. 可用星系校验
	occupied := make(map[int]bool)
	for i := range state.Players {
		p := &state.Players[i]
		if !p.Eliminated {
			occupied[p.Position] = true
		}
	}
	var available []int
	for s := 1; s <= 9; s++ {
		if !occupied[s] && !IsStarEffectActive(state, s, StarEffectDimensionalLock) {
			available = append(available, s)
		}
	}
	if len(available) == 0 {
		AddStructuredLog(state, fmt.Sprintf("没有可用的星系, %s 无法跃迁", player.Name), LogEntryTypeSystem, LogFields{
			PlayerIDs: []string{playerID},
		})
		return
	}

	var newPos int

	// 9. 扣除 jumpCost + messageCost
	player.Energy -= jumpCost + messageCost

	oldPos := player.Position

	// 10. 飞船与其他设施分离：飞船保留进 newFaceUp，其它设施进 otherFacilities
	otherFacilities := make([]Card, 0, len(player.FaceUpCards)-1)
	newFaceUp := make([]Card, 0, len(player.FaceUpCards))
	for i := range player.FaceUpCards {
		if i == shipIndex {
			newFaceUp = append(newFaceUp, player.FaceUpCards[i])
		} else {
			otherFacilities = append(otherFacilities, player.FaceUpCards[i])
		}
	}
	player.FaceUpCards = newFaceUp

	// 11. 计算 remainingEnergy（扣费后）
	remainingEnergy := player.Energy

	// 12. 实际携带 carry = min(carryEnergy, 5, remainingEnergy)，下界 max(carry, 0)
	carry := carryEnergy
	if carry > 5 {
		carry = 5
	}
	if carry > remainingEnergy {
		carry = remainingEnergy
	}
	if carry < 0 {
		carry = 0
	}

	// 13. leftoverEnergy = remainingEnergy - carry
	leftoverEnergy := remainingEnergy - carry

	// 14. 玩家能量暂设为 carry（继承时会 += 遗留能量）
	player.Energy = carry

	// 15. 遗留/销毁处理
	if leaveBehind {
		if leftoverEnergy > 0 || len(otherFacilities) > 0 || filteredMessage != "" {
			// 移除同 SystemID==oldPos 的旧遗留物，再 append 新的
			filtered := state.Leftovers[:0]
			for _, l := range state.Leftovers {
				if l.SystemID != oldPos {
					filtered = append(filtered, l)
				}
			}
			state.Leftovers = append(filtered, StarLeftover{
				SystemID:           oldPos,
				Energy:             leftoverEnergy,
				Facilities:         otherFacilities,
				Message:            filteredMessage,
				LeftByPlayerID:     playerID,
				BroadcastOnInherit: resolveBroadcast(broadcastOnInherit),
			})
			AddStructuredLog(state, fmt.Sprintf("%s 选择将 %d 点能量与 %d 个设施遗留在星系 %d", player.Name, leftoverEnergy, len(otherFacilities), oldPos), LogEntryTypeAction, LogFields{
				SystemID:        &oldPos,
				PlayerIDs:       []string{playerID},
				PositionOwnerID: &playerID,
			})
		}
	} else {
		// 销毁分支：otherFacilities 全部 append 到 DiscardPile；leftoverEnergy 流失
		if len(otherFacilities) > 0 {
			state.DiscardPile = append(state.DiscardPile, otherFacilities...)
		}
		if filteredMessage != "" {
			// 销毁分支不公开位置，故不填 SystemID
			AddStructuredLog(state, fmt.Sprintf("%s 选择销毁 %d 点能量与 %d 个设施,留言不保留", player.Name, leftoverEnergy, len(otherFacilities)), LogEntryTypeAction, LogFields{
				PlayerIDs: []string{playerID},
			})
		} else {
			AddStructuredLog(state, fmt.Sprintf("%s 选择销毁 %d 点能量与 %d 个设施", player.Name, leftoverEnergy, len(otherFacilities)), LogEntryTypeAction, LogFields{
				PlayerIDs: []string{playerID},
			})
		}
	}

	// 16. 跃迁目标：从 available 随机
	newPos = available[rand.Intn(len(available))]

	// 17. player.Position = newPos
	player.Position = newPos

	// 18. 继承处理：遍历 state.Leftovers 找 SystemID==newPos
	for i := range state.Leftovers {
		if state.Leftovers[i].SystemID == newPos {
			leftover := state.Leftovers[i]
			player.Energy += leftover.Energy
			player.FaceUpCards = append(player.FaceUpCards, leftover.Facilities...)
			state.Leftovers = append(state.Leftovers[:i], state.Leftovers[i+1:]...)

			// 构造私有揭示
			discovery := &RelicDiscovery{
				PlayerID: playerID,
				SystemID: newPos,
				IsRelic:  leftover.IsRelic,
				Energy:   leftover.Energy,
				Message:  leftover.Message,
			}
			if leftover.IsRelic {
				discovery.Name = leftover.Name
				discovery.Lore = leftover.Lore
			}
			if len(leftover.Facilities) > 0 {
				names := make([]string, 0, len(leftover.Facilities))
				for _, f := range leftover.Facilities {
					if f.Name != "" {
						names = append(names, f.Name)
					} else {
						names = append(names, f.DefID)
					}
				}
				discovery.FacilityNames = names
			}
			state.LastRelicDiscovery = discovery

			break
		}
	}

	// 检查湮灭打击余波（跃迁成功后触发）
	if IsStarEffectActive(state, newPos, StarEffectAnnihilationStun) {
		player.PenaltyTurn = true
		AddStructuredLog(state, fmt.Sprintf("%s 跃迁至星系 %d，受到湮灭打击余波影响，下回合无法行动", player.Name, newPos), LogEntryTypeSystem, LogFields{
			SystemID:        &newPos,
			PlayerIDs:       []string{playerID},
			PositionOwnerID: &playerID,
		})
	}

	// 19. 位置不公开（公共日志仅记录跃迁，不含星系编号）
	AddStructuredLog(state, fmt.Sprintf("%s 使用光速飞船跃迁", player.Name), LogEntryTypeAction, LogFields{
		PlayerIDs: []string{playerID},
	})
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
