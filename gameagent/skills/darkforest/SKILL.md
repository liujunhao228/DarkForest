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
evt = await darkforest.wait_for_match()        # 入队 + keep-alive 等待，直到匹配成功
loop:
    evt = await darkforest.wait_for_event(30)  # 阻塞等待对局事件（含 delta）
    if evt["hasEvent"]:
        view = await darkforest.get_view()     # 五层语义视图
        aff  = await darkforest.get_affordances()
        # 决策 → 校验 → 执行
        ok, reason = darkforest.validate_action("strike", {...}, aff)
        if ok:
            await darkforest.strike(card_uid, target_system)
        await darkforest.end_turn()
```

> 注：**Swarm 架构下子 Agent 不再直接打对局**——上面的连接/决策循环是历史 LLM
> 玩家路径的参考，当前角色是脚本作者/复盘教练：写脚本 → `validate_script` →
> `spawn_driver` 批量对局 → `review_cycle` 复盘 → `publish_version` 发布 vN+1
> （详见下方「Swarm：driver 管理」与「复盘流程」节）。对局结算由 driver 确定性
> 接管（`get_agent_view.gameOver` 权威判定），不再经 `game_ended` 上报收尾。

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

  对局结束（Phase=gameOver）时返回 `{inGame: false, gameOver: {...}}`，其中
  `gameOver.result` 是**后端权威结果**（win/loss/draw，按你的身份精确映射）、
  `gameOver.winner` / `gameOver.replayId` / `gameOver.totalTurn` /
  `gameOver.eliminated` 供收尾参考。结束判定**只认** `gameOver` 字段非空，不要猜。

  返回结构（关键路径，不要猜顶层字段——顶层没有 currentPlayerId 等键）：

  ```python
  view = await darkforest.get_view()
  cursor = view["agentView"]["cursor"]       # {"isMyTurn", "totalTurn", "turnPhase"}
  is_my_turn = cursor["isMyTurn"]            # 只有它为 true 才轮到你决策
  self_ = view["agentView"]["self"]          # energy / hand(列表!) / faceUpCards / color
  energy = self_["energy"]                   # 能量
  hand = self_["hand"]                       # 卡牌列表；数量用 len(hand)，不是 handCount
  entries = view["agentView"]["events"]["entries"]  # 事件记录 [{"type","message"}, ...]
  pos = view.get("position", {})             # myPosition.isPublic / system / safeSystems
  bcast = view.get("broadcast", {})          # phase / myRole / history
  ```

- `await darkforest.get_affordances() -> dict`
  调 `get_affordances`：返回当前合法动作集 `{inGame, affordance}`，每个 ActionOption
  含 `cost / legalTargets / precondition / expectedEffect / riskNote`。是动作合法
  目标集的权威来源。

  **每次 `wait_for_event` 返回后都要查它**，即使不是你的回合：
  - `affordance.broadcastAction` 非空 = 广播进行中，按 `legalOptions` 处理：
    `agree`/`refuse`（回应者用 `respond_broadcast`）、`cancel`（广播者用
    `cancel_broadcast`）、回应者 id 列表（广播者用 `select_broadcast_responder`）。
    广播会中断回合，双方都必须处理，不能只等自己回合。
  - `affordance.pendingAction` 非空 = 强制挂起动作，先完成它。

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

- `await darkforest.wait_for_match(preferred_count: int = 2, game_mode: str = "classic", wait_seconds: int = 20) -> dict`
  入队并以 **keep-alive** 方式持续等待，直到匹配成功。内部循环：`wait_for_event`
  超时或被后端 30s 队列超时踢队（`match:error TIMEOUT`）后立即重新 `join_match_queue`
  （后端 `ON CONFLICT` 重置 `joined_at`，永不被踢）。两个子 Agent 只要都进入本函数
  就持续同时在队列，后端每 5 秒轮询即开房。匹配成功（`match:found`）时返回本次
  `wait_for_event` 的完整输出 `{hasEvent, events, delta}`。

  **排队期间禁止**调用 `get_queue_info` / `get_my_queues` / `get_match_status`：
  它们内部会 `wait_for_event(3s)` 排空事件队列，可能吞掉 `match:found`，导致误以为
  没匹配上而取消/重排。排队期间只准用 `wait_for_event`（或被本函数自持）。

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

### driver 管理（Swarm：脚本作者/复盘教练侧）

对局由 Python driver 子进程确定性执行，本组函数负责它的生命周期与阶段汇报。
**子 Agent 自己绝不直接连游戏**——这些函数是它与 driver 的唯一接口。

- `darkforest.validate_script(script_path: str, python: str = "") -> dict`
  **L1 离线校验门**：子进程跑 `python -m autonomous_driver validate --script
  <abs path>`（解释器取 env `AUTONOMOUS_PYTHON`，缺省 `sys.executable`；cwd 与
  spawn_driver 一致），exit 0=通过 / 2=失败。校验 = 导入/结构（复用
  `load_script_decider`）+ **干跑**（内置 fixture 集循环调 decide 上限 50 次，
  断言动作名合法、参数键 snake_case）。返回 `{ok, reason}`。**写脚本后先自检
  拿 reason**，不要直接 spawn。

- `darkforest.spawn_driver(script_path: str, games: int, game_mode: str = "classic", mcp_url: str = "") -> dict`
  启动 driver 子进程批量连打 `games` 局：`python -m autonomous_driver --script
  <abs path> --games N --game-mode <mode> --mcp-url <url> --smoke-first`
  （解释器取 env `AUTONOMOUS_PYTHON`，缺省 `sys.executable`；`mcp_url` 缺省读
  `MCP_URL`）。stdout/stderr 合并写入临时日志文件。返回 `{ok, pid, log_path}`。
  **前置硬门（结构性执行，无法跳过）**：spawn 前先跑 L1 校验，`ok=false` 直接
  返回 `{ok: false, reason: "L1 校验未通过: ..."}` 不启动 driver——坏脚本零对局
  成本拦截，不会浪费批量对局。
  **`--script` 是必填参数**：driver CLI 缺省拒绝执行（exit 2），不会降级到
  内置 RuleDecider——对局结果必须归因到你的脚本，静默降级会破坏复盘迭代
  闭环。
  **默认带 `--smoke-first`（L2 首局即冒烟）**：批量第一局兼作动态冒烟——首局
  driver 异常结束（exit_code≠0）或问题动作数 ≥ 5（后端拒绝/未知动作/decide
  抛异常，局内累计）即中止剩余局并 exit 1。坏脚本最多废 1 局而非整批 N 局。
  **同一时刻只允许一个 driver**：已有存活句柄时返回 `{ok: false, reason}`，
  先 `stop_driver` 或等其自然结束。启动即抛的异常（脚本路径不存在等）由
  调用方捕获处理。

  **M=3 修复循环**：L1 校验失败或批量冒烟失败（driver 日志含「冒烟失败」或
  批量 exit 1）→ 读 `driver_status()` 的 `last_log` / `validate_script` 的
  `reason` → 修复脚本 → 重跑 L1 → 重新 spawn（带 smoke-first）；**最多 3 次**，
  仍失败 → `report_batch("driver_failed", {script_name, reason})` 上报编排器
  并结束本轮。机械重试同一坏脚本无意义（失败是确定性的），必须修复后再试。

- `darkforest.driver_status() -> dict`
  查询 driver 状态：`{running, pid, script, log_path, last_log}`。`last_log`
  为日志尾部最近 500 字符，进程结束后用于排查失败原因。未 spawn 过返回
  `{running: false, pid: null, ...}`。

- `darkforest.stop_driver(timeout_seconds: float = 5.0) -> dict`
  终止 driver（terminate → 超时 kill），幂等。返回 `{ok, pid, had_process}`。
  停止后清空模块级句柄（日志文件保留供事后查看）。

- `await darkforest.report_batch(event: str, payload: dict) -> dict`
  向父 Agent（编排器）上报阶段事件。内部构造 `{"event": <event>, **payload}`
  的 **JSON 字符串** 经 `agent_message.send(message=..., receiver_role="parent")`
  发送；`agent_message` 是内核注入模块，缺失/发送异常时 try/except 兜底返回
  `{ok: false, reason}`，不影响对局。
  事件名与字段须与编排器解析器对齐（snake_case）：

  | event | 字段 |
  | --- | --- |
  | `script_ready` | script_name, version |
  | `batch_start` | script_name, version, plan_games |
  | `batch_end` | script_name, version, games_played, wins, losses, draws, match_ids, driver_errors |
  | `driver_failed` | script_name, reason |
  | `review_done` | script_name, from_version, to_version |
  | `v_published` | script_name, version |

  典型流程：`spawn_driver` → 轮询 `driver_status()` 直到 `running=false` →
  读 `last_log` 核对 `batch_end` → `report_batch("batch_end", {...})`。

### 复盘流程（读回放 → 分析 → 发布 vN+1）

对局由 driver 全流程接管后，子 Agent 的创作面只剩「写脚本」与「复盘」。
复盘阶段**临时建立独立 MCP 连接**（不复用对局连接，读完全部回放即断开、
断开异常忽略），拉取与摘要逻辑全部确定性，LLM 只消费紧凑摘要做分析。

- `await darkforest.review_cycle(script_name: str, match_ids: list[str], agent_name: str = "reviewer", mcp_url: str = "") -> dict`
  对每个 `match_id`（batch_end 事件的 match_ids，driver 的 replayId 能力令牌）：
  本地已落库直接读 `get_replay_semantic_view`；未命中先 `fetch_shared_replay`
  按能力令牌拉取落库（失败兜底 `fetch_and_save_replay` 按对局 ID），再取
  `get_replay_deltas` 动作流 + 终局帧，整理为紧凑摘要。返回
  `{script_name, match_ids, replay_summaries, connected}`，每局摘要含
  `match_id / replay_id / game_mode / total_turns / winner / players（终局
  手牌/位置/淘汰原因）/ turns（逐回合动作流）/ final_state（飞行打击/毁星/
  星系效果）`；单局拉取失败不抛异常（该局摘要带 `error` 字段，分析时跳过）。
  `agent_name` 是复盘期临时借用的账户 sid（账池已播种的名字）；本地回放
  无需连接，`ensure_connected` 失败不致命。

- `darkforest.publish_version(script_name: str, code: str, stats: dict | None = None, notes: str = "") -> dict`
  发布新版本脚本：版本号从 manifest 的 `current` **自动递增**（无 manifest →
  v1，`current=v1` → v2），写 `gameagent/rules/<script_name>/vN+1.py` 并更新
  `manifest.json`（versions 版本链、current、`history[version]` = created_at /
  stats / notes）。`stats` 传 batch_end 的胜率记录 `{games, wins, losses,
  draws}`。LLM 不手算版本号、不手写 JSON——分析完调本函数即完成「发布 vN+1」，
  之后 `report_batch("review_done", {from_version, to_version})` 与
  `report_batch("v_published", {version})` 上报编排器。

  复盘闭环示例：

  ```python
  review = await darkforest.review_cycle("s1", match_ids, agent_name="ai1")
  # → LLM 分析 replay_summaries，写出改进后的脚本 code
  pub = darkforest.publish_version("s1", code, stats={"games": 10, "wins": 7, "losses": 3, "draws": 0}, notes="针对败局调整早期打击")
  await darkforest.report_batch("v_published", {"script_name": "s1", "version": pub["version"]})
  ```

## 设计约束

- 连接保持长连接（session id 稳定映射 mcpserver GameSession），`connect()` 只调一次。
  **对局结算由 driver 确定性接管**（`get_agent_view.gameOver` 权威判定 + `report_batch`
  "batch_end" 汇总上报），子 Agent 不手动上报 `game_ended`（旧收尾协议已退役）。
- 动作合法性一律以 `get_affordances` 返回为准，不要在 Python 侧硬编码规则。
- 中间状态用变量保存，避免重复查询。
