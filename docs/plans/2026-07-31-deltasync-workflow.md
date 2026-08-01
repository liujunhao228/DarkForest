---
intent: 在线对局每次玩家动作后，仅广播 per-viewer 的状态增量（变化的字段路径），而非整个 ViewState
success_criteria: 非 fullSync 路径下，单次动作的 WS 下行字节数 < fullSync 的 30%；所有现有 + 新增测试通过；pnpm lint/tsc -b/test --run/build 与 go test ./... 全绿
risk_level: medium
auto_approve: true
---

## Steps

- [ ] **Step 1: 编写 DiffViewStates 失败测试 (RED)**
action: 新建 backend/internal/game/view_state_diff_test.go，编写 TestDiffViewStates 覆盖以下场景：(a) 标量变更（TotalTurn 1→2 产出 `totalTurn` set change）；(b) 嵌套 struct 变更（Players[0].Energy 5→8 产出 `players[0].energy`）；(c) nil 指针字段（Broadcast nil→非 nil 产出 `broadcast` set；非 nil→nil 产出 delete）；(d) 数组元素变更（FlyingStrikes[0].Position 3→5）；(e) Logs append-only（prev Logs 长度 2、next 长度 4，仅产出 `logs[2]` 与 `logs[3]` 两个 change，不重发 logs[0]/logs[1]）；(f) 空 diff 返回 nil 而非空切片。Change 结构体字段为 `{Path string; Value interface{}; Type string}`，Type 取值 "set" 或 "delete"。
loop: false
max_iterations: 1
verify: cd backend; go test ./internal/game/... -run TestDiffViewStates

- [ ] **Step 2: 实现 DiffViewStates 让测试通过 (GREEN)**
action: 新建 backend/internal/game/view_state_diff.go，定义 `type Change struct { Path string; Value interface{}; Type string }` 与 `func DiffViewStates(prev, next *ViewState) []Change`。实现递归 deep equality walk：标量字段直接比较；struct 字段递归；数组按索引对齐比较（不尝试匹配 reorder，符合 ViewState 数组索引即玩家编号不变式）；nil 指针字段 nil→非 nil 产出 "set"、非 nil→nil 产出 "delete"；Logs 字段特殊处理为 append-only（prev 长度 N、next 长度 M > N 时仅产出 logs[N..M-1] 的 set change，不重发前 N 项）；返回值在无 change 时为 nil。无 rooms/hub 依赖。
loop: until cd backend; go test ./internal/game/... -run TestDiffViewStates 通过
max_iterations: 5
verify: cd backend; go test ./internal/game/... -run TestDiffViewStates

- [ ] **Step 3: 新增 EvtSrvGameDeltaSync 常量**
action: 修改 backend/internal/hub/protocol.go，在 ServerEvent 常量块的 Game server events 区域（EvtSrvGameFullSync / EvtSrvGameActionResult / EvtSrvGameError 附近）新增 `EvtSrvGameDeltaSync ServerEvent = "game:deltaSync"`。EvtGameAckState 客户端事件常量已存在，无需新增。此步骤前置以避免后续 buildDeltaSyncMessage 引用未定义常量。
loop: false
max_iterations: 1
verify: cd backend; go build ./...

- [ ] **Step 4: Room 新增 per-player 缓存字段**
action: 修改 backend/internal/rooms/room.go，在 Room struct 新增 `lastSentViews map[string]*game.ViewState` 与 `lastAckVersion map[string]int` 两个字段（持 r.mu 保护）；在 NewRoom 函数中初始化这两个 map（`make(map[string]*game.ViewState)` 与 `make(map[string]int)`）。同时在 StartGame 成功分支末尾（r.State = RoomStatePlaying 之后）调用 `r.lastSentViews = make(map[string]*game.ViewState); r.lastAckVersion = make(map[string]int)` 清空缓存，确保新对局从干净状态开始。
loop: false
max_iterations: 1
verify: cd backend; go build ./...

- [ ] **Step 5: HandleGameAction 末尾递增 Version**
action: 修改 backend/internal/rooms/room.go 的 HandleGameAction，在 dispatch 成功、recorder.RecordAction 调用之后、broadcastGameState 调用之前，递增版本号：若 `r.GameState.Version == nil` 则 `v := 1; r.GameState.Version = &v`，否则 `*r.GameState.Version++`。仅在 dispatch 成功（未 return error）路径递增；default 分支的 ErrUnknownAction 与 unmarshal 失败等错误路径不递增（这些路径在 switch 内已 return）。
loop: false
max_iterations: 1
verify: cd backend; go test ./internal/rooms/...

- [ ] **Step 6: 新增 buildDeltaSyncMessage 辅助函数**
action: 在 backend/internal/rooms/room.go 新增 `func (r *Room) buildDeltaSyncMessage(changes []game.Change, version int) hub.Message`，构建 payload 为 `{"changes": changes, "version": version, "timestamp": time.Now().UnixMilli()}` 的 hub.Message，Type 为 string(hub.EvtSrvGameDeltaSync)（常量已在 Step 3 定义），RoomID 为 r.ID。payload 通过 json.Marshal 序列化，错误时返回空 payload 的 hub.Message（与 buildFullSyncMessageWithState 错误处理一致）。
loop: false
max_iterations: 1
verify: cd backend; go build ./...

