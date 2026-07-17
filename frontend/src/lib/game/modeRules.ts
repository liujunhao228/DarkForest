import type { GameMode } from './types';

/**
 * 打击出现位置：direct=直接在 TargetSystem 出现并即刻判定 / ownerPlanet=从 owner 星球飞行到达后判定
 */
export type StrikeOrigin = 'direct' | 'ownerPlanet';

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
};

/**
 * 返回指定游戏模式的静态规则。未知模式回退到 Classic。
 */
export function getModeRules(gameMode: GameMode | string | undefined): ModeRules {
  if (gameMode === 'civilization_relics') return relicsModeRules;
  return classicModeRules;
}
