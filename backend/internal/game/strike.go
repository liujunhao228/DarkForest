package game

import "fmt"

func MoveStrike(state *GameState, strikeUID string, targetSystem int) {
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

	if strike.RemainingMoves <= 0 {
		return
	}

	if strike.TargetPlayerID != nil {
		var targetPlayer *Player
		for i := range state.Players {
			if state.Players[i].ID == *strike.TargetPlayerID {
				targetPlayer = &state.Players[i]
				break
			}
		}
		if targetPlayer != nil && !targetPlayer.Eliminated {
			strike.TargetSystem = targetPlayer.Position
		}
	}

	strike.Position = targetSystem
	strike.RemainingMoves--
	AddLog(state, fmt.Sprintf("【%s】 (速度 %d, 剩余移动 %d) 移动到星系 %d", strike.StrikeName, strike.Speed, strike.RemainingMoves, targetSystem), LogEntryTypeCombat)

	if strike.Position == strike.TargetSystem && !strike.Arrived {
		strike.Arrived = true

		var targets []*Player
		if strike.TargetPlayerID != nil {
			var targetPlayer *Player
			for i := range state.Players {
				if state.Players[i].ID == *strike.TargetPlayerID && !state.Players[i].Eliminated && state.Players[i].Position == strike.TargetSystem {
					targetPlayer = &state.Players[i]
					break
				}
			}
			if targetPlayer != nil && targetPlayer.ID != strike.OwnerID {
				targets = append(targets, targetPlayer)
			}
		} else {
			for i := range state.Players {
				p := &state.Players[i]
				if !p.Eliminated && p.Position == strike.TargetSystem && p.ID != strike.OwnerID {
					targets = append(targets, p)
				}
			}
		}

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
			AddLog(state, fmt.Sprintf("【%s】已到达目标! 可以宣布生效。", strike.StrikeName), LogEntryTypeCombat)
			return
		} else {
			AddLog(state, fmt.Sprintf("【%s】到达目标星系,但无人在此。打击落空。", strike.StrikeName), LogEntryTypeCombat)
			state.FlyingStrikes = slicesDeleteFunc(state.FlyingStrikes, func(s FlyingStrike) bool { return s.UID == strike.UID })
			state.DiscardPile = append(state.DiscardPile, CreateCardFromStrike(*strike))
		}
	} else if strike.RemainingMoves <= 0 {
		AddLog(state, fmt.Sprintf("【%s】移动次数用完,停止移动。", strike.StrikeName), LogEntryTypeCombat)
	}

	AfterStrikeMove(state)
}

func slicesDeleteFunc[T any](arr []T, fn func(T) bool) []T {
	var result []T
	for _, item := range arr {
		if !fn(item) {
			result = append(result, item)
		}
	}
	return result
}

func ResolveStrike(state *GameState, strike FlyingStrike, targets []*Player) {
	var attacker *Player
	for i := range state.Players {
		if state.Players[i].ID == strike.OwnerID {
			attacker = &state.Players[i]
			break
		}
	}
	if attacker == nil {
		return
	}

	AddLog(state, fmt.Sprintf("%s 宣布【%s】在星系 %d 生效！", attacker.Name, strike.StrikeName, strike.TargetSystem), LogEntryTypeCombat)

	if strike.DefID == "strike_light_particle" {
		if !Contains(state.DestroyedStars, strike.TargetSystem) {
			state.DestroyedStars = append(state.DestroyedStars, strike.TargetSystem)
			AddLog(state, fmt.Sprintf("【光粒打击】毁灭了星系 %d 的恒星！", strike.TargetSystem), LogEntryTypeCombat)
		}
	}

	if strike.DefID == "strike_annihilation" {
		if !Contains(state.DestroyedStars, strike.TargetSystem) {
			state.DestroyedStars = append(state.DestroyedStars, strike.TargetSystem)
			AddLog(state, fmt.Sprintf("【湮灭打击】毁灭了星系 %d 的恒星！", strike.TargetSystem), LogEntryTypeCombat)
		}
		for _, target := range targets {
			if len(target.FaceUpCards) > 0 {
				AddLog(state, fmt.Sprintf("【湮灭打击】毁灭了 %s 的所有设施牌（%d 张）", target.Name, len(target.FaceUpCards)), LogEntryTypeCombat)
				state.DiscardPile = append(state.DiscardPile, target.FaceUpCards...)
				target.FaceUpCards = []Card{}
			}
		}
	}

	for _, target := range targets {
		maxProtection := 0
		for _, card := range target.FaceUpCards {
			if card.Type == CardTypeDefense && card.ProtectionLevel != nil {
				if *card.ProtectionLevel > maxProtection {
					maxProtection = *card.ProtectionLevel
				}
			}
		}

		if strike.Level >= 4 && (strike.Effect == nil || *strike.Effect != "discard_hand") {
			eliminatePlayer(state, target, attacker)
			AddLog(state, fmt.Sprintf("【降维打击】无视防御！%s 被淘汰！", target.Name), LogEntryTypeCombat)
			continue
		}

		if strike.Effect != nil && *strike.Effect == "discard_hand" {
			AddLog(state, fmt.Sprintf("%s 无法防御【%s】，弃掉了全部 %d 张手牌！", target.Name, strike.StrikeName, len(target.Hand)), LogEntryTypeCombat)
			state.DiscardPile = append(state.DiscardPile, target.Hand...)
			target.Hand = []Card{}
			continue
		}

		if strike.Level <= maxProtection {
			AddLog(state, fmt.Sprintf("%s 的防御（等级 %d）成功抵御了【%s】（等级 %d）", target.Name, maxProtection, strike.StrikeName, strike.Level), LogEntryTypeCombat)
		} else {
			eliminatePlayer(state, target, attacker)
			AddLog(state, fmt.Sprintf("%s 被【%s】淘汰！（打击等级 %d > 防御等级 %d）", target.Name, strike.StrikeName, strike.Level, maxProtection), LogEntryTypeCombat)
		}
	}

	state.DiscardPile = append(state.DiscardPile, CreateCardFromStrike(strike))
}

