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
	"github.com/darkforest/backend/internal/rooms"
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

	// Create WebSocket hub
	wsHub := hub.NewHub(logger)
	go wsHub.Run()
	logger.Info("websocket hub initialized")

	// Create room manager (manages game rooms and game state)
	roomManager := rooms.NewRoomManager(wsHub, logger)
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

	// Set room creator callback for custom queue full event
	roomsCreator := func(queueID string, playerIDs []string) error {
		roomID := queueID

		// Get player info and add to room.
		// If ANY player is not currently connected, abort the game start so the
		// matchmaking service can reset the queue status (otherwise the queue
		// would be stuck in "full" forever).
		notFoundCount := 0
		for _, playerID := range playerIDs {
			client, ok := wsHub.GetClientByPlayerID(playerID)
			if !ok {
				notFoundCount++
				logger.Warn("player not found for room join", "playerId", playerID, "roomId", roomID)
				continue
			}

			playerInfo := &hub.PlayerInfo{
				ID:          client.PlayerID,
				UserID:      client.UserID,
				DisplayName: client.DisplayName,
				Role:        client.Role,
			}

			if _, err := roomManager.JoinRoom(playerInfo, roomID); err != nil {
				logger.Error("player failed to join room", "playerId", playerID, "roomId", roomID, "error", err)
				return err
			}
			wsHub.AddClientToRoom(client.ID, roomID)
			// Send room:joined event so the joining player's frontend transitions
			// from the "queue" UI (which may be showing "队列已满，正在创建房间...")
			// to the "room" UI. Without this, the player stays stuck on the queue
			// screen because currentRoom is never set.
			wsHub.SendRoomJoinedInfo(client, roomID)
		}

		if notFoundCount > 0 {
			logger.Error("aborting game start, some players are offline", "roomId", roomID, "total", len(playerIDs), "missing", notFoundCount)
			return hub.ErrPlayerNotFound
		}

		// Start the game
		err := roomManager.StartGameInRoom(roomID, "")
		if err != nil {
			logger.Error("failed to start game from queue", "roomId", roomID, "error", err)
			return err
		}

		logger.Info("game started from custom queue", "roomId", roomID, "playerCount", len(playerIDs))

		// Broadcast room info to players
		players := roomManager.GetRoomPlayerList(roomID)
		payload, _ := json.Marshal(map[string]interface{}{
			"roomId":    roomID,
			"startedBy": "",
			"startedAt": time.Now().Unix(),
			"players":   players,
		})
		wsHub.BroadcastToRoom(roomID, hub.Message{
			Type:    string(hub.EvtSrvRoomGameStarting),
			RoomID:  roomID,
			Payload: payload,
		})
		return nil
	}
	matchService.SetRoomCreator(roomsCreator)

	// Create router and setup routes
	router := api.NewRouter(cfg, logger, queries, wsHub)
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
		matchService.Stop()
		roomManager.Stop()
		db.Close()
		os.Exit(1)
	}

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
