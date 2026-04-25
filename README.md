# DarkForest - 星际战争桌游

一个基于 Next.js 16 + TypeScript 构建的在线多人桌游平台，集成了第三方 [nanobot](https://github.com/HKUDS/nanobot) AI 代理框架以提供桌游相关的 AI 功能。

## 📋 目录

- [项目概述](#项目概述)
- [安装指南](#安装指南)
- [使用说明](#使用说明)
- [主要功能](#主要功能)
- [配置选项](#配置选项)
- [故障排除](#故障排除)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 🎯 项目概述

DarkForest 是一个功能完整的在线多人桌游平台，集成了第三方 AI 代理框架以增强游戏体验：

### 1. 在线桌游平台（本项目核心）
- **技术栈**: Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui
- **实时通信**: Socket.IO WebSocket
- **数据库**: Prisma ORM + SQLite
- **身份验证**: JWT
- **数据验证**: Zod

### 2. nanobot 框架集成（第三方组件）
本项目集成了由 [HKUDS](https://github.com/HKUDS) 开发的 [nanobot](https://github.com/HKUDS/nanobot) 开源 AI 代理框架，用于实现桌游相关的 AI 功能和频道插件。
- **超轻量级**: 小巧可读的核心代理循环
- **多平台支持**: Telegram, Discord, WeChat, Feishu, Slack 等
- **记忆系统**: 持久化的对话记忆
- **MCP 支持**: Model Context Protocol 集成
- **Python 3.11+**: 现代化 Python 开发

### 项目结构

```
DarkForest/
├── src/                      # 桌游平台源码
│   ├── app/                 # Next.js App Router
│   ├── components/          # React 组件
│   ├── lib/                 # 核心库（游戏引擎、匹配系统等）
│   ├── server/              # WebSocket 游戏服务器
│   └── store/               # Zustand 状态管理
├── nanobot/                 # 第三方 nanobot 框架（见 nanobot/LICENSE）
│   ├── nanobot/            # nanobot 核心代理代码
│   └── nanobot-channel-boardgame/  # 本项目开发的桌游频道插件
├── prisma/                  # 数据库 schema
└── public/                  # 静态资源
```

---

## 🚀 安装指南

### 前置要求

- **Node.js 18+** 或 **Bun 1.0+**
- **Python 3.11+** (用于 nanobot)
- **Git**

### 方式一：完整安装（推荐）

#### 1. 克隆仓库

```bash
git clone https://github.com/your-username/DarkForest.git
cd DarkForest
```

#### 2. 安装桌游平台依赖

```bash
# 使用 Bun（推荐）
bun install

# 或使用 pnpm
pnpm install
```

#### 3. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env
```

编辑 `.env` 文件，配置必要的参数：

```env
# JWT 密钥（生成方式：openssl rand -base64 32）
JWT_SECRET=your_jwt_secret_here
ADMIN_SECRET_KEY=your_admin_secret_here

# 数据库
DATABASE_URL="file:./db/dev.db"

# 服务器端口
PORT=3000
WS_PORT=3003
```

#### 4. 初始化数据库

```bash
# 生成 Prisma 客户端
bun run db:generate

# 推送 schema 到数据库
bun run db:push
```

#### 5. 安装 nanobot（可选）

```bash
cd nanobot
pip install -e .
```

---

### 方式二：仅安装桌游平台

```bash
git clone https://github.com/your-username/DarkForest.git
cd DarkForest
bun install
cp .env.example .env
# 编辑 .env
bun run db:generate
bun run db:push
```

---

## 📖 使用说明

### 开发环境启动

#### 1. 启动 WebSocket 游戏服务器（单独终端）

```bash
bun run server:ws
```

#### 2. 启动 Next.js 开发服务器

```bash
bun run dev
```

访问 `http://localhost:3000` 即可开始使用。

---

### 生产环境部署

#### 方式一：直接部署

```bash
# 构建项目
bun run build

# 启动生产服务器
NODE_ENV=production bun server.js
```

#### 方式二：Docker 部署

```bash
# 构建镜像
docker compose -f docker-compose.production.yml build

# 启动服务
docker compose -f docker-compose.production.yml up -d
```

---

### nanobot 框架使用（第三方）

*注：以下是 nanobot 框架的基本使用说明，完整文档请参考 nanobot 官方文档。*

#### 初始化配置

```bash
cd nanobot
nanobot onboard
```

编辑 `~/.nanobot/config.json`：

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "sk-or-v1-xxx"
    }
  },
  "agents": {
    "defaults": {
      "provider": "openrouter",
      "model": "anthropic/claude-opus-4-6"
    }
  },
  "channels": {
    "websocket": { "enabled": true }
  }
}
```

#### 启动 nanobot

```bash
# CLI 模式
nanobot agent

# 网关模式
nanobot gateway
```

---

## ✨ 主要功能

### 🎮 桌游平台功能

| 功能 | 描述 |
|------|------|
| **实时多人游戏** | 基于 WebSocket 的实时对战 |
| **智能匹配系统** | 自动匹配玩家，支持 3-5 人游戏 |
| **房间管理** | 创建/加入房间，房间状态同步 |
| **游戏引擎** | 完整的回合制游戏逻辑 |
| **卡牌系统** | 攻击卡、广播卡、防御卡、设施卡 |
| **星图系统** | 星系地图可视化 |
| **游戏回放** | 记录和回放精彩对局 |
| **用户认证** | JWT 登录/注册 |
| **管理员面板** | 用户管理、游戏监控 |

### 🤖 nanobot 框架功能（第三方）

以下功能由 [nanobot](https://github.com/HKUDS/nanobot) 框架提供：

| 功能 | 描述 |
|------|------|
| **多频道支持** | Telegram, Discord, WeChat, Feishu, Slack, QQ 等 |
| **记忆系统** | 持久化对话历史 |
| **技能系统** | 可扩展的技能插件 |
| **MCP 集成** | Model Context Protocol 工具 |
| **定时任务** | Cron 调度支持 |
| **多提供商** | OpenAI, Anthropic, DeepSeek, Kimi 等 |
| **Python SDK** | 编程接口 |

---

## 🔧 配置选项

### 桌游平台配置

#### 环境变量 (.env)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | Next.js 服务器端口 | 3000 |
| `WS_PORT` | WebSocket 服务器端口 | 3003 |
| `DATABASE_URL` | 数据库连接字符串 | file:./db/dev.db |
| `JWT_SECRET` | JWT 签名密钥 | - |
| `ADMIN_SECRET_KEY` | 管理员密钥 | - |
| `NODE_ENV` | 运行环境 | development |

#### 游戏配置 (src/lib/game/types.ts)

```typescript
// 可调整的游戏参数
const MAX_PLAYERS = 5;
const MIN_PLAYERS = 3;
const INITIAL_ENERGY = 10;
const CARDS_PER_TURN = 2;
```

---

### nanobot 框架配置（第三方）

#### 配置文件 (~/.nanobot/config.json)
*注：这是 nanobot 框架的配置文件，详情请参考 nanobot 官方文档。*

```json
{
  "providers": {
    "openai": { "apiKey": "sk-xxx" },
    "anthropic": { "apiKey": "sk-ant-xxx" }
  },
  "agents": {
    "defaults": {
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-20241022"
    }
  },
  "channels": {
    "websocket": { "enabled": true, "port": 8765 },
    "telegram": { "enabled": false, "botToken": "xxx" }
  },
  "memory": {
    "enabled": true,
    "maxTokens": 100000
  }
}
```

---

## 🧪 测试指南

### 运行所有测试

```bash
bun test
```

### 运行特定测试

```bash
# 匹配系统测试
bun test src/lib/__tests__/matchmaking.test.ts

# 游戏引擎测试
bun test src/lib/__tests__/game-engine.test.ts

# 特定测试用例
bun test src/lib/__tests__/matchmaking.test.ts -t "joinQueue"
```

### 测试覆盖率

```bash
bun test --coverage
```

### E2E 测试

```bash
# 启动 WebSocket 服务器（先）
bun run server:ws

# 运行 E2E 测试
bun run test:e2e

# 交互式 UI 模式
bun run test:e2e:ui
```

---

## ❓ 故障排除

### 常见问题

#### 1. WebSocket 连接失败

**症状**: `Error: connect ECONNREFUSED 127.0.0.1:3003`

**原因**: WebSocket 游戏服务器未启动

**解决方案**:
```bash
# 在单独终端运行
bun run server:ws
```

---

#### 2. 数据库外键约束错误

**症状**: `PrismaClientKnownRequestError: FOREIGN KEY constraint failed`

**原因**: 测试数据清理顺序问题

**解决方案**: 这是测试隔离问题，不影响生产功能，可以安全忽略。

---

#### 3. TypeScript 编译错误

**症状**: 类型找不到或导入失败

**解决方案**:
```bash
# 重新生成 Prisma 客户端
bun run db:generate

# 检查 tsconfig.json
bun run lint
```

---

#### 4. nanobot 启动失败

**症状**: 配置错误或模块缺失

**解决方案**:
```bash
# 重新安装
cd nanobot
pip install -e . --upgrade

# 重新初始化配置
nanobot onboard --reset
```

---

#### 5. 端口被占用

**症状**: `EADDRINUSE: address already in use :::3000`

**解决方案**:
```bash
# Windows: 查找并杀死占用端口的进程
netstat -ano | findstr :3000
taskkill /PID <进程ID> /F

# Linux/Mac:
lsof -ti :3000 | xargs kill -9
```

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 开发流程

1. **Fork 仓库**

2. **创建功能分支**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **提交更改**
   ```bash
   git add .
   git commit -m "feat: 添加新功能"
   ```

4. **推送到分支**
   ```bash
   git push origin feature/your-feature-name
   ```

5. **创建 Pull Request**

---

### 代码规范

请遵循以下规范：

- **TypeScript**: 使用严格模式，避免 `any` 类型
- **命名**: 变量/函数使用 camelCase，常量使用 UPPER_SNAKE_CASE
- **导入**: 使用 `@` 别名的绝对导入
- **注释**: 为公共函数添加 JSDoc 注释
- **提交**: 使用约定式提交格式：
  - `feat:` 新功能
  - `fix:` 修复 bug
  - `docs:` 文档更新
  - `refactor:` 重构
  - `test:` 测试相关
  - `chore:` 构建/工具链

---

### 分支策略

| 分支 | 用途 |
|------|------|
| `main` | 稳定版本，生产就绪 |
| `develop` | 开发分支，功能集成 |
| `feature/*` | 功能开发分支 |
| `hotfix/*` | 紧急修复分支 |

---

## 📄 许可证

### DarkForest 桌游平台（本项目）

MIT License - 详见 [LICENSE](LICENSE)

### nanobot 框架（第三方组件）

nanobot 是一个独立的开源项目，由 [HKUDS](https://github.com/HKUDS) 开发和维护，使用其自己的 MIT 许可证。
详见 [nanobot/LICENSE](nanobot/LICENSE) 或访问 [nanobot GitHub](https://github.com/HKUDS/nanobot) 了解更多信息。

---

## 🌟 致谢

感谢以下开源项目：

- [Next.js](https://nextjs.org/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Prisma](https://www.prisma.io/)
- [nanobot](https://github.com/HKUDS/nanobot)
- [Socket.IO](https://socket.io/)

---

## 📞 联系方式

- **Issues**: [GitHub Issues](https://github.com/your-username/DarkForest/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/DarkForest/discussions)

---

## 🙏 支持

如果这个项目对你有帮助，请给我们一个 ⭐ Star！

---

<p align="center">
  <em>Made with ❤️ by the DarkForest Team</em>
</p>
