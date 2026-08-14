package tools

import (
	"encoding/json"
	"sync"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
)

// ReplayIndex 提供 回合 → 动作区间 → 帧下标 的映射缓存，
// 供 get_replay_semantic_view / get_replay_deltas / get_turn_analysis
// 在只存 actions + 首/终帧的新记录上快速定位目标帧，避免全量解析 states[]。
type ReplayIndex struct {
	// TurnLastActionIdx 记录每个回合最后一条 action 在 actions 数组中的下标。
	// 存在该映射时，turn=T 的末帧下标 = TurnLastActionIdx[T] + 1。
	TurnLastActionIdx map[int]int
	MaxTurn           int // 总回合数（来自 TotalTurns）
	FrameCount        int // 帧数（老记录 = len(states)；新记录 = len(actions)+1）
}

// BuildReplayIndex 从 actions 与回合/帧数构建索引。
func BuildReplayIndex(actions []gamesdk.ActionRecord, totalTurns, frameCount int) *ReplayIndex {
	idx := &ReplayIndex{
		TurnLastActionIdx: make(map[int]int, len(actions)),
		MaxTurn:           totalTurns,
		FrameCount:        frameCount,
	}
	for i, a := range actions {
		idx.TurnLastActionIdx[a.Turn] = i
	}
	return idx
}

// resolveStateIndexForTurn 将玩家回合数映射到 states 数组下标。
// 与 replay_semantic.go 的包级 resolveStateIndexForTurn 相同的映射逻辑：
//   - turn<=0 → 0（初始帧）
//   - turn>=1 → 找 turn 最后一条 action 的 lastIdx+1；空回合回落 t-1，直至 0。
//
// 注意：此处仅做索引计算，越界语义（clamp）由调用方处理，不返回 error。
func (idx *ReplayIndex) resolveStateIndexForTurn(turn int) int {
	if turn <= 0 {
		return 0
	}
	for t := turn; t >= 1; t-- {
		if lastIdx, ok := idx.TurnLastActionIdx[t]; ok {
			return lastIdx + 1
		}
	}
	return 0
}

// indexCache 是 ReplayIndex 的内存缓存（以 replay ID 为键）。
// 与工具函数同包，用 RWMutex 保证并发读写安全。
var (
	indexCacheMu sync.RWMutex
	indexCache   = make(map[string]*ReplayIndex)
)

// GetReplayIndex 从本地 ReplayRow 获取或计算 ReplayIndex，并缓存。
//   - 老记录（states_json 为全量多帧）：FrameCount 取 len(states)。
//   - 新记录（仅两帧）：FrameCount 退化为 len(actions)+1。
//
// actions 解析失败时返回 nil。
func GetReplayIndex(row *persistence.ReplayRow) *ReplayIndex {
	if row == nil {
		return nil
	}
	indexCacheMu.RLock()
	if cached, ok := indexCache[row.ID]; ok {
		indexCacheMu.RUnlock()
		return cached
	}
	indexCacheMu.RUnlock()

	var actions []gamesdk.ActionRecord
	if err := json.Unmarshal([]byte(row.ActionsJSON), &actions); err != nil {
		return nil
	}

	// 计算 frameCount：老记录从 states 数组长度算；新记录（仅两帧）从 actions 推算。
	frameCount := len(actions) + 1
	var states []json.RawMessage
	if err := json.Unmarshal([]byte(row.StatesJSON), &states); err == nil && len(states) > 1 {
		frameCount = len(states)
	}

	idx := BuildReplayIndex(actions, row.TotalTurns, frameCount)

	indexCacheMu.Lock()
	indexCache[row.ID] = idx
	indexCacheMu.Unlock()
	return idx
}

// InvalidateReplayIndex 清除指定回放的索引缓存（测试或重新 fetch 后调用）。
func InvalidateReplayIndex(replayID string) {
	indexCacheMu.Lock()
	delete(indexCache, replayID)
	indexCacheMu.Unlock()
}
