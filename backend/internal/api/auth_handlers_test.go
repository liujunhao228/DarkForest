package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/darkforest/backend/internal/db"
)

// TestRegister_DisplayNameContainsSensitive_Rejected 验证 DisplayName 命中敏感词时注册被拒绝。
// 敏感词校验发生在邀请码查询之前，因此无需 DB 连接即可测试该路径。
func TestRegister_DisplayNameContainsSensitive_Rejected(t *testing.T) {
	// queries 和 pool 均为 nil：校验路径不触及 DB，安全
	handler := NewAuthHandler(nil, nil)

	body := `{"displayName":"badword玩家","password":"password123","inviteCode":"ABCDE"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	rec := httptest.NewRecorder()

	handler.Register(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("期望状态码 %d, 实际 %d, body=%s", http.StatusBadRequest, rec.Code, rec.Body.String())
	}

	var resp ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("解析响应失败: %v, body=%s", err, rec.Body.String())
	}

	const wantMsg = "显示名包含违规内容，请修改"
	if resp.Error != wantMsg {
		t.Errorf("期望错误信息 %q, 实际 %q", wantMsg, resp.Error)
	}
	if resp.Success != false {
		t.Errorf("期望 success=false, 实际 %v", resp.Success)
	}
}

// TestRegister_DisplayNameNormal_Accepted 验证正常 DisplayName 不被敏感词过滤拦截。
// 注意：本项目无 DB mock 基础设施，该测试仅验证校验放行（不返回 400 + "显示名包含违规内容"）。
// queries.db 为 nil，校验通过后在 DB 调用时 panic，使用 defer recover 捕获以避免测试崩溃。
func TestRegister_DisplayNameNormal_Accepted(t *testing.T) {
	// queries.db 和 pool 均为 nil：校验通过后将在 CreatePlayer 调用时 panic
	handler := NewAuthHandler(db.New(nil), nil)

	body := `{"displayName":"正常玩家","password":"password123","inviteCode":"ABCDE"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	rec := httptest.NewRecorder()

	panicked := false
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		handler.Register(rec, req)
	}()

	// 校验通过：响应不应是 400 + "显示名包含违规内容"
	if rec.Code == http.StatusBadRequest && strings.Contains(rec.Body.String(), "显示名包含违规内容") {
		t.Errorf("正常显示名不应被敏感词过滤拦截: code=%d body=%s", rec.Code, rec.Body.String())
	}

	// 校验通过后会因 nil DB 在 QueryRow 调用时 panic（说明已越过校验环节）
	if !panicked {
		t.Logf("未触发 panic；response code=%d body=%s", rec.Code, rec.Body.String())
	}
}
