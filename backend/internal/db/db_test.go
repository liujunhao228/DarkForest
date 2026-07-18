package db

import (
	"context"
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	config := DefaultConfig()

	if config.MaxConns != 25 {
		t.Errorf("Expected MaxConns=25, got %d", config.MaxConns)
	}

	if config.MinConns != 5 {
		t.Errorf("Expected MinConns=5, got %d", config.MinConns)
	}

	if config.MaxConnLifetime != 5*time.Minute {
		t.Errorf("Expected MaxConnLifetime=5m, got %v", config.MaxConnLifetime)
	}
}

func TestHealthCheckWithoutPool(t *testing.T) {
	// Pool should be nil before initialization
	Pool = nil

	ctx := context.Background()
	err := HealthCheck(ctx)
	if err == nil {
		t.Error("Expected error when pool is nil")
	}
}

func TestPingWithoutPool(t *testing.T) {
	// Pool should be nil before initialization
	Pool = nil

	ctx := context.Background()
	err := Ping(ctx)
	if err == nil {
		t.Error("Expected error when pool is nil")
	}
}

func TestGetStatsWithoutPool(t *testing.T) {
	// Pool should be nil before initialization
	Pool = nil

	stats := GetStats()
	if stats != nil {
		t.Error("Expected nil stats when pool is nil")
	}
}
