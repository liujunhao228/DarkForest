// Package main 是 MCP Server 的入口,支持两种模式:
// 1. 服务模式(默认):启动 MCP Server,监听 Streamable HTTP 端点
// 2. 管理模式:mcpserver admin register --count N --prefix "Bot_" --admin-token <JWT>
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/config"
	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
	"darkforest/mcpserver/internal/server"
	"darkforest/mcpserver/internal/session"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "admin" {
		runAdmin()
		return
	}
	runServer()
}

// runServer 启动 MCP Server 服务。
func runServer() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	db, err := persistence.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer db.Close()

	httpC := gamesdk.NewHTTPClient(cfg.GameAPIURL)
	pool := account.NewPool(db.Account, httpC)
	if err := pool.LoadFromDB(); err != nil {
		log.Printf("警告: 从数据库加载账户失败: %v", err)
	}
	log.Printf("账户池已加载: 共 %d 个账户, %d 个可用", len(pool.ListAll()), pool.AvailableCount())

	mgr := session.NewManager(pool, httpC, cfg.GameWSURL, cfg.WSReconnectMax)
	mcpServer := server.New(cfg, pool, mgr, db)

	mux := server.NewMux(cfg.MCPEndpoint, mcpServer)

	httpSrv := &http.Server{
		Addr:    ":" + cfg.MCPPort,
		Handler: mux,
	}

	// 优雅关闭
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("MCP Server 监听 :%s (端点 %s)", cfg.MCPPort, cfg.MCPEndpoint)
		log.Printf("游戏后端: %s / %s", cfg.GameAPIURL, cfg.GameWSURL)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP 服务启动失败: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("正在关闭...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP 关闭警告: %v", err)
	}
	mgr.CloseAll()
	log.Println("已关闭所有会话并归还账户")
}

// runAdmin 处理 admin 子命令。
func runAdmin() {
	if len(os.Args) < 3 {
		fmt.Println("用法: mcpserver admin <command> [options]")
		fmt.Println("命令:")
		fmt.Println("  register  预注册账户到池中")
		fmt.Println("  list      列出池中所有账户")
		os.Exit(1)
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := persistence.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer db.Close()

	httpC := gamesdk.NewHTTPClient(cfg.GameAPIURL)
	pool := account.NewPool(db.Account, httpC)
	if err := pool.LoadFromDB(); err != nil {
		log.Printf("警告: %v", err)
	}

	switch os.Args[2] {
	case "register":
		runAdminRegister(cfg, pool)
	case "list":
		runAdminList(pool)
	default:
		log.Fatalf("未知 admin 命令: %s", os.Args[2])
	}
}

// runAdminRegister 批量预注册账户。
func runAdminRegister(cfg *config.Config, pool *account.Pool) {
	fs := flag.NewFlagSet("admin register", flag.ExitOnError)
	count := fs.Int("count", 1, "注册数量")
	prefix := fs.String("prefix", "Bot_", "账户名前缀")
	adminToken := fs.String("admin-token", "", "admin JWT(留空则用 ADMIN_TOKEN 环境变量)")
	_ = fs.Parse(os.Args[3:])

	token := *adminToken
	if token == "" {
		token = cfg.AdminToken
	}
	if token == "" {
		log.Fatal("需要 --admin-token 或 ADMIN_TOKEN 环境变量来生成邀请码")
	}

	for i := 0; i < *count; i++ {
		displayName := fmt.Sprintf("%s%d", *prefix, time.Now().UnixNano()%100000+int64(i))
		acc, err := pool.Register(displayName, "", "", token)
		if err != nil {
			log.Printf("注册 %s 失败: %v", displayName, err)
			continue
		}
		log.Printf("已注册: %s (ID: %s)", acc.DisplayName, acc.ID)
	}
	log.Printf("完成。池中共 %d 个账户, %d 个可用", len(pool.ListAll()), pool.AvailableCount())
}

// runAdminList 列出池中所有账户。
func runAdminList(pool *account.Pool) {
	all := pool.ListAll()
	if len(all) == 0 {
		fmt.Println("账户池为空")
		return
	}
	fmt.Printf("%-36s %-20s %-10s %-10s %s\n", "ID", "名称", "角色", "状态", "借用者")
	fmt.Println(string([]byte{45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45}))
	for _, a := range all {
		assigned := a.AssignedTo
		if assigned == "" {
			assigned = "-"
		}
		fmt.Printf("%-36s %-20s %-10s %-10s %s\n", a.ID, a.DisplayName, a.Role, a.Status, assigned)
	}
	fmt.Printf("\n共 %d 个账户, %d 个可用\n", len(all), pool.AvailableCount())
}
