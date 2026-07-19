package config

import (
	"os"
	"strings"
)

// Config holds application configuration
type Config struct {
	Port           string
	AllowedOrigins []string
	Environment    string
}

// Load reads configuration from environment variables
func Load() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// 先读取环境变量,用于决定 CORS 默认值
	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		env = "development"
	}

	// Support both CORS_ALLOW_ORIGINS and ALLOWED_ORIGINS for backward compatibility
	allowedOriginsStr := os.Getenv("CORS_ALLOW_ORIGINS")
	if allowedOriginsStr == "" {
		allowedOriginsStr = os.Getenv("ALLOWED_ORIGINS")
	}
	var allowedOrigins []string
	if allowedOriginsStr == "" {
		if env == "production" {
			// 生产环境:同源部署,不放行任何跨域源(最安全)
			allowedOrigins = []string{}
		} else {
			// 开发环境:默认放行所有源(Vite dev server 跨域访问后端)
			allowedOrigins = []string{"*"}
		}
	} else {
		allowedOrigins = strings.Split(allowedOriginsStr, ",")
		for i, origin := range allowedOrigins {
			allowedOrigins[i] = strings.TrimSpace(origin)
		}
	}

	return &Config{
		Port:           port,
		AllowedOrigins: allowedOrigins,
		Environment:    env,
	}
}

// IsDevelopment returns true if running in development mode
func (c *Config) IsDevelopment() bool {
	return c.Environment == "development"
}

// IsProduction returns true if running in production mode
func (c *Config) IsProduction() bool {
	return c.Environment == "production"
}
