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
		return s.OwnerID == player.ID && s.Arrived
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

func ExecuteLightspeedShip(state *GameState, playerID string) {
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
		return
	}

	ship := player.FaceUpCards[shipIndex]
	player.FaceUpCards = append(player.FaceUpCards[:shipIndex], player.FaceUpCards[shipIndex+1:]...)
	state.DiscardPile = append(state.DiscardPile, ship)

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

	newPos := available[rand.Intn(len(available))]

	if len(player.FaceUpCards) > 0 {
		AddLog(state, fmt.Sprintf("%s 放弃了所有设施,带着能量逃离", player.Name), LogEntryTypeAction)
		state.DiscardPile = append(state.DiscardPile, player.FaceUpCards...)
		player.FaceUpCards = []Card{}
	}

	player.Position = newPos
	AddLog(state, fmt.Sprintf("%s 使用光速飞船跃迁至星系 %d! (保留 %d 点能量)", player.Name, newPos, player.Energy), LogEntryTypeAction)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}