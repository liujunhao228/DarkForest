import { get } from './http';
import type { CardDef, GameMode } from '../lib/game/types';

// ============================================================================
// 类型定义 — 与后端 backend/internal/game/rules_export.go 严格对齐
// ============================================================================

/** 枚举类型的可选值（替代旧版 []string 形式的 enumValues） */
export interface EnumOption {
  /** 程序标识符，如 "direct" */
  id: string;
  /** 玩家友好标签，如 "即刻判定" */
  label: string;
  /** 该选项的独立玩家向说明 */
  description: string;
}

/** 游戏基础常量项（v1.1 改为数组形式，每项含 description） */
export interface GameConstantItem {
  key: string;
  name: string;
  value: number;
  unit?: string;
  description: string;
}

/** 规则配置项的值类型（与后端 type 字段对应） */
export type RuleConfigType = 'boolean' | 'integer' | 'enum';

/** 规则配置项的分组（与后端 category 字段对应） */
export type RuleConfigCategory = 'lightspeed' | 'relic' | 'strike';

/** 规则配置项的可取值类型（boolean / integer / enum 字符串） */
export type RuleConfigValue = boolean | number | string;

/**
 * 规则配置项（v1.1 玩家向重构）
 *
 * - 全量 API（GET /api/game/rules）：descriptions 包含全部 mode:value 组合，activeValue 为空
 * - 房间 API（GET /api/rooms/:roomId/rules）：descriptions 仅含一条 {mode:activeValue}，activeValue 已填充
 */
export interface RuleConfig {
  key: string;
  /** 玩家向概念名，如 "光速飞船使用方式" */
  name: string;
  /** 已弃用的旧版混用描述，UI 不应展示 */
  legacyDescription?: string;
  type: RuleConfigType;
  category: RuleConfigCategory;
  /** {"classic": ..., "civilization_relics": ...} */
  values: Record<string, RuleConfigValue>;
  /** 布尔/枚举值的玩家标签，键为 "true"/"false" 或枚举 id */
  valueLabels?: Record<string, string>;
  /** 二维 key: "{mode}:{value}" → 玩家文案 */
  descriptions: Record<string, string>;
  /** 自定义房间改值时的兜底模板，{value} 为占位符 */
  valueTemplate?: string;
  /** integer 单位，如 "能量" */
  unit?: string;
  /** type=enum 时的可选值列表 */
  enumOptions?: EnumOption[];
  /** 房间 API 专用：当前模式下的取值 */
  activeValue?: RuleConfigValue;
}

/** 模式预设 */
export interface ModePreset {
  id: GameMode;
  name: string;
  description: string;
}

/** 遗迹组合的可导出形式 */
export interface RelicComboExport {
  id: string;
  name: string;
  strength: string;
  lore: string;
  energy: number;
  facilityNames: string[];
  facilityDefIds: string[];
}

/** 星图节点 */
export interface StarNodeExport {
  id: number;
  name: string;
}

/** 星图边 */
export interface StarEdgeExport {
  from: number;
  to: number;
}

/** 星图的可导出形式（不含坐标，仅供展示拓扑） */
export interface StarMapExport {
  nodes: StarNodeExport[];
  edges: StarEdgeExport[];
}

/** 单个机制的说明（broadcast / winCondition） */
export interface MechanismDescription {
  description: string;
  phases?: string[];
}

/** 打击机制说明 */
export interface StrikeMechanism {
  description: string;
  originModes: string[];
  missBehaviors: string[];
}

/** 设施产能结算机制说明 */
export interface SettlementMechanism {
  description: string;
  starDependentFacilities: string[];
}

/** 胜负条件说明 */
export interface WinConditionMechanism {
  description: string;
}

/** 各游戏机制的说明 */
export interface GameMechanisms {
  broadcast?: MechanismDescription;
  strike?: StrikeMechanism;
  settlement?: SettlementMechanism;
  winCondition?: WinConditionMechanism;
}

/** GET /api/game/rules 的完整响应结构 */
export interface AllRulesResponse {
  cardDefinitions: CardDef[];
  ruleConfigs: RuleConfig[];
  modePresets: ModePreset[];
  relicCombos: RelicComboExport[];
  starMap: StarMapExport;
  gameConstants: GameConstantItem[];
  mechanisms: GameMechanisms;
}

