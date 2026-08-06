package auth

import (
	"strings"
	"testing"
)

// TestInit_TrustModeSkipsJWTSecret 验证 LOCAL_TRUST_MODE=1 时 Init() 跳过
// JWT_SECRET 与 ADMIN_SECRET_KEY 的强制检查，直接返回 nil。
func TestInit_TrustModeSkipsJWTSecret(t *testing.T) {
	// 重置全局状态（避免其他测试串扰）
	initialized = false
	jwtSecret = nil
	adminSecret = ""

	t.Setenv("LOCAL_TRUST_MODE", "1")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("ADMIN_SECRET_KEY", "")

	if err := Init(); err != nil {
		t.Fatalf("LOCAL_TRUST_MODE=1 时 Init() 应返回 nil，实际: %v", err)
	}

	if !initialized {
		t.Error("Init() 后 initialized 应为 true")
	}
}

// TestInit_RequiresJWTSecretWhenTrustModeUnset 验证 LOCAL_TRUST_MODE 未设时
// Init() 仍强制要求 JWT_SECRET，返回含 "JWT_SECRET" 的 error。
func TestInit_RequiresJWTSecretWhenTrustModeUnset(t *testing.T) {
	initialized = false
	jwtSecret = nil
	adminSecret = ""

	t.Setenv("LOCAL_TRUST_MODE", "")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("ADMIN_SECRET_KEY", "")

	err := Init()
	if err == nil {
		t.Fatal("LOCAL_TRUST_MODE 未设且 JWT_SECRET 为空时 Init() 应返回 error")
	}

	if !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Errorf("error message 应含 'JWT_SECRET'，实际: %v", err)
	}
}
