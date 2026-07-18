package game

import "fmt"

func SettlementPhase(state *GameState) {
	player := GetCurrentPlayer(state)
	if player == nil {
		return
	}

	energyGained := 0
	for i := range player.FaceUpCards {
		card := &player.FaceUpCards[i]
		if card.Type == CardTypeFacility && card.EnergyPerTurn != nil {
			isStarDependent := card.DefID == "facility_solar_array" || card.DefID == "facility_dyson_sphere"
			isStarDestroyed := false
			for _, star := range state.DestroyedStars {
				if star == player.Position {
					isStarDestroyed = true
					break
				}
			}

			if isStarDependent && isStarDestroyed {
				starPos := player.Position
				AddStructuredLog(state, fmt.Sprintf("%s 的【%s】因恒星被毁灭，本回合无法产出能量", player.Name, card.Name), LogEntryTypeInfo, LogFields{
					SystemID:  &starPos,
					CardDefID: &card.DefID,
					PlayerIDs: []string{player.ID},
				})
				continue
			}

			energyGained += *card.EnergyPerTurn
		}
	}

	if energyGained > 0 {
		player.Energy += energyGained
		settlePos := player.Position
		AddStructuredLog(state, fmt.Sprintf("%s 的设施产出了 %d 点能量（当前能量：%d）", player.Name, energyGained, player.Energy), LogEntryTypeInfo, LogFields{
			SystemID:  &settlePos,
			PlayerIDs: []string{player.ID},
		})
	}
}
