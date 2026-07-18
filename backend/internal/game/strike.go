package game

import (
	"fmt"
	"strings"
)

// processStrikeArrival 处理打击到达目标星系的判定：
//   - 若 Position != TargetSystem 或已 Arrived，返回 (false, false)，调用方按原流程继续
//   - 设 Arrived=true，查找目标玩家
//   - 有目标：设 PendingAction{type:"announceStrike"} 并记录日志，返回 (true, true)，调用方应直接 return（不调用 AfterStrikeMove）
//   - 无目标：调用 handleStrikeMiss，返回 (true, false)，调用方应继续调用 AfterStrikeMove 推进流程
//
// 该 helper 抽取自原 MoveStrike 的到达判定逻辑，供 MoveStrike / RetargetStrike / RetargetMissedStrike(OwnerPlanet) 复用，
// 避免再次出现"重设目标为当前星系不触发判定"的同类 bug。
func processStrikeArrival(state *GameState, strike *FlyingStrike) (arrived bool, blocked bool) {
	if strike.Position != strike.TargetSystem || strike.Arrived {
		return false, false
	}
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
		AddStructuredLog(state, fmt.Sprintf("【%s】已到达目标! 可以宣布生效。", strike.StrikeName), LogEntryTypeCombat, LogFields{
			StrikeUID: &strike.UID,
			SystemID:  &strike.TargetSystem,
			CardDefID: &strike.DefID,
			PlayerIDs: targetPlayerIDs,
		})
		return true, true
	}
	handleStrikeMiss(state, strike, GetModeRules(state.GameMode))
	return true, false
}
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
	AddStructuredLog(state, fmt.Sprintf("【%s】 (速度 %d, 剩余移动 %d) 移动到星系 %d", strike.StrikeName, strike.Speed, strike.RemainingMoves, targetSystem), LogEntryTypeCombat, LogFields{
		StrikeUID: &strike.UID,
		SystemID:  &targetSystem,
		CardDefID: &strike.DefID,
		PlayerIDs: []string{strike.OwnerID},
	})

	if arrived, blocked := processStrikeArrival(state, strike); arrived {
		if blocked {
			return
		}
	} else if strike.RemainingMoves <= 0 {
		AddStructuredLog(state, fmt.Sprintf("【%s】移动次数用完,停止移动。", strike.StrikeName), LogEntryTypeCombat, LogFields{
			StrikeUID: &strike.UID,
			CardDefID: &strike.DefID,
			PlayerIDs: []string{strike.OwnerID},
		})
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

	// 打击生效涉及攻击者与所有目标玩家
	resolvePlayerIDs := []string{attacker.ID}
	for _, t := range targets {
		resolvePlayerIDs = append(resolvePlayerIDs, t.ID)
	}
	AddStructuredLog(state, fmt.Sprintf("%s 宣布【%s】在星系 %d 生效！", attacker.Name, strike.StrikeName, strike.TargetSystem), LogEntryTypeCombat, LogFields{
		StrikeUID: &strikeUID,
		SystemID:  &strike.TargetSystem,
		CardDefID: &strike.DefID,
		PlayerIDs: resolvePlayerIDs,
	})

	if strike.DefID == "strike_light_particle" {
		if !Contains(state.DestroyedStars, strike.TargetSystem) {
			state.DestroyedStars = append(state.DestroyedStars, strike.TargetSystem)
			AddStructuredLog(state, fmt.Sprintf("【光粒打击】毁灭了星系 %d 的恒星！", strike.TargetSystem), LogEntryTypeCombat, LogFields{
				StrikeUID: &strikeUID,
				SystemID:  &strike.TargetSystem,
				CardDefID: &strike.DefID,
			})
		}
	}

	if strike.DefID == "strike_annihilation" {
		if !Contains(state.DestroyedStars, strike.TargetSystem) {
			state.DestroyedStars = append(state.DestroyedStars, strike.TargetSystem)
			AddStructuredLog(state, fmt.Sprintf("【湮灭打击】毁灭了星系 %d 的恒星！", strike.TargetSystem), LogEntryTypeCombat, LogFields{
				StrikeUID: &strikeUID,
				SystemID:  &strike.TargetSystem,
				CardDefID: &strike.DefID,
			})
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
				AddStructuredLog(state, fmt.Sprintf("【湮灭打击】毁灭了 %s 的%s", target.Name, strings.Join(parts, "和")), LogEntryTypeCombat, LogFields{
					StrikeUID: &strikeUID,
					CardDefID: &strike.DefID,
					PlayerIDs: []string{target.ID},
				})
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
			AddStructuredLog(state, fmt.Sprintf("【降维打击】无视防御！%s 被淘汰！", target.Name), LogEntryTypeCombat, LogFields{
				StrikeUID: &strikeUID,
				CardDefID: &strike.DefID,
				PlayerIDs: []string{target.ID},
			})
			continue
		}

		if strike.Effect != nil && *strike.Effect == "discard_hand" {
			AddStructuredLog(state, fmt.Sprintf("%s 无法防御【%s】，弃掉了全部 %d 张手牌！", target.Name, strike.StrikeName, len(target.Hand)), LogEntryTypeCombat, LogFields{
				StrikeUID: &strikeUID,
				CardDefID: &strike.DefID,
				PlayerIDs: []string{target.ID},
			})
			state.DiscardPile = append(state.DiscardPile, target.Hand...)
			target.Hand = []Card{}
			continue
		}

		if strike.Level <= maxProtection {
			AddStructuredLog(state, fmt.Sprintf("%s 的防御（等级 %d）成功抵御了【%s】（等级 %d）", target.Name, maxProtection, strike.StrikeName, strike.Level), LogEntryTypeCombat, LogFields{
				StrikeUID: &strikeUID,
				CardDefID: &strike.DefID,
				PlayerIDs: []string{target.ID},
			})
		} else {
			eliminatePlayer(state, target, attacker)
			AddStructuredLog(state, fmt.Sprintf("%s 被【%s】淘汰！（打击等级 %d > 防御等级 %d）", target.Name, strike.StrikeName, strike.Level, maxProtection), LogEntryTypeCombat, LogFields{
				StrikeUID: &strikeUID,
				CardDefID: &strike.DefID,
				PlayerIDs: []string{target.ID},
			})
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
		AddStructuredLog(state, fmt.Sprintf("%s 选择暂不宣布【%s】生效（延迟至下回合）", owner.Name, strike.StrikeName), LogEntryTypeInfo, LogFields{
			StrikeUID: &strike.UID,
			CardDefID: &strike.DefID,
			PlayerIDs: []string{owner.ID},
		})
	} else {
		AddStructuredLog(state, fmt.Sprintf("Unknown 选择暂不宣布【%s】生效", strike.StrikeName), LogEntryTypeInfo, LogFields{
			StrikeUID: &strike.UID,
			CardDefID: &strike.DefID,
		})
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
	AddStructuredLog(state, fmt.Sprintf("【%s】目标重设为星系 %d（消耗 1 次移动，剩余 %d 次）", strike.StrikeName, newTargetSystem, strike.RemainingMoves), LogEntryTypeCombat, LogFields{
		StrikeUID: &strike.UID,
		SystemID:  &newTargetSystem,
		CardDefID: &strike.DefID,
		PlayerIDs: []string{strike.OwnerID},
	})
	AfterStrikeMove(state)
	return true
}

// handleStrikeMiss 处理打击落空（TargetSystem 无目标玩家）的情况。
// 按 rules.StrikeMissBehavior 分派：
//   - StrikeMissDiscard: 从 FlyingStrikes 移除并 append 到 DiscardPile，清除 PendingAction
//   - StrikeMissFreeControl: 设 strike.Missed=true，设 PendingAction{type:"strikeMissedFree"}
//   - StrikeMissRequireTarget: 设 strike.Missed=true，设 PendingAction{type:"strikeMissedRequireTarget", validTargets:[1-9]}
//
// 不调用 AfterStrikeMove，由调用方负责。
func handleStrikeMiss(state *GameState, strike *FlyingStrike, rules ModeRules) {
	strikeUID := strike.UID
	targetSystem := strike.TargetSystem
	defID := strike.DefID
	ownerID := strike.OwnerID
	strikeName := strike.StrikeName

	switch rules.StrikeMissBehavior {
	case StrikeMissDiscard:
		card := CreateCardFromStrike(*strike)
		state.FlyingStrikes = slicesDeleteFunc(state.FlyingStrikes, func(s FlyingStrike) bool { return s.UID == strikeUID })
		state.DiscardPile = append(state.DiscardPile, card)
		state.PendingAction = nil
		AddStructuredLog(state, fmt.Sprintf("【%s】打击落空，已废弃到弃牌堆。", strikeName), LogEntryTypeCombat, LogFields{
			StrikeUID: &strikeUID,
			SystemID:  &targetSystem,
			CardDefID: &defID,
			PlayerIDs: []string{ownerID},
		})
	case StrikeMissFreeControl:
		strike.Missed = true
		state.PendingAction = &PendingAction{
			Type:      "strikeMissedFree",
			StrikeUID: strikeUID,
		}
		AddStructuredLog(state, fmt.Sprintf("【%s】打击落空，等待玩家操作。", strikeName), LogEntryTypeCombat, LogFields{
			StrikeUID: &strikeUID,
			SystemID:  &targetSystem,
			CardDefID: &defID,
			PlayerIDs: []string{ownerID},
		})
	case StrikeMissRequireTarget:
		strike.Missed = true
		validTargets := make([]int, 0, 9)
		for s := 1; s <= 9; s++ {
			validTargets = append(validTargets, s)
		}
		state.PendingAction = &PendingAction{
			Type:         "strikeMissedRequireTarget",
			StrikeUID:    strikeUID,
			ValidTargets: validTargets,
		}
		AddStructuredLog(state, fmt.Sprintf("【%s】打击落空，必须指定新目标星系。", strikeName), LogEntryTypeCombat, LogFields{
			StrikeUID: &strikeUID,
			SystemID:  &targetSystem,
			CardDefID: &defID,
			PlayerIDs: []string{ownerID},
		})
	}
}

// RetargetMissedStrike 重新指定 Missed 打击的目标星系。
// 仅对 Missed=true 打击生效，否则直接返回。
// Direct 模式：Position=newTargetSystem, Missed=false，在 newTargetSystem 即刻判定。
//   - 命中：ResolveStrike + 进弃牌堆 + 游戏结束判定 + AfterStrikeMove（TurnBegin/StrikeMovement）
//   - 再次落空：handleStrikeMiss（可能再次进入 Missed 状态）
//   - 不消耗能量与 RemainingMoves
//
// OwnerPlanet 模式：复用 RetargetStrike 语义（TargetSystem=newTarget, Arrived=false, Missed=false,
//
//	RetargetedThisTurn=true, RemainingMoves-- if >0），调用 AfterStrikeMove
func RetargetMissedStrike(state *GameState, strikeUID string, newTargetSystem int) {
	if newTargetSystem < 1 || newTargetSystem > 9 {
		return
	}
	var strike *FlyingStrike
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].UID == strikeUID {
			strike = &state.FlyingStrikes[i]
			break
		}
	}
	if strike == nil || !strike.Missed {
		return
	}

	rules := GetModeRules(state.GameMode)

	if rules.StrikeOrigin == StrikeOriginDirect {
		// Direct: 即刻在 newTargetSystem 判定
		strike.Position = newTargetSystem
		strike.TargetSystem = newTargetSystem
		strike.Missed = false

		var targets []*Player
		if strike.TargetPlayerID != nil {
			for i := range state.Players {
				if state.Players[i].ID == *strike.TargetPlayerID && !state.Players[i].Eliminated && state.Players[i].Position == strike.TargetSystem {
					if state.Players[i].ID != strike.OwnerID {
						targets = append(targets, &state.Players[i])
					}
					break
				}
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
			strikeSnapshot := *strike
			ResolveStrike(state, strikeSnapshot, targets)
			state.FlyingStrikes = slicesDeleteFunc(state.FlyingStrikes, func(s FlyingStrike) bool { return s.UID == strikeSnapshot.UID })
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
		} else {
			handleStrikeMiss(state, strike, rules)
		}
	} else {
		// OwnerPlanet: 复用 RetargetStrike 语义
		strike.TargetSystem = newTargetSystem
		strike.Arrived = false
		strike.Missed = false
		strike.RetargetedThisTurn = true
		if strike.RemainingMoves > 0 {
			strike.RemainingMoves--
		}
		AddStructuredLog(state, fmt.Sprintf("【%s】目标重设为星系 %d（消耗 1 次移动，剩余 %d 次）", strike.StrikeName, newTargetSystem, strike.RemainingMoves), LogEntryTypeCombat, LogFields{
			StrikeUID: &strike.UID,
			SystemID:  &newTargetSystem,
			CardDefID: &strike.DefID,
			PlayerIDs: []string{strike.OwnerID},
		})
		state.PendingAction = nil
		AfterStrikeMove(state)
	}
}

// SkipMissedStrike 跳过当前 Missed 打击（仅 FreeControl 允许），延迟至下回合处理。
// 仅对 Missed=true 且 StrikeMissBehavior=FreeControl 的打击生效，否则直接返回。
func SkipMissedStrike(state *GameState, strikeUID string) {
	rules := GetModeRules(state.GameMode)
	if rules.StrikeMissBehavior != StrikeMissFreeControl {
		return
	}
	var strike *FlyingStrike
	for i := range state.FlyingStrikes {
		if state.FlyingStrikes[i].UID == strikeUID {
			strike = &state.FlyingStrikes[i]
			break
		}
	}
	if strike == nil || !strike.Missed {
		return
	}

	strike.Delayed = true
	state.PendingAction = nil

	strikeUIDLocal := strike.UID
	defID := strike.DefID
	ownerID := strike.OwnerID
	strikeName := strike.StrikeName
	AddStructuredLog(state, fmt.Sprintf("【%s】选择跳过，延迟至下回合处理", strikeName), LogEntryTypeCombat, LogFields{
		StrikeUID: &strikeUIDLocal,
		CardDefID: &defID,
		PlayerIDs: []string{ownerID},
	})

	AfterStrikeMove(state)
}

// DiscardMissedStrike 废弃 Missed 打击到弃牌堆（兜底退出选项）。
// 仅对 Missed=true 打击生效，否则直接返回。
func DiscardMissedStrike(state *GameState, strikeUID string) {
	var strikeSnapshot FlyingStrike
	found := false
	for _, s := range state.FlyingStrikes {
		if s.UID == strikeUID {
			strikeSnapshot = s
			found = true
			break
		}
	}
	if !found || !strikeSnapshot.Missed {
		return
	}

	state.FlyingStrikes = slicesDeleteFunc(state.FlyingStrikes, func(s FlyingStrike) bool { return s.UID == strikeUID })
	state.DiscardPile = append(state.DiscardPile, CreateCardFromStrike(strikeSnapshot))
	state.PendingAction = nil

	strikeUIDLocal := strikeSnapshot.UID
	defID := strikeSnapshot.DefID
	ownerID := strikeSnapshot.OwnerID
	strikeName := strikeSnapshot.StrikeName
	AddStructuredLog(state, fmt.Sprintf("【%s】选择废弃，进入弃牌堆", strikeName), LogEntryTypeCombat, LogFields{
		StrikeUID: &strikeUIDLocal,
		CardDefID: &defID,
		PlayerIDs: []string{ownerID},
	})

	AfterStrikeMove(state)
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
		defID := s.DefID
		AddStructuredLog(state, fmt.Sprintf("【%s】因拥有者被淘汰，回收进弃牌堆", s.StrikeName), LogEntryTypeSystem, LogFields{
			StrikeUID: &strikeUID,
			CardDefID: &defID,
			PlayerIDs: []string{s.OwnerID},
		})
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
	AddStructuredLog(state, fmt.Sprintf("%s 获得 %d 点能量（剩余玩家 × 3）", attacker.Name, energyGain), LogEntryTypeCombat, LogFields{
		PlayerIDs: []string{attacker.ID},
	})
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
