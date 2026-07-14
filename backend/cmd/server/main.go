package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/darkforest/backend/internal/api"
	"github.com/darkforest/backend/internal/auth"
	"github.com/darkforest/backend/internal/config"
	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/hub"
	"github.com/darkforest/backend/internal/match"
	"github.com/darkforest/backend/internal/replay"
	"github.com/darkforest/backend/internal/rooms"
	"github.com/darkforest/backend/internal/settlement"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func runMigrations() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable"
	}

	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "./internal/db/migrations"
	}

	m, err := migrate.New("file://"+migrationsDir, dbURL)
	if err != nil {
		return fmt.Errorf("failed to create migration instance: %w", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	slog.Info("database migrations completed")
	return nil
}

func main() {
	// Check for migration command
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		if err := runMigrations(); err != nil {
			fmt.Printf("Migration failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("Migration completed successfully")
		return
	}

	// Load configuration
	cfg := config.Load()

	// Initialize logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Run database migrations before starting server
	if err := runMigrations(); err != nil {
		logger.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	// Initialize auth (JWT, bcrypt)
	if err := auth.Init(); err != nil {
		logger.Error("failed to initialize auth", "error", err)
		os.Exit(1)
	}
	logger.Info("auth module initialized")

	// Initialize database connection pool
	if err := db.Initialize(); err != nil {
		logger.Error("failed to initialize database", "error", err)
		os.Exit(1)
	}
	logger.Info("database connection pool initialized")

	// Verify database connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.HealthCheck(ctx); err != nil {
		logger.Error("database health check failed", "error", err)
		db.Close()
		os.Exit(1)
	}
	logger.Info("database health check passed")

	// Get database queries
	queries := db.GetQueries()

	// Create replay service (used by rooms to persist game replays on game over)
	replayService := replay.NewService(queries, logger)
	logger.Info("replay service initialized")

	// Create WebSocket hub
	wsHub := hub.NewHub(logger)
	go wsHub.Run()
	logger.Info("websocket hub initialized")

	// Create room manager (manages game rooms and game state).
	// Inject replayService so each room can record & persist replays.
	// Inject queries so each room can persist match settlement to the matches table.
	roomManager := rooms.NewRoomManager(wsHub, logger, replayService, queries)
	roomManager.Start()
	logger.Info("room manager initialized")

	// Register room manager with hub as RoomService and GameService
	wsHub.SetRoomService(roomManager)
	wsHub.SetGameService(roomManager)
	logger.Info("room manager registered with hub")

	// Create matchmaking service
	matchService := match.NewMatchService(queries, wsHub, logger)
	matchService.Start()
	logger.Info("matchmaking service started")

	// Register match service with hub
	wsHub.SetMatchService(matchService)

	// Create settlement service: scans for stale matches (status waiting/playing
	// but actually finished) and settles them. Runs once at startup + periodically.
	settlementService := settlement.NewService(db.Pool, queries, logger)
	// 启动时一次性扫描修复历史残留对局
	settleCtx, settleCancel := context.WithTimeout(context.Background(), 5*time.Minute)
	if settled, err := settlementService.SettleStaleMatches(settleCtx); err != nil {
		logger.Error("startup settle failed", "error", err)
	} else if settled > 0 {
		logger.Info("startup settle completed", "settled", settled)
	}
	settleCancel()
	// 启动周期性后台任务（每小时一次）
	settlementService.Start()

	// Set room creator callback for custom queue full event.
	// matchID 关联到 matches 表的 UUID（用于回放保存），roomID 用作房间标识。
	roomsCreator := func(matchID string, roomID string, playerIDs []string) error {
		// 预检查：任一玩家离线则直接返回，无副作用，无需回滚。
		for _, pid := range playerIDs {
			if _, ok := wsHub.GetClientByPlayerID(pid); !ok {
				logger.Warn("player offline, aborting room creation", "playerId", pid, "roomId", roomID)
				return hub.ErrPlayerNotFound
			}
		}

		// 预创建房间并以队列实际人数设置 PlayerCount，避免 JoinRoom 内
		// 硬编码 4 导致 PlayerCount 与实际玩家数不一致（否则 NewGame 会因
		// PlayerSeeds 长度 < PlayerCount 而越界 panic，进而触发
		// "有玩家未连接，游戏无法开始" 的误报）。
		roomManager.GetOrCreateRoom(roomID, len(playerIDs))

		// 记录已成功加入房间的玩家，失败时用于回滚。
		type joinedInfo struct {
			playerID string
			clientID string
		}
		var joined []joinedInfo

		// rollbackJoined 回滚已加入的玩家：移出房间 + 清理 hub 映射。
		rollbackJoined := func() {
			for i := len(joined) - 1; i >= 0; i-- {
				if err := roomManager.LeaveRoom(joined[i].playerID); err != nil {
					logger.Warn("rollback LeaveRoom failed", "playerId", joined[i].playerID, "error", err)
				}
				wsHub.RemoveClientFromRoom(joined[i].clientID, roomID)
			}
		}

		for _, playerID := range playerIDs {
			client, ok := wsHub.GetClientByPlayerID(playerID)
			if !ok {
				// 预检查后仍离线（竞态），回滚已加入玩家并清理房间。
				logger.Error("player went offline during room join", "playerId", playerID, "roomId", roomID)
				rollbackJoined()
				roomManager.RemoveRoom(roomID)
				return hub.ErrPlayerNotFound
			}

			playerInfo := &hub.PlayerInfo{
				ID:          client.PlayerID,
				UserID:      client.UserID,
				DisplayName: client.DisplayName,
				Role:        client.Role,
			}

			if _, err := roomManager.JoinRoom(playerInfo, roomID); err != nil {
				logger.Error("player failed to join room", "playerId", playerID, "roomId", roomID, "error", err)
				rollbackJoined()
				roomManager.RemoveRoom(roomID)
				return err
			}
			wsHub.AddClientToRoom(client.ID, roomID)
			// Send room:joined event so the joining player's frontend transitions
			// from the "queue" UI (which may be showing "队列已满，正在创建房间...")
			// to the "room" UI. Without this, the player stays stuck on the queue
			// screen because currentRoom is never set.
			wsHub.SendRoomJoinedInfo(client, roomID)
			joined = append(joined, joinedInfo{playerID: playerID, clientID: client.ID})
		}

		// 广播倒计时通知：游戏即将在 5 秒后开始
		const countdownSeconds = 5
		players := roomManager.GetRoomPlayerList(roomID)
		startingPayload, _ := json.Marshal(map[string]interface{}{
			"roomId":           roomID,
			"startedBy":        "",
			"startedAt":        time.Now().Unix(),
			"players":          players,
			"countdownSeconds": countdownSeconds,
		})
		wsHub.BroadcastToRoom(roomID, hub.Message{
			Type:    string(hub.EvtSrvRoomGameStarting),
			RoomID:  roomID,
			Payload: startingPayload,
		})
		logger.Info("game countdown started", "roomId", roomID, "matchId", matchID, "countdownSeconds", countdownSeconds)

		// 5 秒后实际开始游戏
		time.AfterFunc(countdownSeconds*time.Second, func() {
			_, err := roomManager.StartGameInRoomWithMatchInfo(roomID, matchID, "")
			if err != nil {
				logger.Error("failed to start game after countdown", "roomId", roomID, "matchId", matchID, "error", err)
				errPayload, _ := json.Marshal(map[string]string{"message": "游戏开始失败，请重新匹配"})
				wsHub.BroadcastToRoom(roomID, hub.Message{
					Type:    string(hub.EvtSrvMatchError),
					RoomID:  roomID,
					Payload: errPayload,
				})
				roomManager.RemoveRoom(roomID)
				return
			}

			logger.Info("game started after countdown", "roomId", roomID, "matchId", matchID, "playerCount", len(playerIDs))

			startedPayload, _ := json.Marshal(map[string]interface{}{
				"roomId":    roomID,
				"startedBy": "",
				"startedAt": time.Now().Unix(),
				"players":   roomManager.GetRoomPlayerList(roomID),
			})
			wsHub.BroadcastToRoom(roomID, hub.Message{
				Type:    string(hub.EvtSrvRoomGameStarted),
				RoomID:  roomID,
				Payload: startedPayload,
			})
		})

		return nil
	}
	matchService.SetRoomCreator(roomsCreator)

	// Create router and setup routes. Replay handler also receives replayService.
	router := api.NewRouter(cfg, logger, queries, wsHub, replayService)
	router.SetupRoutes()

	// Create HTTP server
	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		logger.Info("starting server", "port", cfg.Port, "environment", cfg.Environment)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			db.Close()
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server...")

	// Give outstanding requests 30 seconds to complete
	ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("server forced to shutdown", "error", err)
		settlementService.Stop()
		matchService.Stop()
		roomManager.Stop()
		db.Close()
		os.Exit(1)
	}

	// Stop settlement service
	settlementService.Stop()
	logger.Info("settlement service stopped")

	// Stop matchmaking service
	matchService.Stop()
	logger.Info("matchmaking service stopped")

	// Stop room manager
	roomManager.Stop()
	logger.Info("room manager stopped")

	// Close database connection pool
	db.Close()
	logger.Info("server stopped")
}
