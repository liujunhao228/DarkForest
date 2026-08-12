---
name: darkforest
description: DarkForest 游戏 MCP 集成，提供连接/查询/动作全套 API
---

# DarkForest 游戏 MCP 集成（darkforest）

本 skill 封装 `mcpserver` 的 MCP 工具为 Python 异步 API，供 prime-agent 的
IPython 内核预导入后由游戏 Agent 直接调用。所有函数均为 `async`，内部经
`DarkForestMCPClient`（Streamable HTTP 长连接）转发到 mcpserver；返回值是解析后的
JSON 结构（Pydantic model / dict），不是裸文本。

每个子 Agent 实例持有一个独立的 `DarkForestMCPClient`（对应 mcpserver 一个
session/账户池条目），实例之间互不共享连接。

## 快速上手

```python
import darkforest

await darkforest.connect("ai1")                # 建立 MCP 连接 + ensure_connected
await darkforest.join_match_queue()            # 加入快速匹配（默认 2 人 classic）
loop:
    evt = await darkforest.wait_for_event(30)  # 阻塞等待事件（含 delta）
    if evt["hasEvent"]:
        view = await darkforest.get_view()     # 五层语义视图
        aff  = await darkforest.get_affordances()
        # 决策 → 校验 → 执行
        ok, reason = darkforest.validate_action("strike", {...}, aff)
        if ok:
            await darkforest.strike(card_uid, target_system)
        await darkforest.end_turn()
await darkforest.disconnect()
```

## 函数签名与用法

### 连接 / 生命周期

- `await darkforest.connect(agent_name: str) -> dict`
  建立 MCP 长连接并调用 `ensure_connected`。`agent_name` 是 mcpserver 账户池里的
  agent sid（信任模式无需鉴权头）。返回 `{connected, accountId, displayName, playerId}`。

- `await darkforest.disconnect() -> dict`
  调用 `disconnect`，断开游戏连接并归还账户到池。返回 `{success}`。

### 查询 / 感知

- `await darkforest.get_view() -> dict`
  调 `get_agent_view`：返回五层语义视图（对象 ObjectProjector / 打击 StrikeView /
  广播 BroadcastView / 位置 PositionView / 遗迹 RelicView），仅游戏中填充，否则
  `{inGame: false}`。回合开始首选查询。

- `await darkforest.get_affordances() -> dict`
  调 `get_affordances`：返回当前合法动作集 `{inGame, affordance}`，每个 ActionOption
  含 `cost / legalTargets / precondition / expectedEffect / riskNote`。是动作合法
  目标集的权威来源。

- `await darkforest.get_recent_delta() -> dict`
  调 `get_recent_delta`：返回最近一次 fullSync 的结构化 diff（changes / trend /
  highlights），回答「刚发生了什么」。

- `await darkforest.wait_for_event(timeout_seconds: int = 30) -> dict`
  调 `wait_for_event`：阻塞等待新游戏事件（匹配成功、回合切换、对手动作、结算等），
  返回 `{hasEvent, events, delta}`。`delta` 为事件伴随 fullSync 时的语义化 diff。

### 匹配 / 队列

- `await darkforest.join_match_queue(preferred_count: int = 2, game_mode: str = "classic") -> dict`
  调 `join_match_queue`：加入快速匹配队列，人数达到 `preferred_count` 即开房。
  返回 `{joined, message}`。

- `await darkforest.cancel_match_queue() -> dict`
  调 `cancel_match_queue`：取消快速匹配队列。返回 `{cancelled}`。

### 动作

- `await darkforest.play_card(card_uid: str) -> dict` — 调 `play_card`：出牌。
- `await darkforest.deploy_card(card_uid: str) -> dict` — 调 `deploy_card`：部署设施卡。
- `await darkforest.strike(card_uid: str, target_system: int, target_player_id: str = "") -> dict`
  调 `strike`：发射打击卡牌。仅「科技锁死」卡允许传 `target_player_id`。
- `await darkforest.broadcast(card_uid: str, target_system: int) -> dict` — 调 `broadcast`：发起广播。
- `await darkforest.respond_broadcast(agreed: bool, card_uid: str = "") -> dict`
  调 `respond_broadcast`：同意合作（`agreed=true` 时必须传广播卡 `card_uid`）或伪装。
- `await darkforest.select_broadcast_responder(responder_id: str) -> dict`
  调 `select_broadcast_responder`：广播发起者选择响应者。
- `await darkforest.cancel_broadcast() -> dict` — 调 `cancel_broadcast`：取消当前广播。
- `await darkforest.recycle_card(card_uid: str) -> dict` — 调 `recycle_card`：回收场上明牌。
- `await darkforest.end_turn(discard_cards: list[str] | None = None, public_discard: bool = False) -> dict`
  调 `end_turn`：结束当前回合，可同时弃牌。
- `await darkforest.lightspeed_ship(mode: str, target_system: int, carry_energy: int, message: str, leave_behind: bool, broadcast_on_inherit: bool | None = None) -> dict`
  调 `lightspeed_ship`：光速飞船跃迁（普通 / 文明遗迹模式行为分化）。
- `await darkforest.forfeit_game() -> dict` — 调 `forfeit_game`：主动弃权并触发结算。

所有动作工具返回 `{success, action, requestId, error, errorCode}`。`success=true`
仅表示后端已接收，本地状态可能未同步——决策前用 `get_view()` 复核。

### 规则校验（纯逻辑，无 IO）

- `darkforest.validate_action(action_name: str, action_args: dict, affordances: dict) -> tuple[bool, str]`
  检查：动作在 `affordances` 的 `legalActions` 中、参数在对应 `legalTargets` 中、
  成本不超过当前能量。返回 `(是否合法, 拒绝原因)`。执行任意动作前必须调用，
  非法则重新决策。

## 设计约束

- 连接保持长连接（session id 稳定映射 mcpserver GameSession），`connect()` 只调一次，
  对局结束 `disconnect()`。
- 动作合法性一律以 `get_affordances` 返回为准，不要在 Python 侧硬编码规则。
- 中间状态用变量保存，避免重复查询。
