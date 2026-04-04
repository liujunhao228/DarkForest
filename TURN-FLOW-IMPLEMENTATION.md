# 完整回合流程实施报告

## 概述

我们已成功实现完整的回合流程系统，包括回合状态机、阶段转换、超时处理和玩家操作管理。

## 核心架构

### 回合状态机 (`TurnStateMachine.ts`)

新创建的 `TurnStateMachine` 类管理整个回合流程，提供：

- ✅ 阶段自动转换
- ✅ 超时处理
- ✅ AI 自动操作
- ✅ 玩家操作等待
- ✅ 事件广播
- ✅ 游戏结束检测

## 回合流程

### 完整回合流程图

```
startNewTurn()
  │
  ├─ 1. 回合开始 (settlement)
  │   ├─ 获得基础能量 (+1)
  │   ├─ 设施能量产出 (settlementPhase)
  │   └─ 检查飞行打击
  │       ├─ 有打击 → strikeMovement 阶段
  │       └─ 无打击 → draw 阶段
  │
  ├─ 2. 打击移动 (strikeMovement) [可选]
  │   ├─ AI → 自动移动所有打击 → draw 阶段
  │   └─ 玩家 → 等待操作
  │       ├─ 移动打击 → 还有打击？ → 继续等待
  │       └─ 移动打击 → 无打击 → draw 阶段
  │
  ├─ 3. 摸牌阶段 (draw)
  │   ├─ 计算需要摸的牌数 (4 - 当前手牌)
  │   ├─ 从牌堆摸牌
  │   └─ 1秒后 → action 阶段
  │
  ├─ 4. 行动阶段 (action)
  │   ├─ AI → 自动行动 (aiAction) → 1.5秒后 → endTurn
  │   └─ 玩家 → 等待操作请求
  │       ├─ playCard → 出牌
  │       ├─ moveStrike → 移动打击
  │       ├─ respondBroadcast → 回应广播
  │       ├─ recycleCard → 回收卡牌
  │       ├─ useLightspeedShip → 光速飞船
  │       └─ endTurn → 结束回合
  │
  └─ 5. 结束回合 (endTurn)
      ├─ 处理弃牌 (可选)
      └─ advanceToNextPlayer()
          ├─ 检查游戏结束 (存活玩家 ≤ 1)
          │   ├─ 1 人存活 → 该玩家获胜
          │   └─ 0 人存活 → 平局 (永恒黑暗)
          └─ 下一个玩家
              └─ startNewTurn() [循环]
```

### 阶段超时配置

| 阶段 | 超时时间 | 说明 |
|------|---------|------|
| settlement | 5 秒 | 展示阶段 |
| draw | 5 秒 (展示 3 秒) | 摸牌展示 |
| action | 60 秒 | 玩家操作时间 |
| strikeMovement | 30 秒 | 每个打击移动 |

### 超时处理

| 阶段 | 超时动作 |
|------|---------|
| strikeMovement | 自动选择最接近目标的移动 |
| action | 自动结束回合 |
| 其他 | 继续到下一阶段 |

## 实现细节

### 1. TurnStateMachine 类

#### 主要方法

```typescript
class TurnStateMachine {
  // 回合流程
  startNewTurn(state: GameState): void
  private executeTurnStart(state: GameState): void
  private startStrikeMovement(state, strikes): void
  private startDrawPhase(state: GameState): void
  private startActionPhase(state: GameState): void
  endTurn(state: GameState, discardCardUids?: string[]): void
  advanceToNextPlayer(state: GameState): void
  
  // 玩家操作处理
  handleStrikeMove(state, strikeUid, targetSystem): { success, error }
  
  // AI 自动化
  private executeAIMoveStrikes(state, strikes): void
  private executeAIAction(state, player): void
  
  // 超时处理
  private startPhaseTimeout(state, customTimeout?): void
  private handlePhaseTimeout(state: GameState): void
  
  // 游戏结束
  private handleGameOver(state: GameState): void
  
  // 工具方法
  resetPhaseTimer(state: GameState): void
  getPhaseElapsedTime(): number
  getPhaseRemaining(state: GameState): number
  destroy(): void
}
```

#### 关键特性

**1. 阶段自动转换**
```typescript
// 打击移动 → 摸牌 → 行动 → 结束回合
// 每个阶段完成后自动进入下一阶段
```

**2. AI 自动化**
```typescript
// AI 玩家的打击移动和行动都自动执行
// 添加延迟让玩家能看到 AI 操作
```

**3. 事件广播**
```typescript
// 每个阶段变化都广播给客户端
// turnStart, turnEnd, phaseChange, strikeMoveRequest, gameOver
```

**4. 超时保护**
```typescript
// 每个阶段都有超时计时器
// 超时后自动执行默认操作
```

### 2. 与 AuthoritativeGameEngine 集成

#### 修改内容

**之前**:
```typescript
// 直接调用引擎函数
startTurn(this.state);
endTurn(this.state, discardCards);
moveStrike(this.state, strikeUid, targetSystem);
```

