# 匹配API迁移文档

## 概述

本次重构将前端客户端从**快速匹配API**迁移到**自定义房间API**，提供更灵活的游戏匹配体验。

---

## 变更总结

### ✅ 已完成的工作

#### 1. 新增 API 端点

**文件**: `src/app/api/match/room/start/route.ts`
- **功能**: 房主开始游戏
- **方法**: `POST /api/match/room/start`
- **权限**: 仅房主可调用
- **验证**:
  - 检查房间存在
  - 检查房主权限
  - 检查房间状态 (必须为 `waiting`)
  - 检查玩家数量 (至少2人)

#### 2. 重构状态管理

**文件**: `src/store/onlineStore.ts`

**新增类型**:
```typescript
interface CustomQueueInfo {
  queueId: string;
  queueName: string;
  creatorId: string;
  creatorName: string;
  minPlayers: number;
  maxPlayers: number;
  status: 'waiting' | 'matching' | 'full' | 'started';
  players: Array<{...}>;
}

interface RoomInfo {
  id: string;
  roomCode: string;
  hostId: string;
  status: 'waiting' | 'playing' | 'finished';
  playerCount: number;
  players: Array<{...}>;
}
```

**新增状态**:
- `currentQueue: CustomQueueInfo | null` - 当前参与的自定义队列
- `currentRoom: RoomInfo | null` - 当前参与的房间

**新增方法**:
| 方法 | 功能 | API端点 |
|------|------|---------|
| `createCustomQueue(queueName, minPlayers, maxPlayers)` | 创建自定义队列 | `POST /api/match/queue/create` |
| `joinSpecificQueue(queueId)` | 加入指定队列 | `POST /api/match/queue/join-specific` |
| `leaveSpecificQueue(queueId)` | 离开指定队列 | `POST /api/match/queue/leave` |
| `getQueueInfo(queueId)` | 获取队列信息 | `GET /api/match/queue/info` |
| `joinRoomByCode(roomCode)` | 通过房号加入房间 | `POST /api/match/room/join` |
| `startGame(roomCode)` | 开始游戏 (房主) | `POST /api/match/room/start` |
| `leaveRoom()` | 离开房间 | 本地操作 |

**废弃方法** (标记 `@deprecated`):
- `joinQueue()` - 使用 `createCustomQueue` 替代
- `cancelQueue()` - 使用 `leaveSpecificQueue` 替代
- `updateQueueStatus()` - 不再需要
- `setMatchPreferences()` - 不再需要
- `toggleQuickMatch()` - 不再需要

#### 3. 重写匹配组件

**文件**: `src/components/online/Matchmaking.tsx`

**新UI流程**:
```
┌─────────────────────────────────────┐
│        创建/加入房间 (主菜单)         │
├─────────────────────────────────────┤
│  [创建房间]                          │
│  - 房间名称: [________]              │
│  - 人数选择: [3] [4] [5]             │
│  - [创建 4 人房间]                   │
│                                     │
│  [加入队列]                          │
│  - 队列 ID: [________]               │
│  - [加入队列]                        │
│                                     │
│  [直接加入房间]                      │
│  - 房间号: [______]                  │
│  - [加入房间]                        │
└─────────────────────────────────────┘

          ↓ (创建队列后)

┌─────────────────────────────────────┐
│        等待玩家加入                   │
├─────────────────────────────────────┤
│  队列名称: 测试房间                   │
│  队列 ID: abc12345  [复制]           │
│                                     │
│  已加入玩家 (2/4)                     │
│  - 地球文明 [已准备]                  │
│  - 三体文明 [已准备]                  │
│                                     │
│  [离开队列]                          │
└─────────────────────────────────────┘

          ↓ (队列满后自动创建房间)

┌─────────────────────────────────────┐
│        房间准备中                     │
├─────────────────────────────────────┤
│  房间号                              │
│     ABC123  [复制]                   │
│                                     │
│  房间玩家 (3/4)                       │
│  - 地球文明 [房主]                    │
│  - 三体文明                          │
│  - 歌者文明                          │
│                                     │
│  [开始游戏] (仅房主可见)              │
│  [离开房间]                          │
└─────────────────────────────────────┘
```

**核心特性**:
- 三种模式切换: `menu` → `queue` → `room`
- 队列/房间状态轮询 (2秒间隔)
- 房间号/队列ID一键复制
- 房主专属开始游戏按钮

#### 4. 简化主菜单

**文件**: `src/components/online/MainMenu.tsx`

**变更**:
- 移除玩家数选择器
- 移除队列状态显示
- 按钮文案更新为 "创建/加入房间"
- 简化匹配逻辑，直接跳转到 Matchmaking 组件

#### 5. 更新测试

**文件**: `src/app/api/__tests__/routes.test.ts`

**新增测试套件**:
- `Custom Queue API` - 11个测试用例
  - 创建队列 (成功/失败/验证)
  - 加入队列 (成功/不存在)
  - 查询队列信息 (成功/不存在)
  - 离开队列
- `Room Start API` - 2个测试用例
  - 房间不存在
  - 缺少参数

---

## 架构对比

### 旧架构 (快速匹配)

```
前端                         后端
  |                          |
  |-- joinQueue ----------->| (WebSocket)
  |                          |-- 加入内存队列
  |                          |-- 定时匹配 (5s)
  |                          |-- createMatchRoom
  |                          |
  |<-- match:found ----------| (自动推送)
  |                          |
  |-- connect -------------->| (连接到房间)
```

**特点**:
- 被动等待系统匹配
- 无法选择具体玩家
- 无法邀请好友
- 匹配时间不可控

### 新架构 (自定义房间)

