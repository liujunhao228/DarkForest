package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "sqlite://darkforest.db"
	}

	// 去掉 sqlite:// scheme，得到 SQLite 文件路径
	dsn := strings.TrimPrefix(dbURL, "sqlite://")
	if dsn == dbURL {
		fmt.Printf("DATABASE_URL 必须以 sqlite:// 开头: %s\n", dbURL)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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

			// SQLite database/sql 驱动单次 Exec 只接受一条语句，
			// 按分号拆分逐条执行（本仓库迁移无字符串内分号）。
			for _, stmt := range strings.Split(string(content), ";") {
				stmt = strings.TrimSpace(stmt)
				if stmt == "" || strings.HasPrefix(stmt, "--") {
					continue
				}
				if _, err := db.ExecContext(ctx, stmt); err != nil {
					fmt.Printf("Failed to execute migration statement: %v\n%s\n", err, stmt)
					os.Exit(1)
				}
			}

			fmt.Printf("  OK\n")
		}
	}

	// Verify tables created
	count := 0
	rows, err := db.QueryContext(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err != nil {
		fmt.Printf("Failed to list tables: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Println("\nTables created:")
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			fmt.Printf("Error scanning row: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("  - %s\n", tableName)
		count++
	}

	if err := rows.Err(); err != nil {
		fmt.Printf("Error iterating rows: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\nTotal tables: %d\n", count)
	fmt.Println("\nMigration completed successfully!")

	// Verify with a simple query
	playerCount := 0
	err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM players").Scan(&playerCount)
	if err != nil {
		fmt.Printf("Query players count: %v (table may be empty, but that's OK)\n", err)
	} else {
		fmt.Printf("Players in table: %d\n", playerCount)
	}
}
