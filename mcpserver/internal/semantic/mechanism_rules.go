package semantic

// mechanism_rules.go 提供 4 大核心机制(strike/broadcast/lightspeed/relic)
// 的规则说明文本,供 rules://mechanism/{name} Resource 消费。
//
// 设计理由:机制规则是事实陈述型静态知识,与卡牌定义、模式规则同属
// "Agent 决策所需的常量背景"。集中放在 semantic 包内,便于:
//   - 与卡牌库、模式规则同包引用,避免循环依赖
//   - 单测验证文本内容(确保事实陈述、禁用行动指导词)
//   - Resource handler 仅做 URI 路由,文本内容由 semantic 包维护
//
// 文本约束(对齐 Spec):
//   - 中文事实陈述,禁用"建议/应当/推荐/可以/不妨/最好/应该/需要/务必"等行动指导词
//   - 字段名与后端 game 包对齐,便于 Agent 关联 gamesdk.ViewState 字段

// MechanismStrike 是打击机制的规则说明文本。
// 覆盖:5 类打击卡、飞行移动、ETA 计算、模式差异、落空处理。
const MechanismStrike = `打击机制(Strike)

打击卡是飞行打击的载体,从发起者所在星系(Relics 模式)或目标星系(Classic 模式)出发,沿星图边飞行,到达目标星系后判定。

5 类打击卡(按威胁等级 level 排序):
1. 热核打击(strike_thermal, Lv.1, 4 能量, 4 张):无特殊效果,被掩体星环防御后无效
2. 光粒打击(strike_light_particle, Lv.2, 6 能量, 4 张):无论是否被防御,均毁灭目标星系恒星
3. 湮灭打击(strike_annihilation, Lv.3, 8 能量, 3 张):无论是否被防御,均毁灭目标星系恒星及所有建设牌
4. 降维打击(strike_dimensional, Lv.4, 10 能量, 3 张):彻底清除目标星系
5. 科技锁死(strike_tech_lock, Lv.4, 4 能量, 3 张):无视防御,打击生效时,目标玩家立即弃掉全部手牌

移动规则:
- speed=1,每回合移动 1 跳(沿星图边)
- ETA 由 BFS 最短距离决定:距离 N 的目标 ETA=N 回合
- 飞行中打击在 strikeMovement 回合阶段移动

模式差异(StrikeOrigin):
- Classic(direct):打击直接在 TargetSystem 出现并即刻判定
- Relics(ownerPlanet):打击从 owner 星球出现,逐跳飞行到达 TargetSystem 后判定

落空处理(StrikeMissBehavior):
- Classic / Relics 均为 discard:TargetSystem 无目标玩家时,打击牌废弃到弃牌堆
`

// MechanismBroadcast 是广播机制的规则说明文本。
// 覆盖:合作/伪装两类、3 种范围、响应阶段、响应规则、物理牌数量。
const MechanismBroadcast = `广播机制(Broadcast)

广播卡用于与目标星系内的其他玩家互动,分两类 subtype:
- cooperation(合作):双方均选择合作时,各获得 3 能量
- disguise(伪装):伪装方在对方合作时获得 5 能量

3 种范围(range):
- 恒星广播(range=1):目标星系距离 1 以内,0 能量消耗
- 宇宙广播(range=2):目标星系距离 2 以内,1 能量消耗
- 超距广播(range=1000):无视距离,目标任意星系,2 能量消耗

响应阶段(BroadcastPhase):
1. waiting:等待响应者回应
2. select:广播方选择响应者(多个响应者时)
3. reveal:揭示响应结果

响应规则:
- 目标星系内的其他玩家为响应者（广播者自身不作为响应者）
- 允许向自身所在星系广播:若自身星系无其他玩家,触发"无人回应"分支,消耗广播卡换 1 点能量;若有其他玩家,其他玩家照常作为响应者
- 合作广播:响应者选择同意/拒绝,双方同意则各得 3 能量
- 伪装广播:响应者选择同意/拒绝,响应者同意则伪装方得 5 能量
- 监听基地(facility_monitoring_station)所在星系接收广播后不强制回应

物理牌数量:
- 恒星广播:合作 9 张 + 伪装 5 张 = 14 张
- 宇宙广播:合作 6 张 + 伪装 4 张 = 10 张
- 超距广播:合作 2 张 + 伪装 2 张 = 4 张
`

