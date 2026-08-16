package db

import (
	"context"
	"database/sql"
	"testing"

	"github.com/darkforest/backend/internal/db/dbtest"
)

func TestHealthCheckWithoutPool(t *testing.T) {
	// DB should be nil before initialization
	DB = nil

	ctx := context.Background()
	err := HealthCheck(ctx)
	if err == nil {
		t.Error("Expected error when DB is nil")
	}
}

func TestPingWithoutPool(t *testing.T) {
	// DB should be nil before initialization
	DB = nil

	ctx := context.Background()
	err := Ping(ctx)
	if err == nil {
		t.Error("Expected error when DB is nil")
	}
}

// setupMigrationTestDB 打开临时 SQLite 测试库并应用完整迁移（合并后的 000001 schema）。
func setupMigrationTestDB(t *testing.T) *sql.DB {
	t.Helper()
	return dbtest.Open(t)
}
