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

	recentBroadcast := slices.ContainsFunc(player.BroadcastHistory, func(h struct {
		SystemID int
		Turn     int
	}) bool {
		return h.SystemID == targetSystem && state.TotalTurn-h.Turn < 2
	})
	if recentBroadcast {
		return false
	}

	player.Energy -= card.Energy
	player.Hand = append(player.Hand[:cardIndex], player.Hand[cardIndex+1:]...)

	rangeVal := 1
	if card.Range != nil {
		rangeVal = *card.Range
	}
	player.BroadcastHistory = append(player.BroadcastHistory, struct {
		SystemID int
		Turn     int
	}{SystemID: targetSystem, Turn: state.TotalTurn})

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
			return other.Energy >= c.Energy
		})

		hasMonitoringStation := slices.ContainsFunc(other.FaceUpCards, func(c Card) bool {
			return c.Ability != nil && *c.Ability == "detect_broadcast"
		})

		isAtTarget := other.Position == targetSystem
		mustRespond := isAtTarget && hasValidBroadcastCard && !hasMonitoringStation

		responses = append(responses, BroadcastResponse{
			PlayerID:    other.ID,
			PlayerName:  other.Name,
			CanRespond:  hasValidBroadcastCard,
			MustRespond: mustRespond,
			Responded:   false,
			Agreed:      false,
		})
	}

	subtype := BroadcastSubtypeCooperation
	if card.Subtype != nil {
		subtype = *card.Subtype
	}

	state.Broadcast = &BroadcastState{
		BroadcasterID: playerID,
		CardUID:       cardUID,
		Card:          card,
		TargetSystem:  targetSystem,
		Range:         rangeVal,
		Subtype:       subtype,
		Responses:     responses,
		Phase:         BroadcastPhaseWaiting,
	}

	// 广播涉及广播者与所有候选回应者
	broadcastPlayerIDs := []string{playerID}
	for _, r := range responses {
		broadcastPlayerIDs = append(broadcastPlayerIDs, r.PlayerID)
	}
	AddStructuredLog(state, fmt.Sprintf("%s 向星系 %d 发送了【%s】 (手牌: %d 张)", player.Name, targetSystem, card.Name, len(player.Hand)), LogEntryTypeBroadcast, LogFields{
		SystemID:  &targetSystem,
		CardDefID: &card.DefID,
		PlayerIDs: broadcastPlayerIDs,
	})

	possibleResponders := Filter(responses, func(r BroadcastResponse) bool { return r.CanRespond })
	if len(possibleResponders) == 0 {
		// 设计意图：固定退还 1 点能量以防止刷广播试探，即使原卡牌能量为 2 也仅退 1 点
		player.Energy += 1
		state.DiscardPile = append(state.DiscardPile, card)
		AddStructuredLog(state, fmt.Sprintf("无人回应广播, %s 获得 1 点能量", player.Name), LogEntryTypeBroadcast, LogFields{
			SystemID:  &targetSystem,
			CardDefID: &card.DefID,
			PlayerIDs: []string{playerID},
		})
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
	// 入口校验：agreed=true 时 cardUID 必须非空，否则记日志并直接返回（不记录 Agreed=true）
	if agreed && (cardUID == nil || *cardUID == "") {
		AddStructuredLog(state, fmt.Sprintf("回应广播时同意但未提供回应卡: %s", playerID), LogEntryTypeAction, LogFields{
			PlayerIDs: []string{playerID},
		})
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

	// 所有可回应者都已回应后，推进广播阶段
	allResponded := true
	anyAgreed := false
	for i := range state.Broadcast.Responses {
		r := &state.Broadcast.Responses[i]
		if r.CanRespond && !r.Responded {
			allResponded = false
			continue
		}
		if r.Responded && r.Agreed {
			anyAgreed = true
		}
	}

	if !allResponded {
		return
	}

	if anyAgreed {
		// 至少一人同意：进入选择阶段，等待广播者选择回应者
		state.Broadcast.Phase = BroadcastPhaseSelect
	} else {
		// 无人同意：自动取消广播，退还 1 点能量并恢复回合
		CancelBroadcast(state, state.Broadcast.BroadcasterID)
	}
}

func SelectBroadcastResponder(state *GameState, playerID string, responderID string) {
	if state.Broadcast == nil {
		return
	}
	// 授权校验：仅广播发起者可选择回应者
	if state.Broadcast.BroadcasterID != playerID {
		return
	}
	// 输入校验：responderID 必须对应一个 CanRespond && Responded && Agreed 均为 true 的响应
	valid := false
	for _, r := range state.Broadcast.Responses {
		if r.PlayerID == responderID && r.CanRespond && r.Responded && r.Agreed {
			valid = true
			break
		}
	}
	if !valid {
		AddStructuredLog(state, fmt.Sprintf("无效的回应者选择: %s", responderID), LogEntryTypeAction, LogFields{
			PlayerIDs: []string{responderID},
		})
		return
	}
	state.Broadcast.SelectedResponderID = &responderID
	state.Broadcast.Phase = BroadcastPhaseReveal
	// 选择回应者后立即结算：揭示双方卡牌、结算能量、恢复回合。
	// 否则 Broadcast 永远非 nil、TurnPhase 永远停在 interrupted，广播者卡死。
	ResolveBroadcast(state)
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
	rAgreed := response.Agreed
	// 守卫：ResponseCard 为 nil 但 Agreed=true 时强制按拒绝处理，避免无卡进入矩阵结算
	if response.ResponseCard == nil {
		rAgreed = false
	}
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
	// 广播结算日志统一携带目标星系与广播卡牌 defId
	bcTargetSystem := state.Broadcast.TargetSystem
	bcCardDefID := state.Broadcast.Card.DefID
	if rAgreed {
		switch {
		case bSubtype == BroadcastSubtypeCooperation && rSubtype == BroadcastSubtypeCooperation:
			bEnergy = 3
			rEnergy = 3
			AddStructuredLog(state, fmt.Sprintf("双方合作! %s 和 %s 各获得 3 点能量", broadcaster.Name, responder.Name), LogEntryTypeBroadcast, LogFields{
				SystemID:  &bcTargetSystem,
				CardDefID: &bcCardDefID,
				PlayerIDs: []string{broadcaster.ID, responder.ID},
			})
		case bSubtype == BroadcastSubtypeDisguise && rSubtype == BroadcastSubtypeCooperation:
			bEnergy = 5
			AddStructuredLog(state, fmt.Sprintf("%s 伪装成功! 获得 5 点能量", broadcaster.Name), LogEntryTypeBroadcast, LogFields{
				SystemID:  &bcTargetSystem,
				CardDefID: &bcCardDefID,
				PlayerIDs: []string{broadcaster.ID},
			})
		case bSubtype == BroadcastSubtypeCooperation && rSubtype == BroadcastSubtypeDisguise:
			rEnergy = 5
			AddStructuredLog(state, fmt.Sprintf("%s 伪装成功! 获得 5 点能量", responder.Name), LogEntryTypeBroadcast, LogFields{
				SystemID:  &bcTargetSystem,
				CardDefID: &bcCardDefID,
				PlayerIDs: []string{responder.ID},
			})
		default:
			AddStructuredLog(state, "双方伪装! 无人获得能量", LogEntryTypeBroadcast, LogFields{
				SystemID:  &bcTargetSystem,
				CardDefID: &bcCardDefID,
				PlayerIDs: []string{broadcaster.ID, responder.ID},
			})
		}
	}

	broadcaster.Energy += bEnergy
	responder.Energy += rEnergy

	if rAgreed {
		drawn := DrawCard(state, 1)
		responder.Hand = append(responder.Hand, drawn...)
		// 仅在成功进入矩阵结算时累加广播成功次数（Q2）
		broadcaster.BroadcastSuccessCount++
	}

	state.DiscardPile = append(state.DiscardPile, state.Broadcast.Card)

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

func CancelBroadcast(state *GameState, playerID string) {
	if state.Broadcast == nil {
		return
	}
	// 授权校验：仅广播发起者可主动取消
	if state.Broadcast.BroadcasterID != playerID {
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
		// 设计意图：固定退还 1 点能量以防止刷广播试探，即使原卡牌能量为 2 也仅退 1 点
		player.Energy += 1
	}
	state.DiscardPile = append(state.DiscardPile, state.Broadcast.Card)
	if player != nil {
		cancelTargetSystem := state.Broadcast.TargetSystem
		cancelCardDefID := state.Broadcast.Card.DefID
		AddStructuredLog(state, fmt.Sprintf("无人回应, %s 获得 1 点能量", player.Name), LogEntryTypeBroadcast, LogFields{
			SystemID:  &cancelTargetSystem,
			CardDefID: &cancelCardDefID,
			PlayerIDs: []string{player.ID},
		})
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
