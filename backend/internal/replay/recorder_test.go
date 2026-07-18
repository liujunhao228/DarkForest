package replay

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/darkforest/backend/internal/game"
)

// mockSaver 是 Saver 接口的测试替身，记录调用情况。
type mockSaver struct {
	mu          sync.Mutex
	calls       int32
	lastMatchID string
	lastActions []ActionRecord
	err         error
	delay       time.Duration // 模拟 DB 写入耗时
}

func (m *mockSaver) SaveReplay(ctx context.Context, matchID string, playerIDs, playerNames []string, actions []ActionRecord, initialState, finalState *game.GameState) error {
	if m.delay > 0 {
		select {
		case <-time.After(m.delay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	atomic.AddInt32(&m.calls, 1)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lastMatchID = matchID
	m.lastActions = actions
	return m.err
}

func (m *mockSaver) CallCount() int32 {
	return atomic.LoadInt32(&m.calls)
}

// TestRecorder_NilSafe 验证 nil receiver 下所有方法为 no-op，不 panic。
func TestRecorder_NilSafe(t *testing.T) {
	var r *ReplayRecorder
	// 不应 panic
	r.StartRecording("m1", []string{"p1"}, []string{"n1"}, nil)
	r.RecordAction("p1", "playCard", json.RawMessage(`{}`), 1)
	r.SaveReplay(nil)
	if r.IsRecording() {
		t.Fatal("nil recorder should not be recording")
	}
}

// TestRecorder_NoOpBeforeStart 验证未启动录制时 RecordAction/SaveReplay 为 no-op。
func TestRecorder_NoOpBeforeStart(t *testing.T) {
	saver := &mockSaver{}
	r := NewReplayRecorder(saver, nil)
	// 未调用 StartRecording，应全部 no-op
	r.RecordAction("p1", "playCard", json.RawMessage(`{}`), 1)
	r.SaveReplay(nil)
	if saver.CallCount() != 0 {
		t.Fatalf("expected 0 calls before StartRecording, got %d", saver.CallCount())
	}
}

// TestRecorder_EmptyMatchIDDoesNotStart 验证空 matchID 视为未启用录制。
func TestRecorder_EmptyMatchIDDoesNotStart(t *testing.T) {
	saver := &mockSaver{}
	r := NewReplayRecorder(saver, nil)
	r.StartRecording("", []string{"p1"}, []string{"n1"}, nil)
	if r.IsRecording() {
		t.Fatal("empty matchID should not start recording")
	}
	r.RecordAction("p1", "playCard", json.RawMessage(`{}`), 1)
	r.SaveReplay(nil)
	if saver.CallCount() != 0 {
		t.Fatalf("expected 0 calls for empty matchID, got %d", saver.CallCount())
	}
}

// TestRecorder_RecordAction 验证 StartRecording 后 RecordAction 追加到 actions。
func TestRecorder_RecordAction(t *testing.T) {
	saver := &mockSaver{}
	r := NewReplayRecorder(saver, nil)
	state := &game.GameState{Phase: game.GamePhasePlaying, TotalTurn: 1}
	r.StartRecording("m1", []string{"p1", "p2"}, []string{"Alice", "Bob"}, state)

	r.RecordAction("p1", "playCard", json.RawMessage(`{"cardUid":"c1"}`), 1)
	r.RecordAction("p2", "endTurn", json.RawMessage(`{}`), 2)

	// 启动后应是 recording 状态
	if !r.IsRecording() {
		t.Fatal("should be recording after StartRecording")
	}

	// SaveReplay 触发实际写库
	r.SaveReplay(state)
	// 异步写库，等待调用
	deadline := time.After(2 * time.Second)
	for saver.CallCount() == 0 {
		select {
		case <-deadline:
			t.Fatal("SaveReplay did not call saver within timeout")
		default:
			time.Sleep(time.Millisecond)
		}
	}

	saver.mu.Lock()
	defer saver.mu.Unlock()
	if saver.lastMatchID != "m1" {
		t.Errorf("expected matchID m1, got %s", saver.lastMatchID)
	}
	if len(saver.lastActions) != 2 {
		t.Fatalf("expected 2 actions, got %d", len(saver.lastActions))
	}
	if saver.lastActions[0].Action != "playCard" {
		t.Errorf("expected first action playCard, got %s", saver.lastActions[0].Action)
	}
}

// TestRecorder_SaveReplay_Idempotent 验证重复调用 SaveReplay 只写一次。
func TestRecorder_SaveReplay_Idempotent(t *testing.T) {
	saver := &mockSaver{}
	r := NewReplayRecorder(saver, nil)
	state := &game.GameState{Phase: game.GamePhasePlaying, TotalTurn: 1}
	r.StartRecording("m1", []string{"p1"}, []string{"n1"}, state)

	r.SaveReplay(state)
	r.SaveReplay(state)
	r.SaveReplay(state)

	// 等待可能的异步调用
	time.Sleep(100 * time.Millisecond)
	if cnt := saver.CallCount(); cnt != 1 {
		t.Errorf("expected exactly 1 SaveReplay call, got %d", cnt)
	}
}

// TestRecorder_SaveReplay_DoesNotBlock 验证 SaveReplay 异步执行不阻塞调用方。
// 这是 Fix #3 的核心断言：即使 saver 有显著延迟，SaveReplay 应立即返回。
func TestRecorder_SaveReplay_DoesNotBlock(t *testing.T) {
	saver := &mockSaver{delay: 500 * time.Millisecond}
	r := NewReplayRecorder(saver, nil)
	state := &game.GameState{Phase: game.GamePhasePlaying, TotalTurn: 1}
	r.StartRecording("m1", []string{"p1"}, []string{"n1"}, state)

	start := time.Now()
	r.SaveReplay(state)
	elapsed := time.Since(start)

	// 应远小于 500ms（留 100ms 余量处理 goroutine 启动 + clone）
	if elapsed > 100*time.Millisecond {
		t.Fatalf("SaveReplay blocked for %v, expected to return immediately", elapsed)
	}

	// 等待异步写库完成
	deadline := time.After(3 * time.Second)
	for saver.CallCount() == 0 {
		select {
		case <-deadline:
			t.Fatal("async SaveReplay did not complete within timeout")
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

// TestRecorder_SaveReplay_NilServiceNoOp 验证 service 为 nil 时 SaveReplay 为 no-op。
func TestRecorder_SaveReplay_NilServiceNoOp(t *testing.T) {
	r := NewReplayRecorder(nil, nil)
	state := &game.GameState{Phase: game.GamePhasePlaying, TotalTurn: 1}
	r.StartRecording("m1", []string{"p1"}, []string{"n1"}, state)
	// 不应 panic
	r.SaveReplay(state)
	if !r.IsRecording() {
		t.Fatal("recorder with nil service should still be recording (SaveReplay no-op)")
	}
}
