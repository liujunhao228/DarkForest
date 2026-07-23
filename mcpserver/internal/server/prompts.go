package server

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// prompts.go 注册 2 个叙述型知识 Prompt,供 Agent 在对局不同阶段查询。
//
// 设计意图(Spec 决策):静态知识采取 Resource(数据型)+ Prompt(叙述型)混用。
// Prompt 用于"决策思维框架"型知识——非结构化、含上下文关联、引导 Agent 关注
// 关键决策维度(如位置推断、打击威胁、能量管理)。
//
// 与 Resource 的分工:
//   - Resource: 结构化常量(星图/卡牌库/机制规则),按 URI 寻址,Agent 按需读取
//   - Prompt:   决策框架与对局阶段提示,Agent 主动调用获取"如何思考"的引导
//
// 2 个 Prompt(均无参数,纯静态文本):
//   1. game_overview   — 游戏目标、回合结构、三大机制速览(对局开始前阅读)
//   2. strategy_primer — 决策思维框架,含位置推断提示(每回合开始前回顾)
//
// 文本约束(对齐 Spec 与 semantic.strikeForbiddenWords):
//   - 中文事实陈述,禁用"建议/应当/推荐/可以/不妨/最好/应该/需要/务必"等行动指导词
//   - MCP 不是 Agent 赢游戏的"外挂",辅助水平与前端客户端相当
//
// 注册策略:Prompt 是静态知识,不依赖 GameSession/Account 状态,放在 server 包内最简洁。
// RegisterPrompts 由编排者在 server.go 中调用(本文件不修改 server.go)。

// promptForbiddenWords 是 Prompt 文本禁用的行动指导词,与 semantic.strikeForbiddenWords
// 保持同一份词表(语义包未导出该列表,此处镜像)。
var promptForbiddenWords = []string{
	"建议", "应当", "推荐", "可以", "不妨", "最好", "应该", "需要", "务必",
}

// RegisterPrompts 注册所有叙述型知识 Prompt 到 MCP Server。
// 本函数仅注册 Prompt,不依赖 session/account,由编排者在 server.go 中调用。
//
// 注意:本函数不修改 server.go,注册行由编排者统一添加。
func RegisterPrompts(server *mcp.Server) {
	registerGameOverviewPrompt(server)
	registerStrategyPrimerPrompt(server)
}

// --- 1. game_overview ---

// registerGameOverviewPrompt 注册"游戏概览"Prompt。
// 内容:游戏目标、回合结构、三大核心机制(打击/广播/光速飞船)速览、文明遗迹模式简介。
// 适合 Agent 在对局开始前调用,建立基础认知。
func registerGameOverviewPrompt(server *mcp.Server) {
	server.AddPrompt(
		&mcp.Prompt{
			Name:        "game_overview",
			Description: "黑暗森林卡牌策略游戏概览:游戏目标、回合结构、三大核心机制(打击/广播/光速飞船)速览。适合游戏开始前阅读建立基础认知。",
		},
		func(_ context.Context, _ *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			return &mcp.GetPromptResult{
				Description: "黑暗森林 — 游戏概览",
				Messages: []*mcp.PromptMessage{
					{
						Role:    "user",
						Content: &mcp.TextContent{Text: gameOverviewText},
					},
				},
			}, nil
		},
	)
}

// gameOverviewText 是 game_overview Prompt 的完整文本。
// 章节:游戏目标 / 回合结构 / 三大核心机制(打击/广播/光速飞船) / 文明遗迹模式 / 进一步阅读。
const gameOverviewText = `# 黑暗森林 — 游戏概览

## 游戏目标
在 9 星系星图中存活到最后。通过打击淘汰对手、通过广播合作或伪装、通过光速飞船跃迁改变位置。最后未淘汰的玩家获胜。

## 回合结构
- 每回合分 5 个阶段:turnBegin → strikeMovement → drawPhase → actionPhase → turnEnd
- strikeMovement:所有飞行打击按 speed 移动一跳
- drawPhase:当前玩家抽 1 张牌
- actionPhase:当前玩家执行 1 个动作(出牌/打击/部署设施/光速飞船/回收/结束回合)
- 3/4/5 人模式,按颜色顺序轮流行动

## 三大核心机制

### 打击(Strike)
- 5 类打击卡:热核(Lv1)/光粒(Lv2)/湮灭(Lv3)/降维(Lv4)/科技锁死(特殊)
- 逐跳：打击从发起者星球出发,每回合按 speed 移动/飞行相应跳数,抵达目标星系后判定
- 直接：打击直接出现目标星球，即刻判定
- 判定：
  - 降维打击(Lv4):无视防御直接淘汰目标星系玩家
  - 科技锁死(Lv4):无视防御,弃置目标玩家全部手牌
  - 光粒/湮灭(Lv2/Lv3):无论是否被防御,均摧毁恒星
  - 普通打击:比对 level vs protectionLevel,穿透则淘汰,未穿透则被防御挡住
- 飞行途中支持 retarget(重新指定目标星系)
- Classic 模式为直接打击;Relics 模式为逐跳飞行打击

### 广播(Broadcast)
- 2 类:合作(cooperation)/伪装(disguise)
- 3 种范围:恒星广播(range 1)/宇宙广播(range 2)/超距广播(range ∞)
- 流程:发起者出牌 → 范围内其他玩家响应 → 发起者选择响应者 → 揭示
- 双方合作:各获得 3 能量
- 伪装方合作 + 对方合作:伪装方获得 5 能量
- 双方伪装:无人获得能量

### 光速飞船(Lightspeed Ship)
- Classic 模式:一次性使用,10 能量随机跃迁(位置不公开),飞船用后弃置
- Relics 模式:部署 10 能量后可多次使用,随机跃迁 3 能量(位置不公开),飞船保留,其他设施遗留原星系(由其他玩家继承)
- random 跃迁位置不公开

## 文明遗迹模式(Civilization Relics)
- 在 Classic 基础上增加遗迹系统
- 星图分布遗迹,光速飞船跃迁至遗迹星系触发发现
- 遗迹含能量与设施,到达有遗留物的星系时继承能量与设施
- 继承时可选是否广播(BroadcastOnInherit)

## 进一步阅读
- 星图拓扑:starmap://topology
- 卡牌库:cards://library
- 模式规则:rules://mode/classic 或 rules://mode/civilization_relics
- 机制详情:rules://mechanism/{strike|broadcast|lightspeed|relic}
`