```
前端                         后端
  |                          |
  |-- createCustomQueue ---->| (REST API)
  |                          |-- 创建队列记录
  |                          |
  |-- getQueueInfo --------->| (轮询)
  |<-- queue info -----------|
  |                          |
  |   (分享 queueId)         |
  |                          |
  |-- joinSpecificQueue ---->| (其他玩家)
  |                          |-- 加入队列
  |                          |
  |   (队列满)               |
  |                          |-- 自动创建房间
  |                          |
  |-- joinRoomByCode ------->| (REST API)
  |<-- room info ------------|
  |                          |
  |-- startGame ------------>| (房主)
  |                          |-- 更新状态
  |                          |
  |<-- 游戏开始 --------------|
```

**特点**:
- 主动创建/加入队列
- 可分享队列ID邀请好友
- 可直接通过房号加入
- 房主控制开始时机

---

## 迁移指南

### 对于现有代码

旧的快速匹配API仍然可用，但已标记为 `@deprecated`。建议按以下步骤迁移：

1. **更新状态访问**:
```typescript
// 旧
const { isInQueue, queueStatus } = useOnlineStore();

// 新
const { currentQueue, currentRoom } = useOnlineStore();
```

2. **更新匹配调用**:
```typescript
// 旧
joinQueue(4);

// 新
await createCustomQueue('我的房间', 4, 4);
```

3. **更新取消匹配**:
```typescript
// 旧
cancelQueue();

// 新
if (currentQueue) {
  await leaveSpecificQueue(currentQueue.queueId);
}
```

4. **更新房间加入**:
```typescript
// 旧 (WebSocket 自动推送)
// match:found 事件自动处理

// 新 (手动加入)
await joinRoomByCode('ABC123');
```

### API端点可用性

| 端点 | 状态 | 替代方案 |
|------|------|---------|
| `POST /api/match/queue/join` | ⚠️ 废弃 | `POST /api/match/queue/create` |
| `POST /api/match/queue/cancel` | ⚠️ 废弃 | `POST /api/match/queue/leave` |
| `GET /api/match/queue/status` | ⚠️ 废弃 | `GET /api/match/queue/info` |
| `POST /api/match/queue/create` | ✅ 新增 | - |
| `POST /api/match/queue/join-specific` | ✅ 已有 | - |
| `POST /api/match/queue/leave` | ✅ 已有 | - |
| `GET /api/match/queue/info` | ✅ 已有 | - |
| `POST /api/match/room/start` | ✅ 新增 | - |
| `POST /api/match/room/join` | ✅ 已有 | - |
| `GET /api/match/room/:code` | ✅ 已有 | - |

---

## 后续优化建议

1. **队列满检测自动化**:
   - 当前需要前端轮询检测队列满状态
   - 建议: 添加 WebSocket 事件 `queue:full` 自动通知

2. **房间创建自动化**:
   - 当前队列满后需要手动触发房间创建
   - 建议: 后端监听队列满事件，自动创建房间并推送 `room:created`

3. **准备状态同步**:
   - 当前房间准备状态未实现
   - 建议: 添加 `room:ready` 事件，玩家点击准备按钮

4. **队列过期清理**:
   - 当前队列无过期机制
   - 建议: 添加定时任务清理空队列 (超过30分钟)

5. **房间号生成优化**:
   - 当前6位字符可能冲突
   - 建议: 检查冲突并重试，或增加长度到8位

---

## 测试建议

### 手动测试流程

1. **创建队列**:
   ```bash
   curl -X POST http://localhost:3000/api/match/queue/create \
     -H "Content-Type: application/json" \
     -d '{"creatorId":"player1","queueName":"测试","minPlayers":3,"maxPlayers":4}'
   ```

2. **查询队列**:
   ```bash
   curl http://localhost:3000/api/match/queue/info?queueId=abc12345
   ```

3. **加入队列**:
   ```bash
   curl -X POST http://localhost:3000/api/match/queue/join-specific \
     -H "Content-Type: application/json" \
     -d '{"playerId":"player2","queueId":"abc12345"}'
   ```

4. **开始游戏**:
   ```bash
   curl -X POST http://localhost:3000/api/match/room/start \
     -H "Content-Type: application/json" \
     -d '{"roomCode":"ABC123","playerId":"player1"}'
   ```

---

## 文件清单

### 新增文件
- `src/app/api/match/room/start/route.ts` - 开始游戏API

### 修改文件
- `src/store/onlineStore.ts` - 状态管理重构
- `src/components/online/Matchmaking.tsx` - UI重写
- `src/components/online/MainMenu.tsx` - 简化入口
- `src/app/api/__tests__/routes.test.ts` - 新增测试

### 未修改文件 (向后兼容)
- `src/lib/matchmaking.ts` - 核心逻辑 (保留旧函数)
- `src/app/api/match/queue/join/route.ts` - 旧API (标记废弃)
- `src/app/api/match/queue/cancel/route.ts` - 旧API (标记废弃)

---

## 版本历史

- **v3.0** (2026-04-11) - 自定义房间系统
  - 新增自定义队列管理
  - 新增房间开始游戏API
  - 重构前端匹配流程
  - 废弃快速匹配API

- **v2.0** (之前) - 快速匹配系统
  - WebSocket实时匹配
  - 自动队列匹配
  - 被动房间分配

---

## 联系与支持

如有问题或建议，请查阅:
- `MATCHMAKING-INTEGRATION.md` - 集成文档
- `BROADCAST-FLOW-IMPLEMENTATION.md` - 广播流程
- `AUTHORITATIVE-SERVER-IMPLEMENTATION.md` - 权威服务器
