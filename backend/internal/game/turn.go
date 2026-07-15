package game

import (
	"fmt"
	"math/rand"
)

func StartTurn(state *GameState) {
	player := GetCurrentPlayer(state)

	if player == nil || player.Eliminated {
		AdvanceToNextPlayer(state)
		return
	}

	state.TurnPhase = TurnPhaseTurnBegin
	state.PendingAction = nil
	state.IsProcessing = false

	AddLog(state, fmt.Sprintf("--- %s 的回合 ---", player.Name), LogEntryTypeSystem)

	processTurnBegin(state)
}

func processTurnBegin(state *GameState) {
	player := GetCurrentPlayer(state)
	if player == nil {
		return
	}

	player.Energy += 1
	AddLog(state, fmt.Sprintf("%s 获得 1 点基础能量 (当前能量: %d)", player.Name, player.Energy), LogEntryTypeInfo)

	SettlementPhase(state)

	// 回合开始时重置当前玩家所有打击的剩余移动次数（速度 = 每回合可移动距离）
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].OwnerID == player.ID {
			state.FlyingStrikes[i].RemainingMoves = state.FlyingStrikes[i].Speed
		}
	}

	// 重置当前玩家所有打击的延迟标记，允许下回合重新宣布
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].OwnerID == player.ID {
			state.FlyingStrikes[i].Delayed = false
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

	// 收集当前玩家所有需要操作的打击：待移动（仍有移动次数）+ 已 Arrived（可宣布生效）
	movingStrikes := Filter(state.FlyingStrikes, func(s FlyingStrike) bool {
		return s.OwnerID == player.ID && s.Position != s.TargetSystem && s.RemainingMoves > 0
	})
	arrivedStrikes := Filter(state.FlyingStrikes, func(s FlyingStrike) bool {
		return s.OwnerID == player.ID && s.Arrived && !s.Delayed
	})

	totalCount := len(movingStrikes) + len(arrivedStrikes)
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
		AddLog(state, fmt.Sprintf("%s 有 %d 个打击待处理", player.Name, totalCount), LogEntryTypeCombat)
	}
}

// enterStrikeAction 根据打击状态设置对应的 PendingAction
func enterStrikeAction(state *GameState, strike *FlyingStrike) {
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
	AddLog(state, fmt.Sprintf("%s 补充了 %d 张牌", player.Name, len(drawn)), LogEntryTypeInfo)

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

	AddLog(state, fmt.Sprintf("%s 结束了回合。", player.Name), LogEntryTypeInfo)

	advanceToEndPhase(state)
}

func AdvanceToNextPlayer(state *GameState) {
	alivePlayers := Filter(state.Players, func(p Player) bool { return !p.Eliminated })

	if len(alivePlayers) <= 1 {
		state.Phase = GamePhaseGameOver
		if len(alivePlayers) == 1 {
			state.Winner = &alivePlayers[0].ID
			AddLog(state, fmt.Sprintf("游戏结束! %s 获胜!", alivePlayers[0].Name), LogEntryTypeSystem)
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
	state.TurnPhase = TurnPhaseInterrupted
	AddLog(state, fmt.Sprintf("回合中断: %s", reason), LogEntryTypeSystem)
}

func ResumeTurn(state *GameState) {
	state.TurnPhase = TurnPhaseActionPhase
	AddLog(state, "回合已恢复", LogEntryTypeSystem)
}

func ExecuteLightspeedShip(state *GameState, playerID string, leaveBehind bool) {
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

	shipIndex := IndexFunc(player.FaceUpCards, func(c Card) bool {
		return c.Ability != nil && *c.Ability == "escape"
	})
	if shipIndex == -1 {
		AddLog(state, fmt.Sprintf("%s 没有光速飞船,无法跃迁", player.Name), LogEntryTypeSystem)
		return
	}

	if player.Energy < 3 {
		AddLog(state, fmt.Sprintf("%s 能量不足,无法发动光速飞船(需要 3 点,当前 %d)", player.Name, player.Energy), LogEntryTypeSystem)
		return
	}

	occupied := make(map[int]bool)
	for i := range state.Players {
		p := &state.Players[i]
		if !p.Eliminated {
			occupied[p.Position] = true
		}
	}

	var available []int
	for s := 1; s <= 9; s++ {
		if !occupied[s] {
			available = append(available, s)
		}
	}

	if len(available) == 0 {
		AddLog(state, fmt.Sprintf("没有可用的星系, %s 无法跃迁", player.Name), LogEntryTypeSystem)
		return
	}

	// 扣除 3 点跃迁能量(飞船保留在 FaceUpCards 中,不弃置)
	player.Energy -= 3

	oldPos := player.Position
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

	if leaveBehind {
		if player.Energy > 0 || len(otherFacilities) > 0 {
			// 移除同 systemId 的旧遗留物,再 append 新的
			filtered := state.Leftovers[:0]
			for _, l := range state.Leftovers {
				if l.SystemID != oldPos {
					filtered = append(filtered, l)
				}
			}
			state.Leftovers = append(filtered, StarLeftover{
				SystemID:       oldPos,
				Energy:         player.Energy,
				Facilities:     otherFacilities,
				LeftByPlayerID: playerID,
			})
			AddLog(state, fmt.Sprintf("%s 选择将 %d 点能量与 %d 个设施遗留在星系 %d", player.Name, player.Energy, len(otherFacilities), oldPos), LogEntryTypeAction)
		}
		player.Energy = 0
	} else {
		if len(otherFacilities) > 0 {
			state.DiscardPile = append(state.DiscardPile, otherFacilities...)
			AddLog(state, fmt.Sprintf("%s 选择销毁 %d 点能量与 %d 个设施", player.Name, player.Energy, len(otherFacilities)), LogEntryTypeAction)
		}
		player.Energy = 0
	}

	newPos := available[rand.Intn(len(available))]
	player.Position = newPos

	// 继承检查:若目标星系存在遗留物,自动继承
	inherited := false
	for i := range state.Leftovers {
		if state.Leftovers[i].SystemID == newPos {
			leftover := state.Leftovers[i]
			player.Energy += leftover.Energy
			player.FaceUpCards = append(player.FaceUpCards, leftover.Facilities...)
			state.Leftovers = append(state.Leftovers[:i], state.Leftovers[i+1:]...)
			AddLog(state, fmt.Sprintf("%s 在星系 %d 继承了 %d 点能量与 %d 个设施", player.Name, newPos, leftover.Energy, len(leftover.Facilities)), LogEntryTypeAction)
			inherited = true
			break
		}
	}
	if !inherited {
		AddLog(state, fmt.Sprintf("%s 使用光速飞船跃迁至星系 %d", player.Name, newPos), LogEntryTypeAction)
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}