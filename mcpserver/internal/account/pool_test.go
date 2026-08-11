package account

import (
	"errors"
	"testing"
	"time"

	"darkforest/mcpserver/internal/persistence"
)

// releasedCh 供 release 钩子测试接收回收的 sessionID。
var releasedCh = make(chan string, 8)

// newTestPool 用真实 SQLite 作为池底,registrar 为 nil(非 trust 仲裁测试不应产生网络)。
func newTestPool(t *testing.T) (*Pool, *persistence.DB) {
	t.Helper()
	db, err := persistence.Open(t.TempDir() + "/pool.db")
	if err != nil {
		t.Fatalf("persistence.Open 失败: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewPool(db.Account, nil, false), db
}

// TestPool_AddAgent_EmptyName 验证 AddAgent 默认名回退与幂等更新。
func TestPool_AddAgent_EmptyName(t *testing.T) {
	p, _ := newTestPool(t)

	a, err := p.AddAgent("llama", "")
	if err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}
	if a.ID != "agent:llama" {
		t.Fatalf("ID = %q, want %q", a.ID, "agent:llama")
	}
	if a.DisplayName != "AI-llama" {
		t.Fatalf("DisplayName = %q, want %q", a.DisplayName, "AI-llama")
	}
	if a.Role != "player" {
		t.Fatalf("Role = %q, want player", a.Role)
	}
	if a.Status != StatusAvailable {
		t.Fatalf("Status = %q, want %q", a.Status, StatusAvailable)
	}

	// 幂等:同名 agent 二次 AddAgent 不产生新 id,仅更新昵称。
	a2, err := p.AddAgent("llama", "晓狐")
	if err != nil {
		t.Fatalf("AddAgent 二次 err: %v", err)
	}
	if a2.ID != "agent:llama" {
		t.Fatalf("二次 AddAgent ID = %q, want 不变", a2.ID)
	}
	if a2.DisplayName != "晓狐" {
		t.Fatalf("二次 AddAgent DisplayName = %q, want %q", a2.DisplayName, "晓狐")
	}
	if got := p.AgentCount(); got != 1 {
		t.Fatalf("AgentCount = %d, want 1(幂等不回增)", got)
	}
}

// TestPool_ApplySeed_Formats 验证 ApplySeed 支持 sid / sid:名称 且幂等去重。
func TestPool_ApplySeed_Formats(t *testing.T) {
	p, _ := newTestPool(t)

	n, err := p.ApplySeed([]string{"llama", "fox:小鱼", "llama"})
	if err != nil {
		t.Fatalf("ApplySeed err: %v", err)
	}
	if n != 2 {
		t.Fatalf("ApplySeed 新增 = %d, want 2(去重后新增 2)", n)
	}

	fox := p.GetByUserID("agent:fox")
	if fox == nil {
		t.Fatal("GetByUserID(agent:fox) = nil, want 非 nil")
	}
	if fox.DisplayName != "小鱼" {
		t.Fatalf("fox DisplayName = %q, want %q", fox.DisplayName, "小鱼")
	}
	if llama := p.GetByUserID("agent:llama"); llama == nil || llama.DisplayName != "AI-llama" {
		t.Fatalf("llama = %v, want DisplayName=AI-llama", llama)
	}

	// 幂等:重复 ApplySeed 返回 0。
	n2, err := p.ApplySeed([]string{"llama", "fox:小鱼"})
	if err != nil {
		t.Fatalf("ApplySeed 二次 err: %v", err)
	}
	if n2 != 0 {
		t.Fatalf("重复 ApplySeed 新增 = %d, want 0", n2)
	}
	if got := p.AgentCount(); got != 2 {
		t.Fatalf("AgentCount = %d, want 2", got)
	}
}

// TestPool_Borrow_NoNetworkTrust 核心红线:trust(nil registrar)下 Borrow 纯簿记零网络。
func TestPool_Borrow_NoNetworkTrust(t *testing.T) {
	db, err := persistence.Open(t.TempDir() + "/pool.db")
	if err != nil {
		t.Fatalf("persistence.Open 失败: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	p := NewPool(db.Account, nil, true) // trust:registrar=nil → 不产生任何 HTTP
	if _, err := p.AddAgent("llama", ""); err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}

	a, err := p.Borrow("s1")
	if err != nil {
		t.Fatalf("Borrow err: %v", err)
	}
	if a.ID != "agent:llama" {
		t.Fatalf("借出的 ID = %q, want %q", a.ID, "agent:llama")
	}
	if a.Status != StatusInUse {
		t.Fatalf("借出后 Status = %q, want %q", a.Status, StatusInUse)
	}
	if a.AssignedTo != "s1" {
		t.Fatalf("借出后 AssignedTo = %q, want s1", a.AssignedTo)
	}

	// 空池借用应报 ErrNoAvailableAccount。
	empty := NewPool(db.Account, nil, true)
	if _, err := empty.Borrow("s2"); !errors.Is(err, ErrNoAvailableAccount) {
		t.Fatalf("空池 Borrow err = %v, want ErrNoAvailableAccount", err)
	}
}

// TestPool_Attach_PlayerID 验证 AttachPlayerID 回填 player_id 并持久化。
func TestPool_Attach_PlayerID(t *testing.T) {
	p, _ := newTestPool(t)
	if _, err := p.AddAgent("llama", ""); err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}

	p.AttachPlayerID("agent:llama", "pl-uuid")
	// 重新从数据库加载,验证 player_id 已持久化。
	if err := p.LoadFromDB(); err != nil {
		t.Fatalf("LoadFromDB err: %v", err)
	}
	a := p.GetByUserID("agent:llama")
	if a == nil {
		t.Fatal("GetByUserID(agent:llama) = nil")
	}
	if a.PlayerID != "pl-uuid" {
		t.Fatalf("PlayerID = %q, want %q", a.PlayerID, "pl-uuid")
	}
}

// TestPool_TrustMode_Flag 验证 IsTrustMode 反映 NewPool 第三参。
func TestPool_TrustMode_Flag(t *testing.T) {
	_, db := newTestPool(t)
	pt := NewPool(db.Account, nil, true)
	if !pt.IsTrustMode() {
		t.Fatal("IsTrustMode() = false, want true")
	}
	pf := NewPool(db.Account, nil, false)
	if pf.IsTrustMode() {
		t.Fatal("IsTrustMode() = true, want false")
	}
}

// TestPool_StaleReclaim_Lazy 验证 Borrow 在无可用账户时懒回收最旧的 stale 租约,
// 并触发 release 钩子(异常对局泄漏的账户无需重启即可复用)。
func TestPool_StaleReclaim_Lazy(t *testing.T) {
	p, _ := newTestPool(t)
	p.SetBorrowLease(10 * time.Second)
	p.SetOnRelease(func(sid string) {
		releasedCh <- sid
	})
	// 两个 agent
	if _, err := p.AddAgent("a1", ""); err != nil {
		t.Fatalf("AddAgent a1: %v", err)
	}
	if _, err := p.AddAgent("a2", ""); err != nil {
		t.Fatalf("AddAgent a2: %v", err)
	}
	// 全部借出:alpha→s1,beta→s2
	if _, err := p.Borrow("s1"); err != nil {
		t.Fatalf("Borrow s1: %v", err)
	}
	if _, err := p.Borrow("s2"); err != nil {
		t.Fatalf("Borrow s2: %v", err)
	}
	// 池已耗尽,新会话借用应失败
	if _, err := p.Borrow("s3"); !errors.Is(err, ErrNoAvailableAccount) {
		t.Fatalf("池耗尽 Borrow err = %v, want ErrNoAvailableAccount", err)
	}

	// 模拟 s1 异常泄漏:把 s1 的账户借用时间拨到租约之前
	p.mu.Lock()
	for _, a := range p.accounts {
		if a.AssignedTo == "s1" {
			a.BorrowedAt = time.Now().Add(-time.Minute)
		}
	}
	p.mu.Unlock()

	// 再借:s3 应懒回收 s1 的 stale 账户并借出
	a, err := p.Borrow("s3")
	if err != nil {
		t.Fatalf("stale 后 Borrow s3 err = %v, want 成功", err)
	}
	if a.AssignedTo != "s3" {
		t.Fatalf("借出账户 AssignedTo = %q, want s3", a.AssignedTo)
	}
	if got := p.AvailableCount(); got != 0 {
		t.Fatalf("AvailableCount = %d, want 0(s1 被 s3 顶替,s2 仍占用)", got)
	}
	// release 钩子应收到 s1(异步,稍等)
	select {
	case sid := <-releasedCh:
		if sid != "s1" {
			t.Fatalf("release 钩子收到 %q, want s1", sid)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("release 钩子未触发")
	}
}

// TestPool_StaleReclaim_Periodic 验证 ReclaimStale 仅在池耗尽时批量回收 stale 租约。
func TestPool_StaleReclaim_Periodic(t *testing.T) {
	p, _ := newTestPool(t)
	p.SetBorrowLease(10 * time.Second)
	if _, err := p.AddAgent("a1", ""); err != nil {
		t.Fatalf("AddAgent: %v", err)
	}
	if _, err := p.AddAgent("a2", ""); err != nil {
		t.Fatalf("AddAgent: %v", err)
	}
	if _, err := p.AddAgent("a3", ""); err != nil {
		t.Fatalf("AddAgent: %v", err)
	}
	if _, err := p.Borrow("s1"); err != nil {
		t.Fatalf("Borrow s1: %v", err)
	}
	if _, err := p.Borrow("s2"); err != nil {
		t.Fatalf("Borrow s2: %v", err)
	}
	// s1 超租约,s2 未超租约;池中仍有可用账户(a3)→ 不回收(避免误杀超长会话)
	p.mu.Lock()
	for _, a := range p.accounts {
		if a.AssignedTo == "s1" {
			a.BorrowedAt = time.Now().Add(-time.Minute)
		}
	}
	p.mu.Unlock()
	if n := p.ReclaimStale(); n != 0 {
		t.Fatalf("池未耗尽时 ReclaimStale = %d, want 0(不打扰使用中的会话)", n)
	}

	// 借出最后一个可用账户,池耗尽 → 回收全部 stale(s1)
	if _, err := p.Borrow("s3"); err != nil {
		t.Fatalf("Borrow s3: %v", err)
	}
	p.mu.Lock()
	for _, a := range p.accounts {
		if a.AssignedTo == "s2" {
			a.BorrowedAt = time.Now().Add(-time.Minute)
		}
	}
	p.mu.Unlock()
	if n := p.ReclaimStale(); n != 2 {
		t.Fatalf("池耗尽时 ReclaimStale = %d, want 2", n)
	}
	if got := p.AvailableCount(); got != 2 {
		t.Fatalf("AvailableCount = %d, want 2", got)
	}
}

// TestPool_ForceReleaseAll 验证运维强制释放全部 in_use 账户。
func TestPool_ForceReleaseAll(t *testing.T) {
	p, _ := newTestPool(t)
	if _, err := p.AddAgent("a1", ""); err != nil {
		t.Fatalf("AddAgent: %v", err)
	}
	if _, err := p.AddAgent("a2", ""); err != nil {
		t.Fatalf("AddAgent: %v", err)
	}
	if _, err := p.Borrow("s1"); err != nil {
		t.Fatalf("Borrow s1: %v", err)
	}
	if _, err := p.Borrow("s2"); err != nil {
		t.Fatalf("Borrow s2: %v", err)
	}
	if n := p.ForceReleaseAll(); n != 2 {
		t.Fatalf("ForceReleaseAll = %d, want 2", n)
	}
	if got := p.AvailableCount(); got != 2 {
		t.Fatalf("AvailableCount = %d, want 2", got)
	}
	// 指定 session 释放
	if _, err := p.Borrow("s9"); err != nil {
		t.Fatalf("Borrow s9: %v", err)
	}
	if err := p.ForceRelease("s9"); err != nil {
		t.Fatalf("ForceRelease(s9): %v", err)
	}
	if err := p.ForceRelease("s9"); !errors.Is(err, ErrAccountNotFound) {
		t.Fatalf("二次 ForceRelease err = %v, want ErrAccountNotFound", err)
	}
}
