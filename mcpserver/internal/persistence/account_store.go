package persistence

import (
	"database/sql"
	"fmt"
	"time"
)

// AccountRow 对应 accounts 表的一行。
type AccountRow struct {
	ID          string
	DisplayName string
	Password    string
	Token       string
	TokenExpiry int64 // unix 秒;0 表示未知
	PlayerID    string
	Role        string
	Status      string // available / in_use / disabled
	AssignedTo  string // 当前借用的 MCP session ID
	CreatedAt   int64
}

// AccountStore 提供账户的持久化操作。
type AccountStore struct {
	conn *sql.DB
}

// UpsertAccount 插入或更新一个账户(以 id 为主键)。
func (s *AccountStore) UpsertAccount(a AccountRow) error {
	_, err := s.conn.Exec(
		`INSERT INTO accounts (id, display_name, password, token, token_expiry, player_id, role, status, assigned_to, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   display_name=excluded.display_name,
		   password=excluded.password,
		   token=excluded.token,
		   token_expiry=excluded.token_expiry,
		   player_id=excluded.player_id,
		   role=excluded.role,
		   status=excluded.status,
		   assigned_to=excluded.assigned_to`,
		a.ID, a.DisplayName, a.Password, a.Token, a.TokenExpiry,
		a.PlayerID, a.Role, a.Status, a.AssignedTo, a.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert account: %w", err)
	}
	return nil
}

// UpdateAccountStatus 仅更新状态与借用者。
func (s *AccountStore) UpdateAccountStatus(id, status, assignedTo string) error {
	_, err := s.conn.Exec(
		`UPDATE accounts SET status=?, assigned_to=? WHERE id=?`,
		status, assignedTo, id,
	)
	return err
}

// UpdateToken 更新账户的 JWT 与过期时间。
func (s *AccountStore) UpdateToken(id, token string, expiry int64) error {
	_, err := s.conn.Exec(
		`UPDATE accounts SET token=?, token_expiry=? WHERE id=?`,
		token, expiry, id,
	)
	return err
}

// ListAll 返回所有账户。
func (s *AccountStore) ListAll() ([]AccountRow, error) {
	rows, err := s.conn.Query(
		`SELECT id, display_name, password, token, token_expiry, player_id, role, status, assigned_to, created_at
		 FROM accounts ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAccounts(rows)
}

// ListByStatus 按状态筛选账户。
func (s *AccountStore) ListByStatus(status string) ([]AccountRow, error) {
	rows, err := s.conn.Query(
		`SELECT id, display_name, password, token, token_expiry, player_id, role, status, assigned_to, created_at
		 FROM accounts WHERE status=? ORDER BY created_at`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAccounts(rows)
}

func scanAccounts(rows *sql.Rows) ([]AccountRow, error) {
	var out []AccountRow
	for rows.Next() {
		var a AccountRow
		var token sql.NullString
		var tokenExpiry sql.NullInt64
		var playerID sql.NullString
		var assignedTo sql.NullString
		if err := rows.Scan(&a.ID, &a.DisplayName, &a.Password, &token, &tokenExpiry,
			&playerID, &a.Role, &a.Status, &assignedTo, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Token = token.String
		a.TokenExpiry = tokenExpiry.Int64
		a.PlayerID = playerID.String
		a.AssignedTo = assignedTo.String
		out = append(out, a)
	}
	return out, rows.Err()
}

// nowUnix 返回当前时间的 unix 秒。
func nowUnix() int64 { return time.Now().Unix() }
