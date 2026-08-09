package account

import (
	"errors"
	"fmt"
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
			_ = p.store.UpdateAccountStatus(a.ID, StatusAvailable, "")
		}
		p.accounts[a.ID] = a
	}
	return nil
}

// Borrow 从池中借一个 available 账户给指定 sessionID。
// 若 token 已过期,自动重新 login 刷新。
func (p *Pool) Borrow(sessionID string) (*Account, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, a := range p.accounts {
		if a.Status == StatusAvailable {
			a.Status = StatusInUse
			a.AssignedTo = sessionID
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
	}
	return nil, ErrNoAvailableAccount
}

// Return 归还指定 sessionID 借用的账户。
func (p *Pool) Return(sessionID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, a := range p.accounts {
		if a.AssignedTo == sessionID {
			a.Status = StatusAvailable
			a.AssignedTo = ""
			_ = p.store.UpdateAccountStatus(a.ID, StatusAvailable, "")
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
// 返回实际新增的 agent 数;已存在的条目跳过,不重复计数。
func (p *Pool) ApplySeed(names []string) (int, error) {
	added := 0
	for _, raw := range names {
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
