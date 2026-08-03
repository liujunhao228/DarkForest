package rooms

import (
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
)

// newTurnTimerTestRoom 创建一个用于 turnTimer 生命周期测试的房间。
// playerCount 决定玩家数量；customRules 非 nil 时设置到 room.CustomRules。
// 房间的广播回调为 no-op，避免测试期间触发额外逻辑。
func newTurnTimerTestRoom(t *testing.T, playerCount int, customRules *game.ModeRules) *Room {
	t.Helper()
	room := NewRoom(
		"test-turn-timer",
		playerCount,
		func(roomID string, msg hub.Message) {}, // no-op broadcast
		func(playerID string, msg hub.Message) {}, // no-op sendToPlayer
		nil,        // replayService
		slog.Default(),
		nil, // onGameFinish
	)
	if customRules != nil {
		room.CustomRules = customRules
	}
	for i := 0; i < playerCount; i++ {
		pid := []string{"p1", "p2", "p3", "p4"}[i]
		room.AddPlayer(&hub.PlayerInfo{ID: pid, DisplayName: pid, Role: "player"})
	}
	return room
}

// withShortTurnTimeout 临时将 rooms.TurnTimeout 缩短为指定值，测试结束后恢复。
func withShortTurnTimeout(t *testing.T, d time.Duration) {
	t.Helper()
	orig := TurnTimeout
	TurnTimeout = d
	t.Cleanup(func() { TurnTimeout = orig })
}

