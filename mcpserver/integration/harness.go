// Package integration 提供 LOCAL_TRUST_MODE 集成验收的黑盒 harness:
// 起 trust backend(Postgres) + mcpserver(SQLite),以真实 MCP StreamableHTTP
// 客户端驱动两个 agent 会话完成「匹配 → 对局 → 结算 → 回放」全链路断言。
//
// 门控:顶层测例要求 TRUST_E2E=1 且 DATABASE_URL 可达,否则 t.Skip
// (保证 `go test ./...` 在无 DB 环境下不被拖垮;`make trust-e2e` 会置 TRUST_E2E=1)。
package integration

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

// 默认端口(可被环境变量覆盖;并行场景用 pickFreePort 取空闲端口)。
const (
	defaultBackendPort = 18080
	defaultMCPPort     = 19090
)

// trustEnabled 报告是否应运行需要真实后端的集成测试(TRUST_E2E=1)。
func trustEnabled() bool { return os.Getenv("TRUST_E2E") == "1" }

// repoRoot 返回仓库根目录(integration 位于 <root>/mcpserver/integration)。
func repoRoot() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return filepath.Dir(filepath.Dir(wd))
}

// pickFreePort 返回 host 上的一个空闲 TCP 端口。
func pickFreePort(host string) (int, error) {
	l, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// loadBackendDotEnv 解析 backend/.env 的键值(与 bot/e2e/backend_runner.py 同语义)。
func loadBackendDotEnv() map[string]string {
	out := map[string]string{}
	b, err := os.ReadFile(filepath.Join(repoRoot(), "backend", ".env"))
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		kv := strings.SplitN(line, "=", 2)
		key := strings.TrimSpace(kv[0])
		val := strings.Trim(strings.TrimSpace(kv[1]), `"`)
		if key != "" {
			out[key] = val
		}
	}
	return out
}

// requireDB 返回可写 Postgres DSN;缺 DATABASE_URL 时优先读 backend/.env,
// 仍无则 t.Skip 并给出提示。
func requireDB(t *testing.T) string {
	t.Helper()
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}
	if dsn := loadBackendDotEnv()["DATABASE_URL"]; dsn != "" {
		return dsn
	}
	t.Skip("需要 DATABASE_URL(可由 CI 服务容器 / docker compose up -d postgres 提供)")
	return ""
}

// withEnv 基于 os.Environ() 副本生成 env slice,overrides 覆盖旧键(去重)。
func withEnv(overrides map[string]string) []string {
	env := os.Environ()
	skip := make(map[string]bool, len(overrides))
	for k := range overrides {
		skip[k] = true
	}
	out := make([]string, 0, len(env)+len(overrides))
	for _, e := range env {
		key := e
		if i := strings.Index(e, "="); i >= 0 {
			key = e[:i]
		}
		if skip[key] {
			continue
		}
		out = append(out, e)
	}
	for k, v := range overrides {
		out = append(out, k+"="+v)
	}
	return out
}

// trustBackendEnv 组装 trust backend 子进程 env(E2E override 契约 + DATABASE_URL)。
func trustBackendEnv(t *testing.T, port int) []string {
	t.Helper()
	dsn := requireDB(t)
	return withEnv(map[string]string{
		"PORT":                        strconv.Itoa(port),
		"LOCAL_TRUST_MODE":            "1",
		"DISABLE_RATE_LIMIT":          "1",
		"E2E_RAND_SEED":               "42",
		"E2E_DETERMINISTIC_UID":       "1",
		"E2E_MATCH_CHECK_INTERVAL_MS": "1000",
		"E2E_MATCHMAKING_TIMEOUT_MS":  "30000",
		"E2E_FALLBACK_TIMEOUT_MS":     "3000",
		"E2E_TEST_API":                "1",
		"DATABASE_URL":                dsn,
	})
}

// mcpserverEnv 组装 mcpserver 子进程 env(trust + 指向 backend + agent 播种)。
func mcpserverEnv(mcpPort, backendPort int, dbPath string) []string {
	return withEnv(map[string]string{
		"LOCAL_TRUST_MODE": "1",
		"GAME_API_URL":     fmt.Sprintf("http://127.0.0.1:%d", backendPort),
		"GAME_WS_URL":      fmt.Sprintf("ws://127.0.0.1:%d/ws", backendPort),
		"MCP_PORT":         strconv.Itoa(mcpPort),
		"DB_PATH":          dbPath,
		"AGENT_SEED_NAME":  "alpha,beta",
	})
}

