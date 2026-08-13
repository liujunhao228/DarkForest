package account

import (
	"errors"
	"strings"
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

// TestPool_BorrowPreferred_EmptyFallsBack 验证 preferredID 为空时回退自由借用(向后兼容)。
func TestPool_BorrowPreferred_EmptyFallsBack(t *testing.T) {
	p, _ := newTestPool(t)
	if _, err := p.AddAgent("llama", ""); err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}

	a, err := p.BorrowPreferred("s1", "")
	if err != nil {
		t.Fatalf("BorrowPreferred(s1, \"\") err: %v", err)
	}
	if a.ID != "agent:llama" {
		t.Fatalf("借出的 ID = %q, want %q", a.ID, "agent:llama")
	}
	if a.AssignedTo != "s1" {
		t.Fatalf("AssignedTo = %q, want s1", a.AssignedTo)
	}

	// 空池回退同样报 ErrNoAvailableAccount(与 Borrow 行为一致)。
	empty, _ := newTestPool(t)
	if _, err := empty.BorrowPreferred("s2", ""); !errors.Is(err, ErrNoAvailableAccount) {
		t.Fatalf("空池 BorrowPreferred err = %v, want ErrNoAvailableAccount", err)
	}
}

// TestPool_BorrowPreferred_InvalidSid 验证非法 sid(含空格/超长/空)明确报错。
func TestPool_BorrowPreferred_InvalidSid(t *testing.T) {
	p, _ := newTestPool(t)
	for _, bad := range []string{"bad sid", "", "agent:", strings.Repeat("a", 65), "agent:agent:llama"} {
		if _, err := p.BorrowPreferred("s1", bad); err == nil {
			t.Fatalf("BorrowPreferred(s1, %q) err = nil, want 非法 sid 报错", bad)
		}
	}
}

// TestPool_BorrowPreferred_NotFound 验证指名账号不在池中明确报「不在名单」。
func TestPool_BorrowPreferred_NotFound(t *testing.T) {
	p, _ := newTestPool(t)
	if _, err := p.AddAgent("llama", ""); err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}
	_, err := p.BorrowPreferred("s1", "ghost")
	if err == nil || !strings.Contains(err.Error(), "不在账户池/agent 名单中") {
		t.Fatalf("BorrowPreferred(ghost) err = %v, want 包含「不在账户池/agent 名单中」", err)
	}
	// agent: 前缀形式同样归一化到同一键,未播种仍报不在名单。
	if _, err := p.BorrowPreferred("s1", "agent:ghost"); err == nil || !strings.Contains(err.Error(), "不在账户池/agent 名单中") {
		t.Fatalf("BorrowPreferred(agent:ghost) err = %v, want 不在名单", err)
	}
}

// TestPool_BorrowPreferred_Available 验证可用账户被指名借出,且接受 "agent:" 前缀。
func TestPool_BorrowPreferred_Available(t *testing.T) {
	p, _ := newTestPool(t)
	if _, err := p.AddAgent("llama", ""); err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}
	if _, err := p.AddAgent("fox", ""); err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}

	a, err := p.BorrowPreferred("s1", "fox")
	if err != nil {
		t.Fatalf("BorrowPreferred(s1, fox) err: %v", err)
	}
	if a.ID != "agent:fox" {
		t.Fatalf("借出的 ID = %q, want %q", a.ID, "agent:fox")
	}
	if a.Status != StatusInUse {
		t.Fatalf("借出后 Status = %q, want %q", a.Status, StatusInUse)
	}
	if a.AssignedTo != "s1" {
		t.Fatalf("借出后 AssignedTo = %q, want s1", a.AssignedTo)
	}
	// 池中另一账户仍可用(llama 未被误借)。
	if got := p.AvailableCount(); got != 1 {
		t.Fatalf("AvailableCount = %d, want 1", got)
	}

	// 带 "agent:" 前缀指名同一账号:已被本会话占用 → 幂等返回同一账户。
	a2, err := p.BorrowPreferred("s1", "agent:fox")
	if err != nil {
		t.Fatalf("BorrowPreferred(s1, agent:fox) err: %v", err)
	}
	if a2.ID != "agent:fox" {
		t.Fatalf("幂等返回 ID = %q, want %q", a2.ID, "agent:fox")
	}
}

