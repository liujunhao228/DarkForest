package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newReplayHandlerForTest 构造一个不依赖 DB 的 ReplayHandler。
// replay.Service 为具体类型且依赖 Postgres（sqlc），单元测试无法 mock；
// 仅覆盖不触达 DB 的入参校验路径（缺失回放 ID 等），
// 200/404 等需真实回放数据的路径由 Step 10 集成验证（gate: human）覆盖。
func newReplayHandlerForTest() *ReplayHandler {
	return NewReplayHandler(nil, nil)
}

// frameRequest 构造带 PathValue 的 GET 请求。
func frameRequest(t *testing.T, target, replayID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.SetPathValue("id", replayID)
	return req
}

// TestGetReplayFrame_MissingID 验证缺失回放 ID 返回 400。
func TestGetReplayFrame_MissingID(t *testing.T) {
	h := newReplayHandlerForTest()
	req := frameRequest(t, "/api/replay//frames?turn=1", "")
	rr := httptest.NewRecorder()
	h.GetReplayFrame(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body["error"] == "" || body["error"] == nil {
		t.Errorf("expected non-empty error message, got %v", body["error"])
	}
}

// TestGetReplayActionsOnly_MissingID 验证缺失回放 ID 返回 400。
func TestGetReplayActionsOnly_MissingID(t *testing.T) {
	h := newReplayHandlerForTest()
	req := frameRequest(t, "/api/replay//actions", "")
	rr := httptest.NewRecorder()
	h.GetReplayActionsOnly(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// TestWriteJSON 验证 writeJSON 输出 Content-Type 与状态码。
func TestWriteJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	writeJSON(rr, http.StatusOK, map[string]any{"turn": 1})
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["turn"] != float64(1) {
		t.Errorf("expected turn=1, got %v", body["turn"])
	}
}