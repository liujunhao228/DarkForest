package game

import (
	"fmt"
	"slices"
)

func InitiateBroadcast(state *GameState, playerID string, cardUID string, targetSystem int) bool {
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

	if card.Type != CardTypeBroadcast {
		return false
	}
	if player.Energy < card.Energy {
		return false
	}

	recentBroadcast := slices.ContainsFunc(player.BroadcastHistory, func(h struct{ SystemID int; Turn int }) bool {
		return h.SystemID == targetSystem && state.TotalTurn-h.Turn < 2
	})
	if recentBroadcast {
		AddLog(state, fmt.Sprintf("%s 不能连续在同一星系广播", player.Name), LogEntryTypeSystem)
		return false
	}

	player.Energy -= card.Energy
	player.Hand = append(player.Hand[:cardIndex], player.Hand[cardIndex+1:]...)

	rangeVal := 1
	if card.Range != nil {
		rangeVal = *card.Range
	}
	player.BroadcastHistory = append(player.BroadcastHistory, struct{ SystemID int; Turn int }{SystemID: targetSystem, Turn: state.TotalTurn})

	var responses []BroadcastResponse
	for i := range state.Players {
		other := &state.Players[i]
		if other.ID == playerID || other.Eliminated {
			continue
		}
		dist := GetDistance(other.Position, targetSystem)
		if dist > rangeVal {
			continue
		}

		hasValidBroadcastCard := slices.ContainsFunc(other.Hand, func(c Card) bool {
			if c.Type != CardTypeBroadcast {
				return false
			}
			cRange := 0
			if c.Range != nil {
				cRange = *c.Range
			}
			return cRange >= rangeVal && other.Energy >= c.Energy
		})

		hasMonitoringStation := slices.ContainsFunc(other.FaceUpCards, func(c Card) bool {
			return c.Ability != nil && *c.Ability == "detect_broadcast"
		})

		isAtTarget := other.Position == targetSystem
		mustRespond := isAtTarget && hasValidBroadcastCard && !hasMonitoringStation

		responses = append(responses, BroadcastResponse{
			PlayerID:   other.ID,
			PlayerName: other.Name,
			CanRespond: hasValidBroadcastCard,
			MustRespond: mustRespond,
			Responded:  false,
			Agreed:     false,
		})
	}

	subtype := BroadcastSubtypeCooperation
	if card.Subtype != nil {
		subtype = *card.Subtype
	}

	state.Broadcast = &BroadcastState{
		Active:          true,
		BroadcasterID:   playerID,
		CardUID:         cardUID,
		Card:            card,
		TargetSystem:    targetSystem,
		Range:           rangeVal,
		Subtype:         subtype,
		Responses:       responses,
		Phase:           "waiting",
	}

	AddLog(state, fmt.Sprintf("%s 向星系 %d 发送了【%s】 (%s)", player.Name, targetSystem, card.Name, map[BroadcastSubtype]string{
		BroadcastSubtypeCooperation: "合作",
		BroadcastSubtypeDisguise:    "伪装",
	}[subtype]), LogEntryTypeBroadcast)

	possibleResponders := Filter(responses, func(r BroadcastResponse) bool { return r.CanRespond })
	if len(possibleResponders) == 0 {
		player.Energy += 1
		state.DiscardPile = append(state.DiscardPile, card)
		AddLog(state, fmt.Sprintf("无人回应广播, %s 获得 1 点能量", player.Name), LogEntryTypeBroadcast)
		state.Broadcast = nil
	} else {
		InterruptTurn(state, "等待广播响应")
	}

	return true
}

func RespondToBroadcast(state *GameState, playerID string, agreed bool, cardUID *string) {
	if state.Broadcast == nil {
		return
	}

	for i := range state.Broadcast.Responses {
		if state.Broadcast.Responses[i].PlayerID == playerID {
			state.Broadcast.Responses[i].Agreed = agreed
			state.Broadcast.Responses[i].Responded = true

			if agreed && cardUID != nil {
				var player *Player
				for j := range state.Players {
					if state.Players[j].ID == playerID {
						player = &state.Players[j]
						break
					}
				}
				if player != nil {
					for _, c := range player.Hand {
						if c.UID == *cardUID {
							state.Broadcast.Responses[i].ResponseCard = &c
							break
						}
					}
				}
			}
			break
		}
	}
}

