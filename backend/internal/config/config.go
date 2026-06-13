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

	// Support both CORS_ALLOW_ORIGINS and ALLOWED_ORIGINS for backward compatibility
	allowedOriginsStr := os.Getenv("CORS_ALLOW_ORIGINS")
	if allowedOriginsStr == "" {
		allowedOriginsStr = os.Getenv("ALLOWED_ORIGINS")
	}
	var allowedOrigins []string
	if allowedOriginsStr == "" {
		// Default to allow all origins in development
		allowedOrigins = []string{"*"}
	} else {
		allowedOrigins = strings.Split(allowedOriginsStr, ",")
		for i, origin := range allowedOrigins {
			allowedOrigins[i] = strings.TrimSpace(origin)
		}
	}

	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		env = "development"
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