// MechanismLightspeed 是光速飞船机制的规则说明文本。
// 覆盖:跃迁方式、一次性 vs 多次(按模式)、能量消耗、目标星系、留言机制。
const MechanismLightspeed = `光速飞船机制(Lightspeed Ship)

光速飞船(facility_lightspeed_ship, 10 能量, 2 张)是逃生设施,玩家遭遇毁灭性打击时跃迁到其他星系。模式差异显著:

Classic 模式(LightspeedUsage=oneTime):
- 一次性牌,从手牌直接跃迁,跃迁后进弃牌堆
- 消耗 10 能量(LightspeedCombinedActionCost),跃迁至随机无文明星系,位置不公开
- 不携带能量(LightspeedCarryCap=0),无留言(LightspeedMessageEnabled=false)
- 余下能量与设施遗留或销毁

Relics 模式(LightspeedUsage=reusable):
- 飞船保留,多次使用
- 部署成本 10 能量(LightspeedDeployCost)
- 消耗 3 能量(LightspeedJumpCost),跃迁至随机无文明星系,位置不公开
- 携带能量上限 5(LightspeedCarryCap)
- 启用留言(LightspeedMessageEnabled=true),留言消耗 +1 能量

目标星系:
- 跃迁目标为星图中任意非当前星系、未被其他玩家占用的星系(已摧毁星系允许跃迁)
- 跃迁不依赖星图边的连通性,无视距离
`

// MechanismRelic 是遗迹机制的规则说明文本(仅 Relics 模式)。
// 覆盖:发现、继承、能量/设施继承规则、遗迹分布。
const MechanismRelic = `遗迹机制(Relic,仅 Relics 模式)

遗迹(Relic)是星系中遗留的古老设施,Relics 模式(RelicDistributionEnabled=true)专属机制。

发现:
- 玩家跃迁或移动到含遗迹的星系时,触发遗迹发现(RelicDiscovery)
- 遗迹信息(名称 Name、传说 Lore)仅对发现者私有揭示
- 公共日志仅记录"发现遗迹"事件,不暴露遗迹详情

继承:
- 玩家离开星系(光速飞船跃迁)时,余下能量与设施遗留为 StarLeftover
- 其他玩家到达该星系时继承遗留物
- 继承时触发 RelicDiscovery 私有揭示:
  - IsRelic=true:遗迹继承,揭示 Name/Lore
  - IsRelic=false:光速飞船遗留物继承,仅揭示 Energy 与 FacilityNames

能量与设施继承规则:
- 遗留能量(Energy)归继承者所有
- 遗留设施(Facilities)归继承者所有
- 光速飞船遗留时,BroadcastOnInherit 控制是否广播继承事件:
  - true:公共日志记录继承
  - false:私有继承,不公开

遗迹分布:
- Relics 模式开局时,遗迹随机分布在星图中(RelicDistributionEnabled=true)
- Classic 模式无遗迹(RelicDistributionEnabled=false)
`

// mechanismTexts 把机制名映射到规则文本,供 Resource handler 查询。
var mechanismTexts = map[string]string{
	"strike":     MechanismStrike,
	"broadcast":  MechanismBroadcast,
	"lightspeed": MechanismLightspeed,
	"relic":      MechanismRelic,
}

// GetMechanismRule 按 name 返回对应机制的规则说明文本。找到返回 (text, true),否则返回空串与 false。
// name 取值: strike / broadcast / lightspeed / relic。
func GetMechanismRule(name string) (string, bool) {
	text, ok := mechanismTexts[name]
	return text, ok
}

// ListMechanismNames 返回全部机制名(4 个:strike/broadcast/lightspeed/relic)。
// 用于 Resource 消费者枚举所有可查询的机制。
func ListMechanismNames() []string {
	return []string{"strike", "broadcast", "lightspeed", "relic"}
}
