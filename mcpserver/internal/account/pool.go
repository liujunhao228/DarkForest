package account

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"darkforest/mcpserver/internal/persistence"
	"github.com/google/uuid"
)

// ErrNoAvailableAccount 表示池中没有可借用的账户。
var ErrNoAvailableAccount = errors.New("账户池中没有可用账户")

// ErrAccountNotFound 表示指定会话未借用账户。
var ErrAccountNotFound = errors.New("该会话未借用任何账户")

// Pool 管理账户池的借用/归还/注册,线程安全。
type Pool struct {
	store     *persistence.AccountStore
	registrar AccountRegistrar
	trustMode bool // 本地信任模式:池收敛为 agent 名单,Borrow 纯簿记零网络
	// borrowLease 是账户借用租约时长。超过租约仍未归还的 in_use 账户视为
	// "stale"(异常会话泄漏),会在无可用账户时被懒回收、或由 Manager 定期回收。
	// 0 表示禁用 stale 回收(严格模式,借用后必须显式归还)。
	borrowLease time.Duration
	// onRelease 是账户被回收(懒回收/定期回收/运维强制释放)时通知的回调,
	// 由 Manager 注入用于关闭对应的 GameSession,避免新旧会话共用同一账户。
	// 回调必须异步触发(持锁期间只收集,不调用)。
	onRelease func(sessionID string)
	mu        sync.Mutex
	accounts  map[string]*Account // id → Account(内存缓存)
}

// NewPool 创建账户池。registrar 可为 nil(仅在不需注册/登录时,trust 模式必为 nil)。
func NewPool(store *persistence.AccountStore, registrar AccountRegistrar, trustMode bool) *Pool {
	return &Pool{
		store:     store,
		registrar: registrar,
		trustMode: trustMode,
		accounts:  make(map[string]*Account),
	}
}

// SetBorrowLease 设置账户借用租约时长。d<=0 表示禁用 stale 回收。
// 必须在首次 Borrow 前调用。
func (p *Pool) SetBorrowLease(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.borrowLease = d
}

// SetOnRelease 注册"账户被回收"回调(Manager 用它关闭对应 GameSession)。
// 回调在持锁路径外异步触发,不会引入锁顺序反转。
func (p *Pool) SetOnRelease(cb func(sessionID string)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onRelease = cb
}

// notifyRelease 异步通知回收回调(不阻塞、不持锁)。
func (p *Pool) notifyRelease(sessionID string) {
	if p.onRelease != nil && sessionID != "" {
		go p.onRelease(sessionID)
	}
}

// IsTrustMode 返回当前是否处于本地信任模式。
func (p *Pool) IsTrustMode() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.trustMode
}

// SetRegistrar 替换 registrar(用于运行时切换游戏服务器后,让后续注册/登录走新后端)。
func (p *Pool) SetRegistrar(r AccountRegistrar) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.registrar = r
}

// LoadFromDB 从 SQLite 加载所有账户到内存。
func (p *Pool) LoadFromDB() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	rows, err := p.store.ListAll()
	if err != nil {
		return fmt.Errorf("加载账户: %w", err)
	}
	p.accounts = make(map[string]*Account, len(rows))
	for _, r := range rows {
		a := rowToAccount(r)
		// 启动时,所有 in_use 账户重置为 available(上次未正常归还)
		if a.Status == StatusInUse {
			a.Status = StatusAvailable
			a.AssignedTo = ""
			a.BorrowedAt = time.Time{}
			_ = p.store.UpdateAccountStatus(a.ID, StatusAvailable, "")
		}
		p.accounts[a.ID] = a
	}
	return nil
}

