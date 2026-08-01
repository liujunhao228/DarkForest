---
design_type: feature
created_at: 2026-07-31
---

# DeltaSync — 增量状态同步

## Intent Contract

```yaml
intent: 在线对局每次玩家动作后，仅广播 per-viewer 的状态增量（变化的字段路径），而非整个 ViewState
constraints:
  - 黑暗森林 per-viewer 脱敏必须保持（对手位置 -1、对手手牌隐藏、广播卡牌按揭示阶段门控）
  - 不破坏现有 game:fullSync 协议（初始同步、重连、fallback 仍走 fullSync）
  - 前端已锁定的 delta 格式 {path, value, type} 不变
  - 前端 sync.ts 中已有的 isViewPathAllowed 路径白名单作为纵深防御保留
success_criteria:
  - 非 fullSync 路径下，单次动作的 WS 下行字节数 < fullSync 的 30%（典型场景）
  - 所有现有 backend test 与 frontend test 通过，新增 delta 专项测试覆盖脱敏边界
  - pnpm lint / pnpm tsc -b / pnpm test --run / pnpm build / go test ./... 全绿
risk_level: medium
```

`risk_level: medium` 理由：网络协议变更、影响每次玩家动作的热路径；但不涉及认证、计费、隐私数据明文，故不到 high。

## Verification Contract

```yaml
verify_steps:
  - run tests: cd backend && go test ./internal/game/... ./internal/rooms/... ./test/...
    check: DiffViewStates 纯函数单测覆盖（标量/数组/嵌套/nil 指针/Logs 增量）
    confirm: 全部 PASS
  - run tests: cd backend && go test ./test/... -run WS_DeltaSync
    check: WS 端到端集成测试，两玩家收到不同 delta（位置变化对自身可见、对对手仍为 -1）
    confirm: PASS 且 delta payload 不含对手 position 真值
  - run tests: cd frontend && pnpm test --run
    check: sync.ts 的 handleDeltaSync 应用 + isViewPathAllowed 过滤单测
    confirm: PASS
  - run checks: cd frontend && pnpm lint && pnpm tsc -b && pnpm build
    check: 类型与构建
    confirm: 0 error
  - manual: 启动后端 + 前端，两人对局触发 moveStrike / respondBroadcast / endTurn
    check: 浏览器 DevTools Network WS 帧出现 game:deltaSync，且帧大小显著小于 game:fullSync
    confirm:肉眼确认对手位置始终为 -1，UI 无状态漂移
```

## Governance Contract

```yaml
approval_gates:
  - 本设计文档审批通过后才进入 writing-plans
  - 实现完成后必须经 requesting-code-review 子审（hotl:code-review）
  - 任何对 filterBroadcastForView 的等价改写需人工 review（不可由 diff 函数隐式绕过脱敏）
rollback:
  - Room.broadcastGameState 中保留 fullSync 路径为唯一 fallback
  - 若发现 delta 路径产生状态漂移，删除 lastSentViews 缓存 + 注释掉 delta 分支即可恢复
  - 前端 eventListeners.ts 中 game:deltaSync listener 一行删除即可禁用 delta 应用
ownership: backend owner 负责 view_state_diff.go + room.go 改造；frontend owner 负责 eventListeners + sync.ts 激活
```

## Scope

| 类别 | 内容 |
|---|---|
| **In** | 新增 `game:view_state_diff.go` 纯函数；`Room` 新增 per-player ViewState 缓存与 ack 版本表；`broadcastGameState` 在 cache 命中时改发 `game:deltaSync`；`HandleGameAction` 末尾递增 `state.Version`；`hub` 新增 `EvtSrvGameDeltaSync`；前端注册 `game:deltaSync` listener；前端 `sync.ts` 激活（删除"死代码"TODO）；新增 Go 单测 + 前端单测 + WS 集成测试 |
| **Out** | 不动 mcpserver 的 semantic/state_delta.go（无关概念）；不动回放录制（仍记录全量 GameState）；不动 game:requestSync 协议（仍返回 fullSync）；不做 RFC 6902 JSON Patch 迁移；不计算服务端 stateHash（drift 仅靠 version 检测）；不做 per-player 独立版本号 |
| **Out (后续阶段)** | stateHash 计算与 DEV 模式漂移双重校验；delta payload 压缩（gzip）；delta 与 fullSync 切换的运行时开关 / feature flag |

