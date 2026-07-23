package replay

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/darkforest/backend/internal/game"
)

// engineLogger 用于回放引擎内部的诊断日志（clone 失败、unmarshal 失败、重放耗时）。
// 不放在 Service/Recorder 上是因为 GenerateStateSnapshots 是包级函数。
var engineLogger = slog.Default()

// GenerateStateSnapshots generates state snapshots by replaying actions from initial state
func GenerateStateSnapshots(initialState *game.GameState, actions []ActionRecord) ([]*game.GameState, error) {
	if initialState == nil {
		return nil, nil
	}

	start := time.Now()
	snapshots := make([]*game.GameState, 0, len(actions)+1)

	currentState := cloneGameState(initialState)
	if currentState == nil {
		return nil, fmt.Errorf("failed to clone initial state")
	}
	snapshots = append(snapshots, currentState)

	for _, action := range actions {
		next := cloneGameState(currentState)
		if next == nil {
			engineLogger.Error("GenerateStateSnapshots: clone failed, stopping",
				"action", action.Action, "turn", action.Turn)
			return snapshots, fmt.Errorf("clone failed at action %s (turn %d)", action.Action, action.Turn)
		}
		applyActionToState(next, action)
		snapshots = append(snapshots, next)
		currentState = next
	}

	engineLogger.Info("replay snapshots generated",
		"actionCount", len(actions),
		"snapshotCount", len(snapshots),
		"durationMs", time.Since(start).Milliseconds())
	return snapshots, nil
}

func cloneGameState(state *game.GameState) *game.GameState {
	if state == nil {
		return nil
	}
	data, err := json.Marshal(state)
	if err != nil {
		engineLogger.Error("cloneGameState: marshal failed", "error", err)
		return nil
	}
	var cloned game.GameState
	if err := json.Unmarshal(data, &cloned); err != nil {
		engineLogger.Error("cloneGameState: unmarshal failed", "error", err)
		return nil
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
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
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
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.DeployCard(state, playerID, req.CardUID)
		}

	case "strike":
		var req struct {
			CardUID        string  `json:"cardUid"`
			TargetSystem   int     `json:"targetSystem"`
			TargetPlayerID *string `json:"targetPlayerId,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.PlayStrikeCard(state, playerID, req.CardUID, req.TargetSystem, req.TargetPlayerID)
		}

	case "broadcast":
		var req struct {
			CardUID      string `json:"cardUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.InitiateBroadcast(state, playerID, req.CardUID, req.TargetSystem)
		}

	case "respondBroadcast":
		var req struct {
			Agreed  bool    `json:"agreed"`
			CardUID *string `json:"cardUid,omitempty"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.RespondToBroadcast(state, playerID, req.Agreed, req.CardUID)
		}

	case "selectBroadcastResponder":
		var req struct {
			ResponderID string `json:"responderId"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.SelectBroadcastResponder(state, playerID, req.ResponderID)
		}

	case "cancelBroadcast":
		game.CancelBroadcast(state, playerID)

	case "recycleCard":
		var req struct {
			CardUID string `json:"cardUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.RecycleCard(state, playerID, req.CardUID)
		}

	case "moveStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.MoveStrike(state, req.StrikeUID, req.TargetSystem)
		}

	case "announceStrike":
		game.AnnounceStrike(state)

	case "skipAnnounceStrike":
		game.SkipAnnounceStrike(state)

	case "retargetStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.RetargetStrike(state, req.StrikeUID, req.TargetSystem)
		}

	case "selectStrike":
		var req struct {
			StrikeUID string `json:"strikeUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.SelectStrike(state, req.StrikeUID)
		}

	case "skipStrikeSelect":
		game.SkipStrikeSelect(state)

	case "skipStrikeMove":
		game.SkipStrikeMove(state)

	case "retargetMissedStrike":
		var req struct {
			StrikeUID    string `json:"strikeUid"`
			TargetSystem int    `json:"targetSystem"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.RetargetMissedStrike(state, req.StrikeUID, req.TargetSystem)
		}

	case "skipMissedStrike":
		var req struct {
			StrikeUID string `json:"strikeUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.SkipMissedStrike(state, req.StrikeUID)
		}

	case "discardMissedStrike":
		var req struct {
			StrikeUID string `json:"strikeUid"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			game.DiscardMissedStrike(state, req.StrikeUID)
		}

	case "endTurn":
		var req struct {
			DiscardCards  []string `json:"discardCards"`
			PublicDiscard bool     `json:"publicDiscard"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		} else {
			// game.EndTurn 内部已通过 advanceToEndPhase → AdvanceToNextPlayer →
			// StartTurn 完成完整回合推进，不可重复调用后两者，否则会多跳过一整个玩家回合。
			game.EndTurn(state, req.DiscardCards, req.PublicDiscard)
		}

	case "lightspeedShip":
		var req struct {
			Mode               string `json:"mode"`
			TargetSystem       int    `json:"targetSystem"`
			CarryEnergy        int    `json:"carryEnergy"`
			Message            string `json:"message"`
			LeaveBehind        bool   `json:"leaveBehind"`
			BroadcastOnInherit *bool  `json:"broadcastOnInherit,omitempty"`
		}
		_ = json.Unmarshal(data, &req)
		game.ExecuteLightspeedShip(state, playerID, req.CarryEnergy, req.Message, req.LeaveBehind, req.BroadcastOnInherit)

	default:
		engineLogger.Warn("applyActionToState: unknown action", "action", action.Action)
	}
}
