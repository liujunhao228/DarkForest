package db

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// readRand 是 crypto/rand.Read 的别名，便于测试 mock。
var readRand = rand.Read

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

// migrationUpSQL 是 migration 000006 的 up SQL（与 000006_add_maps.up.sql 内容一致）。
const migrationUpSQL = `
CREATE TABLE IF NOT EXISTS maps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES players(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1,
    layout_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_maps_is_official ON maps(is_official);
CREATE INDEX IF NOT EXISTS idx_maps_created_by ON maps(created_by);
`

// migrationDownSQL 是 migration 000006 的 down SQL。
const migrationDownSQL = `DROP TABLE IF EXISTS maps CASCADE;`

// setupMigrationTestDB 尝试连接测试数据库。失败时调用 t.Skip 跳过。
func setupMigrationTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable"
	}

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Skipf("解析 DATABASE_URL 失败，跳过迁移测试: %v", err)
	}
	cfg.MaxConns = 2
	cfg.MinConns = 0

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Skipf("无法连接测试数据库，跳过迁移测试: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("测试数据库不可达，跳过迁移测试: %v", err)
	}
	return pool
}

// TestMapsMigration_UpInsertQueryDown 验证 migration 000006 的 up/down：
//   - 执行 up SQL 后 maps 表存在且列正确
//   - 插入一条官方地图记录并查询成功
//   - 执行 down SQL 后表已删除
//   - 重新执行 up SQL 恢复表（供其他测试使用）
func TestMapsMigration_UpInsertQueryDown(t *testing.T) {
	pool := setupMigrationTestDB(t)
	ctx := context.Background()

	// 确保测试结束后 maps 表存在（恢复状态），供其他集成测试与服务器启动使用。
	// 注意：t.Cleanup 按注册顺序逆序执行（LIFO），先注册 close pool，
	// 后注册恢复表 → 恢复表先执行（pool 仍可用），close pool 最后执行。
	t.Cleanup(func() {
		pool.Close()
	})
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, migrationUpSQL)
	})

	// 先清理：执行 down SQL 确保干净起点
	if _, err := pool.Exec(ctx, migrationDownSQL); err != nil {
		t.Fatalf("预清理 down SQL 失败: %v", err)
	}

	// 1. 执行 up SQL
	if _, err := pool.Exec(ctx, migrationUpSQL); err != nil {
		t.Fatalf("执行 up SQL 失败: %v", err)
	}

	// 2. 验证 maps 表存在
	var tableName string
	err := pool.QueryRow(ctx, "SELECT to_regclass('public.maps')").Scan(&tableName)
	if err != nil {
		t.Fatalf("查询 maps 表失败: %v", err)
	}
	if tableName == "" {
		t.Fatal("up SQL 执行后 maps 表不存在")
	}

	// 3. 验证关键列存在（通过 information_schema）
	columns := []struct {
		name     string
		dataType string
	}{
		{"id", "uuid"},
		{"slug", "text"},
		{"name", "text"},
		{"is_official", "boolean"},
		{"version", "integer"},
		{"layout_json", "jsonb"},
	}
	for _, col := range columns {
		var gotType string
		err := pool.QueryRow(ctx,
			"SELECT data_type FROM information_schema.columns WHERE table_name='maps' AND column_name=$1",
			col.name).Scan(&gotType)
		if err != nil {
			t.Errorf("列 %s 不存在或查询失败: %v", col.name, err)
		}
		if gotType != col.dataType {
			t.Errorf("列 %s 类型 = %s, want %s", col.name, gotType, col.dataType)
		}
	}

	// 4. 插入一条官方地图记录并查询
	testLayout := `{"nodes":[{"id":1,"x":10,"y":10,"name":"A","size":"sm","tint":"#000"}],"edges":[]}`
	var insertedID string
	err = pool.QueryRow(ctx,
		`INSERT INTO maps (slug, name, description, is_official, layout_json)
		 VALUES ('test-migration-slug', '测试地图', '迁移测试用', true, $1::jsonb)
		 RETURNING id::text`,
		testLayout).Scan(&insertedID)
	if err != nil {
		t.Fatalf("插入测试记录失败: %v", err)
	}
	if insertedID == "" {
		t.Error("插入后返回的 id 为空")
	}

	// 查询验证
	var slug, name string
	var isOfficial bool
	err = pool.QueryRow(ctx,
		"SELECT slug, name, is_official FROM maps WHERE id::text = $1", insertedID).
		Scan(&slug, &name, &isOfficial)
	if err != nil {
		t.Fatalf("查询测试记录失败: %v", err)
	}
	if slug != "test-migration-slug" || name != "测试地图" || !isOfficial {
		t.Errorf("查询结果不符: slug=%s name=%s isOfficial=%v", slug, name, isOfficial)
	}

	// 5. 执行 down SQL
	if _, err := pool.Exec(ctx, migrationDownSQL); err != nil {
		t.Fatalf("执行 down SQL 失败: %v", err)
	}

	// 6. 验证表已删除（to_regclass 返回 NULL 表示表不存在）
	var downTableName *string
	err = pool.QueryRow(ctx, "SELECT to_regclass('public.maps')").Scan(&downTableName)
	if err != nil {
		t.Fatalf("查询 maps 表失败: %v", err)
	}
	if downTableName != nil && *downTableName != "" {
		t.Error("down SQL 执行后 maps 表仍存在")
	}
}

