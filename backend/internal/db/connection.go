package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	DB   *sql.DB
	once sync.Once
)

// Initialize 打开 SQLite 数据库（DATABASE_URL 形如 sqlite://path/to/db）。
// file: DSN + pragma：busy_timeout(5s) 防写锁冲突、WAL 提升并发读、foreign_keys 启用外键约束。
func Initialize() error {
	var initErr error
	once.Do(func() {
		dbURL := os.Getenv("DATABASE_URL")
		if dbURL == "" {
			dbURL = "sqlite://darkforest.db"
		}

		dsn := strings.TrimPrefix(dbURL, "sqlite://")
		if dsn == dbURL {
			initErr = fmt.Errorf("DATABASE_URL must start with sqlite://: %s", dbURL)
			return
		}

		db, err := sql.Open("sqlite", "file:"+dsn+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)")
		if err != nil {
			initErr = fmt.Errorf("failed to open sqlite database: %w", err)
			return
		}

		db.SetMaxOpenConns(10)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := db.PingContext(ctx); err != nil {
			initErr = fmt.Errorf("failed to ping database: %w", err)
			db.Close()
			return
		}

		DB = db
	})

	return initErr
}

func GetDB() *sql.DB {
	return DB
}

func GetQueries() *Queries {
	if DB == nil {
		return nil
	}
	return New(DB)
}

func Ping(ctx context.Context) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	return DB.PingContext(ctx)
}

func HealthCheck(ctx context.Context) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	return DB.PingContext(ctx)
}

func Close() {
	if DB != nil {
		DB.Close()
		DB = nil
	}
}
