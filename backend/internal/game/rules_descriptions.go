package game

// ============================================================================
// rules_descriptions.go — 玩家向文案集中存放
//
// 本文件不包含任何游戏逻辑，仅承载面向玩家的展示文案。
// 文案变更（措辞调整、新增模式描述、i18n 扩展）应只动本文件，
// 不应触动 mode_rules.go 中的规则常量。
// ============================================================================

// ruleConfigNames 每个 config key 对应的玩家向概念名。
// 旧的配置项名（如"光速飞船一次性"）仅开发者理解；此处改为玩家直接可读的概念名。
var ruleConfigNames = map[string]string{
	"lightspeed.one_time":           "光速飞船使用方式",
	"lightspeed.deploy_cost":        "光速飞船部署能量",
	"lightspeed.random_cost":        "随机跃迁成本",
	"lightspeed.specified_cost":     "指定跃迁成本",
	"lightspeed.carry_cap":          "跃迁携带能量上限",
	"lightspeed.message_enabled":    "跃迁留言",
	"relic.distribution_enabled":    "遗迹分布",
	"strike.origin":                 "打击出现位置",
	"strike.miss_behavior":          "打击落空处理",
	"strike.can_destroy_relic":      "打击遗留物命中",
}

// ruleConfigDescriptions 每个 config 在特定 (mode, value) 组合下的玩家文案。
// key 为 "configKey" → map["{mode}:{value}"] → 玩家向完整说明。
//
// mode:value 二维 key 的设计理由：
//   - 同一值在不同模式下的语义可能不同（如 random_cost=10 在 classic 是总成本，在 relics 无意义）
//   - 为后续"自定义房间"自由配置取值预留扩展点
//   - 缺失时退化到 valueTemplate 模板渲染兜底
var ruleConfigDescriptions = map[string]map[string]string{
	"lightspeed.one_time": {
		"classic.true":             "光速飞船从手牌直接发动跃迁，跃迁后进入弃牌堆。每次使用都需重新抽到该卡。",
		"classic.false":            "（本模式不适用）",
		"civilization_relics.true": "（本模式不适用）",
		"civilization_relics.false": "光速飞船需先以 10 能量部署到设施区，跃迁后保留在设施区，可多次发动跃迁。",
	},
	"lightspeed.deploy_cost": {
		"classic.0":              "本模式光速飞船无需部署，直接从手牌发动跃迁。",
		"civilization_relics.10": "光速飞船需先消耗 10 能量部署到设施区，之后才能发动跃迁。",
	},
	"lightspeed.random_cost": {
		"classic.10":                       "从手牌直接发动随机跃迁的总能量消耗。跃迁至随机无玩家星系，位置不公开。",
		"civilization_relics.3":            "飞船部署后，每次随机跃迁额外消耗 3 能量（不含部署成本 10）。跃迁至随机无玩家星系，位置不公开。",
	},
	"lightspeed.specified_cost": {
		"classic.13":            "从手牌直接发动指定跃迁的总能量消耗。跃迁至指定星系，位置公开。",
		"civilization_relics.5": "飞船部署后，每次指定跃迁额外消耗 5 能量（不含部署成本 10）。跃迁至指定星系，位置公开。",
	},
	"lightspeed.carry_cap": {
		"classic.0": "跃迁后玩家能量归零，无法携带任何能量到新星系。",
		"civilization_relics.5": "跃迁最多可携带 5 点能量到新星系，超出部分留在原星系作为遗留物。",
	},
	"lightspeed.message_enabled": {
		"classic.false":               "本模式跃迁时不支持附带留言。",
		"classic.true":                "（本模式不适用）",
		"civilization_relics.true":    "跃迁时可附带不超过 10 字符的留言，需额外支付 1 能量。留言内容会随跃迁事件记录在日志中。",
		"civilization_relics.false":   "（本模式不适用）",
	},
	"relic.distribution_enabled": {
		"classic.false":            "本模式不在星系中分布遗迹。",
		"classic.true":             "（本模式不适用）",
		"civilization_relics.true": "游戏开始时，在非玩家起始星系按概率分布预设遗迹组合（弱 60% / 中 30% / 强 10%），玩家跃迁到达时可继承其中的能量与设施。",
		"civilization_relics.false": "（本模式不适用）",
	},
	"strike.origin": {
		"classic.direct":                        "打击直接在目标星系出现并立即结算，没有飞行过程。",
		"civilization_relics.ownerPlanet":        "打击从发射者星球出发，沿星图航线逐跳移动到目标星系后结算。所有玩家可见飞行路径。",
	},
	"strike.miss_behavior": {
		"classic.discard":              "打击落空后进入弃牌堆，本回合不再生效。",
		"civilization_relics.discard":  "打击落空后进入弃牌堆，本回合不再生效。",
	},
	"strike.can_destroy_relic": {
		"classic.false":              "打击仅在目标星系有玩家时生效，命中遗留物/遗迹视为落空。",
		"classic.true":               "（本模式不适用）",
		"civilization_relics.true":   "打击命中目标星系的任何遗留物（遗迹或玩家跃迁遗留）均视为有效命中并消耗打击。科技锁死不参与此结算。",
		"civilization_relics.false":  "（本模式不适用）",
	},
}