## Decisions

| # | 决策点 | 选择 | 拒绝的替代 |
|---|---|---|---|
| D1 | per-viewer 脱敏如何实现 | **Per-viewer diff**：后端为每玩家缓存上次 ViewState，与本次 ViewState 做 deep diff | (a) 单 canonical diff + 前端过滤：信任前端防线，泄露风险高；(b) Hybrid 单 diff + 后端值脱敏：实现复杂度最高 |
| D2 | 何时发 delta vs full | **Always delta**：每个 HandleGameAction 后发 delta；仅在初始 RequestSync / cache miss / version 不匹配 / fallback / GameOver 时发 fullSync | (a) 部分 delta：收益小；(b) 阈值自适应：阈值难调 |
| D3 | 版本号策略 | **后端全局权威版本**：GameState.Version 单一计数器，HandleGameAction 末尾递增；客户端 ackState 回传；下次广播前若 `lastAck != current - 1` 降级 fullSync | (a) per-player 版本：复杂度高；(b) 仅 stateHash：CPU 成本高且非确定性 |
| D4 | 缓存承载者 | **Room struct 内置** `lastSentViews map[string]*ViewState` + `lastAckVersion map[string]int` | (a) 抽出 ViewSyncManager：多一层抽象，与现有持锁模型割裂；(b) 不缓存：CPU 翻倍 |
| D5 | diff 算法 | **递归 deep equality walk**，对 ViewState 字段做反射式遍历，产出 `[]Change{path, value, type}`；`type ∈ {"set","delete"}`；nil 指针与零值空数组按"删除"语义处理 | RFC 6902 JSON Patch：前端格式已锁定，迁移成本高 |
| D6 | Logs 增量 | Logs 视为 append-only，diff 只产出 `logs[N]` `logs[N+1]`… 新增项，**不**重发整个数组 | 重发整个 Logs：违背 delta 初衷 |
| D7 | 协议事件名 | `game:deltaSync`；payload `{changes: Change[], version: int, timestamp: int64}` | 复用 game:fullSync 加 `isDelta` 字段：事件语义混淆 |
| D8 | cache 生命周期 | `StartGame` 时清空；`triggerFallback` 触发后清空（确保下个 fullSync 是干净的）；玩家断连不清空（重连后 version mismatch 自动降级 fullSync） | 断连清空：增加状态机复杂度 |
| D9 | diff 函数位置 | `backend/internal/game/view_state_diff.go`（纯函数，无 rooms 依赖，便于单测） | 放在 rooms 包：破坏分层 |
| D10 | 前端 isViewPathAllowed 命运 | 保留作为纵深防御（defense-in-depth），但补注释说明"主防线是后端 per-viewer diff" | 删除：失去二重校验 |

## Surface

### 后端

新增文件 `backend/internal/game/view_state_diff.go`：暴露 `DiffViewStates(prev, next *ViewState) []Change`，签名输入输出均为 `game` 包内类型，零依赖 `rooms`/`hub`。配套 `view_state_diff_test.go` 覆盖：标量变更、数组元素顺序敏感字段（Players / FlyingStrikes / Logs）、nil 指针字段（Broadcast / PendingAction / Winner）、Logs append-only 行为、空 diff 返回 nil。

修改 `backend/internal/game/types.go`：无字段变更；仅约定 `*Version` 由 `rooms.Room` 在动作 dispatch 成功后递增（不放在 game 包，避免引擎被 rooms 化）。

修改 `backend/internal/rooms/room.go`：`Room` struct 新增 `lastSentViews map[string]*ViewState` 与 `lastAckVersion map[string]int` 字段；`NewRoom` 初始化；`broadcastGameState` 内每个 connected player 先查 cache，命中且 `lastAckVersion[p.ID] == *state.Version - 1` 时走 delta 路径，否则走 fullSync 并刷新 cache；`HandleGameAction` 成功分支末尾递增 `*state.Version`（若为 nil 先取地址初始化为 1）；新增 `HandleAckState(playerID string, version int)` 方法更新 `lastAckVersion`。

