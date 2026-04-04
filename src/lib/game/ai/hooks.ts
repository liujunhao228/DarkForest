// ============================
// AI 触发钩子（测试用）
// ============================
// 仅保留钩子接口，决策逻辑已移除
// 供 TurnStateMachine、BroadcastFlowManager、turn.ts、broadcast.ts 调用
// ============================
import { GameState, Player } from '../types';
import { respondToBroadcast } from '../broadcast';

/**
 * 行动阶段：AI 自动行动（测试钩子）
 * 已移除AI决策逻辑，此处保留接口供后续接入测试或新AI
 */
export function executeAIAction(state: GameState, player: Player, onActionComplete?: () => void): void {
  // 测试钩子：需要手动调用游戏逻辑
  console.log(`[TEST HOOK] executeAIAction for ${player.name}`);
  
  // 如果提供了回调，在行动完成后调用
  if (onActionComplete) {
    onActionComplete();
  }
}

/**
 * 打击移动阶段：AI 自动移动所有打击（测试钩子）
 * 已移除AI决策逻辑，此处保留接口供后续接入测试或新AI
 */
export function executeAIMoveStrikes(
  state: GameState,
  strikes: Array<{ uid: string; position: number; targetSystem: number; speed: number; strikeName: string; ownerId: string }>
): void {
  // 测试钩子：需要手动调用游戏逻辑
  console.log(`[TEST HOOK] executeAIMoveStrikes for ${strikes.length} strikes`);
}

/**
 * 广播博弈：AI 玩家自动回应（测试钩子）
 * 保留简单随机回应逻辑用于测试广播流程
 */
export function processAIResponses(state: GameState): void {
  if (!state.broadcast) return;

  const aiResponses = state.broadcast.responses.filter(r => {
    const player = state.players.find(p => p.id === r.playerId);
    return player?.isAI && r.canRespond && !r.responded;
  });

  for (const response of aiResponses) {
    // 简单随机策略：50% 概率同意（仅用于测试）
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
 * 广播初始化：让 AI 玩家回应广播（测试钩子）
 * 保留简单随机回应逻辑用于测试广播流程
 */
export function triggerAIBroadcastResponse(state: GameState): void {
  if (!state.broadcast) return;

  const aiResponders = state.broadcast.responses.filter(r => {
    const responder = state.players.find(p => p.id === r.playerId);
    return responder?.isAI && r.canRespond;
  });

  for (const resp of aiResponders) {
    // 简单随机回应：80% 概率（仅用于测试）
    const player = state.players.find(p => p.id === resp.playerId)!;
    const shouldRespond = resp.mustRespond || Math.random() < 0.8;
    if (shouldRespond) {
      resp.agreed = true;
      resp.responded = true;
      // 选择手中随机一张广播牌
      const broadcastCards = player.hand.filter(c => c.type === 'broadcast' && player.energy >= c.energy);
      if (broadcastCards.length > 0) {
        const chosenCard = broadcastCards[Math.floor(Math.random() * broadcastCards.length)];
        resp.responseCard = chosenCard;
      }
    } else {
      resp.responded = true;
    }
  }
}

/**
 * 检查是否所有 AI 都已回应广播
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
 */
export function getHumanBroadcastResponders(state: GameState): Array<{ playerId: string; canRespond: boolean }> {
  if (!state.broadcast) return [];

  return state.broadcast.responses.filter(r => {
    const responder = state.players.find(p => p.id === r.playerId);
    return !responder?.isAI && r.canRespond;
  }).map(r => ({ playerId: r.playerId, canRespond: r.canRespond }));
}
