# AGENTS.md - 仓库知识库

## 1. 概述

语言：中文。提交信息、文档、代码注释一律使用中文。

黑暗森林是一个三体题材在线卡牌策略游戏，**三个独立包共存于一个仓库，非 pnpm monorepo**（各自有独立 manifest / go.mod）：

- **frontend/** — Vite 8 + React 19 + TypeScript SPA（pnpm）
- **backend/** — Go 后端：REST API + WebSocket + 游戏引擎 + 匹配 + 回放 + 结算
- **mcpserver/** — 独立 Go 模块 `darkforest/mcpserver`，用 MCP 让 AI 代理接入游戏

后端与 MCP server 互不依赖对方的 go.mod；后端作为唯一的二进制服务前端 `dist`，无独立静态服务器。

## 2. 构建 / 开发 / 检查命令

### 前端（`frontend/`）

```bash
pnpm dev            # Vite dev server，localhost:5173
pnpm build          # tsc -b && vite build → dist/
pnpm lint           # eslint .
pnpm exec tsc --noEmit   # 单独类型检查（CI 用）
pnpm test           # Vitest 单元测试（→ e2e 无关）
```

### 后端（`backend/`）

```bash
make run            # go run ./cmd/server → localhost:8080
make test           # go test ./...
make fmt            # gofmt -w .
make lint           # gofmt -l . 校验（不修改文件）
go vet ./...
```

### MCP Server（`mcpserver/`）

```bash
go run ./cmd/mcpserver   # 默认 localhost:9090/mcp，Streamable HTTP
go test ./...
```

### 数据库迁移（backend/，需 golang-migrate CLI）

```bash
make migrate-up / migrate-down / migrate-version / migrate-fresh / migrate-create
```

迁移文件在 `backend/internal/db/migrations/`（NNNNNN_*_name.up.sql / .down.sql）。注意 `make migrate-create` 用 `set /p` 提示（Windows 专用），依赖 `migrate` 二进制与 `DATABASE_URL`。

## 3. 生成代码（改完必须重新生成）

两处代码生成，改相关源后一定要跑，否则编译/语义不一致：

- **sqlc**（`backend/`）：`backend/queries/*.sql` → `backend/internal/db`（pgx/v5，emit_json_tags）。改 SQL 后跑 `sqlc generate`，不要手动编辑 `internal/db` 产物。
- **跨包 codegen**（从 `backend/` 目录）：`go run ./cmd/codegen` 把后端游戏规则生效值导出到 `mcpserver/internal/semantic/mode_rules_gen.go`（文件头标 "Code generated - DO NOT EDIT"）。只允许通过 codegen 改动这个生成文件。

## 4. 测试（分清两个体系）

- `frontend/` 单元测试：Vitest，`pnpm test`（jsdom）。
- E2E：Playwright，`pnpm e2e`（= `build:e2e && playwright test`），先在 `frontend` 根做 `pnpm exec playwright install chromium`。配置见 `frontend/playwright.config.ts`。

**E2E 架构（单源服务器）**：Go 后端通过 `STATIC_DIR=../frontend/dist` 同时服务 API 和前端，测试直接打 `http://localhost:8080`，没有 Vite preview 双服务器。启动链路 = 先构建前端 → Playwright webServer 启 `go run ./cmd/server` → globalSetup 引导 admin + 预生成邀请码。

E2E 强依赖 backend/.env（DATABASE_URL / JWT_SECRET / ADMIN_SECRET_KEY）和 Postgres。生产环境绝不要设置这些 dev 旁路变量：
- `DISABLE_RATE_LIMIT=1`（绕限流）
- `E2E_FALLBACK_TIMEOUT_MS` / `E2E_MATCH_CHECK_INTERVAL_MS` / `E2E_MATCHMAKING_TIMEOUT_MS`（时间缩短）
- `E2E_RAND_SEED=42` + `E2E_DETERMINISTIC_UID=1`（确定性复现）
- `E2E_TEST_API=1`（开启 `/api/test/game` 注入端点）

## 5. 环境变量

- Go 后端经 `os.Getenv` 读 env，**无 .env 自动加载**（不像前端有 Vite 注入）。`backend/.env` 需自行导出才能生效。
- 前端 `frontend/.env`: `VITE_API_URL=http://localhost:8080`、`VITE_WS_URL=ws://localhost:8080/ws`。
- 完整配置项见各 `.env.example`（backend / mcpserver / frontend）。

## 6. 前端规范

- 路径别名 `@` → `src/`（禁止滥用深相对路径）。
- Tailwind v4 用 `@import "tailwindcss"`（非 `@tailwind`）；确认 `src/main.tsx` 引入 `index.css`。
- 严格 TS：禁 `as any`、禁文件级 `eslint-disable no-explicit-any`。

## 7. 设计约束（`.impeccable.md`，改 UI 必读）

深空藏青底 `#0a0e1a`，低饱和功能色，禁纯黑纯白、禁霓虹/玻璃拟态/青紫渐变 AI 审美。星图每个状态有一套**色彩语义表**（毁灭余烬炭黑+橙红、湮灭紫罗兰、降维灰二维化、广播绿/琥珀脉冲…）；新状态入场前先查语义表，色相必须唯一。

硬约束：
- 常驻动画只能微弱/缓慢/不规则；永久状态纯静态，瞬态事件才允许强演算。
- `prefers-reduced-motion` 降级后信息必须仍完整可读（动画只是增强，不承载信息）。
- 星图一律 SVG 分层 memo 组件 + defs 渐变 + CSS keyframes（仅 opacity/transform/r），**不上 Canvas**。

## 8. CI（改完自测对齐）

`main` 分支触发 `backend.yml` + `frontend.yml`（ci.yml workflow_call）。

- 后端：`go build ./... && go test ./... && go vet ./... && gofmt -l`（gofmt 必须零差异）。
- 前端：`pnpm install --frozen-lockfile && pnpm build && pnpm lint && tsc --noEmit`。

提交信息：Conventional Commits `<type>: 中文描述`，type 见 CONTRIBUTING.md。

## 9. 常见坑

- **Playwright/PostgreSQL 依赖**：E2E 或无 Postgres 不可跑，需先 `docker compose -f docker-compose.production.new.yml up -d postgres`。
- 端口 8080 是 Go 后端；前端开发在 5173；`/api` 与 `/ws` 由 Vite 代理到 8080。
- `backend/internal/db/migrations/` 末尾有 `001_init_schema.sql`（从 Prisma 转译的遗留初始脚本），与序号迁移并存，勿混淆。
- 多 `.new` 后缀文件（`Dockerfile.new`、`Caddyfile.new`、`docker-compose.production.new.yml`）为生产部署清单，另有根 `Dockerfile` 用于本地，别用错。