// ruleConfigValueLabels 布尔/枚举值的玩家友好标签。
// 前端用于在对比表中显示单元格标签（替代纯符号化的 ✓/✗ 或裸枚举标识符）。
var ruleConfigValueLabels = map[string]map[string]string{
	"lightspeed.one_time":        {"true": "一次性消耗", "false": "可复用设施"},
	"lightspeed.message_enabled": {"true": "支持留言", "false": "不支持留言"},
	"relic.distribution_enabled": {"true": "已启用", "false": "未启用"},
	"strike.can_destroy_relic":   {"true": "可命中遗留物", "false": "仅命中玩家"},
}

// ruleConfigValueTemplates 自定义房间改值时的兜底渲染模板。
// 当用户自定义的值在 descriptions map 中没有精确匹配时，
// 前端可用此模板 + strings.ReplaceAll 渲染描述。
var ruleConfigValueTemplates = map[string]string{
	"lightspeed.deploy_cost":    "部署光速飞船需消耗 {value} 能量",
	"lightspeed.random_cost":    "随机跃迁消耗 {value} 能量",
	"lightspeed.specified_cost": "指定跃迁消耗 {value} 能量",
	"lightspeed.carry_cap":      "跃迁最多可携带 {value} 能量到新星系",
}

// ruleConfigEnumOptions 枚举类型的可选值列表（含玩家标签和独立说明）。
// 替代旧版只包含开发者标识符的 enumValues 数组。
var ruleConfigEnumOptions = map[string][]EnumOption{
	"strike.origin": {
		{ID: "direct", Label: "即刻判定", Description: "打击直接在目标星系出现并立即结算，没有飞行过程。"},
		{ID: "ownerPlanet", Label: "逐跳飞行", Description: "打击从发射者星球出发，沿星图航线逐跳移动到目标星系后结算。所有玩家可见飞行路径。"},
		{ID: "stealthOwnerPlanet", Label: "隐式飞行", Description: "同逐跳飞行，但飞行路径仅发射者可见；其他玩家只能看到打击当前位置到目标的剩余距离。"},
	},
	"strike.miss_behavior": {
		{ID: "discard", Label: "废弃", Description: "打击落空后进入弃牌堆，本回合不再生效。"},
		{ID: "freeControl", Label: "自由控制", Description: "打击保留为落空状态，玩家可重新指定目标、跳过移动或主动废弃。"},
		{ID: "requireTarget", Label: "必须重定向", Description: "打击保留为落空状态，玩家必须为其指定新目标或废弃。"},
	},
}

// ruleConfigLegacyDescriptions 每个 config 的旧版混用描述（标注弃用）。
// 保留仅用于前端平滑迁移，新前端代码应忽略。
var ruleConfigLegacyDescriptions = map[string]string{
	"lightspeed.one_time":           "若为 true，光速飞船从手牌一次性跃迁后进弃牌堆；若为 false，需先部署再跃迁，飞船保留可复用（已弃用）",
	"lightspeed.deploy_cost":        "文明遗迹模式下部署飞船到设施区所需的能量；经典模式下无需部署，恒为 0（已弃用）",
	"lightspeed.random_cost":        "经典：一次性总成本；遗迹：部署后额外跃迁成本（已弃用）",
	"lightspeed.specified_cost":     "经典：一次性总成本；遗迹：部署后额外跃迁成本（已弃用）",
	"lightspeed.carry_cap":          "跃迁可携带的能量最大值，0 表示跃迁后能量归零（已弃用）",
	"lightspeed.message_enabled":    "是否允许跃迁时留言（额外 1 能量，≤10 字符）（已弃用）",
	"relic.distribution_enabled":    "是否在非起始星系按概率分布预设遗迹组合（已弃用）",
	"strike.origin":                 "direct=目标星系即刻判定；ownerPlanet=从发射者星球逐跳飞行；stealthOwnerPlanet=隐逐跳（已弃用）",
	"strike.miss_behavior":          "discard=废弃；freeControl=保留可自由操作；requireTarget=必须重定向（已弃用）",
	"strike.can_destroy_relic":      "是否允许打击命中遗留物/遗迹并将其视为有效命中（已弃用）",
}

