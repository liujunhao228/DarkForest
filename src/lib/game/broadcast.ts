// ============================
// 游戏引擎 - 广播系统
// ============================
import { GameState, Player, Card, BroadcastSubtype, BroadcastResponse } from './types';
import { addLog } from './utils';
import { drawCard } from './deck';
import { getDistance, getSystemsInRange } from './starmap';
import { aiRespondToBroadcast } from './ai';

/**
 * 发起广播
 */
export function initiateBroadcast(
  state: GameState,
  playerId: string,
  cardUid: string,
  targetSystem: number
): void {
  const player = state.players.find(p => p.id === playerId)!;
  const cardIndex = player.hand.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return;
  const card = player.hand[cardIndex];

  if (card.type !== 'broadcast') return;
  if (player.energy < card.energy) return;

  // 检查广播限制
  const recentBroadcast = player.broadcastHistory.find(
    h => h.systemId === targetSystem && state.totalTurn - h.turn < 2
  );
  if (recentBroadcast) {
    addLog(state, `${player.name} 不能连续在同一星系广播`, 'system');
    return;
  }

  // 消耗能量，移除手牌
  player.energy -= card.energy;
  player.hand.splice(cardIndex, 1);

  const range = card.range ?? 1;
  player.broadcastHistory.push({ systemId: targetSystem, turn: state.totalTurn });

  // 确定可以回应的玩家
  const responses: BroadcastResponse[] = [];
  for (const other of state.players) {
    if (other.id === playerId || other.eliminated) continue;
    const dist = getDistance(other.position, targetSystem);
    const inRange = dist <= range;

    if (!inRange) continue;

    // 检查是否有合适的广播牌且有足够能量
    // 需要检查：1) 有广播牌 2) 牌的 range >= 当前广播的 range 3) 有足够能量支付该牌
    const hasValidBroadcastCard = other.hand.some(
      c => c.type === 'broadcast' && (c.range ?? 0) >= range && other.energy >= c.energy
    );
    const hasBroadcastCard = other.hand.some(c => c.type === 'broadcast');
    const hasEnergy = other.energy >= (other.hand.find(c => c.type === 'broadcast')?.energy ?? 0);

    // 检查监听基地（允许不做回应）
    const hasMonitoringStation = other.faceUpCards.some(c => c.ability === 'detect_broadcast');

    const isAtTarget = other.position === targetSystem;
    // 有监听基地时，即使在目标星系也不必回应
    const mustRespond = isAtTarget && hasValidBroadcastCard && !hasMonitoringStation;

    responses.push({
      playerId: other.id,
      playerName: other.name,
      canRespond: hasValidBroadcastCard,
      mustRespond,
      responded: false,
      agreed: false,
    });
  }

  state.broadcast = {
    active: true,
    broadcasterId: playerId,
    cardUid,
    card,
    targetSystem,
    range,
    subtype: card.subtype ?? 'cooperation',
    responses,
    phase: 'waiting',
  };

  addLog(state, `${player.name} 向星系 ${targetSystem} 发送了【${card.name}】（${card.subtype === 'cooperation' ? '合作' : '伪装'}）`, 'broadcast');

  // 检查是否有可以回应的玩家
  const possibleResponders = responses.filter(r => r.canRespond);
  if (possibleResponders.length === 0) {
    // 无人回应
    player.energy += 1;
    state.discardPile.push(card);
    addLog(state, `无人回应广播，${player.name} 获得 1 点能量`, 'broadcast');
    state.broadcast = null;
  } else {
    // 让 AI 玩家回应广播（无论发布者是 AI 还是人类）
    const aiResponders = responses.filter(r => {
      const responder = state.players.find(p => p.id === r.playerId);
      return responder?.isAI && r.canRespond;
    });

    for (const resp of aiResponders) {
      aiRespondToBroadcast(state, resp.playerId);
    }

    // 检查是否所有 AI 都已回应
    const allAiResponded = responses.every(r => {
      const responder = state.players.find(p => p.id === r.playerId);
      return responder?.isAI || r.responded;
    });

    // 如果所有 AI 都已回应，检查是否有人类需要回应
    const humanResponders = responses.filter(r => {
      const responder = state.players.find(p => p.id === r.playerId);
      return !responder?.isAI && r.canRespond;
    });

    if (humanResponders.length === 0) {
      // 没有人类需要回应，所有 AI 已回应
      if (player.isAI) {
        // AI 发布者 - 自动选择一个回应者结算
        const respondedPlayers = responses.filter(r => r.responded && r.agreed);
        if (respondedPlayers.length > 0) {
          state.broadcast!.selectedResponderId = respondedPlayers[0].playerId;
          resolveBroadcast(state);
        } else {
          // 无人回应
          player.energy += 1;
          state.discardPile.push(card);
          addLog(state, `无人回应广播，${player.name} 获得 1 点能量`, 'broadcast');
          state.broadcast = null;
        }
      }
      // 人类发布者时，等待人类选择回应者（phase 保持 'waiting'）
    }
    // 如果有人类需要回应，等待人类操作（phase 保持 'waiting'）
  }
}

