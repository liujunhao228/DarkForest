# 匹配系统与房间集成实施报告

## 概述

我们已成功完善匹配逻辑与房间集成，实现了从匹配队列到游戏房间的完整流程。

## 已完成的工作

### 1. 修复 matchmaking.ts

#### 改动内容
- **移除过早的状态更新**：`createMatchRoom` 不再在创建时自动将状态设置为 `playing` 和清理队列
- **原因**：这些操作应该在房间准备好并等待玩家连接后才执行

```typescript
// 移除的代码（已移至 RoomManager.startGame）
// await db.match.update({ status: 'playing', startedAt: new Date() });
// await db.matchmakingQueue.deleteMany({ where: { playerId: { in: playerIds } } });
```

#### 改进 updateMatchStatus
- 添加了 `playing` 状态的处理
- 在游戏开始时自动设置 `startedAt` 时间戳

```typescript
if (status === 'playing') {
  data.startedAt = new Date();
}
```

### 2. 完善 RoomManager

#### 改进 startGame 方法
```typescript
async startGame(roomId: string): Promise<{ success: boolean; error?: string }> {
  // 1. 更新房间状态
  room.status = 'playing';
  
  // 2. 更新数据库
  await updateMatchStatus(roomId, 'playing');
  
  // 3. 清理匹配队列
  for (const [playerId, player] of room.players.entries()) {
    if (!player.isAI) {
      await cancelQueue(playerId);
    }
  }
  
  // 4. 初始化同步管理器
  const syncManager = room.syncManager;
  for (const [playerId, player] of room.players.entries()) {
    if (player.connected && player.socketId) {
      syncManager.addClient(player.socketId);
    }
  }
  
  // 5. 通知所有玩家
  this.broadcastToRoom(roomId, 'room:gameStarting', { roomId, gameState });
}
```

#### 改进 toggleReady 方法
```typescript
async toggleReady(roomId: string, playerId: string, ready: boolean) {
  // ...
  // 检查是否所有玩家都准备好
  const allReady = Array.from(room.players.values()).every(p => p.ready || p.isAI);
  if (allReady && room.status === 'waiting') {
    return await this.startGame(roomId);  // 自动开始游戏
  }
}
```

#### 添加 getRoomIdByCode 方法
```typescript
getRoomIdByCode(roomCode: string): string | undefined {
  return this.roomCodes.get(roomCode);
}
```

### 3. 完善 EventHandlers

#### 添加匹配定时器
```typescript
private matchCheckTimer: NodeJS.Timeout | null;

constructor(io: Server, roomManager: RoomManager) {
  // ...
  this.startMatchCheckTimer();  // 每 5 秒检查一次匹配
}

private startMatchCheckTimer(): void {
  this.matchCheckTimer = setInterval(() => {
    this.tryMatchPlayers();
  }, 5000);
}
```

#### 改进 tryMatchPlayers 方法
```typescript
private async tryMatchPlayers(): Promise<void> {
  const queues = Array.from(this.matchmakingQueue.values());
  
  // 1. 按玩家数分组匹配
  const byCount = new Map<number, typeof queues>();
  for (const q of queues) {
    if (!byCount.has(q.playerCount)) {
      byCount.set(q.playerCount, []);
    }
    byCount.get(q.playerCount)!.push(q);
  }
  
  // 2. 为每个玩家数创建房间
  for (const [count, queueList] of byCount.entries()) {
    if (queueList.length >= count) {
      const matchPlayers = queueList.slice(0, count);
      await this.createMatchRoom(matchPlayers);
      
      // 清理队列
      for (const q of matchPlayers) {
        this.matchmakingQueue.delete(q.playerId);
        import('@/lib/matchmaking').then(m => m.cancelQueue(q.playerId));
      }
    }
  }
  
  // 3. 混合不同玩家数（3-5人）
  const remainingQueues = Array.from(this.matchmakingQueue.values());
  if (remainingQueues.length >= 3) {
    const targetCount = Math.min(5, remainingQueues.length);
    const matchPlayers = remainingQueues.slice(0, targetCount);
    await this.createMatchRoom(matchPlayers);
    
    for (const q of matchPlayers) {
      this.matchmakingQueue.delete(q.playerId);
      import('@/lib/matchmaking').then(m => m.cancelQueue(q.playerId));
    }
  }
}
```

#### 添加 destroy 方法
```typescript
destroy(): void {
  if (this.matchCheckTimer) {
    clearInterval(this.matchCheckTimer);
    this.matchCheckTimer = null;
  }
}
```