/** GET /api/rooms/:roomId/rules 的响应结构（含房间过滤字段） */
export interface RoomRulesResponse extends AllRulesResponse {
  roomId: string;
  gameMode: GameMode;
  /** 当前模式每个 config key 的值 */
  activeValues: Record<string, RuleConfigValue>;
}

// ============================================================================
// API 函数
// ============================================================================

/**
 * GET /api/game/rules — 获取全部游戏规则
 *
 * 无需认证。规则文案以后端为单一数据源，调用方应处理加载/失败态，
 * 不再提供本地兜底数据（避免前后端文案漂移）。
 */
export async function getAllRules(): Promise<AllRulesResponse> {
  return get<AllRulesResponse>('/api/game/rules');
}

/**
 * GET /api/rooms/:roomId/rules — 获取指定房间的游戏规则
 *
 * 需要认证（玩家须在房间内）。返回的 ruleConfigs 中 descriptions 仅含一条
 * {gameMode:activeValue}，activeValue 字段已填充。
 *
 * 错误响应：
 *   - 404 房间不存在
 *   - 403 未加入房间
 */
export async function getRoomRules(roomId: string): Promise<RoomRulesResponse> {
  return get<RoomRulesResponse>(`/api/rooms/${encodeURIComponent(roomId)}/rules`);
}

// ============================================================================
// 工具函数 — 前端渲染辅助
// ============================================================================

/**
 * 将任意值转为 descriptions map 中的 key 片段（与后端 formatConfigValue 对齐）。
 * 布尔 → "true"/"false"；整数 → 数字字符串；字符串 → 原值。
 */
export function formatConfigValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return String(v);
}

/**
 * 取规则配置项在指定模式下的描述。
 * 优先级：descriptions[mode:value] > valueTemplate 替换 > valueLabels[value] > 原值字符串。
 */
export function resolveRuleDescription(
  config: RuleConfig,
  mode: GameMode | string,
  value: RuleConfigValue,
): string {
  const key = `${mode}.${formatConfigValue(value)}`;
  const exact = config.descriptions[key];
  if (exact) return exact;

  if (config.valueTemplate) {
    return config.valueTemplate.replace('{value}', formatConfigValue(value));
  }

  if (config.valueLabels) {
    const label = config.valueLabels[formatConfigValue(value)];
    if (label) return label;
  }

  return formatConfigValue(value);
}

/**
 * 取房间规则 API 响应中 descriptions 唯一一条记录的值。
 * 房间 API 已过滤 descriptions 仅含 {gameMode:activeValue} 一条。
 */
export function getRoomRuleDescription(config: RuleConfig): string {
  const keys = Object.keys(config.descriptions);
  if (keys.length === 0) {
    // 极端兜底：用 valueLabels 或原值
    if (config.activeValue !== undefined && config.valueLabels) {
      const label = config.valueLabels[formatConfigValue(config.activeValue)];
      if (label) return label;
    }
    return config.activeValue !== undefined ? formatConfigValue(config.activeValue) : '—';
  }
  return config.descriptions[keys[0]];
}

/**
 * 渲染规则配置项的单元格值（用于对比表显示）。
 * boolean → valueLabels[String(value)] 或 ✓/✗
 * integer → 数字 + unit
 * enum → enumOptions.find(o => o.id === value)?.label 或原值
 */
export function renderRuleCellValue(config: RuleConfig, value: RuleConfigValue): string {
  switch (config.type) {
    case 'boolean': {
      const label = config.valueLabels?.[formatConfigValue(value)];
      return label ?? (value ? '✓' : '✗');
    }
    case 'integer': {
      const num = typeof value === 'number' ? String(value) : String(value);
      return config.unit ? `${num} ${config.unit}` : num;
    }
    case 'enum': {
      const opt = config.enumOptions?.find((o) => o.id === value);
      return opt?.label ?? (typeof value === 'string' ? value : String(value));
    }
    default:
      return String(value);
  }
}
