import { CARD_DEFINITIONS } from '@/lib/game/cards';
import { STAR_NODES, STAR_EDGES } from '@/lib/game/starmap';
import type {
  AllRulesResponse,
  GameConstantItem,
  GameMechanisms,
  ModePreset,
  RelicComboExport,
  RuleConfig,
} from '@/api/rules';

// ============================================================================
// 静态兜底数据 — 当后端 /api/game/rules 不可用时使用
//
// 内容与后端 backend/internal/game/rules_descriptions.go + relic_combos.go 严格对齐。
// 修改时务必同步后端文件，避免前后端文案漂移。
// ============================================================================

/** 兜底模式预设 */
export const FALLBACK_MODE_PRESETS: ModePreset[] = [
  {
    id: 'classic',
    name: '经典模式',
    description: '快速直接的星际博弈，打击即刻判定，光速飞船一次性使用',
  },
  {
    id: 'civilization_relics',
    name: '文明遗迹模式',
    description: '打击需要飞行到达，星系间散布远古文明遗迹，光速飞船可复用并支持留言',
  },
];

/** 兜底规则配置项（与后端 ruleConfigDescriptions / ruleConfigValueLabels / ruleConfigValueTemplates / ruleConfigEnumOptions 一致） */
export const FALLBACK_RULE_CONFIGS: RuleConfig[] = [
  {
    key: 'lightspeed.one_time',
    name: '光速飞船使用方式',
    legacyDescription: '若为 true，光速飞船从手牌一次性跃迁后进弃牌堆；若为 false，需先部署再跃迁，飞船保留可复用（已弃用）',
    type: 'boolean',
    category: 'lightspeed',
    values: { classic: true, civilization_relics: false },
    valueLabels: { true: '一次性消耗', false: '可复用设施' },
    descriptions: {
      'classic.true': '光速飞船从手牌直接发动跃迁，跃迁后进入弃牌堆。每次使用都需重新抽到该卡。',
      'classic.false': '（本模式不适用）',
      'civilization_relics.true': '（本模式不适用）',
      'civilization_relics.false': '光速飞船需先以 10 能量部署到设施区，跃迁后保留在设施区，可多次发动跃迁。',
    },
  },
  {
    key: 'lightspeed.deploy_cost',
    name: '光速飞船部署能量',
    legacyDescription: '文明遗迹模式下部署飞船到设施区所需的能量；经典模式下无需部署，恒为 0（已弃用）',
    type: 'integer',
    category: 'lightspeed',
    unit: '能量',
    values: { classic: 0, civilization_relics: 10 },
    valueTemplate: '部署光速飞船需消耗 {value} 能量',
    descriptions: {
      'classic.0': '本模式光速飞船无需部署，直接从手牌发动跃迁。',
      'civilization_relics.10': '光速飞船需先消耗 10 能量部署到设施区，之后才能发动跃迁。',
    },
  },
  {
    key: 'lightspeed.random_cost',
    name: '随机跃迁成本',
    legacyDescription: '经典：一次性总成本；遗迹：部署后额外跃迁成本（已弃用）',
    type: 'integer',
    category: 'lightspeed',
    unit: '能量',
    values: { classic: 10, civilization_relics: 3 },
    valueTemplate: '随机跃迁消耗 {value} 能量',
    descriptions: {
      'classic.10': '从手牌直接发动随机跃迁的总能量消耗。跃迁至随机无玩家星系，位置不公开。',
      'civilization_relics.3': '飞船部署后，每次随机跃迁额外消耗 3 能量（不含部署成本 10）。跃迁至随机无玩家星系，位置不公开。',
    },
  },
  {
    key: 'lightspeed.specified_cost',
    name: '指定跃迁成本',
    legacyDescription: '经典：一次性总成本；遗迹：部署后额外跃迁成本（已弃用）',
    type: 'integer',
    category: 'lightspeed',
    unit: '能量',
    values: { classic: 13, civilization_relics: 5 },
    valueTemplate: '指定跃迁消耗 {value} 能量',
    descriptions: {
      'classic.13': '从手牌直接发动指定跃迁的总能量消耗。跃迁至指定星系，位置公开。',
      'civilization_relics.5': '飞船部署后，每次指定跃迁额外消耗 5 能量（不含部署成本 10）。跃迁至指定星系，位置公开。',
    },
  },
  {
    key: 'lightspeed.carry_cap',
    name: '跃迁携带能量上限',
    legacyDescription: '跃迁可携带的能量最大值，0 表示跃迁后能量归零（已弃用）',
    type: 'integer',
    category: 'lightspeed',
    unit: '能量',
    values: { classic: 0, civilization_relics: 5 },
    valueTemplate: '跃迁最多可携带 {value} 能量到新星系',
    descriptions: {
      'classic.0': '跃迁后玩家能量归零，无法携带任何能量到新星系。',
      'civilization_relics.5': '跃迁最多可携带 5 点能量到新星系，超出部分留在原星系作为遗留物。',
    },
  },
  {
    key: 'lightspeed.message_enabled',
    name: '跃迁留言',
    legacyDescription: '是否允许跃迁时留言（额外 1 能量，≤10 字符）（已弃用）',
    type: 'boolean',
    category: 'lightspeed',
    values: { classic: false, civilization_relics: true },
    valueLabels: { true: '支持留言', false: '不支持留言' },
    descriptions: {
      'classic.false': '本模式跃迁时不支持附带留言。',
      'classic.true': '（本模式不适用）',
      'civilization_relics.true': '跃迁时可附带不超过 10 字符的留言，需额外支付 1 能量。留言内容会随跃迁事件记录在日志中。',
      'civilization_relics.false': '（本模式不适用）',
    },
  },
  {
    key: 'relic.distribution_enabled',
    name: '遗迹分布',
    legacyDescription: '是否在非起始星系按概率分布预设遗迹组合（已弃用）',
    type: 'boolean',
    category: 'relic',
    values: { classic: false, civilization_relics: true },
    valueLabels: { true: '已启用', false: '未启用' },
    descriptions: {
      'classic.false': '本模式不在星系中分布遗迹。',
      'classic.true': '（本模式不适用）',
      'civilization_relics.true': '游戏开始时，在非玩家起始星系按概率分布预设遗迹组合（弱 60% / 中 30% / 强 10%），玩家跃迁到达时可继承其中的能量与设施。',
      'civilization_relics.false': '（本模式不适用）',
    },
  },
  {
    key: 'strike.origin',
    name: '打击出现位置',
    legacyDescription: 'direct=目标星系即刻判定；ownerPlanet=从发射者星球逐跳飞行；stealthOwnerPlanet=隐逐跳（已弃用）',
    type: 'enum',
    category: 'strike',
    enumOptions: [
      { id: 'direct', label: '即刻判定', description: '打击直接在目标星系出现并立即结算，没有飞行过程。' },
      { id: 'ownerPlanet', label: '逐跳飞行', description: '打击从发射者星球出发，沿星图航线逐跳移动到目标星系后结算。所有玩家可见飞行路径。' },
      { id: 'stealthOwnerPlanet', label: '隐式飞行', description: '同逐跳飞行，但飞行路径仅发射者可见；其他玩家只能看到打击当前位置到目标的剩余距离。' },
    ],
    values: { classic: 'direct', civilization_relics: 'ownerPlanet' },
    descriptions: {
      'classic.direct': '打击直接在目标星系出现并立即结算，没有飞行过程。',
      'civilization_relics.ownerPlanet': '打击从发射者星球出发，沿星图航线逐跳移动到目标星系后结算。所有玩家可见飞行路径。',
    },
  },
  {
    key: 'strike.miss_behavior',
    name: '打击落空处理',
    legacyDescription: 'discard=废弃；freeControl=保留可自由操作；requireTarget=必须重定向（已弃用）',
    type: 'enum',
    category: 'strike',
    enumOptions: [
      { id: 'discard', label: '废弃', description: '打击落空后进入弃牌堆，本回合不再生效。' },
      { id: 'freeControl', label: '自由控制', description: '打击保留为落空状态，玩家可重新指定目标、跳过移动或主动废弃。' },
      { id: 'requireTarget', label: '必须重定向', description: '打击保留为落空状态，玩家必须为其指定新目标或废弃。' },
    ],
    values: { classic: 'discard', civilization_relics: 'discard' },
    descriptions: {
      'classic.discard': '打击落空后进入弃牌堆，本回合不再生效。',
      'civilization_relics.discard': '打击落空后进入弃牌堆，本回合不再生效。',
    },
  },
  {
    key: 'strike.can_destroy_relic',
    name: '打击遗留物命中',
    legacyDescription: '是否允许打击命中遗留物/遗迹并将其视为有效命中（已弃用）',
    type: 'boolean',
    category: 'strike',
    values: { classic: false, civilization_relics: true },
    valueLabels: { true: '可命中遗留物', false: '仅命中玩家' },
    descriptions: {
      'classic.false': '打击仅在目标星系有玩家时生效，命中遗留物/遗迹视为落空。',
      'classic.true': '（本模式不适用）',
      'civilization_relics.true': '打击命中目标星系的任何遗留物（遗迹或玩家跃迁遗留）均视为有效命中并消耗打击。科技锁死不参与此结算。',
      'civilization_relics.false': '（本模式不适用）',
    },
  },
];

