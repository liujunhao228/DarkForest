# AGENTS.md - bot/ QQbot 包

语言：中文。提交信息、文档、代码注释一律用中文。

## 1. 概述

`bot/` 是一个 Python（uv）QQbot，nonebot2 + OneBot 11，是网页端关停后「黑暗森林」的唯一客户端。通过群聊 `.match` 匹配、私聊 `.deploy`/`.strike`/`.broadcast` 等命令对局，Pillow 渲染星图 PNG，不重写游戏逻辑。

**运行拓扑（务必先理解方向）**：
- bot **监听** `BOT_WS_HOST:BOT_WS_PORT`（默认 8081），SnowLuma（QQ 框架）作为 OneBot 11 **反向 WS** 连过来；bot 自己不去连 QQ。
- bot 作为 WS **客户端**连后端 `ws://127.0.0.1:8080/ws?qq=<n>&name=<nick>`，走 **LOCAL_TRUST_MODE 免 JWT**（后端必须 `LOCAL_TRUST_MODE=1` 启动，且仅 127.0.0.1）。
- 入口 `src/darkforest_bot/main.py`（`python -m darkforest_bot.main` 或 `darkforest-bot` console script）。

## 2. 命令

```bash
uv sync            # 装依赖（严格锁 uv.lock）
uv run pytest      # 单元测试（tests/，mock/fake，不需后端/DB）
uv run pytest e2e  # 进程级 E2E：真实 Go 后端 + Postgres + FakeOneBot
uv run mypy        # strict 模式
uv run ruff check  # E,F,W,I,UP,B；line-length=100
uv run darkforest-bot   # 本地起 bot
```

**无 Makefile、无 CI**。改完必须本地跑 `pytest + mypy + ruff` 三件套。

## 3. 目录结构（src/darkforest_bot/）

- `main.py` 启动编排（单例注入 → init_nonebot → nonebot.run）
- `onebot_setup.py` **一次性** `nonebot.init()` + 注册 OneBot v11 adapter + 加载命令插件（`_PLUGIN_MODULES`）
- `config.py` pydantic-settings，`extra="forbid"`，`load_settings()` lru_cache 单例
- `state.py` 模块级单例容器（Settings/SessionManager/WSConnectionPool/GameSessionStore/NotifyConfigStore），**打破循环 import 的枢纽**
- `backend/` 后端协议镜像 + WS 客户端
- `session/` 每 QQ 会话状态机
- `commands/` 各 `.xxx` 命令（nonebot handler 薄壳 → `handle_xxx_request()` 纯逻辑，可测）
- `notifications/` 匹配成功 / 结算 / notify 配置推送
- `render/` Pillow 渲染（starmap / markdown 转图 / 文本摘要）
- `rules/` 群聊 @机器人规则

## 4. 关键架构约束（改前必读）

### 4.1 后端协议镜像，必须 lockstep 同步

`backend/` 下的文件是 Go 后端的**手抄镜像**，文件头都标注了权威源路径。后端改了必须同步更新，否则解析漂移：
- `backend/protocol.py` ← `backend/internal/hub/protocol.go`（ClientEvent/ServerEvent 常量 + payload 模型）
- `backend/view_state.py` ← `backend/internal/game/view_state.go` + `types.go`
- `backend/delta.py` ← `backend/internal/game/delta_sync.go`（path 语法）
- `render/starmap.py` 的 `_DEFAULT_NODES/_DEFAULT_EDGES` ← `backend/internal/game/starmap.go`

pydantic 模型 `extra="forbid"` 用于在解析时抓 drift；`ModeRules` 特意 `extra="allow"`（opaque blob，bot 不读）。Go nil slice 序列化成 `null`，用 `view_state.py` 的 `NullableList`/`_coerce_none_to_list` 兜底（没有 `omitempty` 的字段）。

### 4.2 会话状态机（session/）

每 QQ 一个 `Session`，状态 `IDLE → MATCHMAKING → IN_ROOM → IN_GAME`，转移受 `LEGAL_TRANSITIONS` 约束。**所有状态变更必须持有 `async with session_manager.acquire(qq)`**（每 QQ 一把 asyncio.Lock）；`.cancel` 与 `.match` 等待阶段能抢锁，因此锁**只**包状态检查/转移，不包 WS 等待。

### 4.3 连接池不变式

`WSConnectionPool` 保证**一 QQ 一 WS**（内部 asyncio.Lock 串行化）；`WSClient` 断线用指数退避重连（`RECONNECT_DELAYS`），重连后**清空所有订阅**并触发 `on_reconnect`（会话重置为 IDLE + 私信提示，不做自动恢复）。

### 4.4 推送策略（notifications/ + backend/game_session.py）

每次 fullSync/deltaSync 用 `classify()` 分类，按 `NotifyConfig` 开关推送：
- **硬推**（不可关）：回合变化、游戏结束、本地 pending 变化
- **可关**（`.notify` 命令）：broadcast / strike / other，每类别独立去重键
- 广播者侧/结算用 `last_broadcast_card_uids` 闭包记录最近 card_uid 渲染 resolution hint

