// Package persistence 提供 MCP Server 的本地 SQLite 持久化。
package persistence

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DB 封装 SQLite 连接,并暴露各 Store。
type DB struct {
	conn     *sql.DB
	Account  *AccountStore
	Replay   *ReplayStore
	Stats    *StatsStore
	Settings *SettingsStore
}

// Open 打开(或创建)SQLite 数据库文件并初始化表结构。
func Open(dbPath string) (*DB, error) {
	dir := filepath.Dir(dbPath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("创建数据库目录: %w", err)
		}
	}

	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("打开 sqlite: %w", err)
	}
	// SQLite 单写者并发模型,开启 WAL 提升读并发。
	if _, err := conn.Exec("PRAGMA journal_mode=WAL"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("设置 WAL 模式: %w", err)
	}
	conn.SetMaxOpenConns(1) // modernc/sqlite 写串行更稳

	if err := initSchema(conn); err != nil {
		conn.Close()
		return nil, fmt.Errorf("初始化表结构: %w", err)
	}

	db := &DB{conn: conn}
	db.Account = &AccountStore{conn: conn}
	db.Replay = &ReplayStore{conn: conn}
	db.Stats = &StatsStore{conn: conn}
	db.Settings = &SettingsStore{conn: conn}
	return db, nil
}

// Close 关闭数据库连接。
func (db *DB) Close() error {
	return db.conn.Close()
}

func initSchema(conn *sql.DB) error {
	schema := `
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    display_name TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    token TEXT,
    token_expiry INTEGER,
    player_id TEXT,
    role TEXT DEFAULT 'player',
    status TEXT DEFAULT 'available',
    assigned_to TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS replays (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    player_ids TEXT NOT NULL,
    player_names TEXT NOT NULL,
    actions_json TEXT,
    states_json TEXT,
    winner TEXT,
    total_turns INTEGER,
    created_at INTEGER,
    fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replays_match ON replays(match_id);

CREATE TABLE IF NOT EXISTS tool_call_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    called_at INTEGER NOT NULL,
    duration_ms INTEGER,
    success INTEGER NOT NULL,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_stats_tool ON tool_call_stats(tool_name);
CREATE INDEX IF NOT EXISTS idx_stats_time ON tool_call_stats(called_at);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
`
	_, err := conn.Exec(schema)
	return err
}
