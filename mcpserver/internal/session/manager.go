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
	pool                 *account.Pool
	wsURL                string
	httpC                *gamesdk.HTTPClient
	trust                bool // 信任模式(由 cfg 注入,GetOrCreate 传给 GameSession)
	maxReconnect         int
	maxBackoff           time.Duration // WS 慢速阶段退避上限
	heartbeatTimeout     time.Duration // WS pong 等待超时
	maxConsecutiveMisses int           // WS 连续 pong 超时容忍次数
	offlineQueueMax      int           // WS 离线队列上限
	idleTimeout          time.Duration // GameSession 空闲超时(0 表示不超时)

	mu       sync.RWMutex
	sessions map[string]*gamesdk.GameSession

	// preferred 是 MCP session ID → 首选账号 ID(sid) 的注册表,由 transport 层
	// 在请求带 X-Agent-Sid header 时登记(会话建立即钉号)。GetOrCreate 借号时
	// 优先按指名借用,保证同名 Agent 恒用同一账号。
	preferredMu sync.RWMutex
	preferred   map[string]string

	stopCleanup chan struct{} // 停止空闲清理 goroutine
	wg          sync.WaitGroup
}

// NewManager 创建会话管理器。
// idleTimeout: GameSession 空闲超时,0 表示不清理。
func NewManager(pool *account.Pool, httpC *gamesdk.HTTPClient, wsURL string, maxReconnect int) *Manager {
	m := &Manager{
		pool:                 pool,
		wsURL:                wsURL,
		httpC:                httpC,
		maxReconnect:         maxReconnect,
		maxBackoff:           5 * time.Minute,
		heartbeatTimeout:     10 * time.Second,
		maxConsecutiveMisses: 3,
		offlineQueueMax:      1000,
		sessions:             make(map[string]*gamesdk.GameSession),
		preferred:            make(map[string]string),
	}
	// 账户被回收(stale 懒回收 / 定期回收 / 运维强制释放)时,异步关闭对应
	// GameSession,避免新旧会话共用同一账户。Close 幂等且不依赖本锁。
	pool.SetOnRelease(func(sessionID string) {
		m.Close(sessionID)
	})
	return m
}

// SetTrustMode 设置信任模式(在 main 装配阶段从 cfg 注入,GetOrCreate 前调用)。
func (m *Manager) SetTrustMode(trust bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.trust = trust
}

// SetStabilityParams 配置 WSClient 稳定性参数(在 GetOrCreate 前调用)。
func (m *Manager) SetStabilityParams(maxBackoff, heartbeatTimeout time.Duration, offlineQueueMax, maxConsecutiveMisses int) {
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
	if maxConsecutiveMisses > 0 {
		m.maxConsecutiveMisses = maxConsecutiveMisses
	}
}

// SetIdleTimeout 设置 GameSession 空闲超时(0 表示不清理)。
// 必须在 StartCleanupLoop 前调用。
func (m *Manager) SetIdleTimeout(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.idleTimeout = d
}

// SetGameServer 运行时切换游戏后端的 HTTP 客户端与 WS 地址。
// 仅影响此后新建的 GameSession;已存在的会话保留各自的快照不受影响。
func (m *Manager) SetGameServer(httpC *gamesdk.HTTPClient, wsURL string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.httpC = httpC
	m.wsURL = wsURL
}

// GameServerURLs 返回当前生效的游戏后端 HTTP / WS 地址。
func (m *Manager) GameServerURLs() (apiURL, wsURL string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.httpC.BaseURL(), m.wsURL
}

// StartCleanupLoop 启动后台 goroutine 定期扫描并清理空闲 session 与 stale 账户租约。
// 必须在所有 GetOrCreate 调用前调用一次。
// 即使 idleTimeout 为 0 也会启动(仅执行账户池 stale 租约回收)。
func (m *Manager) StartCleanupLoop() {
	m.mu.Lock()
	if m.stopCleanup != nil {
		m.mu.Unlock()
		return // 已启动
	}
	m.stopCleanup = make(chan struct{})
	m.mu.Unlock()
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

// cleanupIdle 清理所有空闲超时的 session,并定期回收账户池中的 stale 租约。
func (m *Manager) cleanupIdle() {
	m.mu.RLock()
	idleTimeout := m.idleTimeout
	if idleTimeout <= 0 {
		m.mu.RUnlock()
		// 空闲清理关闭,但仍执行账户 stale 回收(账户池租约独立于会话空闲超时)
		m.pool.ReclaimStale()
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
	// 定期回收超过借用租约的账户(异常对局泄漏的兜底,无需重启 MCP Server)
	if n := m.pool.ReclaimStale(); n > 0 {
		log.Printf("账户池回收 %d 个 stale 租约", n)
	}
}

// SetPreferredAccount 登记 MCP session 的首选账号 ID(sid)。first-wins:
// 已登记且值不同 → 打 warning 拒绝覆盖(会话中途换 sid 不生效,防静默换号);
// 同值或未登记 → 写入。
func (m *Manager) SetPreferredAccount(mcpSessionID, accountID string) {
	m.preferredMu.Lock()
	defer m.preferredMu.Unlock()
	if prev, ok := m.preferred[mcpSessionID]; ok && prev != accountID {
		log.Printf("Session %s 首选账号 %q → %q 被拒绝(会话中途换 sid 不生效)", mcpSessionID, prev, accountID)
		return
	}
	m.preferred[mcpSessionID] = accountID
}

// PreferredAccount 返回 MCP session 登记的首选账号 ID;未登记返回空串。
func (m *Manager) PreferredAccount(mcpSessionID string) string {
	m.preferredMu.RLock()
	defer m.preferredMu.RUnlock()
	return m.preferred[mcpSessionID]
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
	maxConsecutiveMisses := m.maxConsecutiveMisses
	offlineQueueMax := m.offlineQueueMax
	httpC := m.httpC
	wsURL := m.wsURL
	trust := m.trust
	m.mu.RUnlock()

	acc, err := m.pool.BorrowPreferred(mcpSessionID, m.PreferredAccount(mcpSessionID))
	if err != nil {
		return nil, fmt.Errorf("借用账户失败: %w", err)
	}
	gs := gamesdk.NewGameSession(acc, httpC, wsURL, maxReconnect)
	gs.SetWSStabilityParams(maxBackoff, heartbeatTimeout, offlineQueueMax, maxConsecutiveMisses)
	gs.SetTrustMode(trust)
	// 握手确认(player:loginSuccess)解析出 PlayerID 后回写池,供后续展示/断言。
	// 钩子按会话绑定 acc,避免跨会话串货。
	gs.SetOnPlayerID(func(playerID string) { m.pool.AttachPlayerID(acc.ID, playerID) })

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

// Close 关闭指定 MCP session 对应的 GameSession 并归还账户,同时清理其首选账号注册。
func (m *Manager) Close(mcpSessionID string) {
	m.mu.Lock()
	gs, ok := m.sessions[mcpSessionID]
	if ok {
		delete(m.sessions, mcpSessionID)
	}
	m.mu.Unlock()
	// 清理首选账号注册表(防无限增长)
	m.preferredMu.Lock()
	delete(m.preferred, mcpSessionID)
	m.preferredMu.Unlock()
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

// HTTP 返回全局 HTTP 客户端（进程级共享，用于 stateless 回放拉取）。
func (m *Manager) HTTP() *gamesdk.HTTPClient {
	return m.httpC
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