/**
 * 玩家选择回应广播
 */
export function respondToBroadcast(state: GameState, playerId: string, agreed: boolean, cardUid?: string): void {
  if (!state.broadcast) return;
  const response = state.broadcast.responses.find(r => r.playerId === playerId);
  if (!response) return;

  response.agreed = agreed;
  response.responded = true;

  if (agreed && cardUid) {
    const player = state.players.find(p => p.id === playerId)!;
    const card = player.hand.find(c => c.uid === cardUid);
    if (card) {
      response.responseCard = card;
    }
  }
}

/**
 * 广播发布者选择回应者
 */
export function selectBroadcastResponder(state: GameState, responderId: string): void {
  if (!state.broadcast) return;
  state.broadcast.selectedResponderId = responderId;
  state.broadcast.phase = 'reveal';
  resolveBroadcast(state);
}

/**
 * 结算广播
 */
export function resolveBroadcast(state: GameState): void {
  if (!state.broadcast || !state.broadcast.selectedResponderId) return;

  const broadcaster = state.players.find(p => p.id === state.broadcast!.broadcasterId)!;
  const responder = state.players.find(p => p.id === state.broadcast!.selectedResponderId)!;
  const response = state.broadcast.responses.find(r => r.playerId === state.broadcast!.selectedResponderId)!;

  const bSubtype = state.broadcast.subtype;
  const rSubtype = (response.responseCard?.subtype ?? 'cooperation') as BroadcastSubtype;

  // 消耗回应者的能量和牌
  if (response.responseCard) {
    const cardIdx = responder.hand.findIndex(c => c.uid === response.responseCard!.uid);
    if (cardIdx >= 0) {
      responder.energy -= response.responseCard.energy;
      responder.hand.splice(cardIdx, 1);
    }
  }

  // 结算
  let bEnergy = 0;
  let rEnergy = 0;

  if (bSubtype === 'cooperation' && rSubtype === 'cooperation') {
    bEnergy = 3;
    rEnergy = 3;
    addLog(state, `双方合作！${broadcaster.name} 和 ${responder.name} 各获得 3 点能量`, 'broadcast');
  } else if (bSubtype === 'disguise' && rSubtype === 'cooperation') {
    bEnergy = 5;
    addLog(state, `${broadcaster.name} 伪装成功！获得 5 点能量`, 'broadcast');
  } else if (bSubtype === 'cooperation' && rSubtype === 'disguise') {
    rEnergy = 5;
    addLog(state, `${responder.name} 伪装成功！获得 5 点能量`, 'broadcast');
  } else {
    addLog(state, `双方伪装！无人获得能量`, 'broadcast');
  }

  broadcaster.energy += bEnergy;
  responder.energy += rEnergy;

  // 回应者补 1 张牌
  const drawn = drawCard(state, 1);
  responder.hand.push(...drawn);

  // 广播牌明牌放在发布者面前
  broadcaster.faceUpCards.push(state.broadcast.card);

  // 清理广播状态
  state.broadcast = null;
  state.pendingAction = null;

  // 检查游戏是否结束
  const alivePlayers = state.players.filter(p => !p.eliminated);
  if (alivePlayers.length <= 1) {
    state.phase = 'gameOver';
    if (alivePlayers.length === 1) {
      state.winner = alivePlayers[0].id;
    } else {
      state.winner = null;
    }
    return;
  }
}

/**
 * 取消广播（无人回应时）
 */
export function cancelBroadcast(state: GameState): void {
  if (!state.broadcast) return;
  const player = state.players.find(p => p.id === state.broadcast!.broadcasterId)!;
  player.energy += 1;
  state.discardPile.push(state.broadcast.card);
  addLog(state, `无人回应，${player.name} 获得 1 点能量`, 'broadcast');
  state.broadcast = null;
  state.pendingAction = null;
}

/**
 * 检查星系是否在广播范围内
 */
export function isSystemInRange(from: number, to: number, range: number): boolean {
  return getDistance(from, to) <= range;
}

/**
 * 获取星系中的存活玩家
 */
export function getPlayersAtSystem(state: GameState, systemId: number): Player[] {
  return state.players.filter(p => !p.eliminated && p.position === systemId);
}
