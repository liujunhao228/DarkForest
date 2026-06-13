package game

import (
	"fmt"
)

func createCardInstances(def CardDef) []Card {
	var instances []Card
	for i := 0; i < def.Quantity; i++ {
		card := Card{
			UID:         fmt.Sprintf("%s_%d_%s", def.ID, i, GenerateID()),
			DefID:       def.ID,
			Name:        def.Name,
			Type:        def.Type,
			Energy:      def.Energy,
			Description: def.Description,
			Image:       def.Image,
		}

		if subtype, ok := def.Extended["subtype"]; ok {
			s := fmt.Sprintf("%v", subtype)
			st := BroadcastSubtype(s)
			card.Subtype = &st
		}
		if r, ok := def.Extended["range"]; ok {
			rangeVal := int(r.(float64))
			card.Range = &rangeVal
		}
		if level, ok := def.Extended["level"]; ok {
			l := int(level.(float64))
			card.Level = &l
		}
		if speed, ok := def.Extended["speed"]; ok {
			s := int(speed.(float64))
			card.Speed = &s
		}
		if effect, ok := def.Extended["effect"]; ok {
			e := fmt.Sprintf("%v", effect)
			card.Effect = &e
		}
		if pl, ok := def.Extended["protection_level"]; ok {
			protectionLevel := int(pl.(float64))
			card.ProtectionLevel = &protectionLevel
		}
		if ept, ok := def.Extended["energy_per_turn"]; ok {
			energyPerTurn := int(ept.(float64))
			card.EnergyPerTurn = &energyPerTurn
		}
		if ability, ok := def.Extended["ability"]; ok {
			a := fmt.Sprintf("%v", ability)
			card.Ability = &a
		}

		instances = append(instances, card)
	}
	return instances
}

func CreateDrawPile() []Card {
	var allCards []Card
	for _, def := range CardDefinitions {
		allCards = append(allCards, createCardInstances(def)...)
	}
	return Shuffle(allCards)
}

func DrawCard(state *GameState, count int) []Card {
	var drawn []Card
	for i := 0; i < count; i++ {
		if len(state.DrawPile) == 0 {
			if len(state.DiscardPile) == 0 {
				break
			}
			state.DrawPile = Shuffle(state.DiscardPile)
			state.DiscardPile = []Card{}
			AddLog(state, "牌堆已耗尽，弃牌堆重新洗牌。", LogEntryTypeSystem)
		}
		if len(state.DrawPile) > 0 {
			card := state.DrawPile[len(state.DrawPile)-1]
			state.DrawPile = state.DrawPile[:len(state.DrawPile)-1]
			drawn = append(drawn, card)
		}
	}
	return drawn
}