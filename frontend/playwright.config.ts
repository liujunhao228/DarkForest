import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// ESM 下 __dirname 不可用，需通过 import.meta.url 派生
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 从 backend/.env 加载环境变量（不引入 dotenv 依赖）
 *
 * Go 后端通过 os.Getenv 直接读取环境变量，无 .env 自动加载；
 * Playwright webServer.env 需手动注入 DATABASE_URL / JWT_SECRET / ADMIN_SECRET_KEY。
 * 仅加载 backend/.env 中已存在的键，不覆盖 process.env 已有的值（让 shell 显式设置优先）。
 */
function loadBackendEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, '../backend/.env');
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
    if (match) {
      env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const backendEnv = loadBackendEnv();

/**
 * Playwright E2E 配置
 *
 * 架构（D1 决策）：单源 —— Go 后端通过 STATIC_DIR 静态服务前端构建产物，
 * E2E 直接打 http://localhost:8080，无需 Vite preview 双服务器。
 *
 * 启动链路（pnpm e2e）：
 *   1. pnpm build  → 产物在 frontend/dist
 *   2. playwright test 触发 webServer 启动 go run ./cmd/server
 *      （STATIC_DIR 指向 ../frontend/dist，后端同时服务 API + 静态前端）
 *   3. globalSetup 引导 admin + 预生成邀请码
 *   4. 测试用例运行
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // 跨平台启动命令：Windows 用反斜杠
    command: process.platform === 'win32'
      ? 'cd ..\\backend && go run ./cmd/server'
      : 'cd ../backend && go run ./cmd/server',
    url: 'http://localhost:8080/',
    reuseExistingServer: true,
    timeout: 60_000,
    cwd: __dirname,
    env: {
      // 后端作为静态资源服务前端构建产物
      STATIC_DIR: '../frontend/dist',
      // 先注入 backend/.env（提供 DATABASE_URL / JWT_SECRET / ADMIN_SECRET_KEY）
      // 再让 process.env 覆盖（shell 显式导出的值优先级更高）
      ...backendEnv,
      ...process.env,
      // E2E 旁路限流：放在 process.env 之后确保不被覆盖。
      // 测试场景下短时间内会有多次 register/login 调用，默认 5 req/min 限流会触发 429。
      // 生产环境不应设置此变量。
      DISABLE_RATE_LIMIT: '1',
      // E2E 兜底超时缩短：默认 3 分钟太长，测试环境改为 3 秒。
      // 当房间仅剩一名活跃玩家时，3 秒后自动结束游戏并判定该玩家获胜。
      // 生产环境不应设置此变量。
      E2E_FALLBACK_TIMEOUT_MS: '3000',
      // E2E 匹配轮询间隔缩短：默认 5 秒太慢，测试环境改为 1 秒。
      // 3 人入队后 1 秒内即可匹配成功，大幅缩短测试等待时间。
      // 生产环境不应设置此变量。
      E2E_MATCH_CHECK_INTERVAL_MS: '1000',
      // E2E 匹配队列超时：保持默认 30 秒。
      // startQuickMatch 在 3 个并发 BrowserContext 下 UI 渲染速度不一，
      // 最慢的玩家可能比最快的晚 15-20s 入队。
      // 30s 超时确保最早入队的玩家不会在最晚入队的玩家加入前超时。
      // 配合 1s 轮询间隔，3 人齐聚后 1-2s 内即匹配成功。
      E2E_MATCHMAKING_TIMEOUT_MS: '30000',
      // E2E 确定性 RNG 种子：固定为 42，使每局 NewGame 调用 rand.Seed(42)。
      // 玩家初始位置、手牌分发、遗迹强度滚动等全局 rand 调用因此可跨运行复现。
      // 生产环境不应设置此变量（不设置时 resetE2EStateIfNeeded 为 no-op）。
      E2E_RAND_SEED: '42',
      // E2E 确定性 UID：使 GenerateID 改用 e2e_<n> 单调计数器替代 UUID。
      // 卡牌 UID、日志 ID 等跨运行保持稳定，便于断言。
      // 生产环境不应设置此变量（不设置时 GenerateID 走原 uuid 路径）。
      E2E_DETERMINISTIC_UID: '1',
      // E2E 测试游戏注入 API：使 POST /api/test/game 端点可用。
      // 未设置时后端 handler 返回 404，生产环境完全无副作用。
      E2E_TEST_API: '1',
    },
  },
  // globalSetup 在 Step 4 创建后取消注释
  globalSetup: './e2e/globalSetup.ts',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  outputDir: 'test-results',
});
