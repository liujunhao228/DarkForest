package settlement

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// settleInterval 是周期性扫描残留对局的时间间隔。
const settleInterval = 1 * time.Hour

// Service 负责结算残留对局（status 为 waiting/playing 但实际已结束的对局）。
// 它提供启动时一次性扫描 + 周期性后台任务两种触发方式。
type Service struct {
	pool    *pgxpool.Pool
	queries *db.Queries
	logger  *slog.Logger
	quit    chan struct{}
}

// NewService 创建结算服务。pool 用于原生 SQL 批量扫描，queries 用于调用 sqlc 生成的方法。
func NewService(pool *pgxpool.Pool, queries *db.Queries, logger *slog.Logger) *Service {
	return &Service{
		pool:    pool,
		queries: queries,
		logger:  logger,
		quit:    make(chan struct{}),
	}
}

// FinalizeMatch 是公共结算函数：从 GameState 提取结算信息，
// 调用 FinishMatch 更新 matches 表，并遍历 Players 调用 UpdateMatchPlayerStats。
// 供实时结算（RoomManager）和历史修复（SettleStaleMatches）共用。
//
// 参数：
//   - matchID: 对局 UUID 字符串
//   - state: 游戏最终状态（可为 nil，表示无法获取状态，仅标记 finished）
//   - startedAt: 对局开始时间，用于计算 duration；零值时 duration=0
func FinalizeMatch(ctx context.Context, queries *db.Queries, matchID string, state *game.GameState, startedAt time.Time, logger *slog.Logger) error {
	matchUUID, err := parseUUID(matchID)
	if err != nil {
		return fmt.Errorf("invalid matchID: %w", err)
	}

	// 提取 winner
	var winnerID pgtype.UUID
	var winnerType *string
	if state != nil && state.Winner != nil && *state.Winner != "" {
		wid, err := parseUUID(*state.Winner)
		if err != nil {
			logger.Warn("finalizeMatch: invalid winner ID, leaving winner empty", "winner", *state.Winner, "error", err)
		} else {
			winnerID = wid
			wt := "human"
			winnerType = &wt
		}
	}

	// 提取 totalTurns
	var totalTurns int32
	if state != nil {
		totalTurns = int32(state.TotalTurn)
	}

	// 计算 duration
	var duration int32
	if !startedAt.IsZero() {
		duration = int32(time.Since(startedAt).Seconds())
	}

	// 调用 FinishMatch
	_, err = queries.FinishMatch(ctx, db.FinishMatchParams{
		ID:         matchUUID,
		WinnerID:   winnerID,
		WinnerType: winnerType,
		TotalTurns: totalTurns,
		Duration:   duration,
	})
	if err != nil {
		return fmt.Errorf("FinishMatch failed: %w", err)
	}

	// 更新 match_players 统计
	if state != nil {
		for _, p := range state.Players {
			playerUUID, err := parseUUID(p.ID)
			if err != nil {
				logger.Warn("finalizeMatch: invalid player ID, skipping stats update", "playerId", p.ID, "error", err)
				continue
			}
			var finalRank *int32
			if state.Winner != nil && *state.Winner == p.ID {
				rank := int32(1)
				finalRank = &rank
			}
			_, err = queries.UpdateMatchPlayerStats(ctx, db.UpdateMatchPlayerStatsParams{
				MatchID:        matchUUID,
				PlayerID:       playerUUID,
				FinalRank:      finalRank,
				IsEliminated:   p.Eliminated,
				EliminatedTurn: nil,
				Energy:         int32(p.Energy),
				DestroyedStars: 0,
				BroadcastCount: int32(len(p.BroadcastHistory)),
				StrikeCount:    int32(p.StrikeCount),
			})
			if err != nil {
				logger.Warn("finalizeMatch: UpdateMatchPlayerStats failed", "playerId", p.ID, "error", err)
			}
		}
	}

	return nil
}