// Borrow 从池中借一个 available 账户给指定 sessionID。
// 若 token 已过期,自动重新 login 刷新。
// 保序:候选账户按 id 字母序取第一个 available,避免 Go map 遍历乱序
// 导致跨运行借出席位不稳定(确定性要求)。
// 放宽策略:若池中无 available 账户且启用了借用租约,则懒回收最旧的 stale
// 账户(借用超过租约时长、疑似异常会话泄漏),回收后借给本次调用,使异常
// 对局不再需要重启 MCP Server 才能恢复账户。
func (p *Pool) Borrow(sessionID string) (*Account, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	ids := make([]string, 0, len(p.accounts))
	for id, a := range p.accounts {
		if a.Status == StatusAvailable {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		return p.borrowLocked(id, sessionID)
	}
	// 无可用账户:尝试懒回收最旧的 stale 租约。
	if released := p.reclaimOldestStaleLocked(); released.sessionID != "" {
		p.notifyRelease(released.sessionID)
		return p.borrowLocked(released.accountID, sessionID)
	}
	return nil, ErrNoAvailableAccount
}

// borrowLocked 将指定账户标记为 in_use 并返回(调用方须持 p.mu)。
func (p *Pool) borrowLocked(id, sessionID string) (*Account, error) {
	a := p.accounts[id]
	a.Status = StatusInUse
	a.AssignedTo = sessionID
	a.BorrowedAt = time.Now()
	_ = p.store.UpdateAccountStatus(a.ID, StatusInUse, sessionID)
	// 解锁后检查 token(可能触发 HTTP 调用)
	// 为保持锁简单,这里在锁内做 token 刷新(HTTP 调用较短)
	if p.registrar != nil && !a.TokenExpiry.IsZero() && time.Now().After(a.TokenExpiry.Add(-time.Minute)) {
		if refreshed, err := p.registrar.Login(a.DisplayName, a.Password); err == nil {
			a.Token = refreshed.Token
			a.TokenExpiry = refreshed.ExpiresAt
			_ = p.store.UpdateToken(a.ID, a.Token, a.TokenExpiry.Unix())
		}
	}
	return a, nil
}

// staleAccount 描述一个被回收的 stale 账户(账户 ID 与其原借用会话)。
type staleAccount struct {
	accountID string
	sessionID string
}

// reclaimOldestStaleLocked 回收借用时间最久的 stale 账户;
// 无 stale 时返回零值。调用方须持 p.mu。
func (p *Pool) reclaimOldestStaleLocked() staleAccount {
	if p.borrowLease <= 0 {
		return staleAccount{}
	}
	now := time.Now()
	var stale []*Account
	for _, a := range p.accounts {
		if a.Status == StatusInUse && !a.BorrowedAt.IsZero() && now.Sub(a.BorrowedAt) > p.borrowLease {
			stale = append(stale, a)
		}
	}
	if len(stale) == 0 {
		return staleAccount{}
	}
	// 优先回收借用最久的
	sort.Slice(stale, func(i, j int) bool { return stale[i].BorrowedAt.Before(stale[j].BorrowedAt) })
	a := stale[0]
	sid := a.AssignedTo
	p.releaseLocked(a)
	return staleAccount{accountID: a.ID, sessionID: sid}
}

// ReclaimStale 在池耗尽(无可用账户)时回收所有超过借用租约的 stale 账户,
// 返回回收数,并异步通知 Manager 关闭对应 GameSession。
// 仅在池耗尽时回收:若池中仍有可用账户,新借用可直接取用,不必打扰仍在
// 使用中的(可能正常但超长)会话。由 Manager 清理循环定期调用,使异常泄漏
// 的账户无需重启即可回到可用池。
func (p *Pool) ReclaimStale() int {
	if p.borrowLease <= 0 {
		return 0
	}
	p.mu.Lock()
	// 池未耗尽:不回收,避免误杀仍在使用中的超长会话
	hasAvailable := false
	for _, a := range p.accounts {
		if a.Status == StatusAvailable {
			hasAvailable = true
			break
		}
	}
	if hasAvailable {
		p.mu.Unlock()
		return 0
	}
	now := time.Now()
	var reclaimed []*Account
	for _, a := range p.accounts {
		if a.Status == StatusInUse && !a.BorrowedAt.IsZero() && now.Sub(a.BorrowedAt) > p.borrowLease {
			reclaimed = append(reclaimed, a)
		}
	}
	sessionIDs := make([]string, 0, len(reclaimed))
	for _, a := range reclaimed {
		sid := a.AssignedTo
		p.releaseLocked(a)
		sessionIDs = append(sessionIDs, sid)
	}
	p.mu.Unlock()
	for _, sid := range sessionIDs {
		p.notifyRelease(sid)
	}
	return len(sessionIDs)
}

// ForceRelease 强制释放指定 sessionID 借用的账户(运维手段,幂等)。
// 不存在的 session 返回 ErrAccountNotFound。
func (p *Pool) ForceRelease(sessionID string) error {
	p.mu.Lock()
	var sid string
	for _, a := range p.accounts {
		if a.AssignedTo == sessionID {
			p.releaseLocked(a)
			sid = sessionID
			break
		}
	}
	p.mu.Unlock()
	if sid == "" {
		return ErrAccountNotFound
	}
	p.notifyRelease(sid)
	return nil
}

// ForceReleaseAll 强制释放所有 in_use 账户(运维手段),返回释放数量。
// 用于异常对局导致账户集体泄漏时快速恢复,无需重启 MCP Server。
func (p *Pool) ForceReleaseAll() int {
	p.mu.Lock()
	var released []string
	for _, a := range p.accounts {
		if a.Status == StatusInUse {
			sid := a.AssignedTo
			p.releaseLocked(a)
			released = append(released, sid)
		}
	}
	p.mu.Unlock()
	for _, sid := range released {
		p.notifyRelease(sid)
	}
	return len(released)
}

// releaseLocked 将账户置回 available(调用方须持 p.mu,不触发回调)。
func (p *Pool) releaseLocked(a *Account) {
	a.Status = StatusAvailable
	a.AssignedTo = ""
	a.BorrowedAt = time.Time{}
	_ = p.store.UpdateAccountStatus(a.ID, StatusAvailable, "")
}

// Return 归还指定 sessionID 借用的账户。
func (p *Pool) Return(sessionID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, a := range p.accounts {
		if a.AssignedTo == sessionID {
			p.releaseLocked(a)
			return nil
		}
	}
	return ErrAccountNotFound
}

// GetBySession 返回指定 sessionID 当前借用的账户(不归还)。
func (p *Pool) GetBySession(sessionID string) (*Account, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, a := range p.accounts {
		if a.AssignedTo == sessionID {
			return a, true
		}
	}
	return nil, false
}

// AddAgent 将 sid 加入 agent 名单(幂等)。id 固定为 "agent:"+sid;
// name 为空时回退 "AI-"+sid;同名 agent 二次调用仅更新昵称(若显式提供)。
func (p *Pool) AddAgent(sid, name string) (*Account, error) {
	if strings.TrimSpace(sid) == "" {
		return nil, errors.New("sid 不能为空")
	}
	id := "agent:" + sid
	if name == "" {
		name = "AI-" + sid
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if a, ok := p.accounts[id]; ok {
		// 幂等:二次调用不新增,仅当显式提供非空 name 时更新昵称并落库。
		if name != "" && a.DisplayName != name {
			a.DisplayName = name
			_ = p.store.UpsertAccount(accountToRow(a))
		}
		return a, nil
	}
	a := &Account{
		ID:          id,
		DisplayName: name,
		Role:        "player",
		Status:      StatusAvailable,
		CreatedAt:   time.Now(),
	}
	if err := p.store.UpsertAccount(accountToRow(a)); err != nil {
		return nil, err
	}
	p.accounts[id] = a
	return a, nil
}

// ApplySeed 幂等批量播种 agent 名单,支持 "sid" 或 "sid:昵称"(昵称可空)。
// 先对 names 排序保证播种顺序确定(与 Borrow 字母序借出对齐)。
// 返回实际新增的 agent 数;已存在的条目跳过,不重复计数。
func (p *Pool) ApplySeed(names []string) (int, error) {
	sorted := append([]string(nil), names...)
	sort.Strings(sorted)
	added := 0
	for _, raw := range sorted {
		entry := strings.TrimSpace(raw)
		if entry == "" {
			continue
		}
		sid, name := entry, ""
		if idx := strings.Index(entry, ":"); idx >= 0 {
			sid = strings.TrimSpace(entry[:idx])
			name = strings.TrimSpace(entry[idx+1:])
		}
		if sid == "" {
			continue
		}
		if p.GetByUserID("agent:"+sid) != nil {
			continue // 已存在:幂等跳过
		}
		if _, err := p.AddAgent(sid, name); err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

// AgentCount 返回名单中的账户总数。
func (p *Pool) AgentCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.accounts)
}

// GetByUserID 按 user_id(即 id 键)直接查询账户,不存在返回 nil。
func (p *Pool) GetByUserID(userID string) *Account {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.accounts[userID]
}

// AttachPlayerID 将后端握手后回填的玩家 UUID 写回名单(best-effort)。
// 持久化经 store.UpsertAccount(player_id 覆盖),失败静默吞掉。
func (p *Pool) AttachPlayerID(userID, playerID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	a, ok := p.accounts[userID]
	if !ok {
		return
	}
	a.PlayerID = playerID
	_ = p.store.UpsertAccount(accountToRow(a))
}

// Register 注册一个新账户并加入池。inviteCode 为空时用 adminToken 自动生成邀请码。
func (p *Pool) Register(displayName, password, inviteCode, adminToken string) (*Account, error) {
	if p.registrar == nil {
		return nil, errors.New("未配置 registrar,无法注册")
	}
	if inviteCode == "" {
		if adminToken == "" {
			return nil, errors.New("inviteCode 和 adminToken 至少提供一个")
		}
		code, err := p.registrar.CreateInvite(adminToken)
		if err != nil {
			return nil, fmt.Errorf("生成邀请码: %w", err)
		}
		inviteCode = code
	}
	if displayName == "" {
		displayName = "Bot_" + uuid.NewString()[:8]
	}
	if password == "" {
		password = uuid.NewString()[:16]
	}
	result, err := p.registrar.Register(displayName, password, inviteCode)
	if err != nil {
		return nil, fmt.Errorf("注册账户: %w", err)
	}
	a := &Account{
		ID:          result.PlayerID,
		DisplayName: result.DisplayName,
		Password:    password,
		Token:       result.Token,
		TokenExpiry: result.ExpiresAt,
		PlayerID:    result.PlayerID,
		Role:        result.Role,
		Status:      StatusAvailable,
		CreatedAt:   time.Now(),
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.store.UpsertAccount(accountToRow(a)); err != nil {
		return nil, err
	}
	p.accounts[a.ID] = a
	return a, nil
}

// AddExisting 将一个已注册账号加入池:通过 Login 校验凭据可用,
// 校验通过后把 token + 密码落库。若账号已在池中,则刷新其 token 与密码。
// 用于接入预先手工注册的账号(区别于 Register 创建新账号)。
func (p *Pool) AddExisting(displayName, password string) (*Account, error) {
	if p.registrar == nil {
		return nil, errors.New("未配置 registrar,无法登录校验")
	}
	if displayName == "" || password == "" {
		return nil, errors.New("displayName 和 password 必填")
	}
	result, err := p.registrar.Login(displayName, password)
	if err != nil {
		return nil, fmt.Errorf("登录校验失败: %w", err)
	}
	a := &Account{
		ID:          result.PlayerID,
		DisplayName: result.DisplayName,
		Password:    password,
		Token:       result.Token,
		TokenExpiry: result.ExpiresAt,
		PlayerID:    result.PlayerID,
		Role:        result.Role,
		Status:      StatusAvailable,
		CreatedAt:   time.Now(),
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	// 若已存在(同 id),UpsertAccount 会刷新 token/password/status;
	// 已被借用的账号重置为 available,与 LoadFromDB 启动恢复语义一致。
	if err := p.store.UpsertAccount(accountToRow(a)); err != nil {
		return nil, err
	}
	p.accounts[a.ID] = a
	return a, nil
}

// ListAll 返回所有账户的快照(只读)。
func (p *Pool) ListAll() []*Account {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]*Account, 0, len(p.accounts))
	for _, a := range p.accounts {
		cp := *a
		out = append(out, &cp)
	}
	return out
}

// AvailableCount 返回当前可借用的账户数。
func (p *Pool) AvailableCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, a := range p.accounts {
		if a.Status == StatusAvailable {
			n++
		}
	}
	return n
}

func rowToAccount(r persistence.AccountRow) *Account {
	a := &Account{
		ID:          r.ID,
		DisplayName: r.DisplayName,
		Password:    r.Password,
		Token:       r.Token,
		PlayerID:    r.PlayerID,
		Role:        r.Role,
		Status:      r.Status,
		AssignedTo:  r.AssignedTo,
	}
	if r.TokenExpiry > 0 {
		a.TokenExpiry = time.Unix(r.TokenExpiry, 0)
	}
	if r.CreatedAt > 0 {
		a.CreatedAt = time.Unix(r.CreatedAt, 0)
	}
	return a
}

func accountToRow(a *Account) persistence.AccountRow {
	r := persistence.AccountRow{
		ID:          a.ID,
		DisplayName: a.DisplayName,
		Password:    a.Password,
		Token:       a.Token,
		PlayerID:    a.PlayerID,
		Role:        a.Role,
		Status:      a.Status,
		AssignedTo:  a.AssignedTo,
		CreatedAt:   a.CreatedAt.Unix(),
	}
	if !a.TokenExpiry.IsZero() {
		r.TokenExpiry = a.TokenExpiry.Unix()
	}
	return r
}