// --- 2. strategy_primer ---

// registerStrategyPrimerPrompt 注册"决策思维框架"Prompt。
// 内容:回合开始清单、位置推断(关键能力)、打击/广播/光速飞船/能量决策维度、进一步阅读。
// 适合 Agent 在每回合开始前调用,快速回顾决策框架。
//
// 位置推断段落为 Spec 硬约束,4 个核心要点:
//  1. 对手位置不会直接展示
//  2. 信息隐藏在零散事件中(打击发起星系/广播发起星系/光速飞船公开跃迁等)
//  3. MCP 不提供服务端推断(PositionView 不含 inferredFoePositions)
//  4. Agent 自行维护对手位置推断
func registerStrategyPrimerPrompt(server *mcp.Server) {
	server.AddPrompt(
		&mcp.Prompt{
			Name:        "strategy_primer",
			Description: "决策思维框架:何时打击/广播/跃迁、如何管理能量与手牌、如何推断对手位置。适合每回合开始前快速回顾。",
		},
		func(_ context.Context, _ *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			return &mcp.GetPromptResult{
				Description: "黑暗森林 — 决策思维框架",
				Messages: []*mcp.PromptMessage{
					{
						Role:    "user",
						Content: &mcp.TextContent{Text: strategyPrimerText},
					},
				},
			}, nil
		},
	)
}

// strategyPrimerText 是 strategy_primer Prompt 的完整文本。
// 章节:回合开始清单 / 位置推断(关键能力) / 打击决策 / 广播决策 / 光速飞船决策 /
// 能量管理 / 进一步阅读。
//
// 位置推断段落为 Spec 硬约束,明确告知 Agent:
//   - 对手位置不直接展示
//   - 信息隐藏在零散事件中
//   - MCP 不提供服务端推断(PositionView 不含 inferredFoePositions)
//   - Agent 自行维护对手位置推断矩阵
const strategyPrimerText = `# 黑暗森林 — 决策思维框架

## 回合开始清单
1. 调用 get_agent_view 获取完整视图(自己/对手/场景/事件/光标)
2. 检查 cursor.pendingAction:若非空,是强制挂起动作,优先处理
3. 调用 get_affordances 获取当前合法动作集(legalTargets 是权威目标列表)
4. 调用 get_recent_delta 理解上一回合发生了什么

## 位置推断(关键能力)

**对手位置不会直接展示**——只有以下情况位置已知:
- 广播相关交互会暴露位置范围
- 对手用光速飞船公开跃迁,新位置公开
- 对手发起打击,打击的初始位置即为发出者位置(FlyingStrike.Position)

**信息隐藏在零散事件中**:
- 打击发起星系 → 对手曾在该星系(但可能已移动)
- 广播发起星系 → 对手在广播范围内
- 光速飞船公开跃迁 → 对手新位置公开
- 打击当前位置 → 打击从此星系出发

**MCP 不提供服务端推断**(PositionView 不含 inferredFoePositions)。Agent 自行维护对手位置推断矩阵,结合事件日志(get_agent_view 的 events 域)和历史广播/打击记录综合判断。

## 打击决策
- 出打击前:检查 strike_view.outbound 的 etaTurns(多少回合抵达)和 threatLevel(对方防御等级)
- 入站打击:检查 strike_view.inbound 的 etaTurns 和 threatLevel,决定是否光速飞船逃离 / 部署防御 / 接受淘汰
- 高威胁(threatLevel=high):对方防御不足以挡住,淘汰风险大
- 低威胁(threatLevel=low):对方有防御,打击大概率被挡

## 广播决策
- 合作广播:双方合作, 各获得 3 能量;置信度低的合作潜台词
- 伪装广播:对方合作时,伪装方获得 5 能量;双方伪装时,无人获得能量；拒绝/挑衅的潜台词
- 广播范围:恒星(range 1,1 跳内)/宇宙(range 2,2 跳内)/超距(∞,全部)
- 其他玩家借广播范围推断你的位置

## 光速飞船决策
- Classic 模式:一次性,随机 10 能量(位置不公开) / 指定 13 能量(位置公开)
- Relics 模式:部署 10 能量后可多次使用,随机跃迁 3 能量(位置不公开) / 指定跃迁 5 能量(位置公开),飞船保留,其他设施遗留原星系(由其他玩家继承)
- 到达有遗留物的星系时继承能量与设施

## 能量管理
- 设施产出能量(facility_solar_array +1/回合,facility_dyson_sphere +3/回合)
- 打击消耗能量(热核 4 / 光粒 6 / 湮灭 8 / 降维 10)
- 光速飞船消耗能量(Classic 10 随机/13 指定;Relics 部署 10,跃迁 3 随机/5 指定)
- 平衡:积累能量 vs 主动出击 vs 防御部署

## 进一步阅读
- 机制详情:rules://mechanism/{strike|broadcast|lightspeed|relic}
- 卡牌详情:get_card_detail(defId)
- 当前合法动作:get_affordances
`
