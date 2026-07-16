package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// TestSensitiveWordsHandler_ReturnsWordList 验证 GET /api/sensitive-words
// 返回 200、正确的 Content-Type、可解码为 []string，
// 且包含约定的占位测试词。同时验证返回切片与内部状态解耦。
func TestSensitiveWordsHandler_ReturnsWordList(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/sensitive-words", nil)
	rec := httptest.NewRecorder()

	SensitiveWordsHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 %d", rec.Code, http.StatusOK)
	}

	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("Content-Type = %q, 期望包含 application/json", ct)
	}

	var words []string
	if err := json.NewDecoder(rec.Body).Decode(&words); err != nil {
		t.Fatalf("解码响应体失败: %v", err)
	}

	// 仅校验关键占位词存在，避免后续扩充词表时测试不稳定
	required := []string{"敏感词a", "badword", "cheatcode"}
	for _, w := range required {
		if !slices.Contains(words, w) {
			t.Errorf("返回词表缺少期望词 %q, 实际 %v", w, words)
		}
	}

	// 解耦校验：修改首次返回的切片，再次调用不应改变内部状态
	firstLen := len(words)
	// 破坏性修改首次返回的切片
	if len(words) > 0 {
		words[0] = "__mutated__"
	}
	words = append(words, "__injected__")

	req2 := httptest.NewRequest(http.MethodGet, "/api/sensitive-words", nil)
	rec2 := httptest.NewRecorder()
	SensitiveWordsHandler(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("第二次调用状态码 = %d, 期望 %d", rec2.Code, http.StatusOK)
	}

	var words2 []string
	if err := json.NewDecoder(rec2.Body).Decode(&words2); err != nil {
		t.Fatalf("解码第二次响应体失败: %v", err)
	}

	if len(words2) != firstLen {
		t.Errorf("修改返回切片后内部状态被污染: 第二次返回长度 = %d, 期望 %d", len(words2), firstLen)
	}
	if slices.Contains(words2, "__mutated__") || slices.Contains(words2, "__injected__") {
		t.Errorf("修改返回切片后内部状态被污染: 第二次返回包含注入值, 实际 %v", words2)
	}
}

// TestSensitiveWordsHandler_MethodNotAllowed 验证非 GET 方法返回 405。
func TestSensitiveWordsHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/sensitive-words", nil)
	rec := httptest.NewRecorder()

	SensitiveWordsHandler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST 状态码 = %d, 期望 %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
