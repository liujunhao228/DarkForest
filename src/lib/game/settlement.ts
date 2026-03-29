// ============================
// 游戏引擎 - 结算阶段
// ============================
import { GameState } from './types';
import { addLog } from './utils';

/**
 * 阶段 1: 结算 - 仅设施能量产出
 * 注：打击到达检查已移至 moveStrike 函数中，在移动后进行检查
 */
export function settlementPhase(state: GameState): void {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return;

  // 设施能量产出
  let energyGained = 0;
  for (const card of player.faceUpCards) {
    if (card.type === 'facility' && card.energyPerTurn) {
      // 依赖恒星的设施：如果恒星被毁灭，无法产出能量
      const isStarDependent = card.defId === 'facility_solar_array' || card.defId === 'facility_dyson_sphere';
      const isStarDestroyed = state.destroyedStars.includes(player.position);
      
      if (isStarDependent && isStarDestroyed) {
        addLog(state, `${player.name} 的【${card.name}】因恒星被毁灭，本回合无法产出能量`, 'info');
        continue;
      }
      
      energyGained += card.energyPerTurn;
    }
  }
  if (energyGained > 0) {
    player.energy += energyGained;
    addLog(state, `${player.name} 的设施产出了 ${energyGained} 点能量（当前能量：${player.energy}）`, 'info');
  }

  // 注：打击到达检查已移至 moveStrike 函数中
  // 原因：打击应该在移动后才检查是否到达目标，而不是在回合开始时
}