/** 兜底游戏常量（与后端 gameConstantDescriptions 一致） */
export const FALLBACK_GAME_CONSTANTS: GameConstantItem[] = [
  { key: 'totalCards', name: '总卡牌数', value: 72, unit: '张', description: '本局游戏使用的卡牌总数（含全部类型）' },
  { key: 'initialHand', name: '初始手牌数', value: 4, unit: '张', description: '游戏开始时每位玩家抽取的手牌数量' },
  { key: 'handLimit', name: '手牌上限', value: 4, unit: '张', description: '回合结束时手牌数量的上限，超出必须弃牌' },
  { key: 'initialEnergy', name: '初始能量', value: 3, unit: '点', description: '每位玩家游戏开始时获得的能量' },
  { key: 'baseEnergyPerTurn', name: '回合基础能量', value: 1, unit: '点', description: '每回合开始时玩家自动获得的基础能量' },
  { key: 'maxPlayers', name: '最大玩家数', value: 5, unit: '人', description: '单局游戏允许的最大玩家数量' },
  { key: 'eliminationEnergyPerAlive', name: '淘汰奖励系数', value: 3, unit: '点', description: '淘汰一名玩家时，按当前存活玩家数乘以此值奖励能量给攻击者' },
  { key: 'broadcastCooldownTurns', name: '广播冷却轮数', value: 2, unit: '轮', description: '同一星系两次广播之间必须间隔的最少轮数' },
  { key: 'broadcastRefundOnMiss', name: '广播退还能量', value: 1, unit: '点', description: '广播无人回应或被取消时退还给发起者的能量' },
  { key: 'recycleRefundRatio', name: '回收返还比例', value: 0.5, unit: '', description: '回收设施时返还建造能量的比例（向下取整），例如 6 能量设施回收返还 3 能量' },
];

