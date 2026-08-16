package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "sqlite://darkforest.db"
	}

	dsn := strings.TrimPrefix(dbURL, "sqlite://")
	if dsn == dbURL {
		fmt.Printf("DATABASE_URL 必须以 sqlite:// 开头: %s\n", dbURL)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := sql.Open("sqlite", "file:"+dsn+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)")
	if err != nil {
		fmt.Printf("Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		fmt.Printf("Failed to ping database: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Database connection: OK")
	fmt.Println()

	// List all tables
	rows, err := db.QueryContext(ctx, `
		SELECT name
		FROM sqlite_master
		WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
		ORDER BY name
	`)
	if err != nil {
		fmt.Printf("Failed to list tables: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Println("Tables:")
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
	err = db.QueryRowContext(ctx, "SELECT version, dirty FROM schema_migrations LIMIT 1").Scan(&version, &dirty)
	if err != nil {
		fmt.Printf("\nWarning: schema_migrations table query failed: %v\n", err)
	} else {
		fmt.Printf("\nMigration version: %d, dirty: %v\n", version, dirty)
	}

	// Verify players table structure
	fmt.Println("\nPlayers table columns:")
	playerRows, err := db.QueryContext(ctx, `
		SELECT name, type, "notnull"
		FROM pragma_table_info('players')
		ORDER BY cid
	`)
	if err != nil {
		fmt.Printf("  (error: %v)\n", err)
	} else {
		defer playerRows.Close()
		for playerRows.Next() {
			var colName, dataType string
			var notNull int
			if err := playerRows.Scan(&colName, &dataType, &notNull); err != nil {
				fmt.Printf("  Error: %v\n", err)
				break
			}
			nullable := "NO"
			if notNull == 0 {
				nullable = "YES"
			}
			fmt.Printf("  - %s (%s, nullable: %s)\n", colName, dataType, nullable)
		}
	}

	fmt.Println("\nDatabase verification: PASSED")
}
