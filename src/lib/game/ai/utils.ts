// ============================
// AI 工具函数
// ============================
import { Player } from '../types';

/**
 * 判断玩家是否为 AI
 */
export function isAIPlayer(player: Player): boolean {
  return player.isAI;
}

/**
 * 获取 AI 玩家列表
 */
export function getAIPlayers(state: { players: Player[] }): Player[] {
  return state.players.filter(p => p.isAI);
}

/**
 * 获取人类玩家列表
 */
export function getHumanPlayers(state: { players: Player[] }): Player[] {
  return state.players.filter(p => !p.isAI);
}
