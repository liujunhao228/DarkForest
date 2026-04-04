// ============================
// AI 触发钩子
// ============================
// 从各模块提取的AI自动操作逻辑
// 供 TurnStateMachine、BroadcastFlowManager、turn.ts、broadcast.ts 调用
// ============================
import { GameState, Player } from '../types';
import { aiAction, aiMoveStrike, aiRespondToBroadcast } from './decisions';
import { respondToBroadcast } from '../broadcast';

/**
 * 行动阶段：AI 自动行动
 * 从 TurnStateMachine 和 turn.ts 提取
 */
export function executeAIAction(state: GameState, player: Player, onActionComplete?: () => void): void {
  aiAction(state, player);
  
  // 如果提供了回调，在行动完成后调用
  if (onActionComplete) {
    onActionComplete();
  }
}

/**
 * 打击移动阶段：AI 自动移动所有打击
 * 从 TurnStateMachine 和 turn.ts 提取
 */
export function executeAIMoveStrikes(
  state: GameState,
  strikes: Array<{ uid: string; position: number; targetSystem: number; speed: number; strikeName: string; ownerId: string }>
): void {
  for (const strike of strikes) {
    aiMoveStrike(state, strike);
  }
}

/**
 * 广播博弈：AI 玩家自动回应
 * 从 BroadcastFlowManager 提取
 */
export function processAIResponses(state: GameState): void {
  if (!state.broadcast) return;

  const aiResponses = state.broadcast.responses.filter(r => {
    const player = state.players.find(p => p.id === r.playerId);
    return player?.isAI && r.canRespond && !r.responded;
  });

  for (const response of aiResponses) {
    // AI 简单策略：50% 概率同意
    const agreed = Math.random() > 0.5;
    let cardUid: string | undefined;

    if (agreed) {
      const player = state.players.find(p => p.id === response.playerId);
      if (player) {
        // 找第一张有能量的广播牌
        const broadcastCard = player.hand.find(c => c.type === 'broadcast' && player.energy >= c.energy);
        if (broadcastCard) {
          cardUid = broadcastCard.uid;
        }
      }
    }

    respondToBroadcast(state, response.playerId, agreed, cardUid);
  }
}

/**
 * 广播初始化：让 AI 玩家回应广播
 * 从 broadcast.ts 提取
 */
export function triggerAIBroadcastResponse(state: GameState): void {
  if (!state.broadcast) return;

  const aiResponders = state.broadcast.responses.filter(r => {
    const responder = state.players.find(p => p.id === r.playerId);
    return responder?.isAI && r.canRespond;
  });

  for (const resp of aiResponders) {
    aiRespondToBroadcast(state, resp.playerId);
  }
}

/**
 * 检查是否所有 AI 都已回应广播
 * 从 broadcast.ts 提取
 */
export function allAiResponded(state: GameState): boolean {
  if (!state.broadcast) return true;
  
  return state.broadcast.responses.every(r => {
    const responder = state.players.find(p => p.id === r.playerId);
    return responder?.isAI || r.responded;
  });
}

/**
 * 获取需要回应广播的人类玩家
 * 从 broadcast.ts 提取
 */
export function getHumanBroadcastResponders(state: GameState): Array<{ playerId: string; canRespond: boolean }> {
  if (!state.broadcast) return [];
  
  return state.broadcast.responses.filter(r => {
    const responder = state.players.find(p => p.id === r.playerId);
    return !responder?.isAI && r.canRespond;
  }).map(r => ({ playerId: r.playerId, canRespond: r.canRespond }));
}
