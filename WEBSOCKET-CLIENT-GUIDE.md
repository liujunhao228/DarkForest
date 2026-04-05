# 黑暗森林 - WebSocket 客户端开发指南

> 本文档面向前端/移动端开发者，提供完整的 WebSocket 客户端接入说明、API 参考和代码示例。

---

## 目录

- [1. 概述](#1-概述)
- [2. 快速开始](#2-快速开始)
- [3. 连接与认证](#3-连接与认证)
- [4. 消息协议](#4-消息协议)
- [5. 完整流程示例](#5-完整流程示例)
- [6. 错误处理](#6-错误处理)
- [7. 最佳实践](#7-最佳实践)
- [8. API 参考](#8-api-参考)
- [9. 调试技巧](#9-调试技巧)
- [10. 常见问题](#10-常见问题)

---

## 1. 概述

### 1.1 技术栈

| 项目 | 说明 |
|------|------|
| 协议 | Socket.IO v4+ |
| 传输层 | WebSocket（优先）/ HTTP Long-Polling（降级） |
| 数据格式 | JSON |
| 认证方式 | JWT Bearer Token（生产）/ 快速登录（开发） |
| 服务器端口 | `3003`（开发）/ `443`（生产，同 HTTPS） |

### 1.2 架构模式

本项目采用 **权威服务器（Authoritative Server）** 架构：

```
┌────────────┐         ┌──────────────────┐         ┌────────────┐
│  客户端 A   │ ◄─────► │   WebSocket 服务器 │ ◄─────► │  数据库     │
│  (观察者)   │         │  (游戏逻辑权威)   │         │  (SQLite)   │
└────────────┘         └──────────────────┘         └────────────┘
       ▲                        ▲
       │                        │
       ▼                        ▼
┌────────────┐         ┌──────────────────┐
│  客户端 B   │         │   房间管理器      │
│  (观察者)   │         │   状态同步管理器   │
└────────────┘         └──────────────────┘
```

**核心原则：**
- 所有游戏逻辑在服务器端运行
- 客户端只能 **观察** 游戏状态和 **请求** 操作
- 服务器验证每个操作的合法性
- 状态变更通过增量同步推送给客户端

---

## 2. 快速开始

### 2.1 安装依赖

```bash
# npm
npm install socket.io-client

# bun
bun add socket.io-client

# yarn
yarn add socket.io-client
```

### 2.2 最小可运行示例

```typescript
import { io } from 'socket.io-client';

// 1. 建立连接
const socket = io('http://localhost:3003', {
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => {
  console.log('✅ 已连接服务器, socket ID:', socket.id);

  // 2. 快速登录
  socket.emit('player:login', {
    userId: 'user_' + crypto.randomUUID(),
    displayName: '面壁者',
  });
});

socket.on('player:loginSuccess', (data) => {
  console.log('🎮 登录成功:', data);

  // 3. 加入匹配队列
  socket.emit('match:joinQueue', {
    playerCount: 4,      // 期望 4 人局
    quickMatch: false,   // 不启用快速匹配
  });
});

socket.on('match:found', (data) => {
  console.log('🏠 匹配成功, 房间码:', data.roomCode);

  // 4. 准备
  socket.emit('room:ready', {
    roomId: data.roomId,
    ready: true,
  });
});

socket.on('room:gameStarting', (data) => {
  console.log('🚀 游戏即将开始！');
  // data.gameState 包含过滤后的 ViewState
});

// 房主开始游戏（需要 roomId）
function startGame(roomId: string) {
  socket.emit('room:start', { roomId });
}

// 错误处理
socket.on('connect_error', (err) => {
  console.error('❌ 连接失败:', err.message);
});

socket.on('room:error', (data) => {
  console.error('❌ 房间错误:', data.message);
});
```

---

## 3. 连接与认证

### 3.1 建立连接

```typescript
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3003'
  : '/';  // 生产环境使用同源连接（通过反向代理）

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],  // 优先 WebSocket，降级 HTTP
  forceNew: true,                        // 强制创建新连接
  reconnection: true,                    // 自动重连
  reconnectionAttempts: 5,               // 最大重连次数
  reconnectionDelay: 1000,               // 重连延迟（ms）
  timeout: 10000,                        // 连接超时（ms）
});
```

### 3.2 认证方式

#### 方式一：JWT Token 认证（推荐生产环境）

```typescript
const token = localStorage.getItem('authToken');  // 从登录接口获取

const socket = io(SOCKET_URL, {
  auth: { token },  // Socket.IO 认证参数
  // 或者使用查询参数
  // query: { token },
});
```

**Token 获取流程：**
1. 调用 `POST /api/auth/login` 获取 JWT Token
2. 存储 Token（localStorage / secure cookie）
3. 连接 WebSocket 时携带 Token

#### 方式二：快速登录（开发/测试）

```typescript
// 连接后发送登录消息
socket.emit('player:login', {
  userId: 'user_' + crypto.randomUUID(),  // 客户端生成的唯一 ID
  displayName: '面壁者',                   // 显示名称（2-50 字符）
});
```

### 3.3 连接生命周期

```typescript
// 连接成功
socket.on('connect', () => {
  console.log('✅ 连接成功');
  if (socket.data?.playerId) {
    // 重连场景：重新加入房间
    socket.emit('room:join', { roomCode: socket.data.roomCode });
  }
});

// 连接断开
socket.on('disconnect', (reason) => {
  console.log('❌ 连接断开:', reason);
  // reason: 'io server disconnect' | 'io client disconnect' | 'ping timeout' | 'transport close'
});

// 重连中
socket.on('reconnecting', (attempt) => {
  console.log(`🔄 重连中... 第 ${attempt} 次尝试`);
});

// 重连成功
socket.on('reconnect', (attempt) => {
  console.log(`✅ 重连成功，共尝试 ${attempt} 次`);
});

// 重连失败
socket.on('reconnect_failed', () => {
  console.error('❌ 重连失败');
});
```

### 3.4 断开连接

```typescript
// 主动断开
socket.disconnect();

// 登出前清理
socket.emit('player:logout');
socket.disconnect();
```

---

## 4. 消息协议

### 4.1 消息格式

所有消息遵循统一的 `{ type, payload }` 格式：

```typescript
// 客户端 → 服务器
socket.emit('事件名', {
  // 载荷数据
});

// 服务器 → 客户端
socket.on('事件名', (payload) => {
  // 处理响应
});
```

### 4.2 客户端 → 服务器 事件

#### 4.2.1 连接与认证

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `player:login` | `{ userId: string, displayName: string }` | 快速登录 |
| `player:logout` | - | 登出 |

#### 4.2.2 匹配系统

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `match:joinQueue` | `{ playerCount: number, quickMatch?: boolean }` | 加入匹配队列 |
| `match:cancelQueue` | - | 取消匹配 |
| `match:getStatus` | - | 查询队列状态 |

**`match:joinQueue` 参数说明：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `playerCount` | `number` | ✅ | - | 期望玩家数（3-5） |
| `quickMatch` | `boolean` | ❌ | `false` | 快速匹配：接受 3-5 人任意组合 |

#### 4.2.3 房间管理

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `room:join` | `{ roomCode: string }` | 加入房间 |
| `room:leave` | - | 离开房间 |
| `room:ready` | `{ roomId: string, ready: boolean }` | 切换准备状态 |
| `room:start` | `{ roomId: string }` | 开始游戏（仅房主） |

#### 4.2.4 游戏操作

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `game:action` | `{ action: string, payload?: object, requestId?: string }` | 执行游戏操作 |
| `game:requestSync` | - | 请求全量状态同步 |
| `game:ackState` | `{ version: number }` | 确认已接收状态版本 |

**`game:action` 支持的操作类型：**

| 操作 | 说明 | 典型载荷 |
|------|------|----------|
| `playCard` | 出牌 | `{ cardUid: string, targetType?: string }` |
| `moveStrike` | 移动打击牌 | `{ strikeUid: string, targetSystem: number }` |
| `endTurn` | 结束回合 | - |
| `respondBroadcast` | 回应广播 | `{ cardUid: string, agreed: boolean }` |
| `selectResponder` | 选择回应者 | `{ cardUid: string, selectedPlayers: string[] }` |
| `announceStrike` | 宣布打击生效 | `{ strikeUid: string }` |
| `skipAnnounceStrike` | 跳过宣布（延迟） | `{ strikeUid: string }` |
| `recycleCard` | 回收门牌 | `{ cardUid: string }` |
| `useLightspeedShip` | 使用光速飞船 | `{ cardUid: string, targetSystem: number }` |
| `discardCards` | 弃牌 | `{ cardUids: string[] }` |

**幂等性支持：**
所有游戏操作支持可选的 `requestId` 字段，用于防止网络重试导致的重复执行：

```typescript
socket.emit('game:action', {
  action: 'playCard',
  payload: { cardUid: 'card_123' },
  requestId: 'req_' + crypto.randomUUID(),  // 客户端生成的请求 ID
});
```

### 4.3 服务器 → 客户端 事件

#### 4.3.1 连接与认证

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `player:loginSuccess` | `{ playerId, displayName, playerInfo? }` | 登录成功 |
| `player:loginError` | `{ message: string }` | 登录失败 |

**`player:loginSuccess` 响应示例：**

```json
{
  "playerId": "player_abc123",
  "displayName": "面壁者",
  "playerInfo": {
    "id": "player_abc123",
    "displayName": "面壁者",
    "wins": 8,
    "losses": 5,
    "draws": 2,
    "totalMatches": 15
  }
}
```

#### 4.3.2 匹配系统

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `match:queueJoined` | `{ playerCount, position, totalInQueue, groups, quickMatch }` | 成功加入队列 |
| `match:queueCancelled` | - | 取消匹配成功 |
| `match:queueError` | `{ message: string }` | 匹配错误 |
| `match:found` | `{ roomId, roomCode, hostId, players, isHost }` | 匹配成功 |
| `match:queueStatus` | `{ inQueue, position?, estimatedTime? }` | 队列状态响应 |
| `match:queueUpdate` | `{ position, totalInQueue, groups }` | 队列状态更新（广播给队列中其他玩家） |

**`match:queueJoined` 响应示例：**

```json
{
  "playerCount": 4,
  "position": 2,
  "totalInQueue": 5,
  "quickMatch": false,
  "groups": [
    { "playerCount": 3, "count": 2 },
    { "playerCount": 4, "count": 3 }
  ]
}
```

**`match:found` 响应示例：**

```json
{
  "roomId": "match_001",
  "roomCode": "ROOM01",
  "hostId": "player_abc123",
  "players": [
    {
      "playerId": "player_abc123",
      "displayName": "面壁者",
      "isHost": true,
      "playerNumber": 1,
      "position": 0,
      "ready": false,
      "connected": true
    },
    {
      "playerId": "player_def456",
      "displayName": "执剑人",
      "isHost": false,
      "playerNumber": 2,
      "position": 1,
      "ready": false,
      "connected": true
    }
  ],
  "isHost": false
}
```

#### 4.3.3 房间管理

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `room:joined` | `{ roomId, roomCode, players }` | 加入房间成功 |
| `room:error` | `{ message: string }` | 房间错误 |
| `room:playerJoined` | `{ roomId, players }` | 新玩家加入（广播） |
| `room:playerLeft` | `{ roomId, players }` | 玩家离开（广播） |
| `room:playerDisconnected` | `{ roomId, disconnectedPlayerId, disconnectedPlayerName, players, reason, canReconnect, reconnectTimeout? }` | 玩家断线（广播） |
| `room:playerReady` | `{ roomId, players }` | 玩家准备状态变更（广播） |
| `room:gameStarting` | `{ roomId, gameState }` | 游戏即将开始 |

**断线通知 `reason` 值：**

| 值 | 说明 |
|----|------|
| `timeout` | 玩家操作超时 |
| `network_error` | 网络异常断线 |
| `client_closed` | 玩家主动关闭 |

#### 4.3.4 游戏状态同步

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `game:fullSync` | `{ state, version, timestamp }` | 全量状态同步 |
| `game:deltaSync` | `{ changes, version, timestamp }` | 增量状态同步 |
| `game:actionResult` | `{ success, error?, action?, newState? }` | 操作结果 |
| `game:error` | `{ message, code?, details? }` | 游戏错误 |

**增量同步 `changes` 格式：**

```json
{
  "changes": [
    {
      "path": "players.0.energy",
      "value": 5,
      "type": "set"
    },
    {
      "path": "logs",
      "value": { "message": "面壁者打出了探测卫星" },
      "type": "push"
    }
  ],
  "version": 42,
  "timestamp": 1712345678000
}
```

#### 4.3.5 游戏事件

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `game:turnStart` | `{ turnNumber, currentPlayerId, phase }` | 回合开始 |
| `game:turnEnd` | `{ turnNumber, nextPlayerId, phase }` | 回合结束 |
| `game:phaseChange` | `{ oldPhase, newPhase, turnNumber }` | 阶段变更 |
| `game:playerAction` | `{ playerId, action, result, turnNumber }` | 玩家执行操作（广播） |
| `game:broadcastRequest` | `{ broadcasterId, card, targetSystem, range, responses, timeout }` | 广播请求 |
| `game:strikeMoveRequest` | `{ strikeUid, currentSystem, validMoves, timeout }` | 打击移动请求 |
| `game:gameOver` | `{ winnerId, winnerType, rankings, totalTurns, duration }` | 游戏结束 |

**`game:broadcastRequest` 响应示例：**

```json
{
  "broadcasterId": "player_abc123",
  "card": {
    "uid": "card_789",
    "name": "宇宙广播",
    "type": "broadcast"
  },
  "targetSystem": 3,
  "range": 2,
  "responses": [
    {
      "playerId": "player_def456",
      "playerName": "执剑人",
      "canRespond": true,
      "mustRespond": false,
      "responded": false
    }
  ],
  "timeout": 30000
}
```

**`game:gameOver` 响应示例：**

```json
{
  "winnerId": "player_abc123",
  "winnerType": "human",
  "rankings": [
    {
      "playerId": "player_abc123",
      "displayName": "面壁者",
      "rank": 1,
      "eliminated": false
    },
    {
      "playerId": "player_def456",
      "displayName": "执剑人",
      "rank": 2,
      "eliminated": true,
      "eliminatedTurn": 8
    }
  ],
  "totalTurns": 12,
  "duration": 1800
}
```

---

## 5. 完整流程示例

### 5.1 完整游戏流程

```typescript
import { io } from 'socket.io-client';

class DarkForestClient {
  private socket = io('http://localhost:3003', {
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  private playerId: string | null = null;
  private currentRoom: string | null = null;

  // ============================
  // 1. 连接并登录
  // ============================

  async login(displayName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.socket.on('connect', () => {
        this.socket.emit('player:login', {
          userId: 'user_' + crypto.randomUUID(),
          displayName,
        });
      });

      this.socket.once('player:loginSuccess', (data) => {
        this.playerId = data.playerId;
        console.log(`✅ 登录成功: ${data.displayName}`);
        resolve(data.playerId);
      });

      this.socket.once('player:loginError', (data) => {
        reject(new Error(data.message));
      });
    });
  }

  // ============================
  // 2. 加入匹配队列
  // ============================

  joinQueue(playerCount: number, quickMatch = false): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit('match:joinQueue', { playerCount, quickMatch });

      this.socket.once('match:queueJoined', (data) => {
        console.log(`📋 已加入队列，位置: ${data.position}/${data.totalInQueue}`);
        resolve();
      });

      this.socket.once('match:queueError', (data) => {
        reject(new Error(data.message));
      });
    });
  }

  // ============================
  // 3. 监听匹配结果
  // ============================

  onMatchFound(callback: (data: any) => void): void {
    this.socket.on('match:found', (data) => {
      this.currentRoom = data.roomId;
      console.log(`🏠 匹配成功！房间码: ${data.roomCode}`);
      callback(data);
    });
  }

  // ============================
  // 4. 准备并开始游戏
  // ============================

  ready(roomId: string, ready = true): void {
    if (!this.currentRoom) {
      throw new Error('未加入房间');
    }
    this.socket.emit('room:ready', { roomId, ready });
  }

  onGameStart(callback: () => void): void {
    this.socket.on('room:gameStarting', () => {
      console.log('🚀 游戏即将开始！');
      callback();
    });
  }

  // ============================
  // 5. 游戏操作示例：出牌
  // ============================

  playCard(cardUid: string): void {
    this.socket.emit('game:action', {
      action: 'playCard',
      payload: { cardUid },
      requestId: 'req_' + crypto.randomUUID(),
    });
  }

  // ============================
  // 6. 监听状态同步
  // ============================

  onStateUpdate(callback: (state: any) => void): void {
    // 全量同步
    this.socket.on('game:fullSync', (data) => {
      console.log('📥 全量同步，版本:', data.version);
      callback(data.state);
    });

    // 增量同步
    this.socket.on('game:deltaSync', (data) => {
      console.log('📥 增量同步，版本:', data.version, '变化数:', data.changes.length);
      // 应用变化
      data.changes.forEach((change) => {
        this.applyChange(change);
      });
    });
  }

  private applyChange(change: { path: string; value: any; type: string }): void {
    // 实现状态应用逻辑
    console.log(`应用变化: ${change.path} = ${change.value}`);
  }

  // ============================
  // 7. 清理
  // ============================

  disconnect(): void {
    this.socket.disconnect();
  }
}

// 使用示例
const client = new DarkForestClient();

client.login('面壁者').then(() => {
  return client.joinQueue(4);
}).then(() => {
  client.onMatchFound((data) => {
    client.ready(true);
  });

  client.onGameStart(() => {
    console.log('游戏已开始');
  });

  client.onStateUpdate((state) => {
    console.log('状态更新:', state);
  });
});
```

### 5.2 React Hook 封装

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export function useDarkForest() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [player, setPlayer] = useState<any>(null);
  const [queueStatus, setQueueStatus] = useState<any>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io('http://localhost:3003', {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('player:loginSuccess', (data) => setPlayer(data));
    socket.on('player:loginError', (data) => setError(data.message));

    socket.on('match:queueJoined', (data) => setQueueStatus(data));
    socket.on('match:queueUpdate', (data) => setQueueStatus(prev => ({ ...prev, ...data })));
    socket.on('match:queueError', (data) => setError(data.message));

    socket.on('game:fullSync', (data) => setGameState(data.state));
    socket.on('game:deltaSync', (data) => {
      // 增量更新状态
      setGameState(prev => {
        const newState = { ...prev };
        data.changes.forEach(change => {
          const keys = change.path.split('.');
          let obj: any = newState;
          for (let i = 0; i < keys.length - 1; i++) {
            obj = obj[keys[i]];
          }
          obj[keys[keys.length - 1]] = change.value;
        });
        return newState;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const login = useCallback((userId: string, displayName: string) => {
    socketRef.current?.emit('player:login', { userId, displayName });
  }, []);

  const joinQueue = useCallback((playerCount: number, quickMatch = false) => {
    socketRef.current?.emit('match:joinQueue', { playerCount, quickMatch });
  }, []);

  const cancelQueue = useCallback(() => {
    socketRef.current?.emit('match:cancelQueue');
  }, []);

  const ready = useCallback((roomId: string, ready: boolean) => {
    socketRef.current?.emit('room:ready', { roomId, ready });
  }, []);

  const playCard = useCallback((cardUid: string) => {
    socketRef.current?.emit('game:action', {
      action: 'playCard',
      payload: { cardUid },
    });
  }, []);

  return {
    isConnected,
    player,
    queueStatus,
    gameState,
    error,
    login,
    joinQueue,
    cancelQueue,
    ready,
    playCard,
  };
}
```

---

## 6. 错误处理

### 6.1 连接层错误

```typescript
socket.on('connect_error', (error) => {
  switch (error.message) {
    case 'xhr poll error':
      console.error('网络请求失败，请检查网络连接');
      break;
    case 'timeout':
      console.error('连接超时，请检查服务器状态');
      break;
    default:
      console.error('连接错误:', error.message);
  }
});
```

### 6.2 业务层错误

```typescript
// 统一错误处理
socket.on('match:queueError', handleError);
socket.on('room:error', handleError);
socket.on('game:error', handleError);

function handleError(data: { message: string; code?: string }) {
  console.error(`❌ 错误 [${data.code || 'UNKNOWN'}]: ${data.message}`);

  // 根据错误码处理
  switch (data.code) {
    case 'NOT_LOGGED_IN':
      // 重新登录
      break;
    case 'GAME_NOT_STARTED':
      // 提示用户游戏尚未开始
      break;
    case 'INVALID_ACTION':
      // 提示用户操作无效
      break;
    default:
      // 显示通用错误提示
      showToast(data.message, 'error');
  }
}
```

### 6.3 操作超时处理

```typescript
// 游戏操作超时
socket.on('game:strikeMoveRequest', (data) => {
  const { strikeUid, validMoves, timeout } = data;

  // 设置倒计时
  const timer = setTimeout(() => {
    console.warn('打击移动超时');
    // 自动选择第一个合法位置
    socket.emit('game:action', {
      action: 'moveStrike',
      payload: { strikeUid, targetSystem: validMoves[0] },
    });
  }, timeout);

  // 用户操作后清除定时器
  function onMoveStrike(targetSystem: number) {
    clearTimeout(timer);
    socket.emit('game:action', {
      action: 'moveStrike',
      payload: { strikeUid, targetSystem },
    });
  }
});
```

---

## 7. 最佳实践

### 7.1 连接管理

```typescript
// ✅ 推荐：使用单例模式管理连接
class SocketManager {
  private static instance: SocketManager;
  private socket: Socket | null = null;

  static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }
    this.socket = io('http://localhost:3003', {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    return this.socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
```

### 7.2 消息防抖

```typescript
// ✅ 推荐：避免频繁发送操作
import { debounce } from 'lodash';

const emitAction = debounce((action: string, payload: any) => {
  socket.emit('game:action', { action, payload });
}, 200);

// 使用
emitAction('playCard', { cardUid: 'card_123' });
emitAction('playCard', { cardUid: 'card_456' });  // 将被节流
```

### 7.3 状态同步确认

```typescript
// ✅ 推荐：确认接收到状态更新
socket.on('game:deltaSync', (data) => {
  // 应用状态变化
  applyChanges(data.changes);

  // 发送确认
  socket.emit('game:ackState', { version: data.version });
});
```

### 7.4 请求幂等性

```typescript
// ✅ 推荐：为关键操作生成唯一请求 ID
const pendingRequests = new Map<string, Promise<any>>();

function sendAction(action: string, payload: any): Promise<any> {
  const requestId = 'req_' + crypto.randomUUID();

  return new Promise((resolve, reject) => {
    socket.emit('game:action', { action, payload, requestId });

    const handler = (result: any) => {
      if (result.action === action) {
        socket.off('game:actionResult', handler);
        pendingRequests.delete(requestId);
        resolve(result);
      }
    };

    socket.on('game:actionResult', handler);
    pendingRequests.set(requestId, handler);
  });
}
```

### 7.5 网络状况监测

```typescript
// ✅ 推荐：监测连接质量
socket.on('ping', (latency: number) => {
  if (latency > 500) {
    console.warn(`⚠️ 网络延迟较高: ${latency}ms`);
  }
});

socket.on('disconnect', (reason) => {
  if (reason === 'ping timeout') {
    console.error('❌ 连接超时，可能是网络不稳定');
  }
});
```

---

## 8. API 参考

### 8.1 REST API 端点（配合使用）

| 方法 | 路径 | 说明 | 文档 |
|------|------|------|------|
| `POST` | `/api/auth/register` | 玩家注册 | [API README](./API-README.md) |
| `POST` | `/api/auth/login` | 玩家登录（JWT） | [API README](./API-README.md) |
| `POST` | `/api/player/login` | 快速登录 | [API README](./API-README.md) |
| `POST` | `/api/match/queue/join` | 加入匹配（REST） | [API README](./API-README.md) |
| `GET` | `/api/match/queue/status` | 查询匹配状态 | [API README](./API-README.md) |
| `GET` | `/api/match/room/{code}` | 获取房间信息 | [API README](./API-README.md) |

### 8.2 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WEBSOCKET_PORT` | WebSocket 服务器端口 | `3003` |
| `NEXT_PUBLIC_WEBSOCKET_PORT` | 前端使用的 WebSocket 端口 | `3003` |
| `JWT_SECRET` | JWT 签名密钥 | - |

---

## 9. 调试技巧

### 9.1 启用 Socket.IO 调试日志

```javascript
// 浏览器控制台
localStorage.debug = 'socket.io-client:*';
// 或更详细
localStorage.debug = 'socket.io-client:socket,socket.io-client:manager';
```

### 9.2 服务器端日志

```bash
# 启动 WebSocket 服务器时查看日志
bun run src/server/gameServer.ts

# 或 Docker 环境
docker compose logs -f app | grep -i websocket
```

### 9.3 网络抓包

```bash
# 使用 Chrome DevTools
# 1. 打开 DevTools (F12)
# 2. 切换到 Network 标签
# 3. 筛选 WS (WebSocket)
# 4. 查看消息帧
```

### 9.4 测试客户端

```typescript
// 使用 socket.io-client 快速测试
import { io } from 'socket.io-client';

const s = io('http://localhost:3003');

s.on('connect', () => {
  console.log('✅ 已连接');
  s.emit('player:login', { userId: 'test_user', displayName: '测试玩家' });
});

s.on('player:loginSuccess', (data) => {
  console.log('✅ 登录成功', data);
  s.emit('match:joinQueue', { playerCount: 3 });
});

s.on('match:found', (data) => {
  console.log('✅ 匹配成功', data);
});

// 监听所有服务器消息
s.onAny((eventName, ...args) => {
  console.log(`📨 收到事件: ${eventName}`, args);
});

// 监听所有客户端发送的消息
s.onAnyOutgoing((eventName, ...args) => {
  console.log(`📤 发送事件: ${eventName}`, args);
});
```

---

## 10. 常见问题

### Q: 连接失败怎么办？

**排查步骤：**
1. 确认 WebSocket 服务器已启动（`bun run src/server/gameServer.ts`）
2. 检查端口 `3003` 是否被占用
3. 检查防火墙设置是否放行 WebSocket 连接
4. 浏览器控制台查看具体错误信息

### Q: 如何区分开发环境和生产环境？

```typescript
const WS_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3003'
  : '/';  // 生产环境使用同源（Nginx 反向代理）
```

### Q: 断线重连后如何恢复游戏状态？

```typescript
socket.on('reconnect', () => {
  // 重新加入房间
  if (socket.data.roomCode) {
    socket.emit('room:join', { roomCode: socket.data.roomCode });
  }
  // 请求全量同步
  socket.emit('game:requestSync');
});
```

### Q: 移动端如何处理网络切换？

Socket.IO 自动处理网络切换，但建议：

```typescript
// 监测网络状态
window.addEventListener('online', () => {
  if (!socket.connected) {
    socket.connect();
  }
});

window.addEventListener('offline', () => {
  console.log('📱 网络断开');
});
```

### Q: 如何处理多人同时操作的竞态条件？

**服务器权威原则：**
- 客户端只负责 **请求** 操作
- 服务器验证并执行操作
- 服务器通过 `game:deltaSync` 推送结果
- 客户端根据服务器推送的状态更新 UI

```typescript
// ❌ 错误：客户端直接修改状态
function playCard() {
  gameState.energy -= 2;  // 不要这样做
}

// ✅ 正确：等待服务器确认
function playCard() {
  socket.emit('game:action', { action: 'playCard', payload: { cardUid } });
  // 等待 game:deltaSync 或 game:actionResult 更新状态
}
```

---

## 附录

### A. 协议版本

当前协议版本：`1.0.0`

### B. 相关文档

- [REST API 文档](./API-README.md)
- [在线模式说明](./ONLINE-MODE.md)
- [测试指南](./TESTING.md)
- [Docker 部署](./DOCKER-README.md)

### C. 示例代码

- [前端连接管理器](./src/lib/websocket.ts)
- [状态管理 Store](./src/store/onlineStore.ts)
- [服务器事件处理](./src/server/EventHandlers.ts)
- [协议定义](./src/server/protocol.ts)

---

*最后更新：2026-04-05*
