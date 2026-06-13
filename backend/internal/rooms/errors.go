package rooms

import "errors"

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
)
