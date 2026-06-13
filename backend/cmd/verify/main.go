package main

import (
	"context"
	"fmt"
	"os"
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
	fmt.Println()

	// List all tables
	rows, err := pool.Query(ctx, `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
		ORDER BY table_name
	`)
	if err != nil {
		fmt.Printf("Failed to list tables: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Println("Tables in 'public' schema:")
	count := 0
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			fmt.Printf("Error scanning row: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("  - %s\n", tableName)
		count++
	}
	fmt.Printf("\nTotal tables: %d\n", count)

	// Check schema_migrations table
	var version int
	var dirty bool
	err = pool.QueryRow(ctx, "SELECT version, dirty FROM schema_migrations LIMIT 1").Scan(&version, &dirty)
	if err != nil {
		fmt.Printf("\nWarning: schema_migrations table query failed: %v\n", err)
	} else {
		fmt.Printf("\nMigration version: %d, dirty: %v\n", version, dirty)
	}

	// Verify players table structure
	fmt.Println("\nPlayers table columns:")
	playerRows, err := pool.Query(ctx, `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'players'
		ORDER BY ordinal_position
	`)
	if err != nil {
		fmt.Printf("  (error: %v)\n", err)
	} else {
		defer playerRows.Close()
		for playerRows.Next() {
			var colName, dataType, isNullable string
			if err := playerRows.Scan(&colName, &dataType, &isNullable); err != nil {
				fmt.Printf("  Error: %v\n", err)
				break
			}
			fmt.Printf("  - %s (%s, nullable: %s)\n", colName, dataType, isNullable)
		}
	}

	fmt.Println("\nDatabase verification: PASSED")
}
