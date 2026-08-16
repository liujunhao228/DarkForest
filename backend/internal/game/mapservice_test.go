package game

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"testing"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/db/dbtest"
)

// testMapDB 为本测试文件持有的独立 SQLite 库（不污染 db.DB 全局状态）。
var testMapDB *sql.DB

// setupTestMapDB 打开临时 SQLite 测试库并应用迁移。
func setupTestMapDB(t *testing.T) *db.Queries {
	t.Helper()

	if testMapDB != nil {
		return db.New(testMapDB)
	}

	sqlDB := dbtest.Open(t)
	testMapDB = sqlDB
	t.Cleanup(func() { testMapDB = nil })
	return db.New(sqlDB)
}

// TestMapService_SeedIfAbsent_Idempotent 验证 SeedIfAbsent 幂等：
// 调用两次不报错，且官方地图 slug=classic-9 存在。
func TestMapService_SeedIfAbsent_Idempotent(t *testing.T) {
	queries := setupTestMapDB(t)
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	svc := NewMapService(queries, logger)
	ctx := context.Background()

	if err := svc.SeedIfAbsent(ctx); err != nil {
		t.Fatalf("第一次 SeedIfAbsent 失败: %v", err)
	}
	if err := svc.SeedIfAbsent(ctx); err != nil {
		t.Fatalf("第二次 SeedIfAbsent 失败（应幂等）: %v", err)
	}

	// 验证 classic-9 已存在
	slug := OfficialDefaultMapSlug
	if _, err := queries.GetMapBySlug(ctx, &slug); err != nil {
		t.Fatalf("SeedIfAbsent 后查不到 slug=%s: %v", slug, err)
	}
}

// TestMapService_LoadDefaultMap_ReturnsClassic9 验证 LoadDefaultMap 加载
// 官方默认地图后返回 9 节点 14 边，且 DefaultMapState 被正确覆盖。
func TestMapService_LoadDefaultMap_ReturnsClassic9(t *testing.T) {
	queries := setupTestMapDB(t)
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	svc := NewMapService(queries, logger)
	ctx := context.Background()

	// 保存原始 DefaultMapState，测试后恢复
	origDefault := DefaultMapState
	t.Cleanup(func() { DefaultMapState = origDefault })

	// 独立测试库无官方地图，先 seed 再加载
	if err := svc.SeedIfAbsent(ctx); err != nil {
		t.Fatalf("SeedIfAbsent 失败: %v", err)
	}

	if err := svc.LoadDefaultMap(ctx); err != nil {
		t.Fatalf("LoadDefaultMap 失败: %v", err)
	}

	if DefaultMapState == nil {
		t.Fatal("LoadDefaultMap 后 DefaultMapState 为 nil")
	}
	if got := len(DefaultMapState.Nodes); got != 9 {
		t.Errorf("节点数 = %d, want 9", got)
	}
	if got := len(DefaultMapState.Edges); got != 14 {
		t.Errorf("边数 = %d, want 14", got)
	}
}

// TestMapService_LoadMapBySlug_NotFound_ReturnsError 验证对不存在的 slug
// 返回 error。
func TestMapService_LoadMapBySlug_NotFound_ReturnsError(t *testing.T) {
	queries := setupTestMapDB(t)
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	svc := NewMapService(queries, logger)

	_, err := svc.LoadMapBySlug(context.Background(), "nonexistent-test-slug-12345")
	if err == nil {
		t.Fatal("对不存在的 slug 应返回 error，got nil")
	}
}
