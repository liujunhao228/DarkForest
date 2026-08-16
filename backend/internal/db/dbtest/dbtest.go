// Package dbtest 提供仅测试使用的 SQLite 测试库辅助函数。
// 各包集成测试（db/game/hub/api/match）经它打开独立临时文件 SQLite 库并应用迁移。
// 注意：本包不 import internal/db，避免 db 包自身测试引用时产生 import cycle。
package dbtest

import (
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

// Open 打开一个临时文件 SQLite 测试库，应用全部迁移，返回 *sql.DB。
// 调用方用 db.New(sqlDB) 获得 *db.Queries。测试结束自动关闭并清理临时文件。
func Open(t *testing.T) *sql.DB {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	sqlDB, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("打开 SQLite 测试库失败: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })

	// 定位迁移文件：本文件位于 backend/internal/db/dbtest，向上三级到 backend 根。
	_, thisFile, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "internal", "db", "migrations")
	upPath := filepath.Join(migrationsDir, "000001_initial_schema.up.sql")

	content, err := os.ReadFile(upPath)
	if err != nil {
		t.Fatalf("读取迁移文件失败: %v", err)
	}

	applySchema(t, sqlDB, string(content))
	return sqlDB
}

// applySchema 按分号拆分迁移内容，逐 chunk 去掉注释行后执行。
// 逐行剥注释可容忍注释块与注释内分号，避免 naive 拆分产生半截语句。
func applySchema(t *testing.T, sqlDB *sql.DB, content string) {
	t.Helper()
	for _, stmt := range strings.Split(content, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		var lines []string
		for _, line := range strings.Split(stmt, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "--") {
				continue
			}
			lines = append(lines, line)
		}
		clean := strings.TrimSpace(strings.Join(lines, "\n"))
		if clean == "" {
			continue
		}
		if _, err := sqlDB.Exec(clean); err != nil {
			t.Fatalf("执行迁移语句失败: %v\n%s", err, clean)
		}
	}
}
