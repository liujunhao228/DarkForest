// Package config 加载 MCP Server 的环境变量配置。
package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config 持有 MCP Server 的运行时配置。
type Config struct {
	GameAPIURL         string // 游戏后端 HTTP 基址
	GameWSURL          string // 游戏后端 WebSocket 地址
	MCPPort            string // MCP Server 监听端口
	MCPEndpoint        string // Streamable HTTP 端点路径
	DBPath             string // SQLite 文件路径
	AdminToken         string // 游戏后端 admin JWT(预注册账户用)
	SessionIdleTimeout int    // Agent 会话空闲超时(秒);Manager 后台扫描清理
	WSReconnectMax     int    // WS 快速重连阶段次数(超过后进入慢速无限重试)

	// WS 稳定性
	WSHeartbeatTimeout    int // pong 等待超时秒数;超过则主动断开触发重连
	WSReconnectMaxBackoff int // 慢速阶段重连退避上限秒数
	WSOfflineQueueMax     int // 离线发送队列上限(条数);满时丢弃最旧

	// HTTP 稳定性
	HTTPRetryMax                int // HTTP 请求最大重试次数(网络错误与 5xx)
	HTTPCircuitBreakerThreshold int // 熔断阈值(连续失败次数)
	HTTPCircuitBreakerCooldown  int // 熔断冷却秒数

	// MCP 会话
	MCPSessionTimeout int // MCP SDK session 空闲超时秒数(0 表示不超时)
}

// Load 从环境变量加载配置,缺失的给默认值。
func Load() (*Config, error) {
	cfg := &Config{
		GameAPIURL:                  getEnv("GAME_API_URL", "http://localhost:8080"),
		GameWSURL:                   getEnv("GAME_WS_URL", "ws://localhost:8080/ws"),
		MCPPort:                     getEnv("MCP_PORT", "9090"),
		MCPEndpoint:                 getEnv("MCP_ENDPOINT", "/mcp"),
		DBPath:                      getEnv("DB_PATH", "./data/mcpserver.db"),
		AdminToken:                  getEnv("ADMIN_TOKEN", ""),
		SessionIdleTimeout:          getEnvInt("SESSION_IDLE_TIMEOUT", 300),
		WSReconnectMax:              getEnvInt("WS_RECONNECT_MAX", 5),
		WSHeartbeatTimeout:          getEnvInt("WS_HEARTBEAT_TIMEOUT", 10),
		WSReconnectMaxBackoff:       getEnvInt("WS_RECONNECT_MAX_BACKOFF", 300),
		WSOfflineQueueMax:           getEnvInt("WS_OFFLINE_QUEUE_MAX", 1000),
		HTTPRetryMax:                getEnvInt("HTTP_RETRY_MAX", 3),
		HTTPCircuitBreakerThreshold: getEnvInt("HTTP_CIRCUIT_BREAKER_THRESHOLD", 10),
		HTTPCircuitBreakerCooldown:  getEnvInt("HTTP_CIRCUIT_BREAKER_COOLDOWN", 30),
		MCPSessionTimeout:           getEnvInt("MCP_SESSION_TIMEOUT", 1800),
	}
	if cfg.GameAPIURL == "" {
		return nil, fmt.Errorf("GAME_API_URL 不能为空")
	}
	if cfg.GameWSURL == "" {
		return nil, fmt.Errorf("GAME_WS_URL 不能为空")
	}
	return cfg, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
