# 广播博弈完整流程实施报告

## 概述

我们已成功实现完整的广播博弈流程管理系统，包括发布、回应收集、选择回应者和结算四个阶段，并集成了超时处理和 AI 自动化。

## 核心架构

### BroadcastFlowManager 类

新创建的 `BroadcastFlowManager` 类管理整个广播博弈流程，提供：

- ✅ 广播发布验证和处理
- ✅ 回应收集（多玩家）
- ✅ AI 自动回应
- ✅ 选择回应者
- ✅ 广播结算
- ✅ 超时处理
- ✅ 事件广播

## 广播博弈流程

### 完整流程图

```
玩家发布广播
  │
  ├─ 1. 发布阶段 (initiate)
  │   ├─ 验证卡牌合法性
  │   ├─ 消耗能量
  │   ├─ 确定可回应玩家
  │   │   ├─ 距离范围内
  │   │   ├─ 有广播牌
  │   │   └─ 有能量
  │   └─ 检查监听基地
  │
  ├─ 2. 回应收集阶段 (waiting)
  │   ├─ 广播等待回应
  │   ├─ AI 自动回应 (50% 概率)
  │   ├─ 人类玩家手动回应
  │   │   ├─ 同意回应 → 选择广播牌
  │   │   └─ 拒绝回应
  │   └─ 超时处理 (30秒)
  │       └─ 未回应视为拒绝
  │
  ├─ 3. 检查回应结果
  │   ├─ 无人同意 → 取消广播
  │   │   └─ 发布者 +1 能量
  │   └─ 有人同意 → 选择阶段
  │
  ├─ 4. 选择回应者阶段 (select)
  │   ├─ 多个人回应 → 发布者选择
  │   ├─ 一个人回应 + AI 发布者 → 自动选择
  │   └─ 超时处理 (20秒)
  │       └─ 自动选择第一个
  │
  ├─ 5. 揭示阶段 (reveal)
  │   ├─ 展示双方卡牌
  │   └─ 等待 5 秒
  │
  └─ 6. 结算阶段 (resolve)
      ├─ 根据博弈矩阵计算能量
      │   │
      │   ├─ cooperation vs cooperation → 各 +3
      │   ├─ disguise vs cooperation → 发布者 +5
      │   ├─ cooperation vs disguise → 回应者 +5
      │   └─ disguise vs disguise → 无人获得
      │
      ├─ 回应者补 1 张牌
      ├─ 广播牌放在发布者面前
      └─ 清理广播状态
```

## 实施细节

### 1. BroadcastFlowManager 类

#### 主要方法

```typescript
class BroadcastFlowManager {
  // 广播发布
  handleBroadcastInitiation(state, broadcasterId, cardUid, targetSystem): BroadcastActionResult
  
  // 回应处理
  handleBroadcastResponse(state, playerId, agreed, cardUid?): BroadcastActionResult
  private processAIResponses(state): void
  private handleNoResponses(state): BroadcastActionResult
  
  // 回应结果处理
  private processResponses(state): BroadcastActionResult
  
  // 选择回应者
  handleSelectResponder(state, broadcasterId, responderId): BroadcastActionResult
  
  // 结算
  private executeBroadcastResolution(state): BroadcastActionResult
  
  // 超时处理
  private startResponseTimeout(state): void
  private startSelectTimeout(state): void
  private handleResponseTimeout(state): void
  private handleSelectTimeout(state): void
  
  // 工具方法
  cancelBroadcastFlow(state): void
  destroy(): void
}
```

#### 关键特性

**1. AI 自动化回应**
```typescript
// AI 玩家简单策略：50% 概率同意回应
// 自动选择有能量的广播牌
```

**2. 超时保护**
- 回应超时：30 秒
- 选择超时：20 秒
- 揭示时间：5 秒
- 超时后自动执行默认操作

**3. 事件广播**
- broadcastRequest - 广播开始
- broadcastResponse - 玩家回应
- broadcastSelectResponder - 需要选择回应者
- broadcastResponderSelected - 回应者被选中
- broadcastReveal - 揭示阶段
- broadcastResolved - 结算完成
- broadcastEnd - 广播结束（无人回应）
- broadcastCancelled - 广播取消

### 2. 与 AuthoritativeGameEngine 集成

#### 修改内容

**之前**:
```typescript
// 直接调用底层函数
initiateBroadcast(this.state, playerId, cardUid, targetSystem);
respondToBroadcast(this.state, playerId, agreed, cardUid);
selectBroadcastResponder(this.state, responderId);
```

**现在**:
```typescript
// 通过流程管理器处理
this.broadcastFlowManager.handleBroadcastInitiation(this.state, playerId, cardUid, targetSystem);
this.broadcastFlowManager.handleBroadcastResponse(this.state, playerId, agreed, cardUid);
this.broadcastFlowManager.handleSelectResponder(this.state, playerId, responderId);
```

#### 优势

