# WebSocket 服务模块改进方案

## 1. 高优先级问题

### 1.1 Socket 清理不完整

**状态**: ✅ 已完成  
**问题位置**: [RoomHandler.ts:L77-89](file:///e:/DarkForest/src/server/handlers/RoomHandler.ts#L77-L89)

**问题描述**: `handleRoomLeave` 仅清理 `socket.data.roomCode`，但未从 `StateSyncManager` 移除客户端，导致内存泄漏和无效的同步尝试。

**修复方案**:

```typescript
// RoomHandler.ts
handleRoomLeave(socket: Socket): void {
  const playerId = socket.data.playerId;
  const roomCode = socket.data.roomCode;

  if (!playerId || !roomCode) return;

  const roomId = this.roomManager.getRoomIdByCode(roomCode);
  if (roomId) {
    // 获取房间以访问 syncManager
    const room = this.roomManager.getRoom(roomId);
    if (room) {
      // 从 StateSyncManager 移除客户端
      room.syncManager.removeClient(socket.id);
    }
    
    this.roomManager.leaveRoom(roomId, playerId);
  }

  socket.data.roomCode = null;
}
```

**对应的 RoomManager 需要添加辅助方法**:

```typescript
// RoomManager.ts
getRoom(roomId: string): RoomWithEngine | undefined {
  return this.rooms.get(roomId);
}
```

---

### 1.2 事件命名硬编码

**状态**: ✅ 已完成  
**问题位置**: [EventHandlers.ts](file:///e:/DarkForest/src/server/EventHandlers.ts)

**问题描述**: 事件名称使用字符串字面量，未与 `protocol.ts` 中定义的类型关联，导致类型不安全。

**修复方案**:

```typescript
// protocol.ts 新增事件名称常量
export const ClientEvents = {
  // 连接与认证
  PLAYER_LOGIN: 'player:login',
  PLAYER_LOGOUT: 'player:logout',
  
  // 匹配系统
  MATCH_JOIN_QUEUE: 'match:joinQueue',
  MATCH_CANCEL_QUEUE: 'match:cancelQueue',
  MATCH_GET_STATUS: 'match:getStatus',
  MATCH_JOIN_SPECIFIC_QUEUE: 'match:joinSpecificQueue',
  MATCH_CREATE_QUEUE: 'match:createQueue',
  MATCH_LEAVE_SPECIFIC_QUEUE: 'match:leaveSpecificQueue',
  MATCH_GET_QUEUE_INFO: 'match:getQueueInfo',
  MATCH_GET_MY_QUEUES: 'match:getMyQueues',
  
  // 房间管理
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  
  // 游戏操作
  GAME_ACTION: 'game:action',
  GAME_REQUEST_SYNC: 'game:requestSync',
  GAME_ACK_STATE: 'game:ackState',
} as const;

export const ServerEvents = {
  PLAYER_LOGIN_SUCCESS: 'player:loginSuccess',
  PLAYER_LOGIN_ERROR: 'player:loginError',
  // ... 其他事件
} as const;
```

```typescript
// EventHandlers.ts 使用常量
registerEvents(): void {
  this.io.on('connection', (socket: Socket) => {
    socket.on(ClientEvents.PLAYER_LOGIN, (data) => {
      this.authHandler.handlePlayerLogin(socket, data);
    });

    socket.on(ClientEvents.MATCH_JOIN_QUEUE, (data) => {
      this.matchmakingHandler.handleJoinQueue(socket, data);
    });
    
    // ... 其他事件
  });
}
```

---

## 2. 中优先级问题

### 2.1 日志管理

**状态**: ✅ 已完成  
**问题位置**: 多处 `console.log` 调试日志

**修复方案**: 引入统一的日志工具

```typescript
// lib/logger.ts
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private context: string;
  private static level = process.env.NODE_ENV === 'production' 
    ? LogLevel.WARN 
    : LogLevel.DEBUG;

  constructor(context: string) {
    this.context = context;
  }

  debug(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.DEBUG) {
      console.debug(`[${this.context}] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.INFO) {
      console.info(`[${this.context}] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.WARN) {
      console.warn(`[${this.context}] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.ERROR) {
      console.error(`[${this.context}] ${message}`, ...args);
    }
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}
```

**使用示例**:

```typescript
// MatchmakingHandler.ts
import { createLogger } from '@/lib/logger';

export class MatchmakingHandler {
  private logger = createLogger('MatchmakingHandler');
  
  async handleJoinQueue(socket: Socket, data: JoinQueuePayload): Promise<void> {
    this.logger.debug(`玩家加入匹配队列`, { playerId, playerCount: data.playerCount });
    // ...
  }
}
```

---

### 2.2 setTimeout 错误传播

**状态**: ✅ 已完成  
**问题位置**: [BroadcastFlowManager.ts:L498-547](file:///e:/DarkForest/src/server/BroadcastFlowManager.ts#L498-L547)

**问题描述**: `setTimeout` 回调内的错误仅用 `console.error` 记录，不向上传播。

**修复方案**:

```typescript
// 在 BroadcastFlowManager 中引入错误事件
export class BroadcastFlowManager {
  private syncManager: StateSyncManager;
  private config: BroadcastConfig;
  private timeoutTimer: NodeJS.Timeout | null;
  
  // 用于跟踪当前结算状态
  private pendingResolution: {
    resolveFn?: (result: BroadcastActionResult) => void;
    rejectFn?: (error: Error) => void;
  } = {};

  // 修改 executeBroadcastResolution 方法
  private executeBroadcastResolution(state: GameState): BroadcastActionResult {
    // ... 前置逻辑保持不变 ...

    return new Promise<BroadcastActionResult>((resolve, reject) => {
      this.pendingResolution.resolveFn = resolve;
      this.pendingResolution.rejectFn = reject;

      setTimeout(() => {
        try {
          // ... 执行结算逻辑 ...
          
          this.pendingResolution.resolveFn?.({ success: true, phase: 'done' });
          this.pendingResolution = {};
        } catch (error) {
          this.pendingResolution.rejectFn?.(error as Error);
          this.pendingResolution = {};
        }
      }, this.config.revealTimeout);
    }) as unknown as BroadcastActionResult;
  }

  // 新增：清理待处理的结算
  private cancelPendingResolution(): void {
    if (this.pendingResolution.rejectFn) {
      this.pendingResolution.rejectFn(new Error('Broadcast cancelled'));
    }
    this.pendingResolution = {};
  }

  destroy(): void {
    this.clearTimeout();
    this.cancelPendingResolution();
  }
}
```

**或者更简单的方案 - 添加错误事件广播**:

```typescript
// 在 setTimeout 回调中添加
} catch (error) {
  console.error('[BroadcastFlow] setTimeout 中的结算逻辑失败:', error);
  
  // 广播错误事件给所有客户端
  this.syncManager.broadcastSimpleEvent('broadcastError', {
    error: '广播结算失败，请刷新重试',
    timestamp: Date.now(),
  });
}
```

---

### 2.3 统一错误码枚举

**状态**: ✅ 已完成  
**问题描述**: `ActionResult.errorCode` 使用字符串字面量，容易拼写错误。

**修复方案**:

```typescript
// protocol.ts 或新建 errors.ts
export enum ErrorCode {
  // 通用错误
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  IS_PROCESSING = 'IS_PROCESSING',
  UNKNOWN_ACTION = 'UNKNOWN_ACTION',
  
