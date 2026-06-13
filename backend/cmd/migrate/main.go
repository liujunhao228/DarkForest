package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable"
	}

	poolConfig, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		fmt.Printf("Failed to parse DATABASE_URL: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		fmt.Printf("Failed to create connection pool: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		fmt.Printf("Failed to ping database: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Database connection: OK")

	migrationsDir := "internal/db/migrations"

	files, err := os.ReadDir(migrationsDir)
	if err != nil {
		fmt.Printf("Failed to read migrations directory: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Looking for migration files...\n")

	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".up.sql") {
			fullPath := filepath.Join(migrationsDir, f.Name())
			fmt.Printf("  -> Applying: %s\n", f.Name())

			content, err := os.ReadFile(fullPath)
			if err != nil {
				fmt.Printf("Failed to read file: %v\n", err)
				os.Exit(1)
			}

			sqlContent := string(content)

			// Split by semicolon for simpler execution
			_, err = pool.Exec(ctx, sqlContent)
			if err != nil {
				fmt.Printf("Failed to execute migration: %v\n", err)
				os.Exit(1)
			}

			fmt.Printf("  OK\n")
		}
	}

	// Verify tables created
	count := 0
	var tableName string
	rows, err := pool.Query(ctx, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
	if err != nil {
		fmt.Printf("Failed to list tables: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Println("\nTables created:")
	for rows.Next() {
		err := rows.Scan(&tableName)
		if err != nil {
			fmt.Printf("Error scanning row: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("  - %s\n", tableName)
		count++
	}

	if err := rows.Err(); err != nil && err != io.EOF {
		fmt.Printf("Error iterating rows: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\nTotal tables: %d\n", count)
	fmt.Println("\nMigration completed successfully!")

	// Verify with a simple query
	playerCount := 0
	err = pool.QueryRow(ctx, "SELECT COUNT(*) FROM players").Scan(&playerCount)
	if err != nil {
		fmt.Printf("Query players count: %v (table may be empty, but that's OK)\n", err)
	} else {
		fmt.Printf("Players in table: %d\n", playerCount)
	}
}