// migration000007UpSQL 是 migration 000007 的 up SQL（与 000007_add_custom_queue_map_id.up.sql 内容一致）。
const migration000007UpSQL = `
ALTER TABLE custom_match_queues
    ADD COLUMN IF NOT EXISTS map_id UUID REFERENCES maps(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_custom_match_queues_map_id
    ON custom_match_queues(map_id);
`

// migration000007DownSQL 是 migration 000007 的 down SQL。
const migration000007DownSQL = `
DROP INDEX IF EXISTS idx_custom_match_queues_map_id;
ALTER TABLE custom_match_queues
    DROP COLUMN IF EXISTS map_id;
`

// TestMigration000007_CustomQueueMapID 验证 migration 000007 的 up/down：
//   - 执行 up SQL 后 custom_match_queues 表有 map_id 列（UUID 类型，可 NULL）
//   - 插入一条 maps 记录 + 一条 custom_match_queues 记录引用之，map_id 写入正确
//   - 执行 down SQL 后 map_id 列被删除
//   - 重新执行 up SQL 恢复列（供其他测试使用）
//
// 注意：本测试依赖 maps 表（migration 000006）与 custom_match_queues 表（migration 000001）已存在。
// 测试 DB 在 make migrate-up 后默认满足此前置；若 maps 表缺失，先跑 TestMapsMigration_UpInsertQueryDown
// 或在 setupMigrationTestDB 后手动 CREATE TABLE。
func TestMigration000007_CustomQueueMapID(t *testing.T) {
	pool := setupMigrationTestDB(t)
	ctx := context.Background()

	// LIFO cleanup：先注册 close pool，后注册恢复 up SQL → 恢复 up SQL 先执行（pool 仍可用）
	t.Cleanup(func() {
		pool.Close()
	})
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, migration000007UpSQL)
	})

	// 确保 maps 表存在（前置依赖；若已存在则为 no-op）
	if _, err := pool.Exec(ctx, migrationUpSQL); err != nil {
		t.Fatalf("前置 maps 表创建失败: %v", err)
	}

	// 预清理：执行 down SQL 确保干净起点
	if _, err := pool.Exec(ctx, migration000007DownSQL); err != nil {
		t.Fatalf("预清理 down SQL 失败: %v", err)
	}

	// 1. 执行 up SQL
	if _, err := pool.Exec(ctx, migration000007UpSQL); err != nil {
		t.Fatalf("执行 up SQL 失败: %v", err)
	}

	// 2. 验证 map_id 列存在且类型为 uuid
	var dataType string
	err := pool.QueryRow(ctx,
		"SELECT data_type FROM information_schema.columns WHERE table_name='custom_match_queues' AND column_name='map_id'").
		Scan(&dataType)
	if err != nil {
		t.Fatalf("查询 map_id 列失败: %v", err)
	}
	if dataType != "uuid" {
		t.Errorf("map_id 列类型 = %s, want uuid", dataType)
	}

	// 3. 创建测试玩家（custom_match_queues.creator_id 外键依赖）
	var playerID string
	err = pool.QueryRow(ctx,
		`INSERT INTO players (user_id, display_name, role) VALUES ($1, $2, 'player') RETURNING id::text`,
		"p3test-mig-"+uuidSuffix(), "p3test-mig-player-"+uuidSuffix(),
	).Scan(&playerID)
	if err != nil {
		t.Fatalf("创建测试玩家失败: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM players WHERE id::text = $1", playerID)
	})

	// 4. 插入一条 maps 记录
	testLayout := `{"nodes":[{"id":1,"x":10,"y":10,"name":"A","size":"sm","tint":"#000"}],"edges":[]}`
	var mapID string
	err = pool.QueryRow(ctx,
		`INSERT INTO maps (slug, name, is_official, layout_json)
		 VALUES ($1, 'p3test-mig-map', false, $2::jsonb)
		 RETURNING id::text`,
		"p3test-mig-map-"+uuidSuffix(), testLayout,
	).Scan(&mapID)
	if err != nil {
		t.Fatalf("插入测试 maps 记录失败: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM maps WHERE id::text = $1", mapID)
	})

	// 5. 插入一条 custom_match_queues 记录引用该 map
	queueID := "p3test-mig-queue-" + uuidSuffix()
	var cmqID string
	err = pool.QueryRow(ctx,
		`INSERT INTO custom_match_queues (queue_id, queue_name, creator_id, max_players, min_players, status, map_id)
		 VALUES ($1, 'p3test-mig-cmq', $2::uuid, 4, 3, 'waiting', $3::uuid)
		 RETURNING id::text`,
		queueID, playerID, mapID,
	).Scan(&cmqID)
	if err != nil {
		t.Fatalf("插入 custom_match_queues 记录失败: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM custom_match_queues WHERE id::text = $1", cmqID)
	})

	// 6. 验证 map_id 写入正确
	var gotMapID *string
	err = pool.QueryRow(ctx,
		"SELECT map_id::text FROM custom_match_queues WHERE id::text = $1", cmqID,
	).Scan(&gotMapID)
	if err != nil {
		t.Fatalf("查询 custom_match_queues.map_id 失败: %v", err)
	}
	if gotMapID == nil || *gotMapID != mapID {
		t.Errorf("map_id 写入不符: got=%v, want=%s", gotMapID, mapID)
	}

	// 7. 执行 down SQL
	if _, err := pool.Exec(ctx, migration000007DownSQL); err != nil {
		t.Fatalf("执行 down SQL 失败: %v", err)
	}

	// 8. 验证 map_id 列已被删除
	var count int
	err = pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM information_schema.columns WHERE table_name='custom_match_queues' AND column_name='map_id'",
	).Scan(&count)
	if err != nil {
		t.Fatalf("查询 map_id 列存在性失败: %v", err)
	}
	if count != 0 {
		t.Errorf("down SQL 执行后 map_id 列仍存在 (count=%d)", count)
	}
}

// uuidSuffix 返回一个 UUID 前 8 字符作为测试唯一后缀。
// 使用 crypto/rand 保证全局唯一性，避免并发测试冲突。
func uuidSuffix() string {
	b := make([]byte, 4)
	if _, err := readRand(b); err != nil {
		// fallback：用时间戳后 8 位
		return fmt.Sprintf("%08x", time.Now().UnixNano()&0xFFFFFFFF)
	}
	return fmt.Sprintf("%x", b)
}
