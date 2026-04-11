# 黑暗森林 AI Agent

让 AI 大语言模型作为玩家接入黑暗森林网络桌游，与真人玩家对战。

## 架构

```
游戏服务器 (Bun/Socket.IO) <---> AI 适配器 (Python) <---> nanobot (本地 LLM)
```

AI 适配器扮演两个角色：
1. **对游戏服务器**：普通 WebSocket 客户端（和真人客户端一模一样）
2. **对 nanobot**：Prompt 管理者 + JSON 解析器

## 项目结构

```
ai/
├── src/darkforest_ai/          # 主包
│   ├── __init__.py
│   ├── agent.py                # AI Agent 主控制器
│   ├── state.py                # 游戏状态管理
│   ├── prompt.py               # DSL Prompt 翻译器
│   ├── llm.py                  # LLM 推理引擎
│   ├── validator.py            # 操作预校验器
│   ├── config.py               # 配置管理
│   └── cli/                    # CLI 工具
│       ├── __init__.py
│       ├── debug.py            # 调试工具
│       └── multi_ai.py         # 多 AI 对战辅助
│
├── tests/                      # 测试文件
│   ├── __init__.py
│   ├── conftest.py             # Pytest fixtures
│   ├── test_llm.py             # LLM 兼容性测试
│   ├── test_integration.py     # 集成测试
│   └── test_agent_mock.py      # Mock 测试
│
├── pyproject.toml              # 项目配置（现代标准）
└── README.md                   # 本文档
```

## 快速开始

### 1. 安装依赖

```bash
cd ai
uv sync --all-extras
```

### 2. 启动 nanobot

```bash
nanobot serve
```

确认 API 服务在 `http://127.0.0.1:8900` 运行。

### 3. 验证 LLM

```bash
uv run pytest tests/test_llm.py -v
```

### 4. 配置（可选）

```bash
cp .env.example .env
# 编辑 .env 调整配置
```

### 5. 运行 AI Agent

```bash
# 直接运行
uv run darkforest-ai
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `GAME_SERVER_URL` | 游戏服务器地址 | `http://localhost:3003` |
| `LLM_BASE_URL` | nanobot API 端点 | `http://127.0.0.1:8900/v1` |
| `LLM_API_KEY` | API 密钥（nanobot 任意值即可） | `dummy` |
| `LLM_MODEL` | 模型名称（留空自动发现） | 自动 |
| `SESSION_ID` | nanobot 会话 ID | `darkforest-ai` |
| `AI_PLAYER_NAME` | AI 玩家显示名称 | `AI-文明` |

## nanobot API 限制与适配

nanobot 的 `/v1/chat/completions` 端点有以下限制：

| 限制 | 适配方案 |
|------|----------|
| 不支持 `system` 角色 | 所有指令合并到单条 `user` 消息 |
| 不支持 Tool Calling | 约定 AI 返回 JSON 格式指令 |
| 单消息输入 | 每次只发一条 `user` 消息 |
| 不支持流式输出 | 等待完整响应后解析 |

### AI 输出格式约定

Prompt 中明确要求 AI 返回 JSON：

```json
{"action": "play_card", "card_uid": "st_005"}
```

适配器负责：
1. 解析 JSON（支持多种格式容错）
2. 预校验操作合法性
3. 映射到游戏协议发送

## AI 可调用的游戏操作

| 操作 | 参数 | 说明 |
|------|------|------|
| `play_card` | `card_uid`, `target_system?`, `target_player_id?` | 打出手牌 |
| `move_strike` | `strike_uid`, `target_system` | 移动飞行打击 |
| `respond_broadcast` | `agreed`, `card_uid?` | 回应广播 |
| `announce_strike` | `strike_uid` | 宣布打击生效 |
| `skip_announce` | `strike_uid` | 跳过宣布(延迟打击) |
| `recycle_card` | `card_uid` | 回收门牌 |
| `use_lightspeed_ship` | `target_system` | 光速飞船逃逸 |
| `end_turn` | 无 | 结束回合 |

## Prompt 格式 (DSL)

AI 接收的游戏状态采用自定义 DSL 格式：

