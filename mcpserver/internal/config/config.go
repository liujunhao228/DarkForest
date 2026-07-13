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
	SessionIdleTimeout int    // Agent 会话空闲超时(秒)
	WSReconnectMax     int    // WS 重连最大次数
}

// Load 从环境变量加载配置,缺失的给默认值。
func Load() (*Config, error) {
	cfg := &Config{
		GameAPIURL:         getEnv("GAME_API_URL", "http://localhost:8080"),
		GameWSURL:          getEnv("GAME_WS_URL", "ws://localhost:8080/ws"),
		MCPPort:            getEnv("MCP_PORT", "9090"),
		MCPEndpoint:        getEnv("MCP_ENDPOINT", "/mcp"),
		DBPath:             getEnv("DB_PATH", "./data/mcpserver.db"),
		AdminToken:         getEnv("ADMIN_TOKEN", ""),
		SessionIdleTimeout: getEnvInt("SESSION_IDLE_TIMEOUT", 300),
		WSReconnectMax:     getEnvInt("WS_RECONNECT_MAX", 5),
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