// TestRoomTurnTimerLifecycle 是 turnTimer 生命周期的测试组。
// 覆盖：StartGame 启动、有效动作重置、失败动作不重置、超时淘汰、
// InterruptTurn 暂停、ResumeTurn 重启、StopTimers 取消、ModeRules 覆盖、
// 非当前玩家动作不影响计时器。
func TestRoomTurnTimerLifecycle(t *testing.T) {
	// 1. StartGame 后应启动 turnTimer，且 turnTimerPlayerID 为当前玩家
	t.Run("StartsOnStartGame", func(t *testing.T) {
		withShortTurnTimeout(t, 500*time.Millisecond)
		room := newTurnTimerTestRoom(t, 3, nil)
		if !room.StartGame("test", "") {
			t.Fatal("StartGame failed")
		}
		if room.turnTimer == nil {
			t.Fatal("turnTimer should be started after StartGame")
		}
		if room.turnTimerPlayerID != room.GameState.CurrentPlayerID {
			t.Errorf("turnTimerPlayerID = %s, want %s",
				room.turnTimerPlayerID, room.GameState.CurrentPlayerID)
		}
		room.StopTimers()
	})

	// 2. 当前玩家 dispatch endTurn 成功后，回合切换，新计时器启动
	t.Run("ResetsOnValidAction", func(t *testing.T) {
		withShortTurnTimeout(t, 2*time.Second)
		room := newTurnTimerTestRoom(t, 3, nil)
		room.StartGame("test", "")
		prevPlayer := room.GameState.CurrentPlayerID
		prevTimer := room.turnTimer

		err := room.HandleGameAction(prevPlayer, "endTurn", json.RawMessage(`{}`))
		if err != nil {
			t.Fatalf("HandleGameAction endTurn failed: %v", err)
		}

		if room.GameState.CurrentPlayerID == prevPlayer {
			t.Skip("turn did not advance (game-specific behavior); skipping timer reset check")
		}
		if room.turnTimer == nil {
			t.Fatal("turnTimer should be restarted after valid action that advances turn")
		}
		if room.turnTimerPlayerID != room.GameState.CurrentPlayerID {
			t.Errorf("turnTimerPlayerID = %s, want %s (new current player)",
				room.turnTimerPlayerID, room.GameState.CurrentPlayerID)
		}
		if room.turnTimer == prevTimer {
			t.Error("turnTimer pointer should differ after reset (new timer created)")
		}
		room.StopTimers()
	})

	// 3. dispatch 失败（未知 action）不应重置计时器
	t.Run("NoResetOnFailedDispatch", func(t *testing.T) {
		withShortTurnTimeout(t, 2*time.Second)
		room := newTurnTimerTestRoom(t, 3, nil)
		room.StartGame("test", "")
		prevTimer := room.turnTimer
		prevPlayerID := room.turnTimerPlayerID

		err := room.HandleGameAction(room.GameState.CurrentPlayerID, "unknownAction", json.RawMessage(`{}`))
		if err == nil {
			t.Fatal("expected error for unknown action, got nil")
		}

		if room.turnTimer != prevTimer {
			t.Error("turnTimer should NOT change after failed dispatch")
		}
		if room.turnTimerPlayerID != prevPlayerID {
			t.Errorf("turnTimerPlayerID changed: %s -> %s (should stay same)",
				prevPlayerID, room.turnTimerPlayerID)
		}
		room.StopTimers()
	})

	// 4. 超时后当前玩家应被淘汰，回合推进到下一玩家
	t.Run("TriggersElimination", func(t *testing.T) {
		withShortTurnTimeout(t, 100*time.Millisecond)
		room := newTurnTimerTestRoom(t, 3, nil)
		room.StartGame("test", "")
		originalPlayerID := room.GameState.CurrentPlayerID

		// 等待超时触发（100ms 超时 + 200ms buffer）
		time.Sleep(300 * time.Millisecond)

		// 找到原玩家，断言已淘汰
		var originalPlayer *game.Player
		for i := range room.GameState.Players {
			if room.GameState.Players[i].ID == originalPlayerID {
				originalPlayer = &room.GameState.Players[i]
				break
			}
		}
		if originalPlayer == nil {
			t.Fatalf("original player %s not found", originalPlayerID)
		}
		if !originalPlayer.Eliminated {
			t.Errorf("original player %s should be eliminated after timeout", originalPlayerID)
		}
		if room.GameState.CurrentPlayerID == originalPlayerID {
			t.Error("CurrentPlayerID should advance after timeout elimination")
		}
		room.StopTimers()
	})

	// 5. InterruptTurn 后计时器应暂停（turnTimer == nil，turnTimerPlayerID 保留）
	t.Run("PausesOnInterruptTurn", func(t *testing.T) {
		withShortTurnTimeout(t, 2*time.Second)
		room := newTurnTimerTestRoom(t, 3, nil)
		room.StartGame("test", "")
		prevPlayerID := room.GameState.CurrentPlayerID
		prevPhase := room.GameState.TurnPhase

		room.mu.Lock()
		game.InterruptTurn(room.GameState, "test")
		room.reconcileTurnTimerLocked(prevPlayerID, prevPhase)
		room.mu.Unlock()

		if room.turnTimer != nil {
			t.Error("turnTimer should be nil after InterruptTurn (paused)")
		}
		if room.turnTimerPlayerID != prevPlayerID {
			t.Errorf("turnTimerPlayerID = %s, want %s (preserved for ResumeTurn)",
				room.turnTimerPlayerID, prevPlayerID)
		}
		room.StopTimers()
	})

	// 6. ResumeTurn 后计时器应重启（turnTimer != nil，turnTimerPlayerID 为当前玩家）
	t.Run("RestartsOnResumeTurn", func(t *testing.T) {
		withShortTurnTimeout(t, 2*time.Second)
		room := newTurnTimerTestRoom(t, 3, nil)
		room.StartGame("test", "")
		prevPlayerID := room.GameState.CurrentPlayerID
		prevPhase := room.GameState.TurnPhase

		// 先暂停
		room.mu.Lock()
		game.InterruptTurn(room.GameState, "test")
		room.reconcileTurnTimerLocked(prevPlayerID, prevPhase)
		room.mu.Unlock()

		if room.turnTimer != nil {
			t.Fatal("precondition: turnTimer should be nil after InterruptTurn")
		}

		// 再恢复
		interruptedPhase := room.GameState.TurnPhase
		room.mu.Lock()
		game.ResumeTurn(room.GameState)
		room.reconcileTurnTimerLocked(prevPlayerID, interruptedPhase)
		room.mu.Unlock()

		if room.turnTimer == nil {
			t.Error("turnTimer should be restarted after ResumeTurn")
		}
		if room.turnTimerPlayerID != room.GameState.CurrentPlayerID {
			t.Errorf("turnTimerPlayerID = %s, want %s",
				room.turnTimerPlayerID, room.GameState.CurrentPlayerID)
		}
		room.StopTimers()
	})

	// 7. StopTimers 后 turnTimer 应为 nil
	t.Run("CancelOnStopTimers", func(t *testing.T) {
		withShortTurnTimeout(t, 2*time.Second)
		room := newTurnTimerTestRoom(t, 3, nil)
		room.StartGame("test", "")

		if room.turnTimer == nil {
			t.Fatal("precondition: turnTimer should be started after StartGame")
		}

		room.StopTimers()

		if room.turnTimer != nil {
			t.Error("turnTimer should be nil after StopTimers")
		}
		if room.turnTimerPlayerID != "" {
			t.Errorf("turnTimerPlayerID = %s, want empty after StopTimers",
				room.turnTimerPlayerID)
		}
	})

	// 8. ModeRules.TurnTimeoutSeconds 应覆盖环境变量默认值
	t.Run("ModeRulesOverride", func(t *testing.T) {
		// 默认 TurnTimeout 设为很短（50ms），ModeRules 覆盖为 1s
		withShortTurnTimeout(t, 50*time.Millisecond)
		customRules := &game.ModeRules{TurnTimeoutSeconds: 1}
		room := newTurnTimerTestRoom(t, 3, customRules)
		room.StartGame("test", "")
		originalPlayerID := room.GameState.CurrentPlayerID

		// 等待 200ms（> 50ms 默认，但 < 1s 覆盖值）
		time.Sleep(200 * time.Millisecond)

		var originalPlayer *game.Player
		for i := range room.GameState.Players {
			if room.GameState.Players[i].ID == originalPlayerID {
				originalPlayer = &room.GameState.Players[i]
				break
			}
		}
		if originalPlayer == nil {
			t.Fatalf("original player %s not found", originalPlayerID)
		}
		if originalPlayer.Eliminated {
			t.Errorf("player should NOT be eliminated: ModeRules.TurnTimeoutSeconds=1s should override 50ms default")
		}
		room.StopTimers()
	})

	// 9. 非当前玩家的成功动作不应重置当前玩家的计时器
	t.Run("NotAffectOtherPlayersActions", func(t *testing.T) {
		withShortTurnTimeout(t, 2*time.Second)
		room := newTurnTimerTestRoom(t, 3, nil)
		room.StartGame("test", "")
		currentPlayerID := room.GameState.CurrentPlayerID
		prevTimer := room.turnTimer

		// 找一个非当前玩家
		var nonCurrentPlayerID string
		for _, p := range room.GameState.Players {
			if p.ID != currentPlayerID {
				nonCurrentPlayerID = p.ID
				break
			}
		}
		if nonCurrentPlayerID == "" {
			t.Fatal("could not find a non-current player")
		}

		// cancelBroadcast 在无广播时是 no-op，不会改变 CurrentPlayerID/TurnPhase
		err := room.HandleGameAction(nonCurrentPlayerID, "cancelBroadcast", json.RawMessage(`{}`))
		if err != nil {
			t.Fatalf("HandleGameAction cancelBroadcast failed: %v", err)
		}

		// 计时器不应被重置（同一个 timer 指针，同一个 playerID）
		if room.turnTimer != prevTimer {
			t.Error("turnTimer should NOT change after non-current player's action")
		}
		if room.turnTimerPlayerID != currentPlayerID {
			t.Errorf("turnTimerPlayerID = %s, want %s (current player unchanged)",
				room.turnTimerPlayerID, currentPlayerID)
		}
		room.StopTimers()
	})
}
