# AGENTS.md - 仓库知识库

## 1. 概述

语言：中文。提交信息、文档、代码注释一律使用中文。

黑暗森林是一个三体题材在线卡牌策略游戏，**六个独立包共存于一个仓库，非 monorepo**（各自有独立 manifest / go.mod / pyproject.toml / package.json）：

- **frontend/** — Vite 8 + React 19 + TypeScript SPA（pnpm）
- **backend/** — Go 后端：REST API + WebSocket + 游戏引擎 + 匹配 + 回放 + 结算
- **mcpserver/** — 独立 Go 模块 `darkforest/mcpserver`，用 MCP 让 AI 代理接入游戏
- **bot/** — Python（uv）QQbot，nonebot2 + OneBot 11，成为网页端关停后的唯一客户端；用 `.match`/`.play` 等命令驱动对局，Pillow 渲染星图
- **analyser/** — Python（uv）CrewAI 复盘分析流水线：读本地 SQLite 回放 → mcpserver 语义投影 → 产出复盘报告
- **gameagent/** — Node.js/TypeScript（**npm**，非 pnpm）AI 玩家 Agent：prime-agent 常驻 session 管理 RLM 子 Agent 池，子 Agent 经 mcpserver MCP 接口独立接入游戏，Python skill（`skills/darkforest/`）由 prime-agent IPython 内核预导入驱动

后端与 MCP server 互不依赖对方的 go.mod；后端作为唯一的二进制服务前端 `dist`，无独立静态服务器。

**gameagent 包管理特例**：因 prime-agent 生态（`E:\prime-agent`）用 npm，gameagent 统一用 npm 管理依赖；`file:` 依赖（`@earendil-works/pi-coding-agent` / `pi-ai` 指向 `E:\prime-agent\packages/*`）在 npm 下是符号链接，**不递归解析 prime-agent workspace 内部包**（pi-tui 等未发布到 registry，pnpm 的 file: 会踩这个坑）。

**关键架构事实**：`LOCAL_TRUST_MODE=1` 是 QQbot / AI 代理本地接入的推荐路径（backend + mcpserver 同读该 env），JWT 主路径已标 deprecated。详见 §4。

## 2. 构建 / 开发 / 检查命令

### gameagent（`gameagent/`，npm 管理）

```bash
npm install       # 装依赖（file: 链接 E:\prime-agent\packages/*，需 prime-agent 已构建 dist）
npm run build     # tsc → dist/
npm run dev       # tsx watch src/index.ts
npm run typecheck # tsc --noEmit
npm run lint      # eslint .
npm test          # node --import tsx --test test/（node:test）
```

依赖 `@earendil-works/pi-coding-agent` / `pi-ai` 经 `file:` 符号链接指向 `E:\prime-agent\packages/*`；它们 `main/types` 指向 `./dist/*`，**改 prime-agent 源码后需先在 `E:\prime-agent` 跑 `npm run build` 才有类型/运行时产物**。

### 前端（`frontend/`）

```bash
pnpm dev            # Vite dev server，localhost:5173
pnpm build          # tsc -b && vite build → dist/
pnpm lint           # eslint .
pnpm exec tsc --noEmit   # 单独类型检查（CI 用）
pnpm test           # Vitest 单元测试（jsdom）
pnpm e2e            # build:e2e && playwright test（Playwright E2E）
pnpm e2e:install    # playwright install chromium
```

### 后端（`backend/`）

```bash
make run            # go run ./cmd/server → localhost:8080
make test           # go test ./...
make fmt            # gofmt -w .
make lint           # gofmt -l . 校验（不修改文件）
go vet ./...
make trust-e2e      # 起 mcpserver/integration 黑盒 harness（需 TRUST_E2E=1 + 可写 Postgres）
```

### MCP Server（`mcpserver/`）

```bash
go run ./cmd/mcpserver   # 默认 localhost:9090/mcp，Streamable HTTP
go test ./...
```

### Python 包（`bot/`、`analyser/`，均用 uv）

```bash
# bot
uv sync             # 装依赖
uv run pytest       # 单元测试（tests/，命令解析/WS 协议/星图渲染等）
uv run pytest e2e   # 进程级 E2E：真实 Go 后端 + Postgres + FakeOneBot
uv run mypy         # strict 模式
uv run ruff check

# analyser
uv run pytest
uv run mypy
uv run ruff check
analyser <replay_id>   # CLI：本地回放复盘分析（需 mcpserver + LLM 配置）
```

### 数据库迁移（backend/，需 golang-migrate CLI）

```bash
make migrate-up / migrate-down / migrate-version / migrate-fresh / migrate-create
```

迁移文件在 `backend/internal/db/migrations/`（NNNNNN_*_name.up.sql / .down.sql）。注意 `make migrate-create` 用 `set /p` 提示（Windows 专用），依赖 `migrate` 二进制与 `DATABASE_URL`。

## 3. 本地信任模式（LOCAL_TRUST_MODE）

`LOCAL_TRUST_MODE=1` 是 QQbot / AI 代理本地接入的推荐路径，backend 与 mcpserver **读同一个 env 值**，未设或非 `1` 时两者行为与改造前完全一致（JWT 主路径，`JWT_SECRET`/`ADMIN_SECRET_KEY` 仅该路径需要，已标 deprecated）。

- **后端**：trust 面仅 127.0.0.1/::1。WS 走 `/ws?qq=<n>&name=<nick>`（bot）或 `/ws?sid=<agent>&name=<nick>`（AI 代理），按 user_id 自动注册账号、免 JWT；HTTP 侧 `AuthMiddleware` 对 localhost + `X-Trust-User: agent:<sid>` 头做旁路注入（role 恒 player，无提权）。
- **mcpserver**：trust 下跳过 Login/token 刷新，身份经请求参数传递（禁止共享 HTTPClient 字段防串货）；账池语义迁为 agent 名单（`add_pool_agent`/`list_pool_agents`），web register 工具在 trust 下被 handler 拒绝。
- **播种**：`AGENT_SEED_NAME`（逗号分隔 `sid` 或 `sid:昵称`）首次启动批量播种 agent 名单，幂等。
- **一键本地环境**：`docker compose -f docker-compose.trust.yml up -d --build` 起 backend + postgres + mcpserver（bot 留宿主侧）。组网心智：mcpserver/bot 全用 `127.0.0.1:8080` 直连 backend（不用服务名解析），仅 backend→postgres 容器内用服务名。

## 4. 生成代码（改完必须重新生成）

两处代码生成，改相关源后一定要跑，否则编译/语义不一致：

- **sqlc**（`backend/`）：`backend/queries/*.sql` → `backend/internal/db`（pgx/v5，emit_json_tags）。改 SQL 后跑 `sqlc generate`，不要手动编辑 `internal/db` 产物。
- **跨包 codegen**（从 `backend/` 目录）：`go run ./cmd/codegen` 把后端游戏规则生效值导出到 `mcpserver/internal/semantic/mode_rules_gen.go`（文件头标 "Code generated - DO NOT EDIT"）。只允许通过 codegen 改动这个生成文件。

## 5. 测试（分清几个体系）

- **前端单元**：Vitest，`pnpm test`（jsdom，`vitest.config.ts` 独立于 vite.config.ts，排除 `e2e/`）。
- **前端 E2E**：Playwright，`pnpm e2e`，先在 `frontend` 根做 `pnpm exec playwright install chromium`。配置见 `frontend/playwright.config.ts`。
- **后端**：`make test`（go test ./...）。
- **MCP Server**：`go test ./...`。
- **bot / analyser**：`uv run pytest`（单测）；bot E2E `uv run pytest e2e` 需真实 Go 后端 + Postgres。
- **gameagent**：`npm test`（node:test，`test/`）；E2E `npm run e2e:duel`（`npx tsx test/e2e-duel.ts`，需 trust 栈已起 + AGENT_SEED_NAME 播种 ≥2 agent）。
- **trust 集成**：`make trust-e2e`（= `cd ../mcpserver && TRUST_E2E=1 go test ./integration/ -count=1 -v`）。harness 缺 `TRUST_E2E=1` 或 DB 时自动 `t.Skip`，不影响 `go test ./...` 全绿。

**前端 E2E 架构（单源服务器）**：Go 后端通过 `STATIC_DIR=../frontend/dist` 同时服务 API 和前端，测试直接打 `http://localhost:8080`，没有 Vite preview 双服务器。启动链路 = 先构建前端 → Playwright webServer 启 `go run ./cmd/server` → globalSetup 引导 admin + 预生成邀请码。

E2E 强依赖 `backend/.env` 和 Postgres（Playwright 用自定义解析器读 `backend/.env`，不引入 dotenv）。生产环境绝不要设置这些 dev 旁路变量：
- `DISABLE_RATE_LIMIT=1`（绕限流）
- `E2E_FALLBACK_TIMEOUT_MS` / `E2E_MATCH_CHECK_INTERVAL_MS` / `E2E_MATCHMAKING_TIMEOUT_MS`（时间缩短）
- `E2E_RAND_SEED=42` + `E2E_DETERMINISTIC_UID=1`（确定性复现）
- `E2E_TEST_API=1`（开启 `/api/test/game` 注入端点）

## 6. 环境变量

- Go 后端经 `os.Getenv` 读 env，**无 .env 自动加载**（不像前端有 Vite 注入）。`backend/.env` 需自行导出 / 经 compose / Playwright 注入才能生效。
- 前端 `frontend/.env`: `VITE_API_URL=http://localhost:8080`、`VITE_WS_URL=ws://localhost:8080/ws`（留空则同源回退）。
- bot `bot/.env`: `BACKEND_WS_URL`、`BOT_WS_HOST/port`（默认 8081，SnowLuma 反向 WS）、`ONEBOT_ACCESS_TOKEN`、`GROUP_REQUIRE_AT_MENTION`、`RENDER_FONT_PATH`（Windows 默认 msyh.ttc）、`.analyse` 命令的 `ANALYSE_*` 配置。
- gameagent `gameagent/.env.example`: `MCP_URL=http://localhost:9090/mcp`、`MANAGER_PORT=9091`、`MODEL_PROVIDER=deepseek`、`MODEL_ID=deepseek-v4-flash`、`DEEPSEEK_API_KEY`、`AGENT_SEED_NAMES`（逗号分隔 `sid:昵称`，对齐 mcpserver 播种语义）、`MAX_GAME_TIMEOUT_MS`（默认 1800000）、`MEMORY_DB_PATH`。同样无自动加载，需宿主注入。
- 根目录 `.env.example` 是全局聚合参考文档，不会被任何服务自动加载；各服务仍读自己的 `.env.example`。

## 7. 前端规范

- 路径别名 `@` → `src/`（禁止滥用深相对路径）。
- Tailwind v4 用 `@import "tailwindcss"`（非 `@tailwind`）；确认 `src/main.tsx` 引入 `index.css`。
- 严格 TS：禁 `as any`、禁文件级 `eslint-disable no-explicit-any`。

## 8. 设计约束（`.impeccable.md`，改 UI 必读）

深空藏青底 `#0a0e1a`，低饱和功能色，禁纯黑纯白、禁霓虹/玻璃拟态/青紫渐变 AI 审美。星图每个状态有一套**色彩语义表**（毁灭余烬炭黑+橙红、湮灭紫罗兰、降维灰二维化、广播绿/琥珀脉冲…）；新状态入场前先查语义表，色相必须唯一。

硬约束：
- 常驻动画只能微弱/缓慢/不规则；永久状态纯静态，瞬态事件才允许强演算。
- `prefers-reduced-motion` 降级后信息必须仍完整可读（动画只是增强，不承载信息）。
- 星图一律 SVG 分层 memo 组件 + defs 渐变 + CSS keyframes（仅 opacity/transform/r），**不上 Canvas**。

## 9. CI（改完自测对齐）

`ci.yml`（push main + PR）以 workflow_call 汇总调用 `backend.yml` + `frontend.yml` + `trust-integration.yml`；另有 `docker-ghcr.yml`（main/tag 构建并推 GHCR，用 `Dockerfile.new`）。**bot/analyser/gameagent 无 CI**，改它们必须本地跑各自静态检查（bot/analyser 用 `uv run pytest / mypy / ruff`；gameagent 用 `npm run typecheck` + `npm run lint`）。

- 后端：`go build ./... && go test ./... && go vet ./... && gofmt -l`（gofmt 必须零差异）。
- 前端：`pnpm install --frozen-lockfile && pnpm build && pnpm lint && tsc --noEmit`。
- trust 集成：GitHub 起 postgres:16 服务容器，注入 `DATABASE_URL`，跑 `make trust-e2e`。

提交信息：Conventional Commits `<type>: 中文描述`，type 见 CONTRIBUTING.md。

## 10. 常见坑

- **MCP 协议版本锁定（Python 侧必须 mcp 1.x）**：mcpserver 基于 Go SDK `github.com/modelcontextprotocol/go-sdk` v1.6.1（协议 2025-11-25），**尚未跟进 MCP 2.0**（2026-07-28 per-request 信封时代）。Python 侧 `mcp` 依赖必须锁 `>=1.0,<2.0`（analyser 锁 1.28.x、gameagent skill 锁 1.29.x），否则 `uv` 会解析到 mcp 2.x——其 `CallToolResult` 字段已改 snake_case（`structured_content`/`is_error`）、`streamable_http_client` 返回两元组（1.x 是三元组含 get_session_id），与 Go 端不兼容。新版 Go SDK 升级前不要放开此约束。
- **Python 包无 CI**：改 bot/analyser 后务必自跑 `uv run pytest` + `uv run mypy` + `uv run ruff check`。
- **gameagent 依赖 prime-agent**：`file:` 链接的包需 `E:\prime-agent` 已 `npm run build` 才有 dist 产物；gameagent 与 frontend 包管理器不同（npm vs pnpm），勿混用。
- **E2E 三套依赖**：前端 Playwright E2E 走 JWT 路径（需 `JWT_SECRET`/`ADMIN_SECRET_KEY`）；bot E2E（`uv run pytest e2e`）和 trust-e2e 走 LOCAL_TRUST_MODE 路径。都要 Postgres 和 `backend/.env`，无则不可跑。
- 端口：8080 Go 后端；5173 前端 dev；9090 MCP；9091 gameagent Agent 管理器 HTTP API；8081 bot（SnowLuma 反向 WS）。`/api` 与 `/ws` 由 Vite 代理到 8080。
- 根 `Dockerfile` 用于本地/trust/ Railway；`Dockerfile.new` + `docker-compose.production.new.yml` + `Caddyfile.new` 是生产部署清单，别用错。
- `backend/internal/db/migrations/` 末尾有 `001_init_schema.sql`（从 Prisma 转译的遗留初始脚本），与序号迁移并存，勿混淆。
- 设计决策与历史方案见 `docs/designs/` 与 `docs/plans/`（按日期命名的设计文档与可执行 plan），动手改大模块前先查对应设计。
- `frontend/` 严格 TS 同时禁 `as any` 与文件级 eslint-disable；Go 错误包装用 `%w`。
