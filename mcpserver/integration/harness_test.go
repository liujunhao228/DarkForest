package integration

import (
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestSpawn 验证 harness 进程编排本身:能起 trust backend(health ok)+
// mcpserver(health ok),随后 t.Cleanup 整树杀干净。
// 门控:TRUST_E2E=1 且 DATABASE_URL 可达,否则跳过。
func TestSpawn(t *testing.T) {
	if !trustEnabled() {
		t.Skip("TRUST_E2E!=1,跳过集成 harness 骨架测试(开发机无 DB 不硬卡)")
	}
	backendPort, err := pickFreePort("127.0.0.1")
	if err != nil {
		t.Fatalf("pickFreePort 失败: %v", err)
	}
	mcpPort, err := pickFreePort("127.0.0.1")
	if err != nil {
		t.Fatalf("pickFreePort 失败: %v", err)
	}

	// 日志:测试失败时打印,便于定位
	logW := io.Discard
	if os.Getenv("TRUST_E2E_VERBOSE") == "1" {
		logW = os.Stdout
	}

	backendEnv := trustBackendEnv(t, backendPort)
	_, backendPort = spawnBackend(t, backendEnv, logW)

	dbPath := filepath.Join(t.TempDir(), "mcps.db")
	mcpEnv := mcpserverEnv(mcpPort, backendPort, dbPath)
	_, mcpPort = spawnMcpserver(t, mcpEnv, logW)

	waitHealth(t, healthURL(backendPort, "api/health"), 90*time.Second)
	waitHealth(t, healthURL(mcpPort, "health"), 30*time.Second)
	t.Logf("backend :%d + mcpserver :%d 均就绪,清理由 t.Cleanup 负责", backendPort, mcpPort)
}
