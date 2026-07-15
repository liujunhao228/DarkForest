package game

import (
	"fmt"
	"strings"
)

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

	// 打击目标星系固定，不自动追踪目标玩家位置（符合"打击停留于原目标星系"设计）
	strike.Position = targetSystem
	strike.RemainingMoves--
	AddStrikeLog(state, fmt.Sprintf("【%s】 (速度 %d, 剩余移动 %d) 移动到星系 %d", strike.StrikeName, strike.Speed, strike.RemainingMoves, targetSystem), LogEntryTypeCombat, &strike.UID)

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
			AddStrikeLog(state, fmt.Sprintf("【%s】已到达目标! 可以宣布生效。", strike.StrikeName), LogEntryTypeCombat, &strike.UID)
			return
		} else {
			AddStrikeLog(state, fmt.Sprintf("【%s】到达目标星系,但无人在此。打击落空。", strike.StrikeName), LogEntryTypeCombat, &strike.UID)
			state.FlyingStrikes = slicesDeleteFunc(state.FlyingStrikes, func(s FlyingStrike) bool { return s.UID == strike.UID })
			state.DiscardPile = append(state.DiscardPile, CreateCardFromStrike(*strike))
		}
	} else if strike.RemainingMoves <= 0 {
		AddStrikeLog(state, fmt.Sprintf("【%s】移动次数用完,停止移动。", strike.StrikeName), LogEntryTypeCombat, &strike.UID)
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

	strikeUID := strike.UID

	AddStrikeLog(state, fmt.Sprintf("%s 宣布【%s】在星系 %d 生效！", attacker.Name, strike.StrikeName, strike.TargetSystem), LogEntryTypeCombat, &strikeUID)

	if strike.DefID == "strike_light_particle" {
		if !Contains(state.DestroyedStars, strike.TargetSystem) {
			state.DestroyedStars = append(state.DestroyedStars, strike.TargetSystem)
			AddStrikeLog(state, fmt.Sprintf("【光粒打击】毁灭了星系 %d 的恒星！", strike.TargetSystem), LogEntryTypeCombat, &strikeUID)
		}
	}

	if strike.DefID == "strike_annihilation" {
		if !Contains(state.DestroyedStars, strike.TargetSystem) {
			state.DestroyedStars = append(state.DestroyedStars, strike.TargetSystem)
			AddStrikeLog(state, fmt.Sprintf("【湮灭打击】毁灭了星系 %d 的恒星！", strike.TargetSystem), LogEntryTypeCombat, &strikeUID)
		}
		// 毁灭所有设施牌，以及防御等级低于打击等级的防御牌。
		// 防御等级 ≥ 打击等级的防御牌（如量子幽灵等级3 ≥ 湮灭打击等级3）可幸存。
		// 恒星毁灭无法阻止，但玩家是否淘汰仍由打击等级与防御等级的比较决定。
		for _, target := range targets {
			var remaining []Card
			facilityDestroyed := 0
			defenseDestroyed := 0
			for _, card := range target.FaceUpCards {
				destroy := false
				if card.Type == CardTypeFacility {
					destroy = true
					facilityDestroyed++
				} else if card.Type == CardTypeDefense && card.ProtectionLevel != nil && *card.ProtectionLevel < strike.Level {
					destroy = true
					defenseDestroyed++
				}
				if destroy {
					state.DiscardPile = append(state.DiscardPile, card)
				} else {
					remaining = append(remaining, card)
				}
			}
			if facilityDestroyed > 0 || defenseDestroyed > 0 {
				var parts []string
				if facilityDestroyed > 0 {
					parts = append(parts, fmt.Sprintf("%d 张设施牌", facilityDestroyed))
				}
				if defenseDestroyed > 0 {
					parts = append(parts, fmt.Sprintf("%d 张防御牌", defenseDestroyed))
				}
				AddStrikeLog(state, fmt.Sprintf("【湮灭打击】毁灭了 %s 的%s", target.Name, strings.Join(parts, "和")), LogEntryTypeCombat, &strikeUID)
				target.FaceUpCards = remaining
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
			AddStrikeLog(state, fmt.Sprintf("【降维打击】无视防御！%s 被淘汰！", target.Name), LogEntryTypeCombat, &strikeUID)
			continue
		}

		if strike.Effect != nil && *strike.Effect == "discard_hand" {
			AddStrikeLog(state, fmt.Sprintf("%s 无法防御【%s】，弃掉了全部 %d 张手牌！", target.Name, strike.StrikeName, len(target.Hand)), LogEntryTypeCombat, &strikeUID)
			state.DiscardPile = append(state.DiscardPile, target.Hand...)
			target.Hand = []Card{}
			continue
		}

		if strike.Level <= maxProtection {
			AddStrikeLog(state, fmt.Sprintf("%s 的防御（等级 %d）成功抵御了【%s】（等级 %d）", target.Name, maxProtection, strike.StrikeName, strike.Level), LogEntryTypeCombat, &strikeUID)
		} else {
			eliminatePlayer(state, target, attacker)
			AddStrikeLog(state, fmt.Sprintf("%s 被【%s】淘汰！（打击等级 %d > 防御等级 %d）", target.Name, strike.StrikeName, strike.Level, maxProtection), LogEntryTypeCombat, &strikeUID)
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
		AddStrikeLog(state, fmt.Sprintf("%s 选择暂不宣布【%s】生效（延迟至下回合）", owner.Name, strike.StrikeName), LogEntryTypeInfo, &strike.UID)
	} else {
		AddStrikeLog(state, fmt.Sprintf("Unknown 选择暂不宣布【%s】生效", strike.StrikeName), LogEntryTypeInfo, &strike.UID)
	}

	strike.Delayed = true

	if state.TurnPhase == TurnPhaseTurnBegin || state.TurnPhase == TurnPhaseStrikeMovement {
		AfterStrikeMove(state)
	}
}

// RetargetStrike 重新指定打击目标星系，允许玩家手动调整打击移动路径。
// 飞行中或已 Arrived（悬停）的打击均可重设目标；重设后 Arrived 重置为 false。
// 重设消耗 1 次移动次数，且本回合不再允许操作该打击（通过 RetargetedThisTurn 标记阻止再次收集）。
// 剩余移动次数仅在回合开始时按 Speed 重置（符合"速度=每回合移动距离"规则）。
func RetargetStrike(state *GameState, strikeUID string, newTargetSystem int) bool {
	if newTargetSystem < 1 || newTargetSystem > 9 {
		return false
	}
	var strike *FlyingStrike
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].UID == strikeUID {
			strike = &state.FlyingStrikes[i]
			break
		}
	}
	if strike == nil {
		return false
	}

	strike.TargetSystem = newTargetSystem
	strike.Arrived = false
	strike.RetargetedThisTurn = true
	if strike.RemainingMoves > 0 {
		strike.RemainingMoves--
	}
	AddStrikeLog(state, fmt.Sprintf("【%s】目标重设为星系 %d（消耗 1 次移动，剩余 %d 次）", strike.StrikeName, newTargetSystem, strike.RemainingMoves), LogEntryTypeCombat, &strike.UID)
	AfterStrikeMove(state)
	return true
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

// CleanupPlayerStrikes 回收指定玩家所有飞行中的打击到弃牌堆。
// 在玩家被淘汰时调用，避免打击成为无人管理的"幽灵打击"。
func CleanupPlayerStrikes(state *GameState, playerID string) {
	var removed []FlyingStrike
	remaining := state.FlyingStrikes[:0]
	for _, s := range state.FlyingStrikes {
		if s.OwnerID == playerID {
			removed = append(removed, s)
		} else {
			remaining = append(remaining, s)
		}
	}
	state.FlyingStrikes = remaining
	for _, s := range removed {
		state.DiscardPile = append(state.DiscardPile, CreateCardFromStrike(s))
		strikeUID := s.UID
		AddStrikeLog(state, fmt.Sprintf("【%s】因拥有者被淘汰，回收进弃牌堆", s.StrikeName), LogEntryTypeSystem, &strikeUID)
	}
}

func eliminatePlayer(state *GameState, target, attacker *Player) {
	target.Eliminated = true
	CleanupPlayerStrikes(state, target.ID)
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