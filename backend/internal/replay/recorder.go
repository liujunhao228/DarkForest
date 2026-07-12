package replay

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/game"
)

// Saver 抽象回放落库操作，便于在测试中替换为 mock。
// *Service 隐式实现此接口。
type Saver interface {
	SaveReplay(ctx context.Context, matchID string, playerIDs, playerNames []string, actions []ActionRecord, initialState, finalState *game.GameState) error
}

// ReplayRecorder 在对局进行期间收集动作与初始/最终状态，
// 在游戏结束时一次性写入数据库。它由 Room 持有，
// 不参与游戏逻辑，只做被动录制。
type ReplayRecorder struct {
	mu           sync.Mutex
	matchID      string
	playerIDs    []string
	playerNames  []string
	initialState *game.GameState
	actions      []ActionRecord
	service      Saver
	logger       *slog.Logger
	saved        bool
	started      bool
}

// NewReplayRecorder 创建一个新的录制器。service 可为 nil（此时 SaveReplay 为 no-op）。
func NewReplayRecorder(service Saver, logger *slog.Logger) *ReplayRecorder {
	return &ReplayRecorder{
		service: service,
		logger:  logger,
	}
}

// StartRecording 用对局元数据与初始状态快照初始化录制器。
// 若 matchID 为空则视为未启用录制，后续 RecordAction/SaveReplay 均为 no-op。
func (r *ReplayRecorder) StartRecording(matchID string, playerIDs, playerNames []string, initialState *game.GameState) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.matchID = matchID
	r.playerIDs = append([]string(nil), playerIDs...)
	r.playerNames = append([]string(nil), playerNames...)
	r.initialState = cloneGameState(initialState)
	r.actions = nil
	r.saved = false
	r.started = matchID != ""
}

// RecordAction 追加一个动作到录制器。未启动或已保存时为 no-op。
func (r *ReplayRecorder) RecordAction(playerID, action string, data json.RawMessage, turn int) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.started || r.saved {
		return
	}
	// 复制一份 data，避免外部修改影响录制内容
	var dataCopy json.RawMessage
	if len(data) > 0 {
		dataCopy = append([]byte(nil), data...)
	}
	r.actions = append(r.actions, ActionRecord{
		PlayerID:  playerID,
		Action:    action,
		Data:      dataCopy,
		Turn:      turn,
		Timestamp: time.Now().UnixMilli(),
	})
}

// SaveReplay 把录制内容写入数据库。重复调用为 no-op。
// finalState 为游戏结束时的状态快照；可为 nil。
//
// 异步执行：克隆 finalState 后启动 goroutine 写库，避免阻塞房间的 HandleGameAction。
// 游戏已结束（Phase == GamePhaseGameOver），房间不再 mutate GameState，但 finalState
// 指针仍被 broadcastGameState 引用，故必须用 clone。
func (r *ReplayRecorder) SaveReplay(finalState *game.GameState) {
	if r == nil {
		return
	}
	r.mu.Lock()
	if !r.started || r.saved || r.service == nil {
		r.mu.Unlock()
		return
	}
	r.saved = true
	// 拷贝出锁外需要使用的字段，避免长时间持锁
	matchID := r.matchID
	playerIDs := r.playerIDs
	playerNames := r.playerNames
	actions := r.actions
	initialState := r.initialState
	r.mu.Unlock()

	// 克隆 finalState，避免与房间共享指针后被修改
	var finalStateClone *game.GameState
	if finalState != nil {
		finalStateClone = cloneGameState(finalState)
	}

	if r.logger != nil {
		r.logger.Info("saving replay (async)", "matchId", matchID, "actionCount", len(actions))
	}

	// 异步写库：goroutine 自带 10s 超时 context，不依赖 server context。
	// server 30s graceful shutdown 足以覆盖 10s 写库超时。
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := r.service.SaveReplay(ctx, matchID, playerIDs, playerNames, actions, initialState, finalStateClone); err != nil {
			if r.logger != nil {
				r.logger.Error("failed to save replay", "matchId", matchID, "error", err)
			}
		}
	}()
}

// IsRecording 返回录制器是否已启动且尚未保存。
func (r *ReplayRecorder) IsRecording() bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.started && !r.saved
}