// TestPool_BorrowPreferred_SameSessionIdempotent 验证本会话重复指名借用幂等返回同一账户。
func TestPool_BorrowPreferred_SameSessionIdempotent(t *testing.T) {
	p, _ := newTestPool(t)
	if _, err := p.AddAgent("llama", ""); err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}
	a1, err := p.BorrowPreferred("s1", "llama")
	if err != nil {
		t.Fatalf("首次 BorrowPreferred err: %v", err)
	}
	a2, err := p.BorrowPreferred("s1", "llama")
	if err != nil {
		t.Fatalf("二次 BorrowPreferred err: %v", err)
	}
	if a1.ID != a2.ID {
		t.Fatalf("两次借用 ID 不一致: %q vs %q", a1.ID, a2.ID)
	}
	if got := p.AvailableCount(); got != 0 {
		t.Fatalf("AvailableCount = %d, want 0(幂等不重复借出)", got)
	}
}

// TestPool_BorrowPreferred_OtherSessionOccupied 验证他人占用的指名账号明确报「占用」。
func TestPool_BorrowPreferred_OtherSessionOccupied(t *testing.T) {
	p, _ := newTestPool(t)
	if _, err := p.AddAgent("llama", ""); err != nil {
		t.Fatalf("AddAgent err: %v", err)
	}
	if _, err := p.BorrowPreferred("s1", "llama"); err != nil {
		t.Fatalf("BorrowPreferred(s1) err: %v", err)
	}
	_, err := p.BorrowPreferred("s2", "llama")
	if err == nil || !strings.Contains(err.Error(), "已被会话 s1 占用") {
		t.Fatalf("BorrowPreferred(s2, llama) err = %v, want 包含「已被会话 s1 占用」", err)
	}
}

// TestPool_BorrowPreferred_NoStaleReclaim 验证指名路径在池耗尽时不跨会话抢 stale
// (不踢活会话,绑定语义不被租约回收破坏)。
func TestPool_BorrowPreferred_NoStaleReclaim(t *testing.T) {
	p, _ := newTestPool(t)
	p.SetBorrowLease(10 * time.Second)
	p.SetOnRelease(func(sid string) { releasedCh <- sid })
	if _, err := p.AddAgent("a1", ""); err != nil {
		t.Fatalf("AddAgent a1: %v", err)
	}
	if _, err := p.AddAgent("a2", ""); err != nil {
		t.Fatalf("AddAgent a2: %v", err)
	}
	if _, err := p.BorrowPreferred("s1", "a1"); err != nil {
		t.Fatalf("BorrowPreferred(s1, a1): %v", err)
	}
	if _, err := p.BorrowPreferred("s2", "a2"); err != nil {
		t.Fatalf("BorrowPreferred(s2, a2): %v", err)
	}
	// 把 s1 的账户拨到租约之前(变为 stale),池已耗尽。
	p.mu.Lock()
	for _, a := range p.accounts {
		if a.AssignedTo == "s1" {
			a.BorrowedAt = time.Now().Add(-time.Minute)
		}
	}
	p.mu.Unlock()

	// 指名一个被占用的账号:明确报占用,绝不懒回收 stale 顶替。
	if _, err := p.BorrowPreferred("s3", "a1"); err == nil || !strings.Contains(err.Error(), "已被会话 s1 占用") {
		t.Fatalf("指名被占账号 err = %v, want 包含「已被会话 s1 占用」", err)
	}
	// 指名池中不存在的账号:报不在名单,同样不抢 stale。
	if _, err := p.BorrowPreferred("s3", "ghost"); err == nil || !strings.Contains(err.Error(), "不在账户池/agent 名单中") {
		t.Fatalf("指名不存在账号 err = %v, want 不在名单", err)
	}
	// stale 账户未被回收:池中仍无一可用。
	if got := p.AvailableCount(); got != 0 {
		t.Fatalf("AvailableCount = %d, want 0(指名不抢 stale)", got)
	}
	select {
	case sid := <-releasedCh:
		t.Fatalf("release 钩子不应触发,收到 %q", sid)
	case <-time.After(300 * time.Millisecond):
		// 期望路径:无回收
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
