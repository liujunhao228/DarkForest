package game

import (
	"fmt"
	"slices"
)

func PlayCard(state *GameState, player *Player, cardUID string) bool {
	cardIndex := slices.IndexFunc(player.Hand, func(c Card) bool { return c.UID == cardUID })
	if cardIndex == -1 {
		return false
	}
	card := player.Hand[cardIndex]

	if player.Energy < card.Energy {
		AddStructuredLog(state, fmt.Sprintf("%s 能量不足（需要 %d，拥有 %d）", player.Name, card.Energy, player.Energy), LogEntryTypeSystem, LogFields{
			CardDefID: &card.DefID,
			PlayerIDs: []string{player.ID},
		})
		return false
	}

	player.Energy -= card.Energy
	player.Hand = append(player.Hand[:cardIndex], player.Hand[cardIndex+1:]...)
	return true
}

func DeployCard(state *GameState, playerID string, cardUID string) bool {
	var player *Player
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			player = &state.Players[i]
			break
		}
	}
	if player == nil {
		return false
	}

	cardIndex := slices.IndexFunc(player.Hand, func(c Card) bool { return c.UID == cardUID })
	if cardIndex == -1 {
		return false
	}
	card := player.Hand[cardIndex]

	if player.Energy < card.Energy {
		AddStructuredLog(state, fmt.Sprintf("%s 能量不足", player.Name), LogEntryTypeSystem, LogFields{
			CardDefID: &card.DefID,
			PlayerIDs: []string{player.ID},
		})
		return false
	}

	// Classic 模式下光速飞船为一次性牌，不可单独部署（须通过 lightspeedShip action 合并跃迁）
	if StateRules(state).LightspeedOneTime && card.Ability != nil && *card.Ability == "escape" {
		AddStructuredLog(state, "Classic 模式下光速飞船不可单独部署，请直接发动跃迁", LogEntryTypeSystem, LogFields{
			CardDefID: &card.DefID,
			PlayerIDs: []string{player.ID},
		})
		return false
	}

	if card.DefID == "facility_dyson_sphere" {
		for i := range state.Players {
			p := &state.Players[i]
			if !p.Eliminated && p.Position == player.Position {
				if slices.ContainsFunc(p.FaceUpCards, func(c Card) bool { return c.DefID == "facility_dyson_sphere" }) {
					deployPos := player.Position
					AddStructuredLog(state, "该星系已有戴森球，无法建造", LogEntryTypeSystem, LogFields{
						SystemID:  &deployPos,
						CardDefID: &card.DefID,
						PlayerIDs: []string{player.ID},
					})
					return false
				}
			}
		}
	}

	player.Energy -= card.Energy
	player.Hand = append(player.Hand[:cardIndex], player.Hand[cardIndex+1:]...)
	player.FaceUpCards = append(player.FaceUpCards, card)
	deployPos := player.Position
	AddStructuredLog(state, fmt.Sprintf("%s 部署了【%s】 (手牌: %d 张)", player.Name, card.Name, len(player.Hand)), LogEntryTypeAction, LogFields{
		SystemID:  &deployPos,
		CardDefID: &card.DefID,
		PlayerIDs: []string{playerID},
	})
	return true
}

