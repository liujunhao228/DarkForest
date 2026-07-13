package persistence

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// ReplayRow 对应 replays 表的一行。PlayerIDs/PlayerNames 存 JSON 数组字符串。
type ReplayRow struct {
	ID          string
	MatchID     string
	PlayerIDs   string   // JSON: []string
	PlayerNames string   // JSON: []string
	ActionsJSON string   // 完整 actions 数组 JSON
	StatesJSON  string   // 完整 GameState[] 快照 JSON
	Winner      string
	TotalTurns  int
	CreatedAt   int64
	FetchedAt   int64
}

// ReplayStore 提供回放的持久化操作。
type ReplayStore struct {
	conn *sql.DB
}

// SaveReplay 插入或替换一条回放(以 id 为主键)。
func (s *ReplayStore) SaveReplay(r ReplayRow) error {
	if r.FetchedAt == 0 {
		r.FetchedAt = nowUnix()
	}
	_, err := s.conn.Exec(
		`INSERT INTO replays (id, match_id, player_ids, player_names, actions_json, states_json, winner, total_turns, created_at, fetched_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   actions_json=excluded.actions_json,
		   states_json=excluded.states_json,
		   winner=excluded.winner,
		   total_turns=excluded.total_turns,
		   fetched_at=excluded.fetched_at`,
		r.ID, r.MatchID, r.PlayerIDs, r.PlayerNames, r.ActionsJSON, r.StatesJSON,
		r.Winner, r.TotalTurns, r.CreatedAt, r.FetchedAt,
	)
	if err != nil {
		return fmt.Errorf("save replay: %w", err)
	}
	return nil
}

// GetReplay 按 id 查询完整回放。
func (s *ReplayStore) GetReplay(id string) (*ReplayRow, error) {
	var r ReplayRow
	var winner sql.NullString
	var createdAt sql.NullInt64
	err := s.conn.QueryRow(
		`SELECT id, match_id, player_ids, player_names, actions_json, states_json, winner, total_turns, created_at, fetched_at
		 FROM replays WHERE id=?`, id).Scan(
		&r.ID, &r.MatchID, &r.PlayerIDs, &r.PlayerNames, &r.ActionsJSON, &r.StatesJSON,
		&winner, &r.TotalTurns, &createdAt, &r.FetchedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.Winner = winner.String
	r.CreatedAt = createdAt.Int64
	return &r, nil
}

// GetReplayByMatchID 按 matchId 查询回放。
func (s *ReplayStore) GetReplayByMatchID(matchID string) (*ReplayRow, error) {
	var r ReplayRow
	var winner sql.NullString
	var createdAt sql.NullInt64
	err := s.conn.QueryRow(
		`SELECT id, match_id, player_ids, player_names, actions_json, states_json, winner, total_turns, created_at, fetched_at
		 FROM replays WHERE match_id=? LIMIT 1`, matchID).Scan(
		&r.ID, &r.MatchID, &r.PlayerIDs, &r.PlayerNames, &r.ActionsJSON, &r.StatesJSON,
		&winner, &r.TotalTurns, &createdAt, &r.FetchedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.Winner = winner.String
	r.CreatedAt = createdAt.Int64
	return &r, nil
}

// ReplayListItem 是本地回放列表的轻量摘要。
type ReplayListItem struct {
	ID         string   `json:"id"`
	MatchID    string   `json:"matchId"`
	PlayerIDs  []string `json:"playerIds"`
	PlayerNames []string `json:"playerNames"`
	Winner     string   `json:"winner,omitempty"`
	TotalTurns int      `json:"totalTurns"`
	CreatedAt  int64    `json:"createdAt"`
	FetchedAt  int64    `json:"fetchedAt"`
}

// ListReplays 分页列出本地回放(不含 states/actions 大字段)。
func (s *ReplayStore) ListReplays(limit, offset int) ([]ReplayListItem, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.conn.Query(
		`SELECT id, match_id, player_ids, player_names, winner, total_turns, created_at, fetched_at
		 FROM replays ORDER BY fetched_at DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReplayListItem
	for rows.Next() {
		var item ReplayListItem
		var playerIDs, playerNames string
		var winner sql.NullString
		var createdAt sql.NullInt64
		if err := rows.Scan(&item.ID, &item.MatchID, &playerIDs, &playerNames, &winner,
			&item.TotalTurns, &createdAt, &item.FetchedAt); err != nil {
			return nil, err
		}
		item.Winner = winner.String
		item.CreatedAt = createdAt.Int64
		_ = json.Unmarshal([]byte(playerIDs), &item.PlayerIDs)
		_ = json.Unmarshal([]byte(playerNames), &item.PlayerNames)
		out = append(out, item)
	}
	return out, rows.Err()
}