deltaSync 应用失败或缺失缓存 → 发 `game:requestSync` 回退全量。`game_session.py` 的 `_settled_replay_ids` 保证同一回放 ID 只向群推一次结算。

### 4.5 命令注册与 @规则

- `on_command("xxx", rule=require_at_in_group(), priority=10, block=True)`；群聊需 @机器人（`GROUP_REQUIRE_AT_MENTION=false` 可全局关），私聊放行。
- handler 把 `event` 数据抽成 `handle_xxx_request(...)` 纯逻辑函数，测试直接调它 + AsyncMock bot，不碰 nonebot 运行时。

### 4.6 类型约定

- 全包 mypy strict。`Any` 只允许出现在 **JSON 边界**（`protocol.py` 的 payload、`delta.py` 的 `Change.value`、`game_action.py` 的 action data）和命令 handler 的 `bot` 参数（测试用 AsyncMock）。业务逻辑公开签名禁 `Any`。
- 循环 import 用 `TYPE_CHECKING` + `from __future__ import annotations`；单例一律经 `state.py` 拿。

## 5. 测试

### 单元测试（`tests/`）

- `tests/conftest.py` 在收集前调一次 `nonebot.init()`（`on_command` 装饰器在 import 时就要 get_driver），autouse fixture 每用例 `init_state()`/`reset_state()`（NotifyConfigStore 写 `tmp_path`，勿污染 `data/`）。
- 大量用 `MockWSClient`/AsyncMock，**不依赖后端/DB**；`match_found.py` 的 `_announced_rooms` 是模块级状态，用例间要 `reset_announced()`。

### E2E（`e2e/`）

- `uv run pytest e2e`，全部打 `pytest.mark.e2e`（pyproject testpaths 只含 `tests/`，不会误跑）。
- 三进程编排：真实 Go 后端（`go run ./cmd/server`，PORT=18080，LOCAL_TRUST_MODE=1 + 全部 E2E 旁路变量，读 `backend/.env` 的 DATABASE_URL）→ bot 子进程（`python -m darkforest_bot.main`，BOT_WS_PORT=18081）→ FakeOneBot 反向 WS 连接。
- **前置**：Postgres 可连 + `backend/.env`（DATABASE_URL）+ Go 工具链。子进程日志 tee 到 `e2e/.logs/`。
- FakeOneBot 是 OneBot v11 反向 WS 客户端：推 `message` 事件、收 `{"action","params","echo"}` 帧并自动应答、归档 `sent` 队列供断言。
- E2E 用确定性种子（E2E_RAND_SEED=42 / E2E_DETERMINISTIC_UID=1），同样依赖 Playwright 那套 `backend/.env`。

## 6. 环境变量（见 .env.example / config.py 字段）

`BACKEND_WS_URL`（后端 /ws 基址）、`BOT_WS_HOST`/`BOT_WS_PORT`（默认 8081，SnowLuma 反连）、`ONEBOT_ACCESS_TOKEN`、`GROUP_REQUIRE_AT_MENTION`（默认 true）、`RENDER_FONT_PATH`（Windows 默认 msyh.ttc）、`LOG_LEVEL`、`.match` 默认值（`DEFAULT_MATCH_COUNT/MODE`、`MATCH_COUNT_MIN/MAX`）、`STATE_REQUEST_TIMEOUT`、`ACTION_ERROR_TIMEOUT`（发 game:action 后等 game:error 的窗口，超时视为成功）、`.analyse` 的 `ANALYSE_MCP_URL/ANALYSE_BIN/ANALYSE_CWD/ANALYSE_TIMEOUT`。

Settings 用 `extra="forbid"`：`.env` 多写未知键会直接抛错。

## 7. 常见坑

- **bot 不是服务端**：8081 是 bot 的反向 WS 监听口（等 SnowLuma 连），不是 bot 去连的地址；改端口别动 `BACKEND_WS_URL`。
- 后端必须 `LOCAL_TRUST_MODE=1` 且从 127.0.0.1 连，否则 WS 握手失败（JWT 主路径 bot 不适用）。
- `.analyse` 是 subprocess 调 `analyser` CLI（`ANALYSE_BIN`，默认 PATH 里的 `analyser`），`ANALYSE_CWD` 必须指向 `analyser/` 包根目录读 LLM 配置，且 mcpserver 要起着；一次分析含多次 LLM 调用，默认超时 600s。
- 群结算/`match:found` 群消息去重依赖模块级集合，测试与多房间并发留意。
- 迁移/回放等后端产物在 `backend/`；bot 只消费 WS 协议，别直接 import 后端包。
- 本目录在 `.gitignore` 里忽略 `.env`、`data/notify_settings.json`、`.venv/`；`data/` 仅 `.gitkeep`。
- 设计上下文见 `docs/designs/`（2026-08-06 phase-2/3/4、2026-08-07 bot-e2e/settlement/broadcast/notify、2026-08-08 replay-analysis 等）与 `docs/plans/` 同名 workflow。