修改 `backend/internal/rooms/manager.go`：`HandleAction` 已路由至 `room.HandleGameAction`，无需新增路由；新增 `HandleAckState(playerID, version)` 转发到对应 room。

修改 `backend/internal/hub/hub.go`：在事件 dispatch 表中新增 `EvtGameAckState` 分支，调用 `RoomManager.HandleAckState`。

修改 `backend/internal/hub/protocol.go`：新增 `EvtSrvGameDeltaSync ServerEvent = "game:deltaSync"` 常量；`EvtGameAckState` 常量已存在。

新增 `backend/test/ws_smoke_test.go` 扩展：WS_DeltaSync 用例，模拟两玩家连接 → 玩家 A 触发 moveStrike → 验证 A 收到含 `players[0].position` 的 delta，B 收到的 delta 不含 A 的真实位置。

### 前端

修改 `frontend/src/ws/protocol.ts`：`ServerEvent` 联合类型新增 `'game:deltaSync'`；新增 `DeltaSyncPayload` interface `= { changes: Array<{path: string; value: unknown; type: string}>; version: number; timestamp: number }`。

修改 `frontend/src/ws/client.ts`：`handleMessage` 中将 `'game:deltaSync'` 加入与 `'game:fullSync'` 同级的批处理队列（P1-1 优化保持）。

修改 `frontend/src/store/onlineGameStore/eventListeners.ts`：新增 `onGameDeltaSync` listener，解析 payload 调用 `get().handleDeltaSync(changes, version)`；注册与注销。

修改 `frontend/src/store/onlineGameStore/sync.ts`：删除 `applyChanges` 内"当前 deltaSync 为死代码"注释；保留 `isViewPathAllowed` 但补注释说明主防线在后端。`handleDeltaSync` 在 version 不连续时（`version !== gameVersion + 1`）主动 `requestSync()` 触发 fullSync 兜底。

修改 `frontend/src/store/onlineGameStore/__tests__/sync.test.ts`：新增 `handleDeltaSync` 应用测试（含 isViewPathAllowed 路径过滤边界）。

## Risks & Open Questions

| # | 风险 / 问题 | 缓解 / 决策 |
|---|---|---|
| R1 | 内存成本：每玩家 ~50KB ViewState × 4 = ~200KB 常驻 | 可接受；未来若玩家数显著增加可改为 LRU + TTL 淘汰 |
| R2 | diff 算法正确性：数组顺序敏感字段（Players/FlyingStrikes）若 reorder 会产生大量 noise change | DiffViewStates 对数组按"索引对齐"语义比较（不尝试匹配 reorder），符合 ViewState 当前不变式：数组索引即玩家编号 |
| R3 | version 不连续触发 fullSync 的频率：客户端 ack 异步、网络抖动 | 默认策略宽容：`lastAck == current - 1 OR lastAck == current`（允许客户端尚未 ack 当前版本）才发 delta，否则 fullSync |
| R4 | reconnect 时 lastSentViews 仍指向断连前状态，可能产生错误 delta | 由 version mismatch 自动降级 fullSync 兜底；cache 不主动清理（D8） |
| R5 | Logs 无界增长导致 diff 成本线性上升 | D6 已限定 Logs append-only 语义，diff 仅产出新增项； GameState.Logs 上限由现有逻辑裁剪（若无可考虑后续加 cap） |
| R6 | 前端 isViewPathAllowed 与后端 filterBroadcastForView 规则漂移 | 现有规则 0-9 已对齐；本次仅激活不改动；后续 review 强制双盲对照 |
| Q1 | delta payload 是否需要 gzip 压缩？ | 列为后续阶段；当前 JSON 文本已较小，浏览器 per-frame 压缩收益有限 |
| Q2 | 是否需要运行时 feature flag 在 delta 出问题时热切回 fullSync？ | 列为后续阶段；当前依赖代码回滚 |
