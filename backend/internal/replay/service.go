package replay

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ActionRecord represents a recorded game action
type ActionRecord struct {
	PlayerID   string          `json:"playerId"`
	Action     string          `json:"action"`
	Data       json.RawMessage `json:"data"`
	Turn       int             `json:"turn"`
	Timestamp  int64           `json:"timestamp"`
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
func (s *Service) SaveReplay(ctx context.Context, matchID string, playerIDs []string, playerNames []string, actions []ActionRecord, initialState *game.GameState, finalState *game.GameState) error {
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

	replayUUID := uuid.New()
	matchUUID, err := parseUUID(matchID)
	if err != nil {
		return err
	}

	_, err = s.queries.CreateReplay(ctx, db.CreateReplayParams{
		ID:           pgtype.UUID{Bytes: replayUUID, Valid: true},
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

	return s.dbReplayToReplayData(&dbReplay)
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

	return s.dbReplayToReplayData(&dbReplay)
}

// ListReplays retrieves a paginated list of replays
func (s *Service) ListReplays(ctx context.Context, limit, offset int32) ([]*ReplayData, error) {
	dbReplays, err := s.queries.ListReplays(ctx, db.ListReplaysParams{
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		return nil, err
	}

	replays := make([]*ReplayData, 0, len(dbReplays))
	for _, dbReplay := range dbReplays {
		replay, err := s.dbReplayToReplayData(&dbReplay)
		if err != nil {
			s.logger.Warn("failed to parse replay", "replayId", dbReplay.ID, "error", err)
			continue
		}
		replays = append(replays, replay)
	}

	return replays, nil
}

// ListReplaysByPlayer retrieves replays for a specific player
func (s *Service) ListReplaysByPlayer(ctx context.Context, playerID string, limit, offset int32) ([]*ReplayData, error) {
	pgPlayerID, err := parseUUID(playerID)
	if err != nil {
		return nil, err
	}

	dbReplays, err := s.queries.ListReplaysByPlayer(ctx, db.ListReplaysByPlayerParams{
		PlayerID: pgPlayerID,
		Limit:    limit,
		Offset:   offset,
	})
	if err != nil {
		return nil, err
	}

	replays := make([]*ReplayData, 0, len(dbReplays))
	for _, dbReplay := range dbReplays {
		replay, err := s.dbReplayToReplayData(&dbReplay)
		if err != nil {
			s.logger.Warn("failed to parse replay", "replayId", dbReplay.ID, "error", err)
			continue
		}
		replays = append(replays, replay)
	}

	return replays, nil
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

// dbReplayToReplayData converts database replay to ReplayData
func (s *Service) dbReplayToReplayData(dbReplay *db.Replay) (*ReplayData, error) {
	var playerIDs []string
	if err := json.Unmarshal([]byte(dbReplay.PlayerIds), &playerIDs); err != nil {
		return nil, err
	}

	var playerNames []string
	if err := json.Unmarshal([]byte(dbReplay.PlayerNames), &playerNames); err != nil {
		return nil, err
	}

	var actions []ActionRecord
	if err := json.Unmarshal([]byte(dbReplay.Actions), &actions); err != nil {
		return nil, err
	}

	var initialState *game.GameState
	if dbReplay.InitialState != nil && *dbReplay.InitialState != "" {
		initialState = &game.GameState{}
		if err := json.Unmarshal([]byte(*dbReplay.InitialState), initialState); err != nil {
			return nil, err
		}
	}

	var finalState *game.GameState
	if dbReplay.FinalState != nil && *dbReplay.FinalState != "" {
		finalState = &game.GameState{}
		if err := json.Unmarshal([]byte(*dbReplay.FinalState), finalState); err != nil {
			return nil, err
		}
	}

	return &ReplayData{
		ID:           uuidString(dbReplay.ID),
		MatchID:      uuidString(dbReplay.MatchID),
		PlayerIDs:    playerIDs,
		PlayerNames:  playerNames,
		Actions:      actions,
		InitialState: initialState,
		FinalState:   finalState,
		CreatedAt:    dbReplay.CreatedAt.Time.Unix(),
	}, nil
}

// parseUUID converts a string to pgtype.UUID
func parseUUID(s string) (pgtype.UUID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: u, Valid: true}, nil
}

// uuidString converts pgtype.UUID to string
func uuidString(id pgtype.UUID) string {
	return uuid.UUID(id.Bytes).String()
}
