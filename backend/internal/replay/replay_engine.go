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
		} else if err := game.InitiateBroadcast(state, playerID, req.CardUID, req.TargetSystem); err != nil {
			// 无效广播动作按 no-op 跳过，不中断回放
			engineLogger.Warn("applyActionToState: broadcast rejected", "action", action.Action, "error", err)
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

	case "forfeit":
		// 主动弃权：与 room.go HandleGameAction 的 forfeit 分支保持一致。
		// EliminatePlayerForForfeit 仅淘汰+清理，不推进回合、不判定 game over，
		// 此处补齐：≤1 名存活玩家 → 游戏结束；弃权者为当前玩家 → 推进回合。
		var target *game.Player
		for i := range state.Players {
			if state.Players[i].ID == playerID {
				target = &state.Players[i]
				break
			}
		}
		if target != nil && !target.Eliminated {
			wasCurrent := state.CurrentPlayerID == playerID
			game.EliminatePlayerForForfeit(state, playerID)
			alivePlayers := game.Filter(state.Players, func(p game.Player) bool { return !p.Eliminated })
			if len(alivePlayers) <= 1 {
				state.Phase = game.GamePhaseGameOver
				if len(alivePlayers) == 1 {
					id := alivePlayers[0].ID
					state.Winner = &id
				} else {
					state.Winner = nil
				}
				game.AddGameOverLog(state)
			} else if wasCurrent {
				game.AdvanceToNextPlayer(state)
			}
		}

	case "timeout":
		// 回合超时淘汰：镜像 rooms.triggerTurnTimeout——playerID 即被超时淘汰的
		// 当前回合玩家。EliminatePlayerForTimeout 仅淘汰+清理，不推进回合，
		// 此处补齐：≤1 名存活玩家 → 游戏结束；否则推进到下一玩家。
		var target *game.Player
		for i := range state.Players {
			if state.Players[i].ID == playerID {
				target = &state.Players[i]
				break
			}
		}
		if target != nil && !target.Eliminated {
			game.EliminatePlayerForTimeout(state, playerID)
			alivePlayers := game.Filter(state.Players, func(p game.Player) bool { return !p.Eliminated })
			if len(alivePlayers) <= 1 {
				state.Phase = game.GamePhaseGameOver
				if len(alivePlayers) == 1 {
					id := alivePlayers[0].ID
					state.Winner = &id
				} else {
					state.Winner = nil
				}
				game.AddGameOverLog(state)
			} else {
				game.AdvanceToNextPlayer(state)
			}
		}

	case "fallback":
		// 断线兜底结束：镜像 rooms.triggerFallback——action 发起者（playerID）
		// 即兜底胜者，批量淘汰 data 中指定的其余玩家并直接终局。
		var req struct {
			EliminatedPlayerIds []string `json:"eliminatedPlayerIds"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			engineLogger.Warn("applyActionToState: unmarshal failed", "action", action.Action, "error", err)
		}
		game.EliminatePlayersForFallback(state, req.EliminatedPlayerIds)
		state.Phase = game.GamePhaseGameOver
		winner := playerID
		state.Winner = &winner
		game.AddGameOverLog(state)

	default:
		engineLogger.Warn("applyActionToState: unknown action", "action", action.Action)
	}
}
