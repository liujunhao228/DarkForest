package game

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testMapDBPool 为本测试文件持有的独立连接池（不污染 db.Pool 全局状态）。
var testMapDBPool *pgxpool.Pool

// setupTestMapDB 尝试连接测试数据库。失败时调用 t.Skip 跳过。
// 复用 connection.go 的 DATABASE_URL 约定。
func setupTestMapDB(t *testing.T) *db.Queries {
	t.Helper()

	if testMapDBPool != nil {
		return db.New(testMapDBPool)
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable"
	}

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Skipf("解析 DATABASE_URL 失败，跳过 MapService 集成测试: %v", err)
	}
	cfg.MaxConns = 2
	cfg.MinConns = 0

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Skipf("无法连接测试数据库，跳过 MapService 集成测试: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("测试数据库不可达，跳过 MapService 集成测试: %v", err)
	}

	// 检查 maps 表是否存在；不存在则跳过（未执行 migration 000006）
	var tableName string
	err = pool.QueryRow(ctx,
		"SELECT to_regclass('public.maps')").Scan(&tableName)
	if err != nil || tableName == "" {
		pool.Close()
		t.Skipf("maps 表不存在（未执行 migration 000006），跳过 MapService 集成测试")
	}

	testMapDBPool = pool
	return db.New(pool)
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
