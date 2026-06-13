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

	arrivedStrikes := Filter(state.FlyingStrikes, func(s FlyingStrike) bool {
		return s.OwnerID == player.ID && s.Arrived
	})

	if len(arrivedStrikes) > 0 && state.PendingAction == nil {
		strike := arrivedStrikes[0]
		targets := Filter(state.Players, func(p Player) bool {
			return !p.Eliminated && p.Position == strike.TargetSystem && p.ID != player.ID
		})

		if len(targets) > 0 {
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
			AddLog(state, fmt.Sprintf("【%s】已在星系 %d 待命,可以宣布生效", strike.StrikeName, strike.TargetSystem), LogEntryTypeCombat)
			return
		}
	}

	advanceToStrikeMovement(state)
}

func advanceToStrikeMovement(state *GameState) {
	state.TurnPhase = TurnPhaseStrikeMovement

	player := GetCurrentPlayer(state)
	if player == nil {
		return
	}

	playerStrikes := Filter(state.FlyingStrikes, func(s FlyingStrike) bool {
		return s.OwnerID == player.ID && s.Position != s.TargetSystem
	})

	if len(playerStrikes) == 0 {
		DrawPhase(state)
	} else {
		strike := playerStrikes[0]
		validMoves := Adjacency[strike.Position]
		state.PendingAction = &PendingAction{
			Type:       "strikeMove",
			StrikeUID:  strike.UID,
			ValidMoves: validMoves,
		}
		AddLog(state, fmt.Sprintf("%s 需要移动打击牌 【%s】", player.Name, strike.StrikeName), LogEntryTypeCombat)
	}
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
	AddLog(state, fmt.Sprintf("%s 补充了 %d 张牌 (手牌: %d 张)", player.Name, len(drawn), len(player.Hand)), LogEntryTypeInfo)

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

	nextIndex := (state.CurrentPlayerIndex + 1) % len(state.Players)
	looped := false

	for state.Players[nextIndex].Eliminated {
		nextIndex = (nextIndex + 1) % len(state.Players)
		if nextIndex <= state.CurrentPlayerIndex {
			if looped {
				break
			}
			looped = true
		}
	}

	if nextIndex <= state.CurrentPlayerIndex && looped {
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

	remainingStrikes := Filter(state.FlyingStrikes, func(s FlyingStrike) bool {
		return s.OwnerID == player.ID && s.Position != s.TargetSystem
	})

	if len(remainingStrikes) > 0 {
		nextStrike := remainingStrikes[0]
		validMoves := Adjacency[nextStrike.Position]
		state.PendingAction = &PendingAction{
			Type:       "strikeMove",
			StrikeUID:  nextStrike.UID,
			ValidMoves: validMoves,
		}
	} else {
		state.PendingAction = nil
		DrawPhase(state)
	}
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