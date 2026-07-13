package account

import (
	"errors"
	"fmt"
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
	mu        sync.Mutex
	accounts  map[string]*Account // id → Account(内存缓存)
}

// NewPool 创建账户池。registrar 可为 nil(仅在不需注册/登录时)。
func NewPool(store *persistence.AccountStore, registrar AccountRegistrar) *Pool {
	return &Pool{
		store:     store,
		registrar: registrar,
		accounts:  make(map[string]*Account),
	}
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