func PlayStrikeCard(state *GameState, playerID string, cardUID string, targetSystem int, targetPlayerID *string) bool {
	var player *Player
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			player = &state.Players[i]
			break
		}
	}
	if player == nil {
		return false
	}

	cardIndex := slices.IndexFunc(player.Hand, func(c Card) bool { return c.UID == cardUID })
	if cardIndex == -1 {
		return false
	}
	card := player.Hand[cardIndex]

	if player.Energy < card.Energy {
		return false
	}
	if card.Type != CardTypeStrike {
		return false
	}

	// 目标规则：仅"科技锁死"支持指定玩家；其余类型打击仅支持指定星球为目标
	if targetPlayerID != nil && card.DefID != "strike_tech_lock" {
		AddStructuredLog(state, fmt.Sprintf("【%s】仅支持指定星球为目标，无法指定玩家", card.Name), LogEntryTypeSystem, LogFields{
			CardDefID: &card.DefID,
			PlayerIDs: []string{playerID},
		})
		return false
	}

	player.Energy -= card.Energy
	player.Hand = append(player.Hand[:cardIndex], player.Hand[cardIndex+1:]...)

	if card.Effect != nil && *card.Effect == "discard_hand" && targetPlayerID != nil {
		cardUID := card.UID
		var targetPlayer *Player
		for i := range state.Players {
			if state.Players[i].ID == *targetPlayerID {
				targetPlayer = &state.Players[i]
				break
			}
		}
		if targetPlayer == nil || targetPlayer.Eliminated {
			AddStructuredLog(state, "目标玩家已淘汰，【科技锁死】无法发动", LogEntryTypeSystem, LogFields{
				CardDefID: &card.DefID,
				PlayerIDs: []string{playerID},
			})
			player.Energy += card.Energy
			player.Hand = append(player.Hand[:cardIndex], append([]Card{card}, player.Hand[cardIndex:]...)...)
			return false
		}

		AddStructuredLog(state, fmt.Sprintf("%s 对 %s 发动了【%s】！ (手牌: %d 张)", player.Name, targetPlayer.Name, card.Name, len(player.Hand)), LogEntryTypeCombat, LogFields{
			StrikeUID: &cardUID,
			CardDefID: &card.DefID,
			PlayerIDs: []string{playerID, targetPlayer.ID},
		})
		AddStructuredLog(state, fmt.Sprintf("%s 无法防御【科技锁死】，弃掉了全部 %d 张手牌！", targetPlayer.Name, len(targetPlayer.Hand)), LogEntryTypeCombat, LogFields{
			StrikeUID: &cardUID,
			CardDefID: &card.DefID,
			PlayerIDs: []string{targetPlayer.ID},
		})

		state.DiscardPile = append(state.DiscardPile, targetPlayer.Hand...)
		targetPlayer.Hand = []Card{}

		discardedCard := Card{
			UID:    card.UID,
			DefID:  card.DefID,
			Name:   card.Name,
			Type:   CardTypeStrike,
			Energy: card.Energy,
			Level:  card.Level,
			Speed:  card.Speed,
			Effect: card.Effect,
		}
		state.DiscardPile = append(state.DiscardPile, discardedCard)
		return true
	}

	speed := 1
	if card.Speed != nil {
		speed = *card.Speed
	}
	level := 1
	if card.Level != nil {
		level = *card.Level
	}

	strike := FlyingStrike{
		UID:            card.UID,
		DefID:          card.DefID,
		OwnerID:        playerID,
		Position:       player.Position,
		TargetSystem:   targetSystem,
		TargetPlayerID: targetPlayerID,
		Level:          level,
		Speed:          speed,
		Energy:         card.Energy,
		RemainingMoves: speed,
		Effect:         card.Effect,
		StrikeName:     card.Name,
		Arrived:        false,
	}
	player.StrikeCount++
	strikeUID := strike.UID

	var logMessage string
	var strikePlayerIDs []string
	if targetPlayerID != nil {
		var targetName string
		for i := range state.Players {
			if state.Players[i].ID == *targetPlayerID {
				targetName = state.Players[i].Name
				break
			}
		}
		logMessage = fmt.Sprintf("%s 对 %s 发动了【%s】！ (手牌: %d 张)", player.Name, targetName, card.Name, len(player.Hand))
		strikePlayerIDs = []string{playerID, *targetPlayerID}
	} else {
		logMessage = fmt.Sprintf("%s 向星系 %d 发射了【%s】！ (手牌: %d 张)", player.Name, targetSystem, card.Name, len(player.Hand))
		strikePlayerIDs = []string{playerID}
	}
	AddStructuredLog(state, logMessage, LogEntryTypeCombat, LogFields{
		StrikeUID: &strikeUID,
		SystemID:  &targetSystem,
		CardDefID: &card.DefID,
		PlayerIDs: strikePlayerIDs,
	})

	rules := StateRules(state)
	if rules.StrikeOrigin == StrikeOriginDirect {
		// Direct 模式（Classic）：在 targetSystem 即刻判定，不创建长期飞行的 FlyingStrike。
		// 命中：ResolveStrike + 进弃牌堆 + 游戏结束判定 + AfterStrikeMove（参考 AnnounceStrike 末尾逻辑）。
		// 落空：
		//   - Discard：直接进弃牌堆 + 日志（handleStrikeMiss 处理），不创建 FlyingStrike
		//   - FreeControl / RequireTarget：创建 FlyingStrike{Position: targetSystem, Arrived: true, Missed: true}，handleStrikeMiss 设 PendingAction 等待玩家操作
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

	if len(targets) > 0 || leftoverCountsAsTarget(state, strike.DefID, targetSystem, rules) {
		ResolveStrike(state, strike, targets)
		state.PendingAction = nil
		alivePlayers := Filter(state.Players, func(p Player) bool { return !p.Eliminated })
			if len(alivePlayers) <= 1 {
				state.Phase = GamePhaseGameOver
				if len(alivePlayers) == 1 {
					state.Winner = &alivePlayers[0].ID
				} else {
					state.Winner = nil
				}
				return true
			}
			if state.TurnPhase == TurnPhaseTurnBegin || state.TurnPhase == TurnPhaseStrikeMovement {
				AfterStrikeMove(state)
			}
			return true
		}

		// 落空
		if rules.StrikeMissBehavior == StrikeMissDiscard {
			// 不创建 FlyingStrike；handleStrikeMiss 的 Discard 分支会 CreateCardFromStrike 进弃牌堆
			handleStrikeMiss(state, &strike, rules)
			if state.TurnPhase == TurnPhaseTurnBegin || state.TurnPhase == TurnPhaseStrikeMovement {
				AfterStrikeMove(state)
			}
			return true
		}

		// FreeControl / RequireTarget：创建 Missed FlyingStrike，等待玩家操作
		strike.Position = targetSystem
		strike.Arrived = true
		state.FlyingStrikes = append(state.FlyingStrikes, strike)
		strikePtr := &state.FlyingStrikes[len(state.FlyingStrikes)-1]
		handleStrikeMiss(state, strikePtr, rules)
		return true
	}

	// OwnerPlanet 模式（Relics）：保持现有逻辑，创建 FlyingStrike 从 player.Position 出发
	state.FlyingStrikes = append(state.FlyingStrikes, strike)
	return true
}