- [ ] **Step 7: broadcastGameState 增加 delta 分支**
action: 修改 backend/internal/rooms/room.go 的 broadcastGameState 函数。在 sendToPlayer != nil 分支内，对每个 connected player p：先调用 game.CreateViewState 生成 nextView；查 `prevView := r.lastSentViews[p.ID]` 与 `lastAck := r.lastAckVersion[p.ID]`；currentVersion := `*r.GameState.Version`（若 Version 为 nil 视为 0）。若 prevView == nil 或 lastAck 不等于 currentVersion-1 也不等于 currentVersion（宽容策略：允许客户端尚未 ack 当前版本），走 fullSync 路径（沿用现有 buildFullSyncMessageWithState + sendToPlayer）；否则计算 `changes := game.DiffViewStates(prevView, nextView)`，若 len(changes) == 0 则跳过发送（无变化），否则调用 r.buildDeltaSyncMessage(changes, currentVersion) 并 sendToPlayer。无论走哪条路径，最后都更新 `r.lastSentViews[p.ID] = nextView`（注意：nextView 直接赋值即可，因 CreateViewState 每次返回新对象，不会被后续修改污染）。
loop: until cd backend; go build ./... 通过
max_iterations: 3
verify: cd backend; go build ./...

- [ ] **Step 8: 实现 HandleAckState 方法**
action: 在 backend/internal/rooms/room.go 新增 `func (r *Room) HandleAckState(playerID string, version int)` 方法：持 r.mu 锁，设置 `r.lastAckVersion[playerID] = version`。无返回值。若 playerID 不在 r.Players 中也接受（避免 race：玩家刚断连但 ack 仍在途）。
loop: false
max_iterations: 1
verify: cd backend; go test ./internal/rooms/...

- [ ] **Step 9: RoomManager.HandleAckState 路由**
action: 修改 backend/internal/rooms/manager.go，新增 `func (rm *RoomManager) HandleAckState(playerID string, version int)` 方法：通过 `rm.GetRoomByPlayerID(playerID)` 找到 room，若 room 为 nil 静默返回（与 RequestSync 的错误处理一致，ack 是尽力而为），否则调用 `room.HandleAckState(playerID, version)`。同时确认 hub.Hub 持有 *RoomManager 引用（参考现有 RequestSync 在 hub 中的调用链：hub.go 内 EvtGameRequestSync case 调用 roomManager.RequestSync）。
loop: false
max_iterations: 1
verify: cd backend; go build ./...

- [ ] **Step 10: hub.go 注册 EvtGameAckState dispatch**
action: 修改 backend/internal/hub/hub.go 的事件 dispatch switch（处理 ClientEvent 的位置）。参考现有 EvtGameRequestSync 的 case 实现：新增 `case EvtGameAckState:` 分支，解析 payload 为 `{"roomId": string, "version": int}`，调用 `h.roomManager.HandleAckState(client.PlayerID, payload.Version)`（若 hub 使用不同的 RoomManager 字段名，按实际字段名调用）。若 EvtGameAckState case 已存在但为空实现，补全调用。
loop: until cd backend; go test ./internal/hub/... 通过
max_iterations: 3
verify: cd backend; go test ./internal/hub/...

- [ ] **Step 11: 编写 WS_DeltaSync 集成测试**
action: 在 backend/test/ws_smoke_test.go 新增 TestWS_DeltaSync 测试用例：模拟两玩家 A 与 B 连接并进入房间；启动游戏（参考现有 TestWS_* 用例的 StartGame 调用模式）；A 触发 endTurn 动作（避免 moveStrike 的复杂前置条件）；验证 A 与 B 收到的下一条消息类型为 `game:deltaSync`（首次动作后 cache 已由 RequestSync 填充，故走 delta 路径）；验证 B 收到的 delta 的 changes 数组中不含 `players[A_index].position` 路径（A 的 position 在 B 的 ViewState 中为 -1，prev 与 next 均为 -1，不产出 change）；验证 delta payload 包含 version 字段且等于 1（首次递增）。若现有 helper 不支持双客户端模拟，参考现有 TestWS_* 用例的 wsClient 构造模式扩展为双客户端。
loop: until cd backend; go test ./test/... -run TestWS_DeltaSync 通过
max_iterations: 5
verify: cd backend; go test ./test/... -run TestWS_DeltaSync

- [ ] **Step 12: 前端 protocol.ts 新增 deltaSync 类型**
action: 修改 frontend/src/ws/protocol.ts：(a) 在 ServerEvent 联合类型中新增 `| 'game:deltaSync'`（在 'game:fullSync' 之后）；(b) 新增 `export interface DeltaSyncPayload { changes: Array<{ path: string; value: unknown; type: string }>; version: number; timestamp: number }`。
loop: false
max_iterations: 1
verify: cd frontend; pnpm tsc -b

