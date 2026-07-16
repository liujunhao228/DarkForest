# DarkForest - 黑暗森林卡牌策略游戏

一个基于 **Go 后端 + Vite React 前端** 构建的在线多人卡牌策略游戏平台，集成 MCP Server 以支持 AI 代理接入参与对局。

## 📋 目录

- [项目概述](#项目概述)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [安装指南](#安装指南)
- [使用说明](#使用说明)
- [主要功能](#主要功能)
- [配置选项](#配置选项)
- [测试指南](#测试指南)
- [部署](#部署)
- [故障排除](#故障排除)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 🎯 项目概述

DarkForest 是一个功能完整的在线多人卡牌策略游戏平台，包含三大核心组件：

### 1. 前端 SPA（`frontend/`）
基于 Vite + React + TypeScript 的单页应用，提供游戏界面、匹配系统、回放查看等功能。

### 2. 后端服务（`backend/`）
基于 Go 的游戏服务器，提供 REST API、WebSocket 实时通信、游戏引擎、匹配系统、房间管理、回放记录等核心能力。

### 3. MCP Server（`mcpserver/`）
基于 [Model Context Protocol](https://modelcontextprotocol.io/) 的 Go SDK 构建，使 AI 代理（如 Claude）能够通过 MCP 工具调用接入游戏，参与匹配、出牌、广播、打击等操作，并支持账户池管理、回放检索与统计。

---

## 🛠 技术栈

### 前端
- **Vite 8** 构建工具
- **React 19 + TypeScript 6.0**
- **Tailwind CSS v4** 样式
- **shadcn/ui + Radix UI** 组件库
- **Zustand v5** 状态管理
- **React Router DOM v7** 路由
- **Framer Motion** 动画
- **Lucide React** 图标
- **Vitest** 单元测试
- **原生 WebSocket** 通信（无 Socket.IO）

### 后端
- **Go 1.26** 语言
- **pgx/v5** PostgreSQL 驱动
- **PostgreSQL 16** 数据库
- **sqlc** SQL → Go 代码生成
- **golang-migrate** 数据库迁移
- **golang-jwt/jwt v5** JWT 认证
- **gorilla/websocket** WebSocket
- **google/uuid** UUID 生成

### MCP Server
- **Go 1.26** 语言
- **modelcontextprotocol/go-sdk** MCP 协议实现
- **modernc.org/sqlite** SQLite（账户池、回放、统计持久化）
- **gorilla/websocket** 游戏服务器连接
- **Streamable HTTP** 传输

### 基础设施
- **Docker + Docker Compose** 多阶段构建
- **Caddy 2** 反向代理（生产环境）
- **GitHub Actions** CI/CD

---

## 📁 项目结构

```
DarkForest/
├── frontend/                  # 前端 Vite + React SPA
│   ├── public/                # 静态资源（favicon、logo、卡牌 SVG）
│   ├── src/
│   │   ├── api/               # HTTP API 封装（auth、health、replay）
│   │   ├── assets/            # 图片与卡牌 SVG 资源
│   │   ├── components/
│   │   │   ├── game/          # 游戏卡牌组件
│   │   │   ├── online/        # 在线对战组件（星图、面板、回放等）
│   │   │   └── ui/            # shadcn/ui 基础组件
│   │   ├── hooks/             # 自定义 Hooks（WebSocket、本地玩家 ID）
│   │   ├── layouts/           # 布局组件
│   │   ├── lib/
│   │   │   ├── game/          # 游戏协议、星图、卡牌、视图状态
│   │   │   ├── replay/        # 回放引擎
│   │   │   └── token.ts       # Token 管理
│   │   ├── pages/             # 页面（Home、Auth、Admin、Replay）
│   │   ├── store/             # Zustand 状态（认证、在线游戏、匹配）
│   │   └── ws/                # WebSocket 客户端与协议
│   ├── vite.config.ts         # Vite 配置（含 API/WS 代理）
│   ├── vitest.config.ts       # Vitest 配置
│   └── package.json
├── backend/                   # Go 后端服务
│   ├── cmd/
│   │   ├── server/            # 服务入口
│   │   ├── migrate/           # 迁移命令
│   │   └── verify/            # 校验工具
│   ├── internal/
│   │   ├── api/               # HTTP 路由与处理器（auth、player、replay、health）
│   │   ├── auth/              # JWT 认证
│   │   ├── config/            # 配置管理
│   │   ├── db/                # sqlc 生成的数据访问层
│   │   ├── game/              # 游戏引擎（卡牌、回合、星图、打击、广播、遗物、结算）
│   │   ├── hub/               # WebSocket Hub（客户端、协议）
│   │   ├── match/             # 匹配服务
│   │   ├── replay/            # 回放录制与重放
│   │   ├── rooms/             # 房间管理（含掉线兜底逻辑）
│   │   └── settlement/        # 结算服务
│   ├── scripts/               # 启动脚本
│   ├── Makefile               # 构建/运行/迁移命令
│   ├── sqlc.yaml              # sqlc 配置
│   └── go.mod
├── mcpserver/                 # MCP Server（AI 代理接入）
│   ├── cmd/mcpserver/         # 服务入口
│   ├── internal/
│   │   ├── account/           # 账户池管理
│   │   ├── config/            # 配置
│   │   ├── gamesdk/           # 游戏服务器 SDK（HTTP/WS 客户端、熔断器、会话）
│   │   ├── persistence/       # SQLite 持久化（账户、回放、设置、统计）
│   │   ├── server/            # MCP 传输与事件存储
│   │   ├── session/           # 会话管理
│   │   └── tools/             # MCP 工具实现（action、match、replay、stats 等）
│   └── go.mod
├── docs/                      # 架构、部署、运维文档
├── scripts/                   # 数据库迁移脚本
├── replays/                   # 本地回放索引
├── Dockerfile                 # 前后端一体化多阶段构建
├── Dockerfile.new             # 新版 Dockerfile
├── docker-compose.production.new.yml  # 生产环境编排
├── Caddyfile.new              # Caddy 反向代理配置
├── railway.json               # Railway 部署配置
├── AGENTS.md                  # 仓库知识库
└── CONTRIBUTING.md            # 贡献指南
```

---

## 🚀 安装指南

### 前置要求

- **Go 1.26+**
- **Node.js 20+** 或 **Bun 1.0+**（推荐使用 pnpm）
- **PostgreSQL 16+**
- **Git**
- **golang-migrate**（用于数据库迁移）
  ```bash
  go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
  ```

### 1. 克隆仓库

```bash
git clone https://github.com/your-username/DarkForest.git
cd DarkForest
```

### 2. 配置后端

```bash
cd backend
cp .env.example .env
# 编辑 .env，设置 DATABASE_URL、JWT_SECRET、ADMIN_SECRET_KEY
go mod download
```

### 3. 初始化数据库

```bash
# 启动 PostgreSQL（可使用 Docker）
docker compose -f ../docker-compose.production.new.yml up -d postgres

# 执行迁移
make migrate-up
```

### 4. 配置前端

```bash
cd ../frontend
cp .env.example .env
# .env 默认指向 localhost:8080，无需修改即可本地开发
pnpm install
# 或 bun install
```

### 5. 配置 MCP Server（可选，用于 AI 代理接入）

```bash
cd ../mcpserver
cp .env.example .env
# 编辑 .env，设置 GAME_API_URL、GAME_WS_URL、ADMIN_TOKEN
go mod download
```

---

## 📖 使用说明

### 开发环境启动

需要分别启动后端、前端（和可选的 MCP Server）。

#### 1. 启动后端服务

```bash
cd backend
make run
# 或 go run ./cmd/server
```

后端将在 `http://localhost:8080` 启动，同时提供 REST API 与 WebSocket（`/ws`）。

#### 2. 启动前端开发服务器

```bash
cd frontend
pnpm dev
# 或 bun run dev
```

访问 `http://localhost:5173` 即可开始使用。Vite 开发模式下 `/api` 与 `/ws` 会代理到 `localhost:8080`。

#### 3. 启动 MCP Server（可选）

```bash
cd mcpserver
go run ./cmd/mcpserver
```

MCP Server 默认监听 `http://localhost:9090/mcp`（Streamable HTTP 传输）。

### 生产环境部署

详见 [部署](#部署) 章节。

---

## ✨ 主要功能

### 🎮 游戏平台功能

| 功能 | 描述 |
|------|------|
| **实时多人对战** | 基于 WebSocket 的实时卡牌对战，支持 3-5 人 |
| **智能匹配系统** | 自动匹配 / 自定义队列，支持邀请码 |
| **房间管理** | 创建、加入、掉线重连、单人兜底结算 |
| **游戏引擎** | 完整的回合制卡牌逻辑（抽牌、出牌、弃牌、回收） |
| **卡牌系统** | 攻击卡、广播卡、防御卡、设施卡、超光速飞船 |
| **星图系统** | 多玩家星系地图可视化与打击路径 |
| **打击系统** | 宣战、移动打击、重新瞄准、跳过 |
| **广播系统** | 协作、伪装、宇宙广播、明星广播、超级广播 |
| **遗物系统** | 多遗物组合效果 |
| **游戏回放** | 对局录制、回放、分享、增量检索 |
| **用户认证** | JWT 登录/注册、邀请码注册 |
| **管理员面板** | 玩家管理、游戏监控、服务器配置 |
| **统计系统** | 玩家与对局统计数据 |

### 🤖 MCP Server 功能（AI 代理接入）

| 功能 | 描述 |
|------|------|
| **连接管理** | 连接/断开游戏服务器、状态查询 |
| **账户池** | 预注册账户池、自动借用与归还 |
| **匹配工具** | 加入匹配队列、自定义队列、查询状态 |
| **对局操作** | 出牌、回收、结束回合、跳过阶段 |
| **广播/打击** | 发起广播、宣战、移动打击、重新瞄准 |
| **房间管理** | 查询房间信息、离开房间 |
| **回放检索** | 列举本地/远端回放、获取回放增量 |
| **统计查询** | 玩家统计、队列信息、排行榜 |
| **管理工具** | 运行时修改游戏服务器地址等 |
| **稳定性机制** | WS 重连退避、HTTP 熔断、双层会话超时 |

---

## 🔧 配置选项

### 后端配置（`backend/.env`）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | `postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable` |
| `JWT_SECRET` | JWT 签名密钥 | - |
| `ADMIN_SECRET_KEY` | 管理员密钥 | - |
| `PORT` | HTTP 服务端口 | `8080` |
| `ENVIRONMENT` | 运行环境 | `development` |
| `STATIC_DIR` | 前端静态资源目录 | - |
| `MIGRATIONS_DIR` | 迁移文件目录 | - |
| `CORS_ALLOW_ORIGINS` | CORS 允许的来源 | `*` |
| `LOG_LEVEL` | 日志级别 | `info` |

### 前端配置（`frontend/.env`）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_API_URL` | 后端 REST API 地址 | `http://localhost:8080` |
| `VITE_WS_URL` | 后端 WebSocket 地址 | `ws://localhost:8080/ws` |

### MCP Server 配置（`mcpserver/.env`）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `GAME_API_URL` | 游戏后端 HTTP API 地址 | `http://localhost:8080` |
| `GAME_WS_URL` | 游戏后端 WebSocket 地址 | `ws://localhost:8080/ws` |
| `MCP_PORT` | MCP Server 监听端口 | `9090` |
| `MCP_ENDPOINT` | Streamable HTTP 端点 | `/mcp` |
| `DB_PATH` | SQLite 数据库路径 | `./data/mcpserver.db` |
| `ADMIN_TOKEN` | 游戏后端 admin JWT（预注册账户） | - |
| `SESSION_IDLE_TIMEOUT` | Agent 会话空闲超时（秒） | `300` |
| `WS_RECONNECT_MAX` | WS 快速重连阶段次数 | `5` |
| `WS_HEARTBEAT_TIMEOUT` | WS pong 等待超时（秒） | `10` |
| `HTTP_RETRY_MAX` | HTTP 请求最大重试次数 | `3` |
| `HTTP_CIRCUIT_BREAKER_THRESHOLD` | HTTP 熔断阈值 | `10` |
| `MCP_SESSION_TIMEOUT` | MCP SDK 会话空闲超时（秒） | `1800` |

> 完整配置项见 `mcpserver/.env.example`。

---

## 🧪 测试指南

### 前端测试

```bash
cd frontend

# 运行所有单元测试
pnpm test

# 监听模式
pnpm test:watch

# UI 模式
pnpm test:ui
```

### 后端测试

```bash
cd backend

# 运行所有测试
make test
# 或
go test ./...

# 格式化与静态检查
gofmt -w .
go vet ./...
```

### MCP Server 测试

```bash
cd mcpserver
go test ./...
```

---

## 🐳 部署

### 方式一：Docker Compose（推荐）

使用多阶段构建的 `Dockerfile.new`，一次性构建前端与后端，并由 Caddy 提供反向代理。

```bash
# 设置必需的环境变量
export JWT_SECRET="your_jwt_secret_here"
export ADMIN_SECRET_KEY="your_admin_secret_here"

# 构建并启动
docker compose -f docker-compose.production.new.yml up -d --build
```

服务清单：
- `postgres` — PostgreSQL 16 数据库
- `app` — Go 后端 + 前端静态资源（端口 8080）
- `caddy` — 反向代理（端口 80/443）

### 方式二：手动构建

```bash
# 构建前端
cd frontend
pnpm install --frozen-lockfile
pnpm build
# 产物在 frontend/dist/

# 构建后端
cd ../backend
go build -o bin/server ./cmd/server

# 执行迁移后运行
./bin/server
# 后端会以 STATIC_DIR 指向的目录提供前端静态资源
```

### 方式三：Railway

项目已包含 `railway.json` 配置，可直接在 [Railway](https://railway.app/) 上部署。

---

## ❓ 故障排除

### 1. WebSocket 连接失败

**症状**: 前端无法连接 `/ws`，控制台报 `ECONNREFUSED`

**解决方案**:
- 确认 Go 后端已启动并监听 `8080`
- 检查 `frontend/.env` 中的 `VITE_WS_URL`
- Vite 开发模式下 `/ws` 应被代理到 `localhost:8080`（见 `vite.config.ts`）

### 2. 数据库连接失败

**症状**: 后端启动时报 `failed to connect database`

**解决方案**:
- 确认 PostgreSQL 已启动：`docker compose -f docker-compose.production.new.yml up -d postgres`
- 检查 `DATABASE_URL` 格式：`postgres://user:password@host:port/database?sslmode=disable`
- 执行迁移：`make migrate-up`

### 3. 前端构建失败

**症状**: TypeScript 编译错误或样式不生效

**解决方案**:
```bash
cd frontend
pnpm install          # 确保依赖安装
pnpm build --force    # 清理缓存重建
pnpm lint             # 检查代码
```

确认 `src/main.tsx` 中有 `import './index.css'`，且 Tailwind v4 使用 `@import "tailwindcss"`。

### 4. 端口被占用

**症状**: `EADDRINUSE: address already in use :::8080`

**解决方案**:
```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <进程ID> /F

# Linux/Mac
lsof -ti :8080 | xargs kill -9
```

### 5. MCP Server 无法连接游戏服务器

**症状**: MCP 工具调用返回连接错误

**解决方案**:
- 确认游戏后端已启动
- 检查 `mcpserver/.env` 中的 `GAME_API_URL` 与 `GAME_WS_URL`
- 如需预注册账户，确认 `ADMIN_TOKEN` 配置正确
- 查看熔断器状态（连续失败超过 `HTTP_CIRCUIT_BREAKER_THRESHOLD` 会触发熔断）

### 6. Tailwind 样式不生效

- 确认 `src/main.tsx` 中有 `import './index.css'`
- 确认 Tailwind v4 使用 `@import "tailwindcss"` 而非 `@tailwind`
- 检查 `postcss.config.js` 中 `@tailwindcss/postcss` 插件配置

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！详细的开发流程、分支命名、提交规范与代码审查要点请见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 快速规范

- **提交格式**: 使用约定式提交 `<type>: <description>`，type 包括 `feat` / `fix` / `refactor` / `docs` / `chore`
- **TypeScript**: 严格模式，禁止 `as any`，禁止文件级 `eslint-disable @typescript-eslint/no-explicit-any`；联合类型字段解构需通过类型窄化处理
- **Go**: 使用 `gofmt` 格式化，`go vet` 静态检查，错误包装使用 `%w`
- **路径别名**: 前端使用 `@` 别名指向 `src/`
- **命名**: 变量/函数 `camelCase`，组件 `PascalCase`，常量 `UPPER_SNAKE_CASE`，文件 `kebab-case`

### 提交前检查

```bash
# 前端
cd frontend && pnpm lint && pnpm build && pnpm test

# 后端
cd backend && gofmt -w . && go vet ./... && go test ./...
```

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

## 🌟 致谢

感谢以下开源项目：

- [React](https://react.dev/) / [Vite](https://vitejs.dev/)
- [Go](https://go.dev/) / [pgx](https://github.com/jackc/pgx) / [sqlc](https://sqlc.dev/)
- [Tailwind CSS](https://tailwindcss.com/) / [shadcn/ui](https://ui.shadcn.com/)
- [Zustand](https://github.com/pmndrs/zustand)
- [Model Context Protocol](https://modelcontextprotocol.io/) / [go-sdk](https://github.com/modelcontextprotocol/go-sdk)
- [PostgreSQL](https://www.postgresql.org/)
- [Caddy](https://caddyserver.com/)

---

## 📞 联系方式

- **Issues**: [GitHub Issues](https://github.com/your-username/DarkForest/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/DarkForest/discussions)

---

<p align="center">
  <em>Made with ❤️ by the DarkForest Team</em>
</p>
