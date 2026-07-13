// Package session 管理 MCP 会话与 GameSession 的映射。
package session

import (
	"fmt"
	"sync"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/gamesdk"
)

// Manager 维护 MCP session ID → GameSession 的映射,负责生命周期管理。
type Manager struct {
	pool   *account.Pool
	wsURL  string
	httpC  *gamesdk.HTTPClient
	maxReconnect int

	mu       sync.RWMutex
	sessions map[string]*gamesdk.GameSession
}

// NewManager 创建会话管理器。
func NewManager(pool *account.Pool, httpC *gamesdk.HTTPClient, wsURL string, maxReconnect int) *Manager {
	return &Manager{
		pool:         pool,
		wsURL:        wsURL,
		httpC:        httpC,
		maxReconnect: maxReconnect,
		sessions:     make(map[string]*gamesdk.GameSession),
	}
}

// GetOrCreate 返回指定 MCP session 对应的 GameSession。
// 若不存在,则从账户池借用一个账户并创建(未连接,懒初始化在首次使用时触发)。
func (m *Manager) GetOrCreate(mcpSessionID string) (*gamesdk.GameSession, error) {
	m.mu.RLock()
	if gs, ok := m.sessions[mcpSessionID]; ok {
		m.mu.RUnlock()
		return gs, nil
	}
	m.mu.RUnlock()

	acc, err := m.pool.Borrow(mcpSessionID)
	if err != nil {
		return nil, fmt.Errorf("借用账户失败: %w", err)
	}
	gs := gamesdk.NewGameSession(acc, m.httpC, m.wsURL, m.maxReconnect)

	m.mu.Lock()
	// 检查并发竞态:可能另一个 goroutine 已创建
	if existing, ok := m.sessions[mcpSessionID]; ok {
		m.mu.Unlock()
		// 归还刚借的账户
		_ = m.pool.Return(mcpSessionID)
		return existing, nil
	}
	m.sessions[mcpSessionID] = gs
	m.mu.Unlock()
	return gs, nil
}

// Get 返回已存在的 GameSession,不创建新的。
func (m *Manager) Get(mcpSessionID string) (*gamesdk.GameSession, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	gs, ok := m.sessions[mcpSessionID]
	return gs, ok
}

// Close 关闭指定 MCP session 对应的 GameSession 并归还账户。
func (m *Manager) Close(mcpSessionID string) {
	m.mu.Lock()
	gs, ok := m.sessions[mcpSessionID]
	if ok {
		delete(m.sessions, mcpSessionID)
	}
	m.mu.Unlock()
	if ok {
		gs.Close()
		_ = m.pool.Return(mcpSessionID)
	}
}

// CloseAll 关闭所有会话并归还账户(用于优雅停机)。
func (m *Manager) CloseAll() {
	m.mu.Lock()
	all := m.sessions
	m.sessions = make(map[string]*gamesdk.GameSession)
	m.mu.Unlock()
	for sid, gs := range all {
		gs.Close()
		_ = m.pool.Return(sid)
	}
}

// ActiveSessions 返回当前活跃的 session ID 列表。
func (m *Manager) ActiveSessions() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]string, 0, len(m.sessions))
	for sid := range m.sessions {
		out = append(out, sid)
	}
	return out
}