- [ ] **Step 13: ws/client.ts 加入 deltaSync 批处理**
action: 修改 frontend/src/ws/client.ts 的 handleMessage 函数，在批处理条件中（现有 `message.type === 'game:fullSync' || message.type === 'game:actionResult' || message.type === 'game:error'`）新增 `|| message.type === 'game:deltaSync'`，使 deltaSync 与 fullSync 一起进入 microtask 批处理队列（P1-1 优化保持）。
loop: false
max_iterations: 1
verify: cd frontend; pnpm tsc -b

- [ ] **Step 14: eventListeners.ts 注册 onGameDeltaSync**
action: 修改 frontend/src/store/onlineGameStore/eventListeners.ts：(a) 在文件顶部 import 中新增 DeltaSyncPayload 类型（从 '@/ws/protocol' 导入）；(b) 在 registerGameEventListeners 函数内新增 `const onGameDeltaSync = (payload: unknown) => { const data = payload as DeltaSyncPayload; get().handleDeltaSync(data.changes, data.version); }`；(c) 在函数末尾（onGameError 注册之前或之后均可）`wsClient.on('game:deltaSync', onGameDeltaSync); unsubs.push(() => wsClient.off('game:deltaSync', onGameDeltaSync));`。
loop: false
max_iterations: 1
verify: cd frontend; pnpm tsc -b

- [ ] **Step 15: sync.ts 激活 handleDeltaSync + version 兜底**
action: 修改 frontend/src/store/onlineGameStore/sync.ts：(a) 删除 applyChanges 函数内的 `// TODO(deltaSync): 当前 deltaSync 为死代码` 注释（共 2 处：applyChanges 内与 isViewPathAllowed 内）；(b) 在 handleDeltaSync 函数开头（const { gameState } = get(); 之前）新增 version 连续性检查：`if (version !== get().gameVersion + 1) { setTimeout(() => get().requestSync(), 100); return; }`（version 不连续时主动 requestSync 触发 fullSync 兜底）；(c) 在 isViewPathAllowed 函数顶部注释更新为：`纵深防御路径白名单。主防线是后端 per-viewer diff（DiffViewStates），此函数作为二重校验保留。`。
loop: false
max_iterations: 1
verify: cd frontend; pnpm lint

- [ ] **Step 16: 前端 sync.test.ts 新增 handleDeltaSync 测试**
action: 修改 frontend/src/store/onlineGameStore/__tests__/sync.test.ts，新增 describe('handleDeltaSync')：(a) 测试 version 连续时正确应用 changes 到 gameState（构造 mock store with gameVersion: 1, gameState: {kind:'view',...}，调用 handleDeltaSync with version: 2, changes: [{path:'totalTurn', value:5, type:'set'}]，验证 set 被调用且 gameState.totalTurn === 5）；(b) 测试 version 不连续（version !== gameVersion + 1）时调用 requestSync 且不修改 gameState；(c) 新增 describe('isViewPathAllowed') 测试：对对手 position 路径 `players[1].position` 返回 false（构造 state with players[1].id !== localPlayerId）；(d) 对自己手牌路径 `players[0].hand` 返回 true（构造 state with players[0].id === localPlayerId）；(e) 对未揭示的 `broadcast.card` 在非广播者时返回 false。isViewPathAllowed 是非导出函数，需通过 applyChanges 间接测试或导出测试（参考现有 setPathValue 的导出测试模式，将 isViewPathAllowed 导出或在 sync.ts 中通过 export 暴露给测试）。
loop: until cd frontend; pnpm test --run sync.test.ts 通过
max_iterations: 5
verify: cd frontend; pnpm test --run sync.test.ts

- [ ] **Step 17: 后端全量测试回归**
action: 运行后端全量测试套件，确认所有现有测试（broadcast_test / view_state_test / turn_test / strike_test / hub_test / matchservice_test 等）与新测试均通过。重点关注 broadcast_test 中的 InitiateBroadcast / RespondToBroadcast 流程是否受 Version 递增影响（不应受影响：Version 仅由 rooms 层在 HandleGameAction 末尾递增，game 包内 InitiateBroadcast 等函数不感知 Version）。
loop: until cd backend; go test ./... 通过
max_iterations: 3
verify: cd backend; go test ./...

- [ ] **Step 18: 前端全量 lint + tsc + test + build 回归**
action: 依次运行前端 lint、tsc 类型检查、vitest 全量测试、Vite 生产构建，确认零错误。重点关注 onlineGameStore 相关组件（OnlineStarMap / OnlinePlayerPanel / OnlineBroadcastPanel）是否因 ServerEvent 联合类型扩展或 handleDeltaSync 激活产生类型错误（switch 语句穷尽性检查可能报错）。
loop: until 全部通过
max_iterations: 3
verify:
  - type: shell
    command: cd frontend; pnpm lint
  - type: shell
    command: cd frontend; pnpm tsc -b
  - type: shell
    command: cd frontend; pnpm test --run
  - type: shell
    command: cd frontend; pnpm build
gate: human
