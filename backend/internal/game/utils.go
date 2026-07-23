package game

import (
	"fmt"
	"math/rand"
)

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

// LogFields 封装 LogEntry 的可选结构化字段，供 AddStructuredLog 使用。
// 各字段为 nil/空表示不适用，不会写入 LogEntry。
type LogFields struct {
	StrikeUID        *string
	SystemID         *int
	CardDefID        *string
	PlayerIDs        []string
	BroadcastID      *string
	PositionOwnerID  *string
}

// AddLog 保留原签名，StrikeUID 留空
func AddLog(state *GameState, message string, logType LogEntryType) {
	AddStructuredLog(state, message, logType, LogFields{})
}

// AddStrikeLog 新增：带可选 strikeUID 的日志记录
func AddStrikeLog(state *GameState, message string, logType LogEntryType, strikeUID *string) {
	AddStructuredLog(state, message, logType, LogFields{StrikeUID: strikeUID})
}

// AddStructuredLog 统一的日志记录入口，按 fields 填充可选结构化字段。
// fields 中 nil 指针与空切片不会写入 LogEntry（JSON omitempty 自动隐藏）。
func AddStructuredLog(state *GameState, message string, logType LogEntryType, fields LogFields) {
	state.Logs = append(state.Logs, LogEntry{
		ID:               GenerateID(),
		Turn:             state.TotalTurn,
		Phase:            string(state.TurnPhase),
		Message:          message,
		Type:             logType,
		StrikeUID:        fields.StrikeUID,
		SystemID:         fields.SystemID,
		CardDefID:        fields.CardDefID,
		PlayerIDs:        fields.PlayerIDs,
		BroadcastID:      fields.BroadcastID,
		PositionOwnerID:  fields.PositionOwnerID,
	})

	if len(state.Logs) > MaxLogs {
		state.Logs = state.Logs[len(state.Logs)-MaxLogs+10:]
	}
}

// AddGameOverLog 在游戏结束时写入统一的结束日志。
// state.Winner 非空时写入 "游戏结束！{玩家名} 获胜！" 并附带获奖者 PlayerIDs；
// state.Winner 为 nil 时写入 "游戏结束！所有文明陨落，永恒黑暗降临。"。
func AddGameOverLog(state *GameState) {
	if state.Winner != nil {
		for _, p := range state.Players {
			if p.ID == *state.Winner {
				AddStructuredLog(state, fmt.Sprintf("游戏结束！%s 获胜！", p.Name),
					LogEntryTypeSystem, LogFields{
						PlayerIDs: []string{p.ID},
					})
				return
			}
		}
	}
	AddLog(state, "游戏结束！所有文明陨落，永恒黑暗降临。", LogEntryTypeSystem)
}
