/**
 * CustomRulesEditor 字段元数据与分类常量。
 *
 * 与后端 mode_rules.go 字段对齐；MODE_LABELS 复用 rulesText.ts 已有导出。
 * 注意：icon 字段为 lucide-react 组件引用（LucideIcon 类型），非 JSX 元素，
 * 故本文件可使用 .ts 扩展名，避免 react-refresh/only-export-components 警告。
 */

import { Sparkles, Crown, Crosshair, type LucideIcon } from 'lucide-react';
import type { GameMode } from '@/lib/game/types';
import type { ModeRules } from '@/lib/game/modeRules';
import { MODE_LABELS } from '@/constants/rulesText';

export { MODE_LABELS };

/** 字段值类型 */
export type FieldType = 'boolean' | 'integer' | 'enum';

/** 字段所属分类 */
export type FieldCategory = 'lightspeed' | 'relic' | 'strike';

/** 枚举选项 */
export interface EnumOpt {
  id: string;
  label: string;
}

/** 字段元数据描述 */
export interface FieldMeta {
  key: keyof ModeRules;
  label: string;
  category: FieldCategory;
  type: FieldType;
  unit?: string;
  description: string;
  enumOptions?: EnumOpt[];
  /** 该字段在哪些基础模式下"相关"（可编辑）；不相关字段灰显但仍保留值 */
  modes: GameMode[];
}

/** 字段元数据列表（与后端 mode_rules.go 字段对齐） */
export const FIELD_METAS: FieldMeta[] = [
  // lightspeed
  {
    key: 'lightspeedUsage',
    label: '光速飞船使用方式',
    category: 'lightspeed',
    type: 'enum',
    description: 'oneTime=一次性（Classic，跃迁后消失）；reusable=可重复部署（Relics）',
    enumOptions: [
      { id: 'oneTime', label: '一次性消耗' },
      { id: 'reusable', label: '可复用设施' },
    ],
    modes: ['classic', 'civilization_relics'],
  },
  {
    key: 'lightspeedCombinedActionCost',
    label: '合并动作成本（随机）',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Classic 模式下光速飞船合并动作的随机成本',
    modes: ['classic'],
  },
  {
    key: 'lightspeedCombinedActionCostSpecified',
    label: '合并动作成本（指定）',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Classic 模式下光速飞船合并动作的指定成本',
    modes: ['classic'],
  },
  {
    key: 'lightspeedDeployCost',
    label: '部署成本',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Relics 模式下光速飞船的部署成本',
    modes: ['civilization_relics'],
  },
  {
    key: 'lightspeedJumpCostRandom',
    label: '跃迁成本（随机）',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Relics 模式下光速飞船跃迁至随机星系的成本',
    modes: ['civilization_relics'],
  },
  {
    key: 'lightspeedJumpCostSpecified',
    label: '跃迁成本（指定）',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Relics 模式下光速飞船跃迁至指定星系的成本',
    modes: ['civilization_relics'],
  },
  {
    key: 'lightspeedCarryCap',
    label: '携带能量上限',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: '光速飞船可携带的能量上限',
    modes: ['classic', 'civilization_relics'],
  },
  {
    key: 'lightspeedMessageEnabled',
    label: '是否启用留言',
    category: 'lightspeed',
    type: 'boolean',
    description: '光速飞船离开星系时是否可留言',
    modes: ['classic', 'civilization_relics'],
  },
  // relic
  {
    key: 'relicDistributionEnabled',
    label: '遗迹分布',
    category: 'relic',
    type: 'boolean',
    description: '是否在星图上分布遗迹（Relics 默认开启）',
    modes: ['classic', 'civilization_relics'],
  },
  // strike
  {
    key: 'strikeOrigin',
    label: '打击出现位置',
    category: 'strike',
    type: 'enum',
    description: 'direct=即刻判定；ownerPlanet=从拥有者星球飞行；stealthOwnerPlanet=隐逐跳（路径仅拥有者可见）',
    enumOptions: [
      { id: 'direct', label: '即刻判定' },
      { id: 'ownerPlanet', label: '从拥有者星球飞行' },
      { id: 'stealthOwnerPlanet', label: '隐逐跳' },
    ],
    modes: ['classic', 'civilization_relics'],
  },
  {
    key: 'strikeMissBehavior',
    label: '打击落空处理',
    category: 'strike',
    type: 'enum',
    description: 'discard=废弃；freeControl=保留可自由控制；requireTarget=保留必须先指定新目标',
    enumOptions: [
      { id: 'discard', label: '废弃到弃牌堆' },
      { id: 'freeControl', label: '保留可自由控制' },
      { id: 'requireTarget', label: '保留须指定新目标' },
    ],
    modes: ['classic', 'civilization_relics'],
  },
  {
    key: 'strikeCanDestroyRelic',
    label: '打击可摧毁遗迹',
    category: 'strike',
    type: 'boolean',
    description: '打击到达目标后是否可摧毁该星系的遗迹（Relics 默认 true）',
    modes: ['classic', 'civilization_relics'],
  },
];

/** 分类元数据（icon 为组件引用，渲染时需 `<Icon className="..." />`） */
export const CATEGORY_META: Record<FieldCategory, { label: string; icon: LucideIcon }> = {
  lightspeed: { label: '光速飞船', icon: Sparkles },
  relic: { label: '遗迹', icon: Crown },
  strike: { label: '打击', icon: Crosshair },
};

/** 分类展示顺序 */
export const CATEGORY_ORDER: FieldCategory[] = ['lightspeed', 'relic', 'strike'];
