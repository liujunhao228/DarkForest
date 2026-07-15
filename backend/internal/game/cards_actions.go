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
		AddLog(state, fmt.Sprintf("%s 能量不足（需要 %d，拥有 %d）", player.Name, card.Energy, player.Energy), LogEntryTypeSystem)
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
		AddLog(state, fmt.Sprintf("%s 能量不足", player.Name), LogEntryTypeSystem)
		return false
	}

	if card.DefID == "facility_dyson_sphere" {
		for i := range state.Players {
			p := &state.Players[i]
			if !p.Eliminated && p.Position == player.Position {
				if slices.ContainsFunc(p.FaceUpCards, func(c Card) bool { return c.DefID == "facility_dyson_sphere" }) {
					AddLog(state, "该星系已有戴森球，无法建造", LogEntryTypeSystem)
					return false
				}
			}
		}
	}

	player.Energy -= card.Energy
	player.Hand = append(player.Hand[:cardIndex], player.Hand[cardIndex+1:]...)
	player.FaceUpCards = append(player.FaceUpCards, card)
	AddLog(state, fmt.Sprintf("%s 部署了【%s】 (手牌: %d 张)", player.Name, card.Name, len(player.Hand)), LogEntryTypeAction)
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
			AddLog(state, "目标玩家已淘汰，【科技锁死】无法发动", LogEntryTypeSystem)
			player.Energy += card.Energy
			player.Hand = append(player.Hand[:cardIndex], append([]Card{card}, player.Hand[cardIndex:]...)...)
			return false
		}

		AddStrikeLog(state, fmt.Sprintf("%s 对 %s 发动了【%s】！ (手牌: %d 张)", player.Name, targetPlayer.Name, card.Name, len(player.Hand)), LogEntryTypeCombat, &cardUID)
		AddStrikeLog(state, fmt.Sprintf("%s 无法防御【科技锁死】，弃掉了全部 %d 张手牌！", targetPlayer.Name, len(targetPlayer.Hand)), LogEntryTypeCombat, &cardUID)

		state.DiscardPile = append(state.DiscardPile, targetPlayer.Hand...)
		targetPlayer.Hand = []Card{}

		discardedCard := Card{
			UID:    card.UID,
			DefID:  card.DefID,
			Name:   card.Name,
			Type:   CardTypeStrike,
			Energy: 0,
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
		RemainingMoves: speed,
		Effect:         card.Effect,
		StrikeName:     card.Name,
		Arrived:        false,
	}
	state.FlyingStrikes = append(state.FlyingStrikes, strike)
	player.StrikeCount++
	strikeUID := strike.UID

	var logMessage string
	if targetPlayerID != nil {
		var targetName string
		for i := range state.Players {
			if state.Players[i].ID == *targetPlayerID {
				targetName = state.Players[i].Name
				break
			}
		}
		logMessage = fmt.Sprintf("%s 对 %s 发动了【%s】！ (手牌: %d 张)", player.Name, targetName, card.Name, len(player.Hand))
	} else {
		logMessage = fmt.Sprintf("%s 向星系 %d 发射了【%s】！ (手牌: %d 张)", player.Name, targetSystem, card.Name, len(player.Hand))
	}
	AddStrikeLog(state, logMessage, LogEntryTypeCombat, &strikeUID)
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

	AddLog(state, fmt.Sprintf("%s 回收了【%s】，获得 %d 点能量", player.Name, card.Name, refund), LogEntryTypeAction)
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
		AddLog(state, fmt.Sprintf("%s 公开弃掉了 %d 张牌：%s (手牌: %d 张)", player.Name, len(discardedCards), joinStrings(cardNames, "、"), len(player.Hand)), LogEntryTypeBroadcast)
	} else {
		AddLog(state, fmt.Sprintf("%s 弃掉了 %d 张牌（保密） (手牌: %d 张)", player.Name, len(discardedCards), len(player.Hand)), LogEntryTypeAction)
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