```text
你是黑暗森林桌游的 AI 玩家。你必须以 JSON 格式返回操作指令。

[游戏状态]
回合数: 7
当前阶段: actionPhase
你的手牌(4张): [br_001(宇宙广播,消耗1), st_005(等级2打击,消耗2), ...]

其他玩家: {Player_1: 3张牌,位置隐藏,能量4; Player_3: 2张牌,星系5,能量6}

飞行打击: [st_003(Player_1发射,星系2→星系3,等级2,速度1,飞行中)]

[可用动作]
play_card - 打出手牌
end_turn - 结束回合

请返回 JSON 格式的操作指令。
```

## 安全机制

### 预校验拦截
AI 的每个操作在发送给游戏服务器前都会经过本地预校验：
- 检查打出的牌是否在手牌中
- 检查打击牌是否存在且属于自己
- 检查目标星系是否合法
- ...

### 幻觉处理
如果预校验失败，拦截操作并 fallback 到结束回合。

### JSON 解析容错
支持三种解析策略：
1. 直接解析纯 JSON
2. 提取 Markdown 代码块中的 JSON
3. 提取第一个 `{` 到最后一个 `}`

## 测试

### 联调测试（分阶段验证）

```bash
# 阶段 1：连接与登录
uv run pytest tests/test_integration.py -v -k stage1

# 阶段 2：匹配系统（需要其他玩家在线）
uv run pytest tests/test_integration.py -v -k stage2

# 阶段 3：完整游戏流程（Mock LLM，推荐先用这个）
uv run pytest tests/test_integration.py -v -k stage3

# 阶段 4：真实 LLM 对局
uv run pytest tests/test_integration.py -v -k stage4
```

### 多 AI 对战（无需真人玩家）

```bash
# 启动 4 个 AI 互相匹配（Mock LLM，快速测试游戏流程）
make multi-ai

# 启动 3 个 AI 使用真实 LLM
uv run darkforest-multi-ai --count 3
```

### 日志级别
修改 `config.py` 中的 `LOG_LEVEL` 环境变量：
- `DEBUG` - 详细调试信息（含 LLM 原始回复）
- `INFO` - 正常日志
- `WARNING` - 仅警告

### CLI 调试工具
另开终端运行：
```bash
make debug
```

实时监控游戏事件流。

### CLI 输出示例
```
2024-04-11 10:00:00 [INFO] 🌌 黑暗森林 AI Agent 启动
2024-04-11 10:00:00 [INFO]   游戏服务器: http://localhost:3003
2024-04-11 10:00:00 [INFO]   LLM 服务: http://127.0.0.1:8900/v1
2024-04-11 10:00:01 [INFO] ✅ 已连接到游戏服务器
2024-04-11 10:00:01 [INFO] 🔑 尝试登录: AI-文明 (ai_3847)
2024-04-11 10:00:02 [INFO] 🎮 登录成功! 玩家 ID: p2
2024-04-11 10:00:15 [INFO] 🤖 AI 正在思考...
2024-04-11 10:00:20 [INFO] LLM 响应时间: 5.23秒
2024-04-11 10:00:20 [INFO] 🎯 AI 决策: play_card({"action": "play_card", "card_uid": "fa_008"})
2024-04-11 10:00:20 [INFO] 📤 发送操作: playCard({'cardUid': 'fa_008'})
2024-04-11 10:00:20 [INFO] ✅ 操作成功: playCard
```

## 作为库使用

本项目采用 src 布局，可以作为 Python 库导入：

```python
from darkforest_ai import AIAgent, GameState, PromptBuilder, LLMEngine, ActionValidator

# 自定义 AI Agent
agent = AIAgent()
await agent.run()
```

## 后续优化方向

- [ ] 记忆压缩：历史摘要 + 最近 N 轮详情
- [ ] 策略增强：根据游戏阶段动态调整 Prompt 策略
- [ ] CLI 调试工具增强：实时查看 Prompt/决策/指令链
- [ ] 多 AI 对战：同时运行多个 AI Agent 互相对战

## 开发规范

### 代码风格

- 使用 Ruff 进行代码格式化和检查
- 行长度限制：100 字符
- 遵循 PEP 8 规范
- 提交前自动运行 pre-commit 钩子

### 测试规范

- 测试文件放在 `tests/` 目录
- 测试文件命名：`test_*.py`
- 测试函数命名：`test_*`
- 使用 pytest fixtures 共享测试数据