// gameConstantDescriptions 每个常量的玩家向描述（含 name / value / unit / description）。
var gameConstantDescriptions = []GameConstantItem{
	{Key: "totalCards",                Name: "总卡牌数",     Value: 72,  Unit: "张", Description: "本局游戏使用的卡牌总数（含全部类型）"},
	{Key: "initialHand",               Name: "初始手牌数",   Value: 4,   Unit: "张", Description: "游戏开始时每位玩家抽取的手牌数量"},
	{Key: "handLimit",                 Name: "手牌上限",     Value: 4,   Unit: "张", Description: "回合结束时手牌数量的上限，超出必须弃牌"},
	{Key: "initialEnergy",             Name: "初始能量",     Value: 3,   Unit: "点", Description: "每位玩家游戏开始时获得的能量"},
	{Key: "baseEnergyPerTurn",         Name: "回合基础能量", Value: 1,   Unit: "点", Description: "每回合开始时玩家自动获得的基础能量"},
	{Key: "maxPlayers",                Name: "最大玩家数",   Value: 5,   Unit: "人", Description: "单局游戏允许的最大玩家数量"},
	{Key: "eliminationEnergyPerAlive", Name: "淘汰奖励系数", Value: 3,   Unit: "点", Description: "淘汰一名玩家时，按当前存活玩家数乘以此值奖励能量给攻击者"},
	{Key: "broadcastCooldownTurns",    Name: "广播冷却轮数", Value: 2,   Unit: "轮", Description: "同一星系两次广播之间必须间隔的最少轮数"},
	{Key: "broadcastRefundOnMiss",     Name: "广播退还能量", Value: 1,   Unit: "点", Description: "广播无人回应或被取消时退还给发起者的能量"},
	{Key: "recycleRefundRatio",        Name: "回收返还比例", Value: 0.5, Unit: "",   Description: "回收设施时返还建造能量的比例（向下取整），例如 6 能量设施回收返还 3 能量"},
}

// modePresetDescriptions 游戏模式的预设名称与描述（玩家向）。
// buildModePresets() 按固定顺序（classic 在前）从此 map 取值，保证 API 输出顺序不变。
var modePresetDescriptions = map[string]ModePreset{
	"classic": {
		ID:          "classic",
		Name:        "经典模式",
		Description: "快速直接的星际博弈，打击即刻判定，光速飞船一次性使用",
	},
	"civilization_relics": {
		ID:          "civilization_relics",
		Name:        "文明遗迹模式",
		Description: "打击需要飞行到达，星系间散布远古文明遗迹，光速飞船可复用并支持留言",
	},
}

// mechanismDescriptions 各游戏机制的玩家向说明文案。
// exportMechanisms() 从此取描述，结构数据（phases / originModes / starDependentFacilities 等）保留在 rules_export.go。
var mechanismDescriptions = struct {
	Broadcast    string
	Strike       string
	Settlement   string
	WinCondition string
}{
	Broadcast:    "向目标星系发送广播信号，目标星系内的玩家可选择回应或伪装。双方均选择合作则各获得 3 能量；一方伪装则伪装方获得 5 能量，另一方 0 能量；双方均伪装则均不得能量。",
	Strike:       "向目标星系发动打击，可摧毁目标玩家或恒星。打击等级决定其是否可被防御牌防护。",
	Settlement:   "每回合开始时，玩家已部署的设施产出能量。部分设施（太阳能阵列、戴森球）依赖恒星，恒星被毁灭后无法产出。",
	WinCondition: "最后存活的玩家获胜。当其他玩家全部被淘汰时，游戏结束。",
}