  // 认证错误
  AUTH_TOKEN_MISSING = 'AUTH_TOKEN_MISSING',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  PLAYER_NOT_FOUND = 'PLAYER_NOT_FOUND',
  
  // 游戏操作错误
  CARD_NOT_FOUND = 'CARD_NOT_FOUND',
  CARD_NOT_IN_HAND = 'CARD_NOT_IN_HAND',
  NOT_ENOUGH_ENERGY = 'NOT_ENOUGH_ENERGY',
  MISSING_TARGET = 'MISSING_TARGET',
  MISSING_TARGET_PLAYER = 'MISSING_TARGET_PLAYER',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  INVALID_PHASE = 'INVALID_PHASE',
  
  // 广播博弈错误
  NO_ACTIVE_BROADCAST = 'NO_ACTIVE_BROADCAST',
  CANNOT_RESPOND = 'CANNOT_RESPOND',
  ALREADY_RESPONDED = 'ALREADY_RESPONDED',
  NOT_BROADCASTER = 'NOT_BROADCASTER',
  ALREADY_SELECTED = 'ALREADY_SELECTED',
  
  // ... 其他错误码
}
```

**修改 AuthoritativeGameEngine 使用枚举**:

```typescript
// AuthoritativeGameEngine.ts
import { ErrorCode } from './errors';

