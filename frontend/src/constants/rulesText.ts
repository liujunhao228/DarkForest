/**
 * 规则面板 UI 文案集中管理（GameRulesPanel / GameRulesButton 组件）。
 *
 * 设计原则：
 * - 此处仅承载规则面板的静态 UI 标签（分类名、模式名、标题、提示）
 * - 规则文案本身（随房间配置动态变化的描述）由后端 API 运行时拉取，不在此处
 */

import type { GameMode } from '@/lib/game/types';
import type { RuleConfigCategory } from '@/api/rules';

/** 规则配置项分类 → 玩家向标签 */
export const CATEGORY_LABELS: Record<RuleConfigCategory, string> = {
  lightspeed: '光速飞船',
  relic: '遗迹',
  strike: '打击',
};

/** 游戏模式 → 玩家向标签 */
export const MODE_LABELS: Record<GameMode, string> = {
  classic: '经典模式',
  civilization_relics: '文明遗迹模式',
};

/** 规则面板标题（按 variant） */
export const RULES_PANEL_TITLE = {
  full: '游戏规则',
  'mode-filtered': '当前房间规则',
  compact: '规则速查',
};

/** 详细规则提示文案（链接嵌入文案中间，拆分为三段） */
export const RULES_TIP = {
  prefix: '提示：',
  detailPre: '详细规则可在 ',
  detailLink: 'GAME_RULES.md',
  detailPost: ' 中查阅完整说明。',
  detailUrl: 'https://github.com/darkforest/game/blob/main/docs/GAME_RULES.md',
};

/** GameRulesButton 默认标签 */
export const RULES_BUTTON_DEFAULT_LABEL = '游戏规则';