**现在**:
```typescript
// 通过状态机管理
this.turnStateMachine.startNewTurn(this.state);
this.turnStateMachine.endTurn(this.state, discardCards);
this.turnStateMachine.handleStrikeMove(this.state, strikeUid, targetSystem);
```

#### 优势

1. **集中管理** - 所有回合逻辑在一个地方
2. **自动转换** - 阶段自动流转，无需手动控制
3. **超时保护** - 防止玩家卡住游戏
4. **事件通知** - 自动广播状态变化
5. **易于测试** - 状态机可以独立测试

## 数据流

### 玩家回合流程

```
1. 服务器: startNewTurn()
   └─> 广播: game:turnStart { phase: 'settlement' }
   
2. 服务器: settlement (自动)
   ├─ 基础能量 +1
   └─ 设施能量产出
   
3. 服务器: 检查打击
   ├─ 有打击 → strikeMovement
   │   └─> 广播: game:strikeMoveRequest { strikeUid, validMoves }
   └─ 无打击 → draw
   
4. 服务器: draw (自动)
   ├─ 摸牌至 4 张
   └─> 广播: game:phaseChange { newPhase: 'draw' }
   
5. 服务器: action (等待玩家)
   └─> 广播: game:phaseChange { newPhase: 'action' }
   └─> 广播: game:turnStart { phase: 'action' }
   
6. 客户端: 玩家操作
   └─> 发送: game:action { action: 'playCard', payload }
   
7. 服务器: 验证并执行
   ├─ GameValidator 验证
   ├─ 执行操作
   └─ StateSyncManager 同步状态
   
8. 客户端: 玩家结束回合
   └─> 发送: game:action { action: 'endTurn' }
   
9. 服务器: endTurn()
   ├─ advanceToNextPlayer()
   └─> 广播: game:turnEnd
   
10. 服务器: 下一个玩家
    └─> startNewTurn() [循环]
```

### AI 回合流程

```
1. startNewTurn() → settlement → strikeMovement
2. AI 自动移动打击 (executeAIMoveStrikes)
3. draw → action
4. AI 自动行动 (executeAIAction)
5. 1.5 秒后自动 endTurn()
6. advanceToNextPlayer() → 下一个玩家
```

## 事件列表

### 广播事件

| 事件 | 时机 | 数据 |
|------|------|------|
| `game:turnStart` | 回合开始 | turnNumber, currentPlayerId, playerName, phase |
| `game:turnEnd` | 回合结束 | turnNumber, endedPlayerId, endedPlayerName |
| `game:phaseChange` | 阶段变化 | oldPhase, newPhase, turnNumber |
| `game:strikeMoveRequest` | 需要移动打击 | strikeUid, currentSystem, validMoves, timeout |
| `game:gameOver` | 游戏结束 | winnerId, winnerName, totalTurns, reason |

## 超时配置

```typescript
const DEFAULT_TURN_CONFIG: TurnConfig = {
  phaseTimeout: {
    settlement: 5000,        // 5 秒
    draw: 5000,              // 5 秒
    action: 60000,           // 60 秒
    strikeMovement: 30000,   // 30 秒
  },
  cardsToDraw: 4,           // 摸 4 张
  maxHandSize: 10,          // 最多 10 张
};
```

## 关键改进

### 相比旧实现的改进

| 特性 | 旧实现 | 新实现 |
|------|--------|--------|
| 阶段管理 | 分散在多个文件 | 集中在 TurnStateMachine |
| 超时处理 | ❌ 无 | ✅ 完整超时保护 |
| 事件广播 | ❌ 手动 | ✅ 自动广播 |
| AI 操作 | 直接调用 | 状态机管理 + 延迟 |
| 游戏结束 | 简单检测 | 完整结算 + 广播 |
| 阶段转换 | 手动调用 | 自动转换 |
| 错误处理 | ❌ 无 | ✅ 返回错误信息 |

### 代码质量

- ✅ TypeScript 类型安全
- ✅ 清晰的注释和文档
- ✅ 统一的错误处理
- ✅ 可配置的超时时间
- ✅ 易于测试的接口

## 测试状态

### 构建状态
✅ **编译成功** - 无 TypeScript 错误

### 待测试
- [ ] 完整回合流程测试
- [ ] 超时处理测试
- [ ] AI 自动化测试
- [ ] 游戏结束检测测试
- [ ] 事件广播测试

## 文件清单

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/server/TurnStateMachine.ts` | 559 | 回合状态机 |
| `src/server/AuthoritativeGameEngine.ts` | 456 | 权威引擎（已更新） |

## 下一步工作

1. **测试**
   - [ ] 编写回合流程集成测试
   - [ ] 测试超时处理
   - [ ] 测试 AI 自动化

2. **优化**
   - [ ] 可配置的超时时间
   - [ ] 阶段动画支持
   - [ ] 阶段暂停/恢复

3. **完善**
   - [ ] 广播博弈完整集成
   - [ ] 打击到达结算
   - [ ] 日志记录优化

---

**实施日期**: 2026-04-04  
**状态**: ✅ 完整回合流程实现完成
