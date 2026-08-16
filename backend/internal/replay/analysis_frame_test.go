package replay

import (
	"encoding/json"
	"testing"
)

// TestProjectAnalysisFrame_Fields 验证投影字段完整性：Players 长度、
// 每个 player 的 HandCount 正确、能量非负，且 JSON 体积 < 5KB。
func TestProjectAnalysisFrame_Fields(t *testing.T) {
	gs := newTestGameState()
	frame := ProjectAnalysisFrame(gs, false, 0)

	if frame == nil {
		t.Fatal("ProjectAnalysisFrame returned nil")
	}
	if len(frame.Players) != 3 {
		t.Fatalf("expected 3 players, got %d", len(frame.Players))
	}
	for _, p := range frame.Players {
		if p.Energy < 0 {
			t.Errorf("player %s has negative energy %d", p.ID, p.Energy)
		}
		if p.HandCount < 0 {
			t.Errorf("player %s has negative hand count %d", p.ID, p.HandCount)
		}
		if p.Eliminated {
			t.Errorf("initial state player %s should not be eliminated", p.ID)
		}
	}
	if frame.DrawPileCount < 0 {
		t.Errorf("negative draw pile count: %d", frame.DrawPileCount)
	}
	if frame.Clamped {
		t.Error("clamped should be false for initial state")
	}
	if frame.InvalidActions != 0 {
		t.Errorf("expected invalidActions=0, got %d", frame.InvalidActions)
	}

	// 验证 JSON 体积 < 5KB
	data, _ := json.Marshal(frame)
	if len(data) > 5120 {
		t.Errorf("AnalysisFrame JSON too large: %d bytes (limit 5120)", len(data))
	}
}

// TestProjectAnalysisFrame_Clamped 验证 clamped 标志传递正确。
func TestProjectAnalysisFrame_Clamped(t *testing.T) {
	gs := newTestGameState()
	frame := ProjectAnalysisFrame(gs, true, 3)
	if !frame.Clamped {
		t.Error("expected clamped=true")
	}
	if frame.InvalidActions != 3 {
		t.Errorf("expected invalidActions=3, got %d", frame.InvalidActions)
	}
}

// TestProjectAnalysisFrame_Nil 验证 nil 输入返回 nil。
func TestProjectAnalysisFrame_Nil(t *testing.T) {
	frame := ProjectAnalysisFrame(nil, false, 0)
	if frame != nil {
		t.Error("expected nil for nil input")
	}
}

// TestProjectAnalysisFrame_DiscardPile 验证弃牌堆投影。
func TestProjectAnalysisFrame_DiscardPile(t *testing.T) {
	gs := newTestGameState()
	// 初始状态无弃牌
	frame := ProjectAnalysisFrame(gs, false, 0)
	if len(frame.DiscardPile) != 0 {
		t.Errorf("expected empty discard pile, got %d cards", len(frame.DiscardPile))
	}
}
