// Package session 管理 MCP 会话与 GameSession 的映射。
package session

import (
	"fmt"
	"log"
	"sync"
	"time"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/gamesdk"
)

// ManagerStats 是 Manager 的统计信息。
type ManagerStats struct {
	ActiveSessions int `json:"activeSessions"`
	PoolTotal      int `json:"poolTotal"`
	PoolAvailable  int `json:"poolAvailable"`
}

// Manager 维护 MCP session ID → GameSession 的映射,负责生命周期管理。
type Manager struct {
	pool        *account.Pool
	wsURL       string
	httpC       *gamesdk.HTTPClient
	maxReconnect int
	maxBackoff   time.Duration // WS 慢速阶段退避上限
	heartbeatTimeout time.Duration // WS pong 等待超时
	offlineQueueMax   int // WS 离线队列上限
	idleTimeout time.Duration // GameSession 空闲超时(0 表示不超时)

	mu       sync.RWMutex
	sessions map[string]*gamesdk.GameSession

	stopCleanup chan struct{} // 停止空闲清理 goroutine
	wg          sync.WaitGroup
}

// NewManager 创建会话管理器。
// idleTimeout: GameSession 空闲超时,0 表示不清理。
func NewManager(pool *account.Pool, httpC *gamesdk.HTTPClient, wsURL string, maxReconnect int) *Manager {
	return &Manager{
		pool:          pool,
		wsURL:         wsURL,
		httpC:         httpC,
		maxReconnect:  maxReconnect,
		maxBackoff:    5 * time.Minute,
		heartbeatTimeout: 10 * time.Second,
		offlineQueueMax: 1000,
		sessions:      make(map[string]*gamesdk.GameSession),
	}
}

// SetStabilityParams 配置 WSClient 稳定性参数(在 GetOrCreate 前调用)。
func (m *Manager) SetStabilityParams(maxBackoff, heartbeatTimeout time.Duration, offlineQueueMax int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if maxBackoff > 0 {
		m.maxBackoff = maxBackoff
	}
	if heartbeatTimeout > 0 {
		m.heartbeatTimeout = heartbeatTimeout
	}
	if offlineQueueMax > 0 {
		m.offlineQueueMax = offlineQueueMax
	}
}

// SetIdleTimeout 设置 GameSession 空闲超时(0 表示不清理)。
// 必须在 StartCleanupLoop 前调用。
func (m *Manager) SetIdleTimeout(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.idleTimeout = d
}

// StartCleanupLoop 启动后台 goroutine 定期扫描并清理空闲 session。
// 必须在所有 GetOrCreate 调用前调用一次。
func (m *Manager) StartCleanupLoop() {
	m.mu.Lock()
	if m.stopCleanup != nil {
		m.mu.Unlock()
		return // 已启动
	}
	m.stopCleanup = make(chan struct{})
	idleTimeout := m.idleTimeout
	m.mu.Unlock()
	if idleTimeout <= 0 {
		return
	}
	m.wg.Add(1)
	go m.cleanupLoop()
}

// cleanupLoop 每 60s 扫描一次所有 session,清理空闲超时的。
func (m *Manager) cleanupLoop() {
	defer m.wg.Done()
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stopCleanup:
			return
		case <-ticker.C:
			m.cleanupIdle()
		}
	}
}

// cleanupIdle 清理所有空闲超时的 session。
func (m *Manager) cleanupIdle() {
	m.mu.RLock()
	idleTimeout := m.idleTimeout
	if idleTimeout <= 0 {
		m.mu.RUnlock()
		return
	}
	now := time.Now()
	var toClose []string
	for sid, gs := range m.sessions {
		if now.Sub(gs.LastActivityAt()) > idleTimeout {
			toClose = append(toClose, sid)
		}
	}
	m.mu.RUnlock()
	for _, sid := range toClose {
		log.Printf("Session %s 空闲超时(%v),自动清理", sid, idleTimeout)
		m.Close(sid)
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
	maxReconnect := m.maxReconnect
	maxBackoff := m.maxBackoff
	heartbeatTimeout := m.heartbeatTimeout
	offlineQueueMax := m.offlineQueueMax
	m.mu.RUnlock()

	acc, err := m.pool.Borrow(mcpSessionID)
	if err != nil {
		return nil, fmt.Errorf("借用账户失败: %w", err)
	}
	gs := gamesdk.NewGameSession(acc, m.httpC, m.wsURL, maxReconnect)
	gs.SetWSStabilityParams(maxBackoff, heartbeatTimeout, offlineQueueMax)

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
	// 停止清理 goroutine
	m.mu.Lock()
	if m.stopCleanup != nil {
		close(m.stopCleanup)
		m.stopCleanup = nil
	}
	all := m.sessions
	m.sessions = make(map[string]*gamesdk.GameSession)
	m.mu.Unlock()
	for sid, gs := range all {
		gs.Close()
		_ = m.pool.Return(sid)
	}
	m.wg.Wait()
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

// Stats 返回 Manager 的统计信息。
func (m *Manager) Stats() ManagerStats {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return ManagerStats{
		ActiveSessions: len(m.sessions),
		PoolTotal:      len(m.pool.ListAll()),
		PoolAvailable:  m.pool.AvailableCount(),
	}
}

// GetConnState 返回指定 session 的 WS 连接状态。
// 不存在时返回 StateDisconnected。
func (m *Manager) GetConnState(mcpSessionID string) gamesdk.ConnState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	gs, ok := m.sessions[mcpSessionID]
	if !ok {
		return gamesdk.StateDisconnected
	}
	return gs.ConnState()
}