// SettleStaleMatches 扫描所有 status IN ('waiting','playing') 的残留对局，逐个结算。
// 有 replay 且 final_state 非空的：从中提取 winner 与 total_turns，补全 match_players 统计。
// 无 replay 或 final_state 为空的：标记为 finished，winner 留空。
// 返回成功结算的对局数。
func (s *Service) SettleStaleMatches(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, started_at, created_at
		FROM matches
		WHERE status IN ('waiting', 'playing')
	`)
	if err != nil {
		return 0, fmt.Errorf("query stale matches failed: %w", err)
	}
	defer rows.Close()

	settled := 0
	for rows.Next() {
		var matchID pgtype.UUID
		var startedAt, createdAt pgtype.Timestamptz
		if err := rows.Scan(&matchID, &startedAt, &createdAt); err != nil {
			s.logger.Warn("settle: scan row failed", "error", err)
			continue
		}
		if !matchID.Valid {
			continue
		}

		if err := s.settleOneMatch(ctx, matchID, startedAt, createdAt); err != nil {
			s.logger.Error("settle: failed to settle match", "matchId", uuidString(matchID), "error", err)
			continue
		}
		settled++
	}

	return settled, rows.Err()
}

// settleOneMatch 结算单个残留对局。
func (s *Service) settleOneMatch(ctx context.Context, matchID pgtype.UUID, startedAt, createdAt pgtype.Timestamptz) error {
	matchIDStr := uuidString(matchID)

	// 查询关联的 replay
	replay, err := s.queries.GetReplayByMatchID(ctx, matchID)
	if err != nil {
		// 无关联 replay：标记为 finished，winner 为空
		return s.finalizeWithoutReplay(ctx, matchID, startedAt, createdAt)
	}

	// 有 replay：尝试从 final_state 提取
	if replay.FinalState == nil || *replay.FinalState == "" {
		return s.finalizeWithoutReplay(ctx, matchID, startedAt, createdAt)
	}

	var finalState game.GameState
	if err := json.Unmarshal([]byte(*replay.FinalState), &finalState); err != nil {
		s.logger.Warn("settle: failed to parse final_state, falling back to no-replay", "matchId", matchIDStr, "error", err)
		return s.finalizeWithoutReplay(ctx, matchID, startedAt, createdAt)
	}

	// 计算 startedAt
	var startTime time.Time
	if startedAt.Valid {
		startTime = startedAt.Time
	} else if createdAt.Valid {
		startTime = createdAt.Time
	}

	return FinalizeMatch(ctx, s.queries, matchIDStr, &finalState, startTime, s.logger)
}

// finalizeWithoutReplay 标记对局为 finished，winner 为空。
func (s *Service) finalizeWithoutReplay(ctx context.Context, matchID pgtype.UUID, startedAt, createdAt pgtype.Timestamptz) error {
	var duration int32
	if startedAt.Valid {
		duration = int32(time.Since(startedAt.Time).Seconds())
	} else if createdAt.Valid {
		duration = int32(time.Since(createdAt.Time).Seconds())
	}

	_, err := s.queries.FinishMatch(ctx, db.FinishMatchParams{
		ID:         matchID,
		WinnerID:   pgtype.UUID{}, // Valid=false
		WinnerType: nil,
		TotalTurns: 0,
		Duration:   duration,
	})
	return err
}

// Start 启动周期性后台任务，每 settleInterval 执行一次 SettleStaleMatches。
func (s *Service) Start() {
	go func() {
		ticker := time.NewTicker(settleInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
				settled, err := s.SettleStaleMatches(ctx)
				cancel()
				if err != nil {
					s.logger.Error("periodic settle failed", "error", err)
				} else if settled > 0 {
					s.logger.Info("periodic settle completed", "settled", settled)
				}
			case <-s.quit:
				return
			}
		}
	}()
	s.logger.Info("settlement service started", "interval", settleInterval.String())
}

// Stop 停止后台任务。
func (s *Service) Stop() {
	close(s.quit)
	s.logger.Info("settlement service stopped")
}

// parseUUID 将字符串转为 pgtype.UUID。
func parseUUID(s string) (pgtype.UUID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: u, Valid: true}, nil
}

// uuidString 将 pgtype.UUID 转为字符串。
func uuidString(id pgtype.UUID) string {
	return uuid.UUID(id.Bytes).String()
}
