package rooms

import (
	"errors"

	"github.com/darkforest/backend/internal/game"
)

var (
	// ErrRoomNotFound is returned when a room cannot be found
	ErrRoomNotFound = errors.New("room not found")

	// ErrRoomFull is returned when a room has reached maximum capacity
	ErrRoomFull = errors.New("room is full")

	// ErrGameNotStarted is returned when trying to process game actions before game starts
	ErrGameNotStarted = errors.New("game has not started yet")

	// ErrUnknownAction is returned when an action type is not recognized
	ErrUnknownAction = errors.New("unknown game action")

	// ErrPlayerNotFound is returned when a player is not found in the room
	ErrPlayerNotFound = errors.New("player not found in room")

	// ErrPlayerNotInGame is returned when a player is not in the room's GameState.Players
	ErrPlayerNotInGame = errors.New("player not in game state")

	// ErrPlayerEliminated is returned when a rejoining player has been eliminated
	ErrPlayerEliminated = errors.New("player has been eliminated")
)

// actionErrorCode 将动作校验/执行错误映射为客户端可读的错误码。
// 返回空字符串表示无匹配（调用方回退到 ACTION_FAILED）。
// 注意：错误可能经 fmt.Errorf("%w") 包装，必须用 errors.Is 匹配。
func actionErrorCode(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrGameNotStarted):
		return "GAME_NOT_STARTED"
	case errors.Is(err, ErrUnknownAction):
		return "UNKNOWN_ACTION"
	case errors.Is(err, game.ErrActionPlayerNotFound):
		return "PLAYER_NOT_FOUND"
	case errors.Is(err, game.ErrActionPlayerEliminated):
		return "PLAYER_ELIMINATED"
	case errors.Is(err, game.ErrActionNotYourTurn):
		return "NOT_YOUR_TURN"
	case errors.Is(err, game.ErrActionWrongPhase):
		return "WRONG_PHASE"
	case errors.Is(err, game.ErrActionPendingBlocked):
		return "PENDING_ACTION_BLOCKED"
	case errors.Is(err, game.ErrActionNoPending):
		return "NO_PENDING_ACTION"
	case errors.Is(err, game.ErrActionPendingMismatch):
		return "PENDING_ACTION_MISMATCH"
	case errors.Is(err, game.ErrActionNoBroadcast):
		return "NO_BROADCAST"
	default:
		return ""
	}
}
