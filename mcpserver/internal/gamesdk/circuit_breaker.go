package gamesdk

import (
	"sync"
	"time"
)

// CircuitState 表示熔断器状态。
type CircuitState int

const (
	// CircuitClosed 闭合:正常放行所有请求。
	CircuitClosed CircuitState = iota
	// CircuitOpen 开启:拒绝所有请求,等待冷却期。
	CircuitOpen
	// CircuitHalfOpen 半开:允许单个探测请求,成功则闭合,失败则重新开启。
	CircuitHalfOpen
)

// String 返回状态的字符串表示。
func (s CircuitState) String() string {
	switch s {
	case CircuitOpen:
		return "open"
	case CircuitHalfOpen:
		return "halfOpen"
	default:
		return "closed"
	}
}

// CircuitBreaker 是简单的熔断器实现。
// 当连续失败次数达到阈值时打开;冷却期过后进入半开状态;
// 半开状态下单个探测请求成功则闭合,失败则重新打开。
type CircuitBreaker struct {
	mu         sync.Mutex
	state      CircuitState
	failures   int       // 连续失败计数(闭合状态下)
	threshold  int       // 打开阈值
	cooldown   time.Duration // 冷却时长
	openedAt   time.Time // 进入 Open 状态的时间
	halfOpenInflight bool // 半开状态下是否已有探测请求在途
}

// NewCircuitBreaker 创建熔断器。
// threshold: 连续失败次数阈值;cooldown: 冷却时长。
func NewCircuitBreaker(threshold int, cooldown time.Duration) *CircuitBreaker {
	if threshold <= 0 {
		threshold = 10
	}
	if cooldown <= 0 {
		cooldown = 30 * time.Second
	}
	return &CircuitBreaker{
		state:     CircuitClosed,
		threshold: threshold,
		cooldown:  cooldown,
	}
}

// Allow 检查是否允许请求通过。
// 返回 true 表示允许;false 表示熔断中。
// 在 HalfOpen 状态下,只允许 1 个探测请求。
func (c *CircuitBreaker) Allow() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch c.state {
	case CircuitClosed:
		return true
	case CircuitOpen:
		// 检查是否已过冷却期
		if time.Since(c.openedAt) >= c.cooldown {
			c.state = CircuitHalfOpen
			c.halfOpenInflight = true
			return true
		}
		return false
	case CircuitHalfOpen:
		// 半开状态下只允许 1 个探测请求
		if c.halfOpenInflight {
			return false
		}
		c.halfOpenInflight = true
		return true
	}
	return true
}

// RecordSuccess 记录一次成功请求。
// 闭合状态下重置失败计数;半开状态下转为闭合。
func (c *CircuitBreaker) RecordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failures = 0
	if c.state == CircuitHalfOpen {
		c.state = CircuitClosed
		c.halfOpenInflight = false
	}
}

// RecordFailure 记录一次失败请求。
// 闭合状态下增加失败计数,达到阈值则打开;半开状态下重新打开。
func (c *CircuitBreaker) RecordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch c.state {
	case CircuitClosed:
		c.failures++
		if c.failures >= c.threshold {
			c.state = CircuitOpen
			c.openedAt = time.Now()
		}
	case CircuitHalfOpen:
		// 探测失败,重新打开
		c.state = CircuitOpen
		c.openedAt = time.Now()
		c.halfOpenInflight = false
	}
}

// State 返回当前熔断状态(线程安全)。
func (c *CircuitBreaker) State() CircuitState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// Failures 返回当前连续失败次数(线程安全)。
func (c *CircuitBreaker) Failures() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.failures
}