1. **验证完整** - 所有操作都经过严格验证
2. **错误处理** - 返回详细的错误信息
3. **事件广播** - 自动广播所有状态变化
4. **超时保护** - 防止玩家卡住流程
5. **AI 自动化** - AI 玩家自动回应

## 数据流

### 广播博弈完整数据流

```
1. 玩家 A 出广播牌
   └─> 发送: game:action { action: 'playCard', payload: { cardUid, targetSystem } }
   
2. 服务器验证并发起广播
   ├─> 验证卡牌
   ├─> 计算可回应玩家
   ├─> 创建 BroadcastState
   └─> 广播: game:broadcastRequest { responses, timeout }
   
3. 玩家 B、C、D 收到广播请求
   └─> 显示广播响应 UI
   
4. 玩家 B 回应（同意）
   └─> 发送: game:action { action: 'respondBroadcast', payload: { agreed: true, cardUid } }
   
5. 服务器验证回应
   ├─> 验证卡牌
   ├─> 记录回应
   └─> 广播: game:broadcastResponse { playerId, agreed }
   
6. AI 玩家 C 自动回应
   └─> 50% 概率决定
   
7. 玩家 D 回应（拒绝）
   └─> 发送: game:action { action: 'respondBroadcast', payload: { agreed: false } }
   
8. 所有玩家回应完毕
   └─> 服务器检查 allResponded
   
9. 进入选择阶段
   └─> 广播: game:broadcastSelectResponder { responders }
   
10. 玩家 A 选择回应者
    └─> 发送: game:action { action: 'selectResponder', payload: { responderId } }
    
11. 服务器验证并选择
    ├─> 验证选择
    ├─> 记录选择
    └─> 广播: game:broadcastResponderSelected { responderId }
    
12. 揭示阶段（5 秒）
    └─> 广播: game:broadcastReveal { cards }
    
13. 结算
    ├─> 计算博弈结果
    ├─> 分配能量
    ├─> 回应者补牌
    └─> 广播: game:broadcastResolved { result }
    
14. 清理广播状态
    └─> 继续游戏
```

## 超时配置

```typescript
const DEFAULT_BROADCAST_CONFIG: BroadcastConfig = {
  responseTimeout: 30000,      // 30 秒回应时间
  selectTimeout: 20000,        // 20 秒选择时间
  revealTimeout: 5000,         // 5 秒揭示时间
};
```

## 博弈矩阵

| 发布者 \ 回应者 | cooperation | disguise |
|----------------|-------------|----------|
| **cooperation** | 各 +3 | 回应者 +5 |
| **disguise** | 发布者 +5 | 无人获得 |

## 事件列表

### 广播事件

| 事件 | 时机 | 数据 |
|------|------|------|
| `game:broadcastRequest` | 广播开始 | broadcasterId, card, targetSystem, responses, timeout |
| `game:broadcastResponse` | 玩家回应 | playerId, agreed, responses |
| `game:broadcastSelectResponder` | 需要选择 | broadcasterId, responders, timeout |
| `game:broadcastResponderSelected` | 选择完成 | broadcasterId, responderId |
| `game:broadcastReveal` | 揭示阶段 | broadcasterCard, responderCard, timeout |
| `game:broadcastResolved` | 结算完成 | 双方信息，能量变化 |
| `game:broadcastEnd` | 无人回应 | reason, broadcasterEnergy |
| `game:broadcastCancelled` | 广播取消 | - |

## 关键改进

### 相比旧实现的改进

| 特性 | 旧实现 | 新实现 |
|------|--------|--------|
| 流程管理 | ❌ 分散 | ✅ 集中管理 |
| 超时处理 | ❌ 无 | ✅ 完整超时保护 |
| 事件广播 | ❌ 手动 | ✅ 自动广播 |
| AI 回应 | 部分实现 | ✅ 完整自动化 |
| 错误处理 | ❌ 简单 | ✅ 详细错误信息 |
| 验证逻辑 | ❌ 不完整 | ✅ 完整验证 |
| 多玩家回应 | ❌ 不支持 | ✅ 完整支持 |

## 文件清单

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/server/BroadcastFlowManager.ts` | 553 | 广播博弈流程管理器 |
| `src/server/AuthoritativeGameEngine.ts` | 494 | 权威引擎（已更新） |

## 测试状态

### 构建状态
✅ **编译成功** - 无 TypeScript 错误

### 待测试
- [ ] 广播发布流程测试
- [ ] 多玩家回应测试
- [ ] AI 自动回应测试
- [ ] 选择回应者测试
- [ ] 广播结算测试
- [ ] 超时处理测试

## 下一步工作

1. **测试**
   - [ ] 编写广播博弈集成测试
   - [ ] 测试超时处理
   - [ ] 测试 AI 自动化

2. **优化**
   - [ ] 可配置的超时时间
   - [ ] AI 策略优化
   - [ ] 事件去重

3. **完善**
   - [ ] 打击到达结算
   - [ ] 游戏日志优化
   - [ ] 性能监控

---

**实施日期**: 2026-04-04  
**状态**: ✅ 广播博弈完整流程实现完成