func SelectBroadcastResponder(state *GameState, responderID string) {
	if state.Broadcast == nil {
		return
	}
	state.Broadcast.SelectedResponderID = &responderID
	state.Broadcast.Phase = "reveal"
}

func ResolveBroadcast(state *GameState) {
	if state.Broadcast == nil || state.Broadcast.SelectedResponderID == nil {
		return
	}

	var broadcaster, responder *Player
	for i := range state.Players {
		if state.Players[i].ID == state.Broadcast.BroadcasterID {
			broadcaster = &state.Players[i]
		}
		if state.Players[i].ID == *state.Broadcast.SelectedResponderID {
			responder = &state.Players[i]
		}
	}
	if broadcaster == nil || responder == nil {
		return
	}

	var response *BroadcastResponse
	for i := range state.Broadcast.Responses {
		if state.Broadcast.Responses[i].PlayerID == *state.Broadcast.SelectedResponderID {
			response = &state.Broadcast.Responses[i]
			break
		}
	}
	if response == nil {
		return
	}

	bSubtype := state.Broadcast.Subtype
	rSubtype := BroadcastSubtypeCooperation
	if response.ResponseCard != nil && response.ResponseCard.Subtype != nil {
		rSubtype = *response.ResponseCard.Subtype
	}

	if response.ResponseCard != nil {
		cardIdx := slices.IndexFunc(responder.Hand, func(c Card) bool {
			return c.UID == response.ResponseCard.UID
		})
		if cardIdx >= 0 {
			responder.Energy -= response.ResponseCard.Energy
			responder.Hand = append(responder.Hand[:cardIdx], responder.Hand[cardIdx+1:]...)
		}
	}

	var bEnergy, rEnergy int
	switch {
	case bSubtype == BroadcastSubtypeCooperation && rSubtype == BroadcastSubtypeCooperation:
		bEnergy = 3
		rEnergy = 3
		AddLog(state, fmt.Sprintf("双方合作! %s 和 %s 各获得 3 点能量", broadcaster.Name, responder.Name), LogEntryTypeBroadcast)
	case bSubtype == BroadcastSubtypeDisguise && rSubtype == BroadcastSubtypeCooperation:
		bEnergy = 5
		AddLog(state, fmt.Sprintf("%s 伪装成功! 获得 5 点能量", broadcaster.Name), LogEntryTypeBroadcast)
	case bSubtype == BroadcastSubtypeCooperation && rSubtype == BroadcastSubtypeDisguise:
		rEnergy = 5
		AddLog(state, fmt.Sprintf("%s 伪装成功! 获得 5 点能量", responder.Name), LogEntryTypeBroadcast)
	default:
		AddLog(state, "双方伪装! 无人获得能量", LogEntryTypeBroadcast)
	}

	broadcaster.Energy += bEnergy
	responder.Energy += rEnergy

	drawn := DrawCard(state, 1)
	responder.Hand = append(responder.Hand, drawn...)

	broadcaster.FaceUpCards = append(broadcaster.FaceUpCards, state.Broadcast.Card)

	state.Broadcast = nil
	state.PendingAction = nil

	ResumeTurn(state)

	alivePlayers := Filter(state.Players, func(p Player) bool { return !p.Eliminated })
	if len(alivePlayers) <= 1 {
		state.Phase = GamePhaseGameOver
		if len(alivePlayers) == 1 {
			state.Winner = &alivePlayers[0].ID
		} else {
			state.Winner = nil
		}
	}
}

func CancelBroadcast(state *GameState) {
	if state.Broadcast == nil {
		return
	}
	var player *Player
	for i := range state.Players {
		if state.Players[i].ID == state.Broadcast.BroadcasterID {
			player = &state.Players[i]
			break
		}
	}
	if player != nil {
		player.Energy += 1
	}
	state.DiscardPile = append(state.DiscardPile, state.Broadcast.Card)
	if player != nil {
		AddLog(state, fmt.Sprintf("无人回应, %s 获得 1 点能量", player.Name), LogEntryTypeBroadcast)
	}
	state.Broadcast = nil
	state.PendingAction = nil

	ResumeTurn(state)
}

func IsSystemInRange(from, to, rangeDist int) bool {
	return GetDistance(from, to) <= rangeDist
}

func GetPlayersAtSystem(state *GameState, systemID int) []*Player {
	var result []*Player
	for i := range state.Players {
		if !state.Players[i].Eliminated && state.Players[i].Position == systemID {
			result = append(result, &state.Players[i])
		}
	}
	return result
}