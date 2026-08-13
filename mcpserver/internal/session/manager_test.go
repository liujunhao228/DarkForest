package session

import (
	"strings"
	"testing"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/persistence"
)

// newTestManager 用真实 SQLite 账户池 + nil registrar(trust,零网络)构造 Manager。
func newTestManager(t *testing.T) (*Manager, *account.Pool) {
	t.Helper()
	db, err := persistence.Open(t.TempDir() + "/mgr.db")
	if err != nil {
		t.Fatalf("persistence.Open 失败: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	pool := account.NewPool(db.Account, nil, true)
	m := NewManager(pool, nil, "ws://127.0.0.1:1/ws", 0)
	return m, pool
}

// TestManager_SetPreferredAccount_FirstWins 验证注册表 first-wins 语义。
func TestManager_SetPreferredAccount_FirstWins(t *testing.T) {
	m, _ := newTestManager(t)

	// 首次写入
	m.SetPreferredAccount("s1", "ai1")
	if got := m.PreferredAccount("s1"); got != "ai1" {
		t.Fatalf("首次写入后 PreferredAccount = %q, want ai1", got)
	}

	// 同值幂等
	m.SetPreferredAccount("s1", "ai1")
	if got := m.PreferredAccount("s1"); got != "ai1" {
		t.Fatalf("同值幂等后 PreferredAccount = %q, want ai1", got)
	}

	// 换值被 first-wins 拒绝(打 warning 不覆盖)
	m.SetPreferredAccount("s1", "ai2")
	if got := m.PreferredAccount("s1"); got != "ai1" {
		t.Fatalf("换值被拒后 PreferredAccount = %q, want ai1(不覆盖)", got)
	}

	// 未登记会话返回空串
	if got := m.PreferredAccount("ghost"); got != "" {
		t.Fatalf("未登记会话 PreferredAccount = %q, want 空串", got)
	}
}

// TestManager_GetOrCreate_FreeBorrowWithoutPreferred 验证无 preferred 时走自由借用。
func TestManager_GetOrCreate_FreeBorrowWithoutPreferred(t *testing.T) {
	m, pool := newTestManager(t)
	if _, err := pool.AddAgent("ai1", ""); err != nil {
		t.Fatalf("AddAgent ai1: %v", err)
	}
	if _, err := pool.AddAgent("ai2", ""); err != nil {
		t.Fatalf("AddAgent ai2: %v", err)
	}

	gs, err := m.GetOrCreate("s1")
	if err != nil {
		t.Fatalf("GetOrCreate err: %v", err)
	}
	// 无 preferred → 自由借用(字母序第一个 available:agent:ai1)
	if gs.Account.ID != "agent:ai1" {
		t.Fatalf("借出账号 = %q, want %q(自由借用字母序)", gs.Account.ID, "agent:ai1")
	}
	if gs.Account.AssignedTo != "s1" {
		t.Fatalf("AssignedTo = %q, want s1", gs.Account.AssignedTo)
	}
}

// TestManager_GetOrCreate_NamedBorrowWithPreferred 验证有 preferred 时走指名借用。
func TestManager_GetOrCreate_NamedBorrowWithPreferred(t *testing.T) {
	m, pool := newTestManager(t)
	if _, err := pool.AddAgent("ai1", ""); err != nil {
		t.Fatalf("AddAgent ai1: %v", err)
	}
	if _, err := pool.AddAgent("ai2", ""); err != nil {
		t.Fatalf("AddAgent ai2: %v", err)
	}

	m.SetPreferredAccount("s1", "ai2")
	gs, err := m.GetOrCreate("s1")
	if err != nil {
		t.Fatalf("GetOrCreate err: %v", err)
	}
	if gs.Account.ID != "agent:ai2" {
		t.Fatalf("指名借出账号 = %q, want %q", gs.Account.ID, "agent:ai2")
	}

	// 无 preferred 的 s2 仍自由借用(不受 s1 指名影响)
	gs2, err := m.GetOrCreate("s2")
	if err != nil {
		t.Fatalf("GetOrCreate(s2) err: %v", err)
	}
	if gs2.Account.ID != "agent:ai1" {
		t.Fatalf("s2 自由借出账号 = %q, want %q", gs2.Account.ID, "agent:ai1")
	}

	// 指名未播种 sid → 明确报「不在账户池/agent 名单中」,错误带归因包装
	m.SetPreferredAccount("s3", "ghost")
	if _, err := m.GetOrCreate("s3"); err == nil || !strings.Contains(err.Error(), "借用账户失败") || !strings.Contains(err.Error(), "不在账户池/agent 名单中") {
		t.Fatalf("指名不存在账号 err = %v, want 包含「借用账户失败」与「不在账户池/agent 名单中」", err)
	}
}

// TestManager_Close_CleansPreferred 验证 Close 清理注册表并归还账户。
func TestManager_Close_CleansPreferred(t *testing.T) {
	m, pool := newTestManager(t)
	if _, err := pool.AddAgent("ai1", ""); err != nil {
		t.Fatalf("AddAgent: %v", err)
	}
	m.SetPreferredAccount("s1", "ai1")
	if _, err := m.GetOrCreate("s1"); err != nil {
		t.Fatalf("GetOrCreate err: %v", err)
	}
	if got := m.PreferredAccount("s1"); got != "ai1" {
		t.Fatalf("Close 前 PreferredAccount = %q, want ai1", got)
	}

	m.Close("s1")
	if got := m.PreferredAccount("s1"); got != "" {
		t.Fatalf("Close 后 PreferredAccount = %q, want 空串(注册表已清理)", got)
	}
	if got := pool.AvailableCount(); got != 1 {
		t.Fatalf("Close 后 AvailableCount = %d, want 1(账户已归还)", got)
	}
}
