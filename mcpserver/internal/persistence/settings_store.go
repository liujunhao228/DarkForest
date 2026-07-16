package persistence

import (
	"database/sql"
	"fmt"
	"time"
)

// SettingsStore 提供通用键值配置的持久化(运行时可配置项,如游戏服务器 URL)。
type SettingsStore struct {
	conn *sql.DB
}

// Get 读取一个配置项。未找到时返回 ("", nil)。
func (s *SettingsStore) Get(key string) (string, error) {
	var value string
	err := s.conn.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("读取配置 %q: %w", key, err)
	}
	return value, nil
}

// Set 写入(或更新)一个配置项。
func (s *SettingsStore) Set(key, value string) error {
	_, err := s.conn.Exec(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
		key, value, time.Now().Unix(),
	)
	if err != nil {
		return fmt.Errorf("写入配置 %q: %w", key, err)
	}
	return nil
}
