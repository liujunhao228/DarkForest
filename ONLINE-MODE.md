# 黑暗森林 - 在线对战功能

## 功能概述

黑暗森林现已支持多人在线对战功能！你可以：

- 🎮 **在线匹配** - 与其他玩家实时对战
- 🏆 **排位模式** - 计分排位，提升你的文明等级
- 😌 **休闲模式** - 不计分，轻松娱乐
- 🤖 **AI 填充** - 匹配等待过长时自动加入 AI 对手
- 📊 **玩家统计** - 查看胜率、对局数、评分

## 快速开始

### 方法一：使用启动脚本（推荐）

**Windows:**
```bash
.zscripts\dev-online.bat
```

**Linux/Mac:**
```bash
.zscripts/dev-online.sh
```

### 方法二：手动启动

1. **启动 WebSocket 服务器** (端口 3003):
```bash
bun run src/server/gameServer.ts
```

2. **启动 Next.js 开发服务器** (端口 3000):
```bash
bun run dev
```

3. **打开浏览器访问**: http://localhost:3000

## 游戏流程

### 1. 主菜单
- 输入你的文明名称
- 点击 "进入黑暗森林" 登录

### 2. 选择模式
- **休闲模式** - 不计分，轻松娱乐
- **排位模式** - 计分，影响评分

### 3. 期望玩家数
- 选择 3-5 名玩家
- 如果真人玩家不足，将自动加入 AI

### 4. 匹配中
- 显示队列位置和预计等待时间
- 可随时取消匹配

### 5. 游戏开始
- 房主可以开始游戏
- 所有玩家准备后自动开始

## 技术架构

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│   玩家 A      │     │   玩家 B      │     │   玩家 C     │
│  (浏览器)    │     │  (浏览器)    │     │  (浏览器)   │
└──────┬───────┘     └──────┬───────┘     └──────┬──────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                   ┌────────▼────────┐
                   │  WebSocket 服务器 │
                   │  (Socket.IO)    │
                   │  - 匹配服务      │
                   │  - 房间管理      │
                   │  - 游戏同步      │
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │   SQLite 数据库  │
                   │   - 玩家信息     │
                   │   - 对局记录     │
                   └─────────────────┘
```

## API 端点

### 玩家 API
- `POST /api/player/login` - 玩家登录/创建

### 匹配 API
- `POST /api/match/queue/join` - 加入匹配队列
- `POST /api/match/queue/cancel` - 取消匹配队列
- `GET /api/match/queue/status?playerId=xxx` - 查询匹配状态
- `GET /api/match/room/[roomCode]` - 获取房间信息
- `POST /api/match/room/join` - 加入房间

## WebSocket 事件

### 客户端 → 服务器
- `player:login` - 玩家登录
- `match:joinQueue` - 加入匹配队列
- `match:cancelQueue` - 取消匹配队列
- `room:join` - 加入房间
- `room:ready` - 准备状态
- `room:start` - 开始游戏
- `game:action` - 游戏动作

### 服务器 → 客户端
- `player:loggedIn` - 登录成功
- `match:found` - 匹配成功
- `room:joined` - 加入房间成功
- `game:start` - 游戏开始
- `game:state` - 游戏状态更新

## 数据库 Schema

### Player 表
- `id` - 玩家 ID
- `displayName` - 显示名称
- `level` - 等级
- `rating` - ELO 评分
- `wins/losses/draws` - 胜负平统计

### Match 表
- `id` - 对局 ID
- `roomCode` - 房间号
- `hostId` - 房主 ID
- `status` - 游戏状态
- `mode` - 模式 (casual/ranked)

## 开发说明

### 添加新功能
1. 在 `src/lib/matchmaking.ts` 添加匹配逻辑
2. 在 `src/server/gameServer.ts` 添加 WebSocket 事件处理
3. 在 `src/store/onlineStore.ts` 添加客户端状态管理
4. 创建相应的 UI 组件

### 调试
- WebSocket 服务器日志在控制台输出
- 客户端可以在浏览器开发者工具查看网络请求
- 使用 `socket.io-client` 的调试模式：
  ```javascript
  localStorage.debug = 'socket.io-client:*'
  ```

## 注意事项

1. **开发环境**: WebSocket 服务器运行在端口 3003
2. **数据库**: 使用 SQLite 数据库，文件位于 `db/custom.db`
3. **跨域**: 开发环境允许所有来源连接 WebSocket
4. **AI 填充**: 匹配等待 30 秒后自动加入 AI 对手

## 故障排除

### WebSocket 连接失败
- 检查端口 3003 是否被占用
- 确认 WebSocket 服务器已启动
- 检查防火墙设置

### 匹配失败
- 检查数据库连接
- 确认 Prisma Schema 已推送
- 查看服务器日志

### 构建失败
- 运行 `bun install` 安装依赖
- 运行 `bun run db:push` 推送数据库
- 清除 `.next` 目录后重新构建

## 未来计划

- [ ] 好友系统
- [ ] 观战模式
- [ ] 回放系统
- [ ] 聊天功能
- [ ] 成就系统
- [ ] 赛季排行