// exeSuffix 返回当前平台的可执行文件后缀。
func exeSuffix() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

// spawnBackend 构建并启动 trust backend 子进程,返回其句柄与监听端口。
// 构建产物放 t.TempDir(),进程注册 t.Cleanup 整树清理。
func spawnBackend(t *testing.T, env []string, logW io.Writer) (*exec.Cmd, int) {
	t.Helper()
	backendDir := filepath.Join(repoRoot(), "backend")
	bin := filepath.Join(t.TempDir(), "df-server"+exeSuffix())

	build := exec.Command("go", "build", "-o", bin, "./cmd/server")
	build.Dir = backendDir
	build.Env = env
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("构建 backend 失败: %v\n%s", err, out)
	}

	cmd := exec.Command(bin)
	cmd.Dir = backendDir
	cmd.Env = env
	cmd.Stdout = logW
	cmd.Stderr = logW
	if err := cmd.Start(); err != nil {
		t.Fatalf("启动 backend 失败: %v", err)
	}
	t.Cleanup(func() { killTree(t, cmd) })

	port := defaultBackendPort
	for _, e := range env {
		if strings.HasPrefix(e, "PORT=") {
			if n, err := strconv.Atoi(strings.TrimPrefix(e, "PORT=")); err == nil {
				port = n
			}
		}
	}
	return cmd, port
}

// spawnMcpserver 构建并启动 mcpserver 子进程,返回其句柄与监听端口。
func spawnMcpserver(t *testing.T, env []string, logW io.Writer) (*exec.Cmd, int) {
	t.Helper()
	mcpDir := filepath.Join(repoRoot(), "mcpserver")
	bin := filepath.Join(t.TempDir(), "df-mcps"+exeSuffix())

	build := exec.Command("go", "build", "-o", bin, "./cmd/mcpserver")
	build.Dir = mcpDir
	build.Env = env
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("构建 mcpserver 失败: %v\n%s", err, out)
	}

	cmd := exec.Command(bin)
	cmd.Dir = mcpDir
	cmd.Env = env
	cmd.Stdout = logW
	cmd.Stderr = logW
	if err := cmd.Start(); err != nil {
		t.Fatalf("启动 mcpserver 失败: %v", err)
	}
	t.Cleanup(func() { killTree(t, cmd) })

	port := defaultMCPPort
	for _, e := range env {
		if strings.HasPrefix(e, "MCP_PORT=") {
			if n, err := strconv.Atoi(strings.TrimPrefix(e, "MCP_PORT=")); err == nil {
				port = n
			}
		}
	}
	return cmd, port
}

// killTreeCmd 终止子进程及其整棵进程树(Windows 用 taskkill /T /F),不依赖 *testing.T。
// 供 trustEnv.stop() 在两轮之间显式关停(t.Cleanup 仅在测试结束才触发)。
func killTreeCmd(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	if runtime.GOOS == "windows" {
		if err := exec.Command("taskkill", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F").Run(); err != nil {
			_ = cmd.Process.Kill()
		}
		_, _ = cmd.Process.Wait()
		return
	}
	_ = cmd.Process.Kill()
	_, _ = cmd.Process.Wait()
}

// killTree 终止子进程及其整棵进程树(Windows 用 taskkill /T /F)。
func killTree(t *testing.T, cmd *exec.Cmd) {
	t.Helper()
	if cmd == nil || cmd.Process == nil {
		return
	}
	if runtime.GOOS == "windows" {
		err := exec.Command("taskkill", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F").Run()
		if err != nil {
			_ = cmd.Process.Kill()
		}
		return
	}
	_ = cmd.Process.Kill()
}

// healthURL 拼接 127.0.0.1 上的健康检查 URL(backend 用 api/health,mcpserver 用 health)。
func healthURL(port int, path string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/%s", port, path)
}

// waitHealth 轮询 url,<500 状态码即视为就绪(与 bot backend_runner 同语义)。
func waitHealth(t *testing.T, url string, timeout time.Duration) {
	t.Helper()
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 500 {
				return
			}
			lastErr = fmt.Errorf("http %d", resp.StatusCode)
		} else {
			lastErr = err
		}
		time.Sleep(500 * time.Millisecond)
	}
	t.Fatalf("服务未就绪(%s): %v", url, lastErr)
}