/** 兜底机制说明（与后端 exportMechanisms 一致） */
export const FALLBACK_MECHANISMS: GameMechanisms = {
  broadcast: {
    description: '向目标星系发送广播信号，目标星系内的玩家可选择回应或伪装。双方均选择合作则各获得 3 能量；一方伪装则伪装方获得 5 能量，另一方 0 能量；双方均伪装则均不得能量。',
    phases: ['waiting', 'select', 'reveal', 'resolve'],
  },
  strike: {
    description: '向目标星系发动打击，可摧毁目标玩家或恒星。打击等级决定其是否可被防御牌防护。',
    originModes: ['direct', 'ownerPlanet', 'stealthOwnerPlanet'],
    missBehaviors: ['discard', 'freeControl', 'requireTarget'],
  },
  settlement: {
    description: '每回合开始时，玩家已部署的设施产出能量。部分设施（太阳能阵列、戴森球）依赖恒星，恒星被毁灭后无法产出。',
    starDependentFacilities: ['facility_solar_array', 'facility_dyson_sphere'],
  },
  winCondition: {
    description: '最后存活的玩家获胜。当其他玩家全部被淘汰时，游戏结束。',
  },
};

/** 兜底遗迹组合（与后端 RelicCombos 一致，共 11 个） */
export const FALLBACK_RELIC_COMBOS: RelicComboExport[] = [
  // 弱
  {
    id: 'relic_weak_signal_dust', name: '信号尘埃', strength: '弱', energy: 1,
    lore: '一颗早已熄灭的文明在临终前发出的微弱电波残余，散落在沙暴般的星际尘埃里。捕获者偶尔能拼出只言片语的求救信。',
    facilityNames: ['太阳能阵列'], facilityDefIds: ['facility_solar_array'],
  },
  {
    id: 'relic_weak_dormant_array', name: '沉睡阵列', strength: '弱', energy: 2,
    lore: '废弃的太阳能阵列仍朝向一颗早已死亡的恒星缓慢转动，积蓄的能量勉强够点亮一盏孤灯。',
    facilityNames: ['聚变反应堆'], facilityDefIds: ['facility_fusion_reactor'],
  },
  {
    id: 'relic_weak_whisper_dish', name: '低语之碟', strength: '弱', energy: 1,
    lore: '监听基地的残骸里，电磁记录装置仍在循环播放一段无法解读的低语，似乎是某个文明在黑暗森林边缘最后的呢喃。',
    facilityNames: ['监听基地'], facilityDefIds: ['facility_monitoring_station'],
  },
  {
    id: 'relic_weak_fragment_records', name: '残章断简', strength: '弱', energy: 2,
    lore: '一段被辐射风化得残缺不全的文明档案，其中残留的太阳能技术图样仍可勉强复原。',
    facilityNames: ['太阳能阵列'], facilityDefIds: ['facility_solar_array'],
  },
  // 中
  {
    id: 'relic_mid_derelict_reactor', name: '废弃反应堆', strength: '中', energy: 4,
    lore: '一座被遗弃的反物质引擎仍在低功率运转，冷却管道上凝着亿万年的霜。任何靠近者都能感到皮肤上的静电。',
    facilityNames: ['反物质引擎'], facilityDefIds: ['facility_antimatter_engine'],
  },
  {
    id: 'relic_mid_observers_ruin', name: '观星者遗址', strength: '中', energy: 3,
    lore: '古老的观星者在此布下监听阵列与太阳能补给站，试图捕捉黑暗森林中的脚步声。他们消失得无声无息，只留下这些沉默的耳目。',
    facilityNames: ['监听基地', '太阳能阵列'], facilityDefIds: ['facility_monitoring_station', 'facility_solar_array'],
  },
  {
    id: 'relic_mid_echo_chamber', name: '回响舱室', strength: '中', energy: 5,
    lore: '一座聚变反应堆的废弃舱室里回响着古老的广播频段，传说捕获者能听到自己未来的回音——只是从未有人证实。',
    facilityNames: ['聚变反应堆'], facilityDefIds: ['facility_fusion_reactor'],
  },
  {
    id: 'relic_mid_shattered_dish', name: '破碎监听阵', strength: '中', energy: 4,
    lore: '陨石击碎了半数监听碟，但残存的阵列与备用聚变堆仍能拼凑出一段断续的星际窃听记录。',
    facilityNames: ['监听基地', '聚变反应堆'], facilityDefIds: ['facility_monitoring_station', 'facility_fusion_reactor'],
  },
  // 强
  {
    id: 'relic_strong_dyson_tomb', name: '戴森之墓', strength: '强', energy: 8,
    lore: '一颗戴森球笼罩着早已熄灭的恒星，建造它的文明在工程完成的同一刻被未知力量抹除。球壳上仍残留着温热的能量储备和一台无人值守的监听装置。',
    facilityNames: ['戴森球', '监听基地'], facilityDefIds: ['facility_dyson_sphere', 'facility_monitoring_station'],
  },
  {
    id: 'relic_strong_antimatter_vault', name: '反物质秘窟', strength: '强', energy: 10,
    lore: '深藏于死星地幔下的反物质储藏室，由一台反物质引擎与聚变堆双重供能。开启它的文明留下了刻在金属门上的警告：\'不要让它看见你\'。',
    facilityNames: ['反物质引擎', '聚变反应堆'], facilityDefIds: ['facility_antimatter_engine', 'facility_fusion_reactor'],
  },
  {
    id: 'relic_strong_citadel_of_silence', name: '寂静堡垒', strength: '强', energy: 12,
    lore: '一座由戴森球、反物质引擎与监听基地共同支撑的末日堡垒。建造者笃信\'黑暗森林\'的终极真相，最终选择在沉默中蒸发，只留下这些机器继续守望。',
    facilityNames: ['戴森球', '反物质引擎', '监听基地'],
    facilityDefIds: ['facility_dyson_sphere', 'facility_antimatter_engine', 'facility_monitoring_station'],
  },
];

/**
 * 完整的兜底规则响应数据。
 * 当 getAllRules() API 请求失败时使用此数据。
 *
 * 注意：cardDefinitions / starMap 直接复用本地常量（与后端一致），
 * 避免在兜底场景下重复维护一份卡牌定义。
 */
export const FALLBACK_ALL_RULES: AllRulesResponse = {
  cardDefinitions: CARD_DEFINITIONS,
  ruleConfigs: FALLBACK_RULE_CONFIGS,
  modePresets: FALLBACK_MODE_PRESETS,
  relicCombos: FALLBACK_RELIC_COMBOS,
  starMap: {
    nodes: STAR_NODES.map((n) => ({ id: n.id, name: n.name })),
    edges: STAR_EDGES.map((e) => ({ from: e.from, to: e.to })),
  },
  gameConstants: FALLBACK_GAME_CONSTANTS,
  mechanisms: FALLBACK_MECHANISMS,
};