func AnnounceStrike(state *GameState) {
	if state.PendingAction == nil || state.PendingAction.Type != "announceStrike" {
		return
	}

	var strike *FlyingStrike
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].UID == state.PendingAction.StrikeUID {
			strike = &state.FlyingStrikes[i]
			break
		}
	}
	if strike == nil {
		return
	}

	var targets []*Player
	for _, id := range state.PendingAction.TargetPlayerIDs {
		for i := range state.Players {
			if state.Players[i].ID == id && !state.Players[i].Eliminated {
				targets = append(targets, &state.Players[i])
			}
		}
	}

	ResolveStrike(state, *strike, targets)
	state.FlyingStrikes = slicesDeleteFunc(state.FlyingStrikes, func(s FlyingStrike) bool { return s.UID == strike.UID })
	state.PendingAction = nil

	alivePlayers := Filter(state.Players, func(p Player) bool { return !p.Eliminated })
	if len(alivePlayers) <= 1 {
		state.Phase = GamePhaseGameOver
		if len(alivePlayers) == 1 {
			state.Winner = &alivePlayers[0].ID
		} else {
			state.Winner = nil
		}
		return
	}

	if state.TurnPhase == TurnPhaseTurnBegin || state.TurnPhase == TurnPhaseStrikeMovement {
		AfterStrikeMove(state)
	}
}

func SkipAnnounceStrike(state *GameState) {
	if state.PendingAction == nil || state.PendingAction.Type != "announceStrike" {
		return
	}

	var strike *FlyingStrike
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].UID == state.PendingAction.StrikeUID {
			strike = &state.FlyingStrikes[i]
			break
		}
	}
	if strike == nil {
		return
	}

	state.PendingAction = nil

	var owner *Player
	for i := range state.Players {
		if state.Players[i].ID == strike.OwnerID {
			owner = &state.Players[i]
			break
		}
	}
	if owner != nil {
		AddLog(state, fmt.Sprintf("%s 选择暂不宣布【%s】生效", owner.Name, strike.StrikeName), LogEntryTypeInfo)
	} else {
		AddLog(state, fmt.Sprintf("Unknown 选择暂不宣布【%s】生效", strike.StrikeName), LogEntryTypeInfo)
	}

	if state.TurnPhase == TurnPhaseTurnBegin || state.TurnPhase == TurnPhaseStrikeMovement {
		AfterStrikeMove(state)
	}
}

func CreateCardFromStrike(strike FlyingStrike) Card {
	speed := strike.Speed
	return Card{
		UID:    strike.UID,
		DefID:  strike.DefID,
		Name:   strike.StrikeName,
		Type:   CardTypeStrike,
		Energy: 0,
		Level:  &strike.Level,
		Speed:  &speed,
		Effect: strike.Effect,
	}
}

func eliminatePlayer(state *GameState, target, attacker *Player) {
	target.Eliminated = true
	state.DiscardPile = append(state.DiscardPile, target.Hand...)
	state.DiscardPile = append(state.DiscardPile, target.FaceUpCards...)
	target.Hand = []Card{}
	target.FaceUpCards = []Card{}

	aliveCount := 0
	for _, p := range state.Players {
		if !p.Eliminated {
			aliveCount++
		}
	}
	energyGain := aliveCount * 3
	attacker.Energy += energyGain
	AddLog(state, fmt.Sprintf("%s 获得 %d 点能量（剩余玩家 × 3）", attacker.Name, energyGain), LogEntryTypeCombat)
}

func GetStrikeBestMove(strike FlyingStrike) int {
	neighbors := Adjacency[strike.Position]
	if len(neighbors) == 0 {
		return strike.Position
	}
	bestMove := neighbors[0]
	bestDist := GetDistance(bestMove, strike.TargetSystem)
	for _, n := range neighbors[1:] {
		d := GetDistance(n, strike.TargetSystem)
		if d < bestDist {
			bestDist = d
			bestMove = n
		}
	}
	return bestMove
}