async processAction(...): Promise<ActionResult> {
  // ...
  if (this.isProcessing) {
    return { success: false, error: '操作处理中', errorCode: ErrorCode.IS_PROCESSING };
  }
  // ...
}
```

---

## 3. 低优先级问题

### 3.1 Request 缓存 LRU 优化

**状态**: ✅ 已完成  
**问题位置**: [AuthoritativeGameEngine.ts:L567-587](file:///e:/DarkForest/src/server/AuthoritativeGameEngine.ts#L567-L587)

**当前实现**: 使用简单 Map + 手动清理

**改进方案**: 使用 LRU Cache

```typescript
// 安装 lru-cache: bun add lru-cache
import LRU from 'lru-cache';

export class AuthoritativeGameEngine {
  private processedRequests: LRU<string, ProcessedRequest>;
  
  constructor(...) {
    this.processedRequests = new LRU({
      max: 200,           // 最多缓存 200 个请求
      ttl: 60 * 1000,    // 60 秒过期
      updateAgeOnGet: false,
    });
  }
  
  // 简化后的缓存逻辑
  private cacheRequestResult(requestId: string, playerId: string, result: ActionResult): void {
    this.processedRequests.set(requestId, {
      requestId,
      playerId,
      result,
      timestamp: Date.now(),
    });
  }
}
```

---

### 3.2 重连状态判断优化

**状态**: ✅ 已完成  
**问题位置**: [AuthHandler.ts:L67-111](file:///e:/DarkForest/src/server/handlers/AuthHandler.ts#L67-L111)

**问题描述**: 假设 `status === 'full'` 即代表重连，但实际可能是匹配刚成功。

**改进方案**: 增加时间窗口判断

```typescript
private async restorePlayerQueueState(playerId: string, socketId: string): Promise<void> {
  try {
    const { getPlayerQueues } = await import('@/lib/matchmaking');
    const playerQueues = await getPlayerQueues(playerId);

    if (!playerQueues || playerQueues.length === 0) {
      return;
    }

    for (const queue of playerQueues) {
      // 检查队列是否已满且创建时间超过 10 秒
      // 如果队列刚创建（10秒内），可能是匹配刚成功，不应恢复
      const queueAge = Date.now() - new Date(queue.createdAt).getTime();
      const isStaleFullQueue = queue.status === 'full' && queueAge > 10000;

      if (isStaleFullQueue && !this.matchmakingQueueHasPlayer(playerId)) {
        // 恢复逻辑...
      }
    }
  } catch (error) {
    // ...
  }
}
```

---

## 4. 实施计划

| 阶段 | 任务 | 优先级 | 工作量 | 状态 |
|------|------|--------|--------|------|
| **Phase 1** | Socket 清理修复 | 高 | 1-2 小时 | ✅ 已完成 |
| **Phase 1** | 事件名称常量抽取 | 高 | 2-3 小时 | ✅ 已完成 |
| **Phase 2** | 日志工具引入 | 中 | 3-4 小时 | ✅ 已完成 |
| **Phase 2** | setTimeout 错误处理 | 中 | 2-3 小时 | ✅ 已完成 |
| **Phase 2** | 统一错误码枚举 | 中 | 2 小时 | ✅ 已完成 |
| **Phase 3** | LRU 缓存优化 | 低 | 1-2 小时 | ✅ 已完成 |
| **Phase 3** | 重连状态判断优化 | 低 | 2 小时 | ✅ 已完成 |

**总预计工作量**: 约 13-19 小时
**已完成工作量**: 约 13-19 小时
**剩余工作量**: 0 小时

---

## 5. 测试建议

每个修复都应伴随相应测试：

1. **Socket 清理**: 验证 `handleRoomLeave` 后 `syncManager.clients.size` 减少
2. **事件常量**: 编译时检查无硬编码字符串遗漏
3. **日志工具**: 验证生产环境日志级别过滤
4. **错误处理**: 模拟 `setTimeout` 回调异常，验证错误事件广播
5. **LRU 缓存**: 验证超过 200 条后最旧条目被驱逐
6. **重连判断**: 模拟 10 秒内外的不同行为
