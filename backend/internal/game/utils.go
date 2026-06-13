package game

import "math/rand"

const MaxLogs = 200

func Shuffle[T any](arr []T) []T {
	a := make([]T, len(arr))
	copy(a, arr)
	for i := len(a) - 1; i > 0; i-- {
		j := rand.Intn(i + 1)
		a[i], a[j] = a[j], a[i]
	}
	return a
}

func Filter[T any](arr []T, fn func(T) bool) []T {
	var result []T
	for _, item := range arr {
		if fn(item) {
			result = append(result, item)
		}
	}
	return result
}

func Contains[T comparable](arr []T, item T) bool {
	for _, v := range arr {
		if v == item {
			return true
		}
	}
	return false
}

func IndexFunc[T any](arr []T, fn func(T) bool) int {
	for i, v := range arr {
		if fn(v) {
			return i
		}
	}
	return -1
}

func GetCurrentPlayer(state *GameState) *Player {
	if state.CurrentPlayerIndex < 0 || state.CurrentPlayerIndex >= len(state.Players) {
		return nil
	}
	return &state.Players[state.CurrentPlayerIndex]
}

func AddLog(state *GameState, message string, logType LogEntryType) {
	state.Logs = append(state.Logs, LogEntry{
		ID:      GenerateID(),
		Turn:    state.TotalTurn,
		Phase:   string(state.TurnPhase),
		Message: message,
		Type:    logType,
	})

	if len(state.Logs) > MaxLogs {
		state.Logs = state.Logs[len(state.Logs)-MaxLogs+10:]
	}
}