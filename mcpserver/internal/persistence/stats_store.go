package persistence

import (
	"database/sql"
	"fmt"
)

// StatsRow 对应 tool_call_stats 表的一行。
type StatsRow struct {
	ID         int64
	SessionID  string
	ToolName   string
	CalledAt   int64
	DurationMs int64
	Success    bool
	Error      string
}

// StatsStore 提供工具调用统计的持久化操作。
type StatsStore struct {
	conn *sql.DB
}

// RecordStats 插入一条工具调用统计。
func (s *StatsStore) RecordStats(row StatsRow) error {
	successVal := 0
	if row.Success {
		successVal = 1
	}
	if row.CalledAt == 0 {
		row.CalledAt = nowUnix()
	}
	_, err := s.conn.Exec(
		`INSERT INTO tool_call_stats (session_id, tool_name, called_at, duration_ms, success, error)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		row.SessionID, row.ToolName, row.CalledAt, row.DurationMs, successVal, row.Error,
	)
	if err != nil {
		return fmt.Errorf("record stats: %w", err)
	}
	return nil
}

// StatsSummary 是按工具名聚合的统计摘要。
type StatsSummary struct {
	ToolName   string `json:"toolName"`
	CallCount  int64  `json:"callCount"`
	SuccessCount int64 `json:"successCount"`
	FailCount  int64  `json:"failCount"`
	AvgDurationMs float64 `json:"avgDurationMs"`
}

// GetStatsSummary 返回 since(unix 秒)之后的工具调用统计;since<=0 表示全部。
// toolName 为空则返回所有工具的聚合。
func (s *StatsStore) GetStatsSummary(since int64, toolName string) ([]StatsSummary, error) {
	q := `SELECT tool_name, COUNT(*),
		     SUM(CASE WHEN success=1 THEN 1 ELSE 0 END),
		     SUM(CASE WHEN success=0 THEN 1 ELSE 0 END),
		     AVG(duration_ms)
	      FROM tool_call_stats WHERE 1=1`
	args := []any{}
	if since > 0 {
		q += " AND called_at >= ?"
		args = append(args, since)
	}
	if toolName != "" {
		q += " AND tool_name = ?"
		args = append(args, toolName)
	}
	q += " GROUP BY tool_name ORDER BY call_count DESC"
	rows, err := s.conn.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StatsSummary
	for rows.Next() {
		var ss StatsSummary
		var avg sql.NullFloat64
		if err := rows.Scan(&ss.ToolName, &ss.CallCount, &ss.SuccessCount, &ss.FailCount, &avg); err != nil {
			return nil, err
		}
		ss.AvgDurationMs = avg.Float64
		out = append(out, ss)
	}
	return out, rows.Err()
}

// GetRecentStats 返回最近的 N 条原始统计记录。
func (s *StatsStore) GetRecentStats(limit int) ([]StatsRow, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.conn.Query(
		`SELECT id, session_id, tool_name, called_at, duration_ms, success, error
		 FROM tool_call_stats ORDER BY called_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StatsRow
	for rows.Next() {
		var r StatsRow
		var errMsg sql.NullString
		var sessionID sql.NullString
		if err := rows.Scan(&r.ID, &sessionID, &r.ToolName, &r.CalledAt, &r.DurationMs, &r.Success, &errMsg); err != nil {
			return nil, err
		}
		r.SessionID = sessionID.String
		r.Error = errMsg.String
		out = append(out, r)
	}
	return out, rows.Err()
}
