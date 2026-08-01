package game

import "testing"

// findChangesByPath 返回所有 Path 等于 path 的 change。
func findChangesByPath(changes []Change, path string) []Change {
	var out []Change
	for _, c := range changes {
		if c.Path == path {
			out = append(out, c)
		}
	}
	return out
}

// hasChangeOfType 判断是否存在 Path=path 且 Type=ctype 的 change。
func hasChangeOfType(changes []Change, path, ctype string) bool {
	for _, c := range changes {
		if c.Path == path && c.Type == ctype {
			return true
		}
	}
	return false
}

// TestDiffViewStates 覆盖 ViewState 增量 diff 的 6 个核心场景。
//
// 注意：DiffViewStates 函数与 Change 类型在 view_state_diff.go（Step 2）中实现，
// 因此本测试在 Step 2 完成前会因编译失败而 RED——这是 TDD 的预期行为。
func TestDiffViewStates(t *testing.T) {
	// (a) 标量变更：TotalTurn 1→2 产出 {Path:"totalTurn", Value:2, Type:"set"}
	t.Run("scalar TotalTurn 1 to 2", func(t *testing.T) {
		prev := &ViewState{TotalTurn: 1}
		next := &ViewState{TotalTurn: 2}

		changes := DiffViewStates(prev, next)

		if len(changes) != 1 {
			t.Fatalf("expected exactly 1 change, got %d: %+v", len(changes), changes)
		}
		c := changes[0]
		if c.Path != "totalTurn" {
			t.Errorf("Path = %q, want %q", c.Path, "totalTurn")
		}
		if c.Type != "set" {
			t.Errorf("Type = %q, want %q", c.Type, "set")
		}
		if c.Value != 2 {
			t.Errorf("Value = %v, want 2", c.Value)
		}
	})

	// (b) 嵌套 struct 变更：Players[0].Energy 5→8 产出 {Path:"players[0].energy", Value:8, Type:"set"}
	t.Run("nested Players[0].Energy 5 to 8", func(t *testing.T) {
		prev := &ViewState{
			Players: []PlayerView{{ID: "p1", Energy: 5}},
		}
		next := &ViewState{
			Players: []PlayerView{{ID: "p1", Energy: 8}},
		}

		changes := DiffViewStates(prev, next)

		if len(changes) != 1 {
			t.Fatalf("expected exactly 1 change, got %d: %+v", len(changes), changes)
		}
		c := changes[0]
		if c.Path != "players[0].energy" {
			t.Errorf("Path = %q, want %q", c.Path, "players[0].energy")
		}
		if c.Type != "set" {
			t.Errorf("Type = %q, want %q", c.Type, "set")
		}
		if c.Value != 8 {
			t.Errorf("Value = %v, want 8", c.Value)
		}
	})

	// (c) nil 指针字段：Broadcast nil→非 nil 产出 set；非 nil→nil 产出 delete
	t.Run("Broadcast nil to non-nil", func(t *testing.T) {
		prev := &ViewState{Broadcast: nil}
		next := &ViewState{
			Broadcast: &BroadcastStateView{BroadcasterID: "p1", CardUID: "card-1"},
		}

		changes := DiffViewStates(prev, next)

		if len(changes) != 1 {
			t.Fatalf("expected exactly 1 change, got %d: %+v", len(changes), changes)
		}
		c := changes[0]
		if c.Path != "broadcast" {
			t.Errorf("Path = %q, want %q", c.Path, "broadcast")
		}
		if c.Type != "set" {
			t.Errorf("Type = %q, want %q", c.Type, "set")
		}
		bv, ok := c.Value.(*BroadcastStateView)
		if !ok {
			t.Fatalf("Value type = %T, want *BroadcastStateView", c.Value)
		}
		if bv == nil {
			t.Fatal("Value is nil, want non-nil *BroadcastStateView")
		}
		if bv.BroadcasterID != "p1" {
			t.Errorf("Value.BroadcasterID = %q, want %q", bv.BroadcasterID, "p1")
		}
	})

	t.Run("Broadcast non-nil to nil", func(t *testing.T) {
		prev := &ViewState{
			Broadcast: &BroadcastStateView{BroadcasterID: "p1", CardUID: "card-1"},
		}
		next := &ViewState{Broadcast: nil}

		changes := DiffViewStates(prev, next)

		if len(changes) != 1 {
			t.Fatalf("expected exactly 1 change, got %d: %+v", len(changes), changes)
		}
		c := changes[0]
		if c.Path != "broadcast" {
			t.Errorf("Path = %q, want %q", c.Path, "broadcast")
		}
		if c.Type != "delete" {
			t.Errorf("Type = %q, want %q", c.Type, "delete")
		}
	})

	// (d) 数组元素变更：FlyingStrikes[0].Position 3→5 产出 {Path:"flyingStrikes[0].position", Value:5, Type:"set"}
	t.Run("FlyingStrikes[0].Position 3 to 5", func(t *testing.T) {
		prev := &ViewState{
			FlyingStrikes: []FlyingStrikeView{{UID: "s1", Position: 3}},
		}
		next := &ViewState{
			FlyingStrikes: []FlyingStrikeView{{UID: "s1", Position: 5}},
		}

		changes := DiffViewStates(prev, next)

		if len(changes) != 1 {
			t.Fatalf("expected exactly 1 change, got %d: %+v", len(changes), changes)
		}
		c := changes[0]
		if c.Path != "flyingStrikes[0].position" {
			t.Errorf("Path = %q, want %q", c.Path, "flyingStrikes[0].position")
		}
		if c.Type != "set" {
			t.Errorf("Type = %q, want %q", c.Type, "set")
		}
		if c.Value != 5 {
			t.Errorf("Value = %v, want 5", c.Value)
		}
	})

	// (e) Logs append-only：prev 长度 2、next 长度 4，仅产出 logs[2] 与 logs[3] 两个 set change，
	//     不产出 logs[0] 或 logs[1] 的 change
	t.Run("Logs append-only", func(t *testing.T) {
		log0 := LogEntry{ID: "log-0", Turn: 1, Message: "first"}
		log1 := LogEntry{ID: "log-1", Turn: 1, Message: "second"}
		log2 := LogEntry{ID: "log-2", Turn: 2, Message: "third"}
		log3 := LogEntry{ID: "log-3", Turn: 2, Message: "fourth"}

		prev := &ViewState{
			Logs: []LogEntry{log0, log1},
		}
		next := &ViewState{
			Logs: []LogEntry{log0, log1, log2, log3},
		}

		changes := DiffViewStates(prev, next)

		// 仅应产出 logs[2] 与 logs[3] 两个 set change
		if len(changes) != 2 {
			t.Fatalf("expected exactly 2 changes (logs[2], logs[3]), got %d: %+v", len(changes), changes)
		}

		m2 := findChangesByPath(changes, "logs[2]")
		if len(m2) != 1 || m2[0].Type != "set" {
			t.Errorf("expected 1 set change for logs[2], got %+v", m2)
		} else {
			le, ok := m2[0].Value.(LogEntry)
			if !ok {
				t.Errorf("logs[2] Value type = %T, want LogEntry", m2[0].Value)
			} else if le.ID != "log-2" {
				t.Errorf("logs[2] Value.ID = %q, want %q", le.ID, "log-2")
			}
		}

		m3 := findChangesByPath(changes, "logs[3]")
		if len(m3) != 1 || m3[0].Type != "set" {
			t.Errorf("expected 1 set change for logs[3], got %+v", m3)
		} else {
			le, ok := m3[0].Value.(LogEntry)
			if !ok {
				t.Errorf("logs[3] Value type = %T, want LogEntry", m3[0].Value)
			} else if le.ID != "log-3" {
				t.Errorf("logs[3] Value.ID = %q, want %q", le.ID, "log-3")
			}
		}

		// append-only 语义：前缀匹配的 logs[0] / logs[1] 不应产生任何 change
		if hasChangeOfType(changes, "logs[0]", "set") || hasChangeOfType(changes, "logs[0]", "delete") {
			t.Errorf("should not produce any change for logs[0], got %+v", findChangesByPath(changes, "logs[0]"))
		}
		if hasChangeOfType(changes, "logs[1]", "set") || hasChangeOfType(changes, "logs[1]", "delete") {
			t.Errorf("should not produce any change for logs[1], got %+v", findChangesByPath(changes, "logs[1]"))
		}
	})

	// (f) 空 diff：prev 与 next 完全相同，返回 nil（非空切片）
	t.Run("empty diff returns nil", func(t *testing.T) {
		prev := &ViewState{
			Phase:     GamePhasePlaying,
			TotalTurn: 5,
			Players:   []PlayerView{{ID: "p1", Energy: 3}},
			Logs:      []LogEntry{{ID: "log-1", Turn: 1, Message: "hello"}},
		}
		// next 与 prev 字段值完全相同（独立构造）
		next := &ViewState{
			Phase:     GamePhasePlaying,
			TotalTurn: 5,
			Players:   []PlayerView{{ID: "p1", Energy: 3}},
			Logs:      []LogEntry{{ID: "log-1", Turn: 1, Message: "hello"}},
		}

		changes := DiffViewStates(prev, next)

		if changes != nil {
			t.Errorf("expected nil changes for identical states, got %+v", changes)
		}
	})
}