#### 更新事件处理方法
- `handleRoomReady` - 异步处理，自动开始游戏
- `handleRoomStart` - 异步处理，只有房主可以开始
- `handleRoomJoin` - 使用新的 getRoomIdByCode 方法
- `handleDisconnect` - 正确清理房间和队列

### 4. 完善 gameServer.ts

#### 改进优雅关闭
```typescript
function gracefulShutdown(signal: string): void {
  // 1. 销毁事件处理器（清理定时器）
  eventHandlers.destroy();
  
  // 2. 销毁房间管理器
  roomManager.destroy();
  
  // 3. 关闭 Socket.IO
  io.close(() => {
    // 4. 关闭 HTTP 服务器
    httpServer.close(() => {
      process.exit(0);
    });
  });
}
```

## 数据流

### 匹配流程

```
1. 玩家点击"在线匹配"
   └─> 客户端发送: socket.emit('match:joinQueue', { mode: 'casual', playerCount: 4 })
   
2. EventHandlers 接收
   └─> 添加到 matchmakingQueue Map
   └─> 调用 joinQueue() 写入数据库
   
3. 定时匹配检查（每 5 秒）
   └─> tryMatchPlayers() 检查队列
   └─> 按玩家数分组
   └─> 如果某组有足够玩家，创建房间
   
4. createMatchRoom()
   └─> 调用 RoomManager.createRoom()
   └─> 创建数据库记录（Match, MatchPlayer）
   └─> 生成 6 位房间号
   └─> 分配星系位置
   
5. 通知玩家
   └─> 发送 match:found 事件
   └─> 包含 roomId, roomCode, players 列表
   
6. 玩家自动加入房间
   └─> 发送 room:join 事件
   └─> 设置 ready = true
   
7. 所有玩家准备好
   └─> toggleReady() 检查 allReady
   └─> 自动调用 startGame()
   
8. startGame()
   └─> 更新房间状态为 playing
   └─> 更新数据库
   └─> 清理匹配队列
   └─> 初始化同步管理器
   └─> 广播 room:gameStarting
   
9. 游戏开始
   └─> 客户端接收 gameState
   └─> 开始正常游戏流程
```

### 断线重连流程

```
1. 玩家断线
   └─> handleDisconnect()
   └─> 标记 player.connected = false
   └─> player.socketId = ''
   
2. 玩家重新连接
   └─> 发送 player:login
   └─> 发送 room:join with roomCode
   
3. RoomManager.joinRoom()
   └─> 找到现有玩家记录
   └─> 更新 socketId 和 connected = true
   
4. 请求全量同步
   └─> 客户端发送 game:requestSync
   └─> StateSyncManager 发送 game:fullSync
   
5. 玩家恢复游戏
```

## 数据库状态

### Match 表状态流转

```
waiting → playing → finished
  ↑         ↓
  └──── 玩家加入 ┘
  
waiting: 等待玩家加入和准备
playing: 游戏进行中（startGame 时设置）
finished: 游戏结束（endGame 时设置）
```

### MatchmakingQueue 表

```
加入队列:
  - 玩家点击匹配时创建
  - 包含 playerId, mode, playerCount, timeout

离开队列:
  - 匹配成功时删除
  - 玩家取消时删除
  - 玩家断线时删除
  - 游戏开始时删除
```

## 关键特性

### ✅ 防重复匹配
- 检查玩家是否已在队列中
- 匹配成功后立即从 Map 和数据库中删除

### ✅ 自动开始
- 所有玩家准备好后自动开始游戏
- 无需房主手动点击"开始"

### ✅ 定时检查
- 每 5 秒自动检查一次匹配队列
- 确保不会遗漏任何匹配机会

### ✅ 混合匹配
- 支持不同玩家数偏好的混合匹配
- 优先满足相同偏好的玩家
- 剩余玩家混合匹配（3-5人）

### ✅ 优雅关闭
- 正确清理所有定时器
- 正确销毁所有房间
- 正确关闭所有 WebSocket 连接

## 测试状态

### 构建状态
✅ **编译成功** - 无 TypeScript 错误

### 待测试
- [ ] 匹配流程测试
- [ ] 房间加入测试
- [ ] 准备系统测试
- [ ] 游戏开始测试
- [ ] 断线重连测试

## 下一步工作

1. **游戏逻辑完善**
   - [ ] 实现完整的回合流程
   - [ ] 实现广播博弈多玩家交互
   - [ ] 实现打击移动同步

2. **测试**
   - [ ] 匹配系统集成测试
   - [ ] 房间管理集成测试
   - [ ] E2E 测试

3. **优化**
   - [ ] 匹配超时处理
   - [ ] 心跳检测优化
   - [ ] 内存优化

---

**更新日期**: 2026-04-04  
**状态**: ✅ 匹配系统与房间集成完成
