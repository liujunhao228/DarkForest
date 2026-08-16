package replay

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/google/uuid"
)

// ActionRecord represents a recorded game action
type ActionRecord struct {
	PlayerID  string          `json:"playerId"`
	Action    string          `json:"action"`
	Data      json.RawMessage `json:"data"`
	Turn      int             `json:"turn"`
	Timestamp int64           `json:"timestamp"`
}

// ReplayListItem 是列表视图下的回放摘要表示。
// 它不含 actions/initialState/finalState，避免列表场景下回传大 payload。
type ReplayListItem struct {
	ID          string   `json:"id"`
	MatchID     string   `json:"matchId"`
	PlayerIDs   []string `json:"playerIds"`
	PlayerNames []string `json:"playerNames"`
	ActionCount int      `json:"actionCount"`
	Winner      string   `json:"winner,omitempty"`
	TotalTurns  int      `json:"totalTurns,omitempty"`
	CreatedAt   int64    `json:"createdAt"`
}

// ReplayData holds the complete replay information
type ReplayData struct {
	ID           string          `json:"id"`
	MatchID      string          `json:"matchId"`
	PlayerIDs    []string        `json:"playerIds"`
	PlayerNames  []string        `json:"playerNames"`
	Actions      []ActionRecord  `json:"actions"`
	InitialState *game.GameState `json:"initialState"`
	FinalState   *game.GameState `json:"finalState"`
	CreatedAt    int64           `json:"createdAt"`
}

