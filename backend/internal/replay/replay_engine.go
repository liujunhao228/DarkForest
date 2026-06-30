package replay

import (
	"encoding/json"

	"github.com/darkforest/backend/internal/game"
)

// GenerateStateSnapshots generates state snapshots by replaying actions from initial state
func GenerateStateSnapshots(initialState *game.GameState, actions []ActionRecord) ([]*game.GameState, error) {
	if initialState == nil {
		return nil, nil
	}

	snapshots := make([]*game.GameState, 0, len(actions)+1)

	currentState := cloneGameState(initialState)
	snapshots = append(snapshots, currentState)

	for _, action := range actions {
		currentState = cloneGameState(currentState)
		applyActionToState(currentState, action)
		snapshots = append(snapshots, currentState)
	}

	return snapshots, nil
}

func cloneGameState(state *game.GameState) *game.GameState {
	data, err := json.Marshal(state)
	if err != nil {
		return state
	}
	var cloned game.GameState
	if err := json.Unmarshal(data, &cloned); err != nil {
		return state
	}
	return &cloned
}

func applyActionToState(state *game.GameState, action ActionRecord) {
	data := action.Data
	playerID := action.PlayerID

	switch action.Action {
	case "playCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			var player *game.Player
			for i := range state.Players {
				if state.Players[i].ID == playerID {
					player = &state.Players[i]
					break
				}
			}
			if player != nil {
				game.PlayCard(state, player, req.CardUID)
			}
		}

	case "deployCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			game.DeployCard(state, playerID, req.CardUID)
		}

	case "strike":
		var req struct {
			CardUID        string  `json:"cardUid"`
			TargetSystem   int     `json:"targetSystem"`
			TargetPlayerID *string `json:"targetPlayerId,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			game.PlayStrikeCard(state, playerID, req.CardUID, req.TargetSystem, req.TargetPlayerID)
		}

	case "broadcast":
		var req struct {
			CardUID      string `json:"cardUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			game.InitiateBroadcast(state, playerID, req.CardUID, req.TargetSystem)
		}

	case "respondBroadcast":
		var req struct {
			Agreed  bool    `json:"agreed"`
			CardUID *string `json:"cardUid,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			game.RespondToBroadcast(state, playerID, req.Agreed, req.CardUID)
		}

	case "selectBroadcastResponder":
		var req struct {
			ResponderID string `json:"responderId"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			game.SelectBroadcastResponder(state, req.ResponderID)
		}

	case "cancelBroadcast":
		game.CancelBroadcast(state)

	case "recycleCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			game.RecycleCard(state, playerID, req.CardUID)
		}

	case "moveStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			game.MoveStrike(state, req.StrikeUID, req.TargetSystem)
		}

	case "announceStrike":
		game.AnnounceStrike(state)

	case "skipAnnounceStrike":
		game.SkipAnnounceStrike(state)

	case "endTurn":
		var req struct {
			DiscardCards []string `json:"discardCards"`
			PublicDiscard bool     `json:"publicDiscard"`
		}
		if err := json.Unmarshal(data, &req); err == nil {
			game.EndTurn(state, req.DiscardCards, req.PublicDiscard)
			game.AdvanceToNextPlayer(state)
			game.StartTurn(state)
		}

	case "lightspeedShip":
		game.ExecuteLightspeedShip(state, playerID)
	}
}
