package settlement

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/google/uuid"
)

// settleInterval 是周期性扫描残留对局的时间间隔。
const settleInterval = 1 * time.Hour

// Service 负责结算残留对局（status 为 waiting/playing 但实际已结束的对局）。
// 它提供启动时一次性扫描 + 周期性后台任务两种触发方式。
type Service struct {
	pool    *sql.DB
	queries *db.Queries
	logger  *slog.Logger
	quit    chan struct{}
}

// NewService 创建结算服务。pool 用于原生 SQL 批量扫描，queries 用于调用 sqlc 生成的方法。
func NewService(pool *sql.DB, queries *db.Queries, logger *slog.Logger) *Service {
	return &Service{
		pool:    pool,
		queries: queries,
		logger:  logger,
		quit:    make(chan struct{}),
	}
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

// FinalizeMatch 是公共结算函数：从 GameState 提取结算信息，
// 调用 FinishMatch 更新 matches 表，并遍历 Players 调用 UpdateMatchPlayerStats。
// 供实时结算（RoomManager）和历史修复（SettleStaleMatches）共用。
//
// 参数：
//   - matchID: 对局 UUID 字符串
//   - state: 游戏最终状态（可为 nil，表示无法获取状态，仅标记 finished）
//   - startedAt: 对局开始时间，用于计算 duration；零值时 duration=0
func FinalizeMatch(ctx context.Context, queries *db.Queries, matchID string, state *game.GameState, startedAt time.Time, logger *slog.Logger) error {
	// 提取 winner
	var winnerID *string
	var winnerType *string
	if state != nil && state.Winner != nil && *state.Winner != "" {
		if _, err := uuid.Parse(*state.Winner); err != nil {
			logger.Warn("finalizeMatch: invalid winner ID, leaving winner empty", "winner", *state.Winner, "error", err)
		} else {
			winnerID = state.Winner
			wt := "human"
			winnerType = &wt
		}
	}

	// 提取 totalTurns
	var totalTurns int64
	if state != nil {
		totalTurns = int64(state.TotalTurn)
	}

	// 计算 duration
	var duration int64
	if !startedAt.IsZero() {
		duration = int64(time.Since(startedAt).Seconds())
	}

	// 序列化 game_log
	var gameLog *string
	if state != nil && len(state.Logs) > 0 {
		logData, err := json.Marshal(state.Logs)
		if err == nil {
			logStr := string(logData)
			gameLog = &logStr
		}
	}

	// 调用 FinishMatch
	_, err := queries.FinishMatch(ctx, db.FinishMatchParams{
		ID:         matchID,
		WinnerID:   winnerID,
		WinnerType: winnerType,
		TotalTurns: totalTurns,
		Duration:   duration,
		GameLog:    gameLog,
	})
	if err != nil {
		return fmt.Errorf("FinishMatch failed: %w", err)
	}

	// 更新 match_players 统计
	if state != nil {
		for _, p := range state.Players {
			if _, err := uuid.Parse(p.ID); err != nil {
				logger.Warn("finalizeMatch: invalid player ID, skipping stats update", "playerId", p.ID, "error", err)
				continue
			}
			var finalRank *int64
			if state.Winner != nil && *state.Winner == p.ID {
				rank := int64(1)
				finalRank = &rank
			}
			var eliminatedTurn *int64
			if p.EliminatedTurn > 0 {
				et := int64(p.EliminatedTurn)
				eliminatedTurn = &et
			}
			_, err := queries.UpdateMatchPlayerStats(ctx, db.UpdateMatchPlayerStatsParams{
				MatchID:        matchID,
				PlayerID:       p.ID,
				FinalRank:      finalRank,
				IsEliminated:   p.Eliminated,
				EliminatedTurn: eliminatedTurn,
				Energy:         int64(p.Energy),
				DestroyedStars: int64(p.DestroyedStarCount),
				BroadcastCount: int64(p.BroadcastSuccessCount),
				StrikeCount:    int64(p.StrikeCount),
			})
			if err != nil {
				logger.Warn("finalizeMatch: UpdateMatchPlayerStats failed", "playerId", p.ID, "error", err)
			}

			// 更新 players 表全局统计（wins/losses/draws/total_matches）
			playerStat, statErr := queries.GetPlayerByID(ctx, p.ID)
			if statErr != nil {
				logger.Warn("finalizeMatch: GetPlayerByID failed", "playerId", p.ID, "error", statErr)
				continue
			}
			var wins, losses, draws int64 = playerStat.Wins, playerStat.Losses, playerStat.Draws
			if state.Winner == nil {
				draws++
			} else if *state.Winner == p.ID {
				wins++
			} else {
				losses++
			}
			_, statErr = queries.UpdatePlayerStats(ctx, db.UpdatePlayerStatsParams{
				ID:           p.ID,
				Wins:         wins,
				Losses:       losses,
				Draws:        draws,
				TotalMatches: playerStat.TotalMatches + 1,
			})
			if statErr != nil {
				logger.Warn("finalizeMatch: UpdatePlayerStats failed", "playerId", p.ID, "error", statErr)
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
	rows, err := s.pool.QueryContext(ctx, `
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
		var matchID, createdAt string
		var startedAt sql.NullString
		if err := rows.Scan(&matchID, &startedAt, &createdAt); err != nil {
			s.logger.Warn("settle: scan row failed", "error", err)
			continue
		}
		if matchID == "" {
			continue
		}

		startTime := parseTS(createdAt)
		if startedAt.Valid && startedAt.String != "" {
			startTime = parseTS(startedAt.String)
		}

		if err := s.settleOneMatch(ctx, matchID, startTime); err != nil {
			s.logger.Error("settle: failed to settle match", "matchId", matchID, "error", err)
			continue
		}
		settled++
	}

	return settled, rows.Err()
}

// settleOneMatch 结算单个残留对局。
func (s *Service) settleOneMatch(ctx context.Context, matchID string, startTime time.Time) error {
	// 查询关联的 replay
	replay, err := s.queries.GetReplayByMatchID(ctx, matchID)
	if err != nil {
		// 无关联 replay：标记为 finished，winner 为空
		return s.finalizeWithoutReplay(ctx, matchID, startTime)
	}

	// 有 replay：尝试从 final_state 提取
	if replay.FinalState == nil || *replay.FinalState == "" {
		return s.finalizeWithoutReplay(ctx, matchID, startTime)
	}

	var finalState game.GameState
	if err := json.Unmarshal([]byte(*replay.FinalState), &finalState); err != nil {
		s.logger.Warn("settle: failed to parse final_state, falling back to no-replay", "matchId", matchID, "error", err)
		return s.finalizeWithoutReplay(ctx, matchID, startTime)
	}

	return FinalizeMatch(ctx, s.queries, matchID, &finalState, startTime, s.logger)
}

// finalizeWithoutReplay 标记对局为 finished，winner 为空。
func (s *Service) finalizeWithoutReplay(ctx context.Context, matchID string, startTime time.Time) error {
	var duration int64
	if !startTime.IsZero() {
		duration = int64(time.Since(startTime).Seconds())
	}

	_, err := s.queries.FinishMatch(ctx, db.FinishMatchParams{
		ID:         matchID,
		WinnerID:   nil,
		WinnerType: nil,
		TotalTurns: 0,
		Duration:   duration,
		GameLog:    nil,
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
