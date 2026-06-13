# 黑暗森林 (Dark Forest) - 架构文档

## 目录

- [系统架构](#系统架构)
- [核心模块](#核心模块)
- [数据流](#数据流)
- [技术栈](#技术栈)
- [部署架构](#部署架构)
- [扩展性设计](#扩展性设计)

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         客户端层 (Frontend)                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Vite + React + TypeScript + Tailwind CSS + shadcn/ui   │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Home      │  │  Auth      │  │  Game      │        │  │
│  │  │  Pages     │  │  Pages     │  │  Pages     │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  WebSocket │  │  HTTP API  │  │  Zustand   │        │  │
│  │  │  Client    │  │  Client    │  │  Store     │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
                    HTTP/WebSocket (REST API + WS)
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                       服务层 (Backend - Go)                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    HTTP Router + Middleware               │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Auth      │  │  Player    │  │  Replay    │        │  │
│  │  │  Handlers  │  │  Handlers  │  │  Handlers  │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    WebSocket Hub                          │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Client    │  │  Room      │  │  Message   │        │  │
│  │  │  Manager   │  │  Manager   │  │  Protocol  │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Game Engine                            │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Engine    │  │  Turn      │  │  Cards     │        │  │
│  │  │  Core      │  │  Manager   │  │  Actions   │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Strike    │  │  Broadcast │  │  Settlement│        │  │
│  │  │  Effects   │  │  Effects   │  │  Logic     │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Match Service                          │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Match     │  │  Queue     │  │  Room      │        │  │
│  │  │  Service   │  │  Manager   │  │  Manager   │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Replay Service                         │  │
│  │  ┌────────────┐  ┌────────────┐                        │  │
│  │  │  Replay    │  │  Storage   │                        │  │
│  │  │  Service   │  │  Manager   │                        │  │
│  │  └────────────┘  └────────────┘                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
                        PostgreSQL (SQL)
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                       数据层 (Database)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    PostgreSQL 16                          │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Players   │  │  Matches   │  │  Replays   │        │  │
│  │  │  Table     │  │  Table     │  │  Table     │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Invitation│  │  Match     │  │  Match     │        │  │
│  │  │  Codes     │  │  Players   │  │  Queue     │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心模块

### 1. HTTP Router + Middleware (`internal/api/`)

#### 功能

- HTTP 路由管理
- 请求中间件链
- 认证与授权
- CORS 处理
- 日志记录
- 错误恢复

#### 关键文件

- [router.go](../backend/internal/api/router.go) - 路由配置
- [middleware.go](../backend/internal/api/middleware.go) - 中间件链
- [auth_handlers.go](../backend/internal/api/auth_handlers.go) - 认证处理器
- [player_handler.go](../backend/internal/api/player_handler.go) - 玩家处理器
- [replay_handler.go](../backend/internal/api/replay_handler.go) - 回放处理器

#### 路由结构

```
/api/health                 → HealthHandler
/api/auth/login             → AuthHandler.Login
/api/auth/register          → AuthHandler.Register
/api/auth/admin-setup       → AuthHandler.AdminSetup
/api/auth/invite            → AuthHandler.CreateInvite (需认证)
/api/player/me              → PlayerHandler.GetCurrentPlayer (需认证)
/api/player/:id             → PlayerHandler.GetPlayer
/api/player/:id/stats       → PlayerHandler.GetPlayerStats
/api/leaderboard            → PlayerHandler.GetLeaderboard
/api/replay/:id             → ReplayHandler.GetReplayByID (需认证)
/api/replay/list            → ReplayHandler.ListReplays (需认证)
/ws                         → WebSocket Handler (需认证)
```

---

### 2. WebSocket Hub (`internal/hub/`)

#### 功能

- WebSocket 连接管理
- 房间管理
- 消息广播
- 心跳检测
- 连接池管理

#### 关键文件

- [hub.go](../backend/internal/hub/hub.go) - Hub 核心（单 goroutine）
- [client.go](../backend/internal/hub/client.go) - Client 连接管理
- [handler.go](../backend/internal/hub/handler.go) - HTTP -> WebSocket 升级
- [protocol.go](../backend/internal/hub/protocol.go) - 消息协议定义

#### 架构特点

- **单 goroutine Hub**: 避免 data race，使用 select loop
- **读写分离**: ReadPump + WritePump
- **心跳机制**: 60s 超时，ping/pong
- **JWT 认证**: query token 或 Authorization header

#### 消息协议

```json
{
  "type": "game:action",
  "payload": {
    "action": "play_card",
    "data": { ... }
  }
}
```

---

### 3. Game Engine (`internal/game/`)

#### 功能

- 游戏状态管理
- 卡牌操作
- 打击效果
- 广播效果
- 结算逻辑
- 回合管理

#### 关键文件

- [engine.go](../backend/internal/game/engine.go) - 游戏引擎核心
- [turn.go](../backend/internal/game/turn.go) - 回合管理
- [cards.go](../backend/internal/game/cards.go) - 卡牌定义
- [cards_actions.go](../backend/internal/game/cards_actions.go) - 卡牌动作
- [strike.go](../backend/internal/game/strike.go) - 打击效果
- [broadcast.go](../backend/internal/game/broadcast.go) - 广播效果
- [settlement.go](../backend/internal/game/settlement.go) - 结算逻辑
- [types.go](../backend/internal/game/types.go) - 游戏类型定义

#### 游戏流程

```
1. 初始化游戏状态
2. 发牌（每个玩家 5 张）
3. 回合循环：
   - 当前玩家行动（出牌/打击/广播/跳过）
   - 验证行动合法性
   - 执行行动效果
   - 更新游戏状态
   - 广播状态给所有玩家
   - 检查游戏结束条件
4. 游戏结束 -> 结算
```

---

### 4. Match Service (`internal/match/`)

#### 功能

- 匹配队列管理
- 匹配逻辑
- 房间创建
- 玩家分配

#### 关键文件

- [service.go](../backend/internal/match/service.go) - 匹配服务逻辑
- [queue.go](../backend/internal/match/queue.go) - 匹配队列管理

#### 匹配流程

```
1. 玩家加入匹配队列（指定期望玩家数）
2. 匹配服务定期轮询队列
3. 找到满足条件的玩家组合（3-5 人）
4. 创建房间
5. 通知所有匹配成功的玩家
6. 玩家进入房间开始游戏
```

---

### 5. Room Manager (`internal/rooms/`)

#### 功能

- 房间生命周期管理
- 玩家进出管理
- 游戏动作处理
- 状态同步
- 房间超时回收

#### 关键文件

- [room.go](../backend/internal/rooms/room.go) - 单个房间对象
- [manager.go](../backend/internal/rooms/manager.go) - 房间管理器
- [errors.go](../backend/internal/rooms/errors.go) - 房间错误定义

#### 房间架构

```
RoomManager (房间管理器)
  ├── Room 1 (房间 1)
  │   ├── GameEngine (游戏引擎)
  │   ├── Players [P1, P2, P3, P4]
  │   └── WebSocket Connections [C1, C2, C3, C4]
  ├── Room 2 (房间 2)
  │   ├── GameEngine (游戏引擎)
  │   ├── Players [P5, P6, P7]
  │   └── WebSocket Connections [C5, C6, C7]
  └── ...
```

---

### 6. Replay Service (`internal/replay/`)

#### 功能

- 游戏回放记录
- 回放查询
- 回放存储
- 回放删除

#### 关键文件

- [service.go](../backend/internal/replay/service.go) - 回放服务核心

#### 回放数据结构

```json
{
  "id": "uuid",
  "matchId": "uuid",
  "players": [
    {"id": "p1", "displayName": "Player 1"},
    {"id": "p2", "displayName": "Player 2"}
  ],
  "actions": [
    {"turn": 1, "player": "p1", "action": "play_card", "data": {...}},
    {"turn": 2, "player": "p2", "action": "strike", "data": {...}}
  ],
  "finalState": {...},
  "createdAt": "2024-01-01T10:00:00Z"
}
```

---

## 数据流

### 1. 用户认证流程

```
客户端                HTTP Router              Auth Service           Database
  │                      │                        │                      │
  │──POST /api/auth/login──→│                      │                      │
  │                      │──Validate credentials──→│                      │
  │                      │                      │──Query player────────→│
  │                      │                      │←────Player data──────│
  │                      │                      │──Generate JWT─────────│
  │                      │←────JWT token────────│                      │
  │←───{token, player}────│                      │                      │
```

### 2. WebSocket 连接流程

```
客户端                WebSocket Handler         Hub                   Room Manager
  │                      │                        │                      │
  │──GET /ws?token=xxx───→│                      │                      │
  │                      │──Validate JWT─────────→│                      │
  │                      │──Upgrade to WebSocket──│                      │
  │                      │──Create Client────────→│                      │
  │                      │                      │──Register client──────→│
  │←───WebSocket connection─│                      │                      │
  │                      │                      │                      │
  │──Join room message───→│                      │                      │
  │                      │──Handle message───────→│                      │
  │                      │                      │──Join room───────────→│
  │                      │                      │                      │──Create/Get room
  │                      │                      │←───Room info─────────│
  │                      │←───Broadcast join─────│                      │
  │←───Room state update───│                      │                      │
```

### 3. 游戏动作流程

```
客户端                WebSocket Handler         Hub                   Room Manager              Game Engine
  │                      │                        │                      │                          │
  │──Game action message──→│                      │                      │                          │
  │                      │──Handle message───────→│                      │                          │
  │                      │                      │──Find player room────→│                          │
  │                      │                      │                      │──Get room by player────→│
  │                      │                      │                      │←────Room object─────────│
  │                      │                      │                      │──Handle action──────────→│
  │                      │                      │                      │                          │──Validate action
  │                      │                      │                      │                          │──Execute action
  │                      │                      │                      │                          │──Update state
  │                      │                      │                      │←────New state───────────│
  │                      │                      │←───Broadcast state───│                          │
  │                      │←───Broadcast to all───│                      │                          │
  │←───State update───────│                      │                      │                          │
```

---

## 技术栈

### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Vite** | 8.0+ | 构建工具 |
| **React** | 19.2+ | UI 框架 |
| **TypeScript** | 6.0+ | 类型系统 |
| **Tailwind CSS** | 4.3+ | CSS 框架 |
| **shadcn/ui** | latest | UI 组件库 |
| **Zustand** | 5.0+ | 状态管理 |
| **React Router** | 7.17+ | 路由管理 |
| **Lucide React** | 1.17+ | 图标库 |

### 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Go** | 1.23+ | 编程语言 |
| **net/http** | 标准库 | HTTP 服务器 |
| **gorilla/websocket** | 1.5+ | WebSocket 库 |
| **pgx/v5** | 5.7+ | PostgreSQL 驱动 |
| **golang-jwt/jwt** | 5.2+ | JWT 库 |
| **golang.org/x/crypto** | 0.31+ | 密码哈希（bcrypt） |
| **google/uuid** | 1.6+ | UUID 生成 |

### 数据库技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **PostgreSQL** | 16+ | 主数据库 |
| **golang-migrate** | 4.16+ | 数据库迁移工具 |
| **sqlc** | 1.26+ | SQL 代码生成工具 |

### 部署技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Docker** | 24+ | 容器化 |
| **Docker Compose** | 2.20+ | 容器编排 |
| **Caddy** | 2.7+ | 反向代理 |
| **Alpine Linux** | 3.19+ | 基础镜像 |

---

## 部署架构

### 单机部署

```
┌─────────────────────────────────────────────────┐
│              单机服务器                          │
│  ┌──────────────────────────────────────────┐  │
│  │  Docker Compose                          │  │
│  │  ┌────────────┐  ┌────────────┐        │  │
│  │  │  App       │  │  PostgreSQL│        │  │
│  │  │  Container │  │  Container │        │  │
│  │  │  (Go+React)│  │  (Database)│        │  │
│  │  └────────────┘  └────────────┘        │  │
│  │  ┌────────────┐                        │  │
│  │  │  Caddy     │                        │  │
│  │  │  Container │                        │  │
│  │  │  (Proxy)   │                        │  │
│  │  └────────────┘                        │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  持久化存储                               │  │
│  │  ┌────────────┐  ┌────────────┐        │  │
│  │  │  PostgreSQL│  │  Logs      │        │  │
│  │  │  Data      │  │  Backup    │        │  │
│  │  └────────────┘  └────────────┘        │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 分布式部署（推荐）

```
┌─────────────────────────────────────────────────────────────────┐
│                         负载均衡层                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Caddy / Nginx / Cloud Load Balancer                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                         应用服务层                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐              │
│  │  App Node 1│  │  App Node 2│  │  App Node 3│              │
│  │  (Go+React)│  │  (Go+React)│  │  (Go+React)│              │
│  └────────────┘  └────────────┘  └────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                         数据库层                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  PostgreSQL Primary + Replicas                           │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │  Primary   │  │  Replica 1 │  │  Replica 2 │        │  │
│  │  │  (Write)   │  │  (Read)    │  │  (Read)    │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 扩展性设计

### 1. 水平扩展

#### 应用层扩展

- 使用 Docker Compose 或 Kubernetes 部署多个应用实例
- 使用负载均衡分发请求
- WebSocket 连接需要 sticky session 或共享 Hub

#### 数据库层扩展

- 使用 PostgreSQL 主从复制
- 读写分离：写操作到主库，读操作到从库
- 使用连接池管理数据库连接

### 2. 功能扩展

#### 新增游戏模式

- 在 `internal/game/` 添加新的游戏引擎
- 在 `internal/rooms/` 添加新的房间类型
- 在前端添加新的游戏页面

#### 新增 API 接口

- 在 `internal/api/` 添加新的 handler
- 在 `backend/queries/` 添加新的 SQL 查询
- 使用 sqlc 生成 Go 代码

#### 新增 WebSocket 消息类型

- 在 `internal/hub/protocol.go` 添加新的消息类型
- 在 `internal/rooms/room.go` 添加新的消息处理逻辑

### 3. 性能优化

#### 连接池优化

- 调整 PostgreSQL 连接池大小
- 使用 pgx/v5 的连接池特性

#### 缓存策略

- 使用 Redis 缓存常用数据（玩家信息、排行榜）
- 使用内存缓存房间状态

#### 数据库优化

- 为常用查询字段添加索引
- 定期清理过期数据
- 使用分区表存储历史对局数据

---

## 相关文档

- [部署文档 (DEPLOYMENT.md)](./DEPLOYMENT.md)
- [运维手册 (RUNBOOK.md)](./RUNBOOK.md)
- [任务清单 (.trae/specs/tasks.md)](../.trae/specs/tasks.md)