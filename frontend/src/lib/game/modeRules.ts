import type { GameMode } from './types';

/**
 * 打击出现位置：
 * - direct=直接在 TargetSystem 出现并即刻判定
 * - ownerPlanet=从 owner 星球飞行到达后判定
 * - stealthOwnerPlanet=「隐逐跳」：行为同 ownerPlanet，但飞行路径仅拥有者可见；
 *   对其他玩家仅揭露 TargetSystem 与当前位置到目标的图最短跳数距离；回放可见完整路径
 */
export type StrikeOrigin = 'direct' | 'ownerPlanet' | 'stealthOwnerPlanet';

/**
 * 打击落空处理：discard=废弃到弃牌堆 / freeControl=保留可自由控制 / requireTarget=保留必须先指定新 TargetSystem
 */
export type StrikeMissBehavior = 'discard' | 'freeControl' | 'requireTarget';

/**
 * 描述特定游戏模式的规则差异。字段为编译期常量，与后端 mode_rules.go 保持一致。
 */
export interface ModeRules {
  /** 光速飞船是否一次性（true=Classic, false=Relics） */
  lightspeedOneTime: boolean;
  /** Classic 合并动作成本（random） */
  lightspeedCombinedActionCost: number;
  /** Classic 合并动作成本（specified） */
  lightspeedCombinedActionCostSpecified: number;
  /** Relics 部署成本 */
  lightspeedDeployCost: number;
  /** Relics 跃迁成本（random） */
  lightspeedJumpCostRandom: number;
  /** Relics 跃迁成本（specified） */
  lightspeedJumpCostSpecified: number;
  /** 携带能量上限 */
  lightspeedCarryCap: number;
  /** 是否启用留言 */
  lightspeedMessageEnabled: boolean;
  /** 是否启用遗迹分布 */
  relicDistributionEnabled: boolean;
  /** 打击出现位置 */
  strikeOrigin: StrikeOrigin;
  /** 打击落空处理 */
  strikeMissBehavior: StrikeMissBehavior;
  /** 打击是否可摧毁遗迹（true=Relics 默认，false=Classic 默认） */
  strikeCanDestroyRelic: boolean;
}

const classicModeRules: ModeRules = {
  lightspeedOneTime: true,
  lightspeedCombinedActionCost: 10,
  lightspeedCombinedActionCostSpecified: 13,
  lightspeedDeployCost: 0,
  lightspeedJumpCostRandom: 0,
  lightspeedJumpCostSpecified: 0,
  lightspeedCarryCap: 0,
  lightspeedMessageEnabled: false,
  relicDistributionEnabled: false,
  strikeOrigin: 'direct',
  strikeMissBehavior: 'discard',
  strikeCanDestroyRelic: false,
};

const relicsModeRules: ModeRules = {
  lightspeedOneTime: false,
  lightspeedCombinedActionCost: 0,
  lightspeedCombinedActionCostSpecified: 0,
  lightspeedDeployCost: 10,
  lightspeedJumpCostRandom: 3,
  lightspeedJumpCostSpecified: 5,
  lightspeedCarryCap: 5,
  lightspeedMessageEnabled: true,
  relicDistributionEnabled: true,
  strikeOrigin: 'ownerPlanet',
  strikeMissBehavior: 'discard',
  strikeCanDestroyRelic: true,
};

/**
 * 返回指定游戏模式的静态规则。未知模式回退到 Classic。
 *
 * 重载：接受字符串模式名（向后兼容），或包含 {gameMode, modeRules} 的状态对象。
 * 当 state.modeRules 存在时优先返回该自定义覆盖值（与后端 StateRules(state) 语义一致）。
 * 后端 GameState / ViewState 经由 CreateViewState 透传 state.ModeRules，
 * 自定义房间（房主在创建时调整规则）的对局按自定义规则渲染。
 */
export function getModeRules(input: GameMode | string | undefined): ModeRules;
export function getModeRules(input: { gameMode?: GameMode | string; modeRules?: ModeRules | null } | undefined): ModeRules;
export function getModeRules(
  input:
    | GameMode
    | string
    | { gameMode?: GameMode | string; modeRules?: ModeRules | null }
    | undefined,
): ModeRules {
  if (input && typeof input === 'object' && 'modeRules' in input) {
    // 状态对象形式：自定义规则优先于预设
    if (input.modeRules) return input.modeRules;
    return getModeRules(input.gameMode);
  }
  // 字符串形式：按 gameMode 选预设
  if (input === 'civilization_relics') return relicsModeRules;
  return classicModeRules;
}