func RecycleCard(state *GameState, playerID string, cardUID string) bool {
	var player *Player
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			player = &state.Players[i]
			break
		}
	}
	if player == nil {
		return false
	}

	cardIndex := slices.IndexFunc(player.FaceUpCards, func(c Card) bool { return c.UID == cardUID })
	if cardIndex == -1 {
		return false
	}

	card := player.FaceUpCards[cardIndex]
	refund := card.Energy / 2

	player.FaceUpCards = append(player.FaceUpCards[:cardIndex], player.FaceUpCards[cardIndex+1:]...)
	player.Energy += refund
	state.DiscardPile = append(state.DiscardPile, card)

	recyclePos := player.Position
	AddStructuredLog(state, fmt.Sprintf("%s 回收了【%s】，获得 %d 点能量", player.Name, card.Name, refund), LogEntryTypeAction, LogFields{
		SystemID:  &recyclePos,
		CardDefID: &card.DefID,
		PlayerIDs: []string{playerID},
	})
	return true
}

func DiscardHandCards(state *GameState, playerID string, cardUIDs []string, publicDiscard bool) bool {
	var player *Player
	for i := range state.Players {
		if state.Players[i].ID == playerID {
			player = &state.Players[i]
			break
		}
	}
	if player == nil || len(cardUIDs) == 0 {
		return false
	}

	var discardedCards []Card
	for _, uid := range cardUIDs {
		cardIndex := slices.IndexFunc(player.Hand, func(c Card) bool { return c.UID == uid })
		if cardIndex != -1 {
			card := player.Hand[cardIndex]
			player.Hand = append(player.Hand[:cardIndex], player.Hand[cardIndex+1:]...)
			discardedCards = append(discardedCards, card)
		}
	}

	if len(discardedCards) == 0 {
		return false
	}

	state.DiscardPile = append(state.DiscardPile, discardedCards...)

	if publicDiscard {
		var cardNames []string
		for _, c := range discardedCards {
			cardNames = append(cardNames, fmt.Sprintf("【%s】", c.Name))
		}
		AddStructuredLog(state, fmt.Sprintf("%s 公开弃掉了 %d 张牌：%s (手牌: %d 张)", player.Name, len(discardedCards), joinStrings(cardNames, "、"), len(player.Hand)), LogEntryTypeAction, LogFields{
			PlayerIDs: []string{playerID},
		})
	} else {
		AddStructuredLog(state, fmt.Sprintf("%s 弃掉了 %d 张牌（保密） (手牌: %d 张)", player.Name, len(discardedCards), len(player.Hand)), LogEntryTypeAction, LogFields{
			PlayerIDs: []string{playerID},
		})
	}
	return true
}

func joinStrings(arr []string, sep string) string {
	if len(arr) == 0 {
		return ""
	}
	result := arr[0]
	for i := 1; i < len(arr); i++ {
		result += sep + arr[i]
	}
	return result
}
