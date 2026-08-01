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
