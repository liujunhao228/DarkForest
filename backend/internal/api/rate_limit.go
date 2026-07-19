package api

import (
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ipRateLimiter 为每个客户端 IP 维护一个独立的令牌桶限流器
type ipRateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitorEntry
	rps      rate.Limit
	burst    int
	ttl      time.Duration // 空闲条目过期时间
}

type visitorEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func newIPRateLimiter(rps float64, burst int) *ipRateLimiter {
	rl := &ipRateLimiter{
		visitors: make(map[string]*visitorEntry),
		rps:      rate.Limit(rps),
		burst:    burst,
		ttl:      10 * time.Minute,
	}
	go rl.cleanup()
	return rl
}

func (rl *ipRateLimiter) getLimiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if v, ok := rl.visitors[ip]; ok {
		v.lastSeen = time.Now()
		return v.limiter
	}

	limiter := rate.NewLimiter(rl.rps, rl.burst)
	rl.visitors[ip] = &visitorEntry{limiter: limiter, lastSeen: time.Now()}
	return limiter
}

func (rl *ipRateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		for ip, v := range rl.visitors {
			if time.Since(v.lastSeen) > rl.ttl {
				delete(rl.visitors, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// extractClientIP 从请求中提取客户端真实 IP
// 信任 X-Real-IP(由前置代理如 Caddy 设置),其次 X-Forwarded-For 首段,最后 RemoteAddr
func extractClientIP(r *http.Request) string {
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if idx := strings.Index(xff, ","); idx >= 0 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// RateLimitMiddleware 返回按 IP 限流的中间件
// rps: 每秒允许的请求数; burst: 令牌桶容量(突发请求数)
// 超限的请求返回 HTTP 429 Too Many Requests
func RateLimitMiddleware(rps float64, burst int) Middleware {
	limiter := newIPRateLimiter(rps, burst)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := extractClientIP(r)
			if !limiter.getLimiter(ip).Allow() {
				w.Header().Set("Retry-After", "60")
				slog.Warn("rate limit exceeded",
					"ip", ip,
					"method", r.Method,
					"path", r.URL.Path,
				)
				WriteJSONError(w, "请求过于频繁,请稍后再试", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
