// ============================
// AI 决策逻辑
// ============================
// 包含所有AI的核心决策函数
// ============================
import { GameState, Player } from '../types';
import { addLog } from '../utils';
import { drawCard } from '../deck';
import { getSystemsInRange } from '../starmap';
import { advanceToNextPlayer } from '../turn';
import { deployCard, playStrikeCard } from '../cards-actions';
import { initiateBroadcast } from '../broadcast';
import { ADJACENCY, getDistance } from '../starmap';
import { resolveStrike, createCardFromStrike } from '../strike';

/**
 * AI 行动逻辑
 */
export function aiAction(state: GameState, player: Player): void {
  // AI 简单策略：每回合执行一个主要行动
  const defenseCards = player.hand.filter(c => c.type === 'defense' && c.energy <= player.energy);
  const facilityCards = player.hand.filter(c => c.type === 'facility' && c.ability !== 'escape' && c.energy <= player.energy);
  const strikeCards = player.hand.filter(c => c.type === 'strike' && c.energy <= player.energy);
  const broadcastCards = player.hand.filter(c => c.type === 'broadcast' && c.energy <= player.energy);

  let cardsPlayedCount = 0;

  // 优先部署防御（最多 1 张）
  if (defenseCards.length > 0 && player.faceUpCards.filter(c => c.type === 'defense').length < 2) {
    const card = defenseCards[0];
    if (deployCard(state, player.id, card.uid)) {
      cardsPlayedCount++;
    }
  }

  // 部署设施（最多 1 张）
  const updatedFacilityCards = player.hand.filter(c => c.type === 'facility' && c.ability !== 'escape' && c.energy <= player.energy);
  if (updatedFacilityCards.length > 0 && player.faceUpCards.filter(c => c.type === 'facility').length < 2) {
    const card = updatedFacilityCards[Math.floor(Math.random() * updatedFacilityCards.length)];
    if (deployCard(state, player.id, card.uid)) {
      cardsPlayedCount++;
    }
  }

  // 随机选择：打击或广播（二选一）
  const updatedStrikeCards = player.hand.filter(c => c.type === 'strike' && c.energy <= player.energy);
  const updatedBroadcastCards = player.hand.filter(c => c.type === 'broadcast' && c.energy <= player.energy);

  const action = Math.random();

  if (action < 0.5 && updatedStrikeCards.length > 0) {
    // 发射打击
    const card = updatedStrikeCards[0];
    const targets = state.players.filter(p => !p.eliminated && p.id !== player.id);
    if (targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      // 科技锁死：指定目标玩家
      if (card.effect === 'discard_hand') {
        playStrikeCard(state, player.id, card.uid, target.position, target.id);
      } else {
        playStrikeCard(state, player.id, card.uid, target.position);
      }
      cardsPlayedCount++;
    }
  } else if (updatedBroadcastCards.length > 0) {
    // 广播
    const card = updatedBroadcastCards[Math.floor(Math.random() * updatedBroadcastCards.length)];
    const range = card.range ?? 1;
    const validSystems = getSystemsInRange(player.position, range);
    if (validSystems.length > 0) {
      const targetSystem = validSystems[Math.floor(Math.random() * validSystems.length)];
      initiateBroadcast(state, player.id, card.uid, targetSystem);
      cardsPlayedCount++;
      // 注意：广播现在是异步的（AI vs AI 模式有延迟），不立即结束回合
      // 广播将在 2.5 秒后自动结算，然后由 store 处理后续流程
      return; // 提前返回，等待广播完成
    }
  }

  // 补牌（打出多少补多少）
  if (cardsPlayedCount > 0) {
    const drawn = drawCard(state, cardsPlayedCount);
    player.hand.push(...drawn);
  }

  // 结束回合
  addLog(state, `${player.name} 结束了回合`, 'info');
  advanceToNextPlayer(state);
}

/**
 * AI 移动打击牌
 */
export function aiMoveStrike(state: GameState, strike: any): void {
  // 简单 AI：向目标方向移动
  const neighbors = ADJACENCY[strike.position] ?? [];
  if (neighbors.length === 0) return;

  // 选择最接近目标的邻居
  let bestMove = neighbors[0];
  let bestDist = getDistance(neighbors[0], strike.targetSystem);
  for (const n of neighbors) {
    const d = getDistance(n, strike.targetSystem);
    if (d < bestDist) {
      bestDist = d;
      bestMove = n;
    }
  }

  strike.position = bestMove;
  addLog(state, `【${strike.strikeName}】移动到星系 ${bestMove}`, 'combat');

  // 检查到达
  if (strike.position === strike.targetSystem) {
    const targets = state.players.filter(
      p => !p.eliminated && p.position === strike.targetSystem && p.id !== strike.ownerId
    );
    if (targets.length > 0) {
      resolveStrike(state, strike, targets);
      state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
    } else {
      addLog(state, `【${strike.strikeName}】到达目标但无人在此。`, 'combat');
      state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
      state.discardPile.push(createCardFromStrike(strike));
    }
  }
}

/**
 * AI 回应广播
 */
export function aiRespondToBroadcast(state: GameState, playerId: string): void {
  if (!state.broadcast) return;
  const player = state.players.find(p => p.id === playerId)!;
  const response = state.broadcast.responses.find(r => r.playerId === playerId);
  if (!response || !response.canRespond) return;

  // 简单 AI: 80% 概率回应
  const shouldRespond = response.mustRespond || Math.random() < 0.8;
  if (shouldRespond) {
    response.agreed = true;
    response.responded = true;
    // AI 选择手中随机一张广播牌
    const broadcastCards = player.hand.filter(c => c.type === 'broadcast' && player.energy >= c.energy);
    if (broadcastCards.length > 0) {
      const chosenCard = broadcastCards[Math.floor(Math.random() * broadcastCards.length)];
      response.responseCard = chosenCard;
    }
  } else {
    response.responded = true;
  }
}
