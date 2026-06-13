package db

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	Pool   *pgxpool.Pool
	once   sync.Once
	config *pgxpool.Config
)

type Config struct {
	MaxConns        int32
	MinConns        int32
	MaxConnLifetime time.Duration
	MaxConnIdleTime time.Duration
}

func DefaultConfig() *Config {
	return &Config{
		MaxConns:        25,
		MinConns:        5,
		MaxConnLifetime: 5 * time.Minute,
		MaxConnIdleTime: 30 * time.Second,
	}
}

func Initialize() error {
	var initErr error
	once.Do(func() {
		dbURL := os.Getenv("DATABASE_URL")
		if dbURL == "" {
			dbURL = "postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable"
		}

		cfg, err := pgxpool.ParseConfig(dbURL)
		if err != nil {
			initErr = fmt.Errorf("failed to parse DATABASE_URL: %w", err)
			return
		}

		defaultCfg := DefaultConfig()
		cfg.MaxConns = defaultCfg.MaxConns
		cfg.MinConns = defaultCfg.MinConns
		cfg.MaxConnLifetime = defaultCfg.MaxConnLifetime
		cfg.MaxConnIdleTime = defaultCfg.MaxConnIdleTime

		Pool, err = pgxpool.NewWithConfig(context.Background(), cfg)
		if err != nil {
			initErr = fmt.Errorf("failed to create connection pool: %w", err)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := Pool.Ping(ctx); err != nil {
			initErr = fmt.Errorf("failed to ping database: %w", err)
			Pool.Close()
			Pool = nil
			return
		}

		config = cfg
	})

	return initErr
}

func GetPool() *pgxpool.Pool {
	return Pool
}

func GetQueries() *Queries {
	if Pool == nil {
		return nil
	}
	return New(Pool)
}

func Ping(ctx context.Context) error {
	if Pool == nil {
		return fmt.Errorf("connection pool not initialized")
	}
	return Pool.Ping(ctx)
}

func HealthCheck(ctx context.Context) error {
	if Pool == nil {
		return fmt.Errorf("connection pool not initialized")
	}
	return Pool.Ping(ctx)
}

func GetStats() *pgxpool.Stat {
	if Pool == nil {
		return nil
	}
	return Pool.Stat()
}

func Close() {
	if Pool != nil {
		Pool.Close()
		Pool = nil
	}
}