// parseTS 容忍两种时间格式：SQLite CURRENT_TIMESTAMP（'2006-01-02 15:04:05'）与 RFC3339。
func parseTS(s string) time.Time {
	for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

// summaryRowToItem 从 ListReplaySummariesByPlayer 的查询行派生摘要项。
// 查询行不含 actions，故 ActionCount 不在此设置（列表场景不需要）。
func summaryRowToItem(row *db.ListReplaySummariesByPlayerRow) (*ReplayListItem, error) {
	var playerIDs []string
	if err := json.Unmarshal([]byte(row.PlayerIds), &playerIDs); err != nil {
		return nil, err
	}

	var playerNames []string
	if err := json.Unmarshal([]byte(row.PlayerNames), &playerNames); err != nil {
		return nil, err
	}

	item := &ReplayListItem{
		ID:          row.ID,
		MatchID:     row.MatchID,
		PlayerIDs:   playerIDs,
		PlayerNames: playerNames,
		CreatedAt:   parseTS(row.CreatedAt).Unix(),
	}

	// final_state 可为 NULL（旧数据或保存失败），需 nil 检查
	if row.FinalState != nil && *row.FinalState != "" {
		var finalState game.GameState
		if err := json.Unmarshal([]byte(*row.FinalState), &finalState); err != nil {
			return nil, err
		}
		if finalState.Winner != nil {
			item.Winner = *finalState.Winner
		}
		item.TotalTurns = finalState.TotalTurn
	}

	return item, nil
}

// Service handles replay storage and retrieval
type Service struct {
	queries *db.Queries
	logger  *slog.Logger
}

// NewService creates a new replay service
func NewService(queries *db.Queries, logger *slog.Logger) *Service {
	return &Service{
		queries: queries,
		logger:  logger,
	}
}

// SaveReplay saves the complete replay when the game ends.
// 它由 ReplayRecorder 在游戏结束时调用，无需关心录制过程。
// replayUUID 由 ReplayRecorder 预生成并传入，与广播给玩家的结算消息保持一致。
func (s *Service) SaveReplay(ctx context.Context, replayUUID uuid.UUID, matchID string, playerIDs []string, playerNames []string, actions []ActionRecord, initialState *game.GameState, finalState *game.GameState) error {
	playerIDsJSON, err := json.Marshal(playerIDs)
	if err != nil {
		return err
	}

	playerNamesJSON, err := json.Marshal(playerNames)
	if err != nil {
		return err
	}

	actionsJSON, err := json.Marshal(actions)
	if err != nil {
		return err
	}

	var initialStateJSON string
	if initialState != nil {
		data, err := json.Marshal(initialState)
		if err != nil {
			return err
		}
		initialStateJSON = string(data)
	}

	var finalStateJSON string
	if finalState != nil {
		data, err := json.Marshal(finalState)
		if err != nil {
			return err
		}
		finalStateJSON = string(data)
	}

	matchUUID, err := parseUUID(matchID)
	if err != nil {
		return err
	}

	_, err = s.queries.CreateReplay(ctx, db.CreateReplayParams{
		ID:           replayUUID.String(),
		MatchID:      matchUUID,
		PlayerIds:    string(playerIDsJSON),
		PlayerNames:  string(playerNamesJSON),
		Actions:      string(actionsJSON),
		InitialState: &initialStateJSON,
		FinalState:   &finalStateJSON,
	})

	if err != nil {
		s.logger.Error("failed to save replay", "matchId", matchID, "error", err)
		return err
	}

	s.logger.Info("replay saved", "replayId", replayUUID.String(), "matchId", matchID, "actionCount", len(actions))
	return nil
}

// GetReplay retrieves a replay by ID
func (s *Service) GetReplay(ctx context.Context, replayID string) (*ReplayData, error) {
	pgID, err := parseUUID(replayID)
	if err != nil {
		return nil, err
	}

	dbReplay, err := s.queries.GetReplayByID(ctx, pgID)
	if err != nil {
		return nil, err
	}

	return replayRowToReplayData(dbReplay.ID, dbReplay.MatchID, dbReplay.PlayerIds,
		dbReplay.PlayerNames, dbReplay.Actions, dbReplay.InitialState,
		dbReplay.FinalState, dbReplay.CreatedAt)
}

// GetReplayByMatchID retrieves a replay by match ID
func (s *Service) GetReplayByMatchID(ctx context.Context, matchID string) (*ReplayData, error) {
	pgMatchID, err := parseUUID(matchID)
	if err != nil {
		return nil, err
	}

	dbReplay, err := s.queries.GetReplayByMatchID(ctx, pgMatchID)
	if err != nil {
		return nil, err
	}

	return replayRowToReplayData(dbReplay.ID, dbReplay.MatchID, dbReplay.PlayerIds,
		dbReplay.PlayerNames, dbReplay.Actions, dbReplay.InitialState,
		dbReplay.FinalState, dbReplay.CreatedAt)
}

// ListReplayItemsByPlayer 返回某玩家的回放摘要列表（不含 actions/initialState）。
// 使用专用的摘要查询，避免反序列化 actions/initial_state 这两个大字段。
func (s *Service) ListReplayItemsByPlayer(ctx context.Context, playerID string, limit, offset int32) ([]*ReplayListItem, error) {
	pgPlayerID, err := parseUUID(playerID)
	if err != nil {
		return nil, err
	}

	rows, err := s.queries.ListReplaySummariesByPlayer(ctx, db.ListReplaySummariesByPlayerParams{
		PlayerID: pgPlayerID,
		Limit:    int64(limit),
		Offset:   int64(offset),
	})
	if err != nil {
		return nil, err
	}

	items := make([]*ReplayListItem, 0, len(rows))
	for i := range rows {
		item, err := summaryRowToItem(&rows[i])
		if err != nil {
			s.logger.Warn("failed to parse replay summary", "replayId", rows[i].ID, "error", err)
			continue
		}
		items = append(items, item)
	}

	return items, nil
}

// DeleteReplay deletes a replay by ID
func (s *Service) DeleteReplay(ctx context.Context, replayID string) error {
	pgID, err := parseUUID(replayID)
	if err != nil {
		return err
	}

	err = s.queries.DeleteReplay(ctx, pgID)
	if err != nil {
		s.logger.Error("failed to delete replay", "replayId", replayID, "error", err)
		return err
	}
	return nil
}

// replayRowToReplayData 从 DB 查询行的字段值构建 ReplayData。
// 抽出参数化形式是为了兼容 sqlc 生成的不同 Row 类型
// （GetReplayByIDRow / GetReplayByMatchIDRow / 旧的 db.Replay）。
func replayRowToReplayData(
	id, matchID string,
	playerIds, playerNames, actions string,
	initialState, finalState *string,
	createdAt string,
) (*ReplayData, error) {
	var pIDs []string
	if err := json.Unmarshal([]byte(playerIds), &pIDs); err != nil {
		return nil, err
	}

	var pNames []string
	if err := json.Unmarshal([]byte(playerNames), &pNames); err != nil {
		return nil, err
	}

	var acts []ActionRecord
	if err := json.Unmarshal([]byte(actions), &acts); err != nil {
		return nil, err
	}

	var init *game.GameState
	if initialState != nil && *initialState != "" {
		init = &game.GameState{}
		if err := json.Unmarshal([]byte(*initialState), init); err != nil {
			return nil, err
		}
	}

	var fin *game.GameState
	if finalState != nil && *finalState != "" {
		fin = &game.GameState{}
		if err := json.Unmarshal([]byte(*finalState), fin); err != nil {
			return nil, err
		}
	}

	return &ReplayData{
		ID:           id,
		MatchID:      matchID,
		PlayerIDs:    pIDs,
		PlayerNames:  pNames,
		Actions:      acts,
		InitialState: init,
		FinalState:   fin,
		CreatedAt:    parseTS(createdAt).Unix(),
	}, nil
}

// parseUUID 校验并原样返回 UUID 字符串。
func parseUUID(s string) (string, error) {
	if _, err := uuid.Parse(s); err != nil {
		return "", err
	}
	return s, nil
}
