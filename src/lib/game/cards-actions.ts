// ============================
// 游戏引擎 - 卡牌操作
// ============================
import { GameState, Card } from './types';
import { addLog } from './utils';
import { drawCard } from './deck';

/**
 * 打出卡牌 - 通用
 */
export function playCard(state: GameState, player: any, cardUid: string): boolean {
  const cardIndex = player.hand.findIndex((c: Card) => c.uid === cardUid);
  if (cardIndex === -1) return false;
  const card = player.hand[cardIndex];

  // 检查能量
  if (player.energy < card.energy) {
    addLog(state, `${player.name} 能量不足（需要 ${card.energy}，拥有 ${player.energy}）`, 'system');
    return false;
  }

  // 消耗能量
  player.energy -= card.energy;
  player.hand.splice(cardIndex, 1);
  return true;
}

/**
 * 部署防御/设施牌
 */
export function deployCard(state: GameState, playerId: string, cardUid: string): boolean {
  const player = state.players.find(p => p.id === playerId)!;
  const cardIndex = player.hand.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return false;
  const card = player.hand[cardIndex];

  if (player.energy < card.energy) {
    addLog(state, `${player.name} 能量不足`, 'system');
    return false;
  }

  // 戴森球限制：每个星系只能建造 1 个
  if (card.defId === 'facility_dyson_sphere') {
    const playersAtSameSystem = state.players.filter(
      p => !p.eliminated && p.position === player.position
    );
    for (const p of playersAtSameSystem) {
      if (p.faceUpCards.some((c: Card) => c.defId === 'facility_dyson_sphere')) {
        addLog(state, `该星系已有戴森球，无法建造`, 'system');
        return false;
      }
    }
  }

  player.energy -= card.energy;
  player.hand.splice(cardIndex, 1);
  player.faceUpCards.push(card);
  addLog(state, `${player.name} 部署了【${card.name}】`, 'action');
  return true;
}

/**
 * 打出打击牌
 * @param targetSystem 目标星系（普通打击）或目标玩家当前所在星系（科技锁死）
 * @param targetPlayerId 指定目标玩家（科技锁死专用）
 */
export function playStrikeCard(
  state: GameState,
  playerId: string,
  cardUid: string,
  targetSystem: number,
  targetPlayerId?: string
): boolean {
  const player = state.players.find(p => p.id === playerId)!;
  const cardIndex = player.hand.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return false;
  const card = player.hand[cardIndex];

  if (player.energy < card.energy) return false;
  if (card.type !== 'strike') return false;

  player.energy -= card.energy;
  player.hand.splice(cardIndex, 1);

  // 创建飞行打击
  const strike = {
    uid: card.uid,
    defId: card.defId,
    ownerId: playerId,
    position: player.position,
    targetSystem,
    targetPlayerId,
    level: card.level ?? 1,
    speed: card.speed ?? 1,
    effect: card.effect,
    strikeName: card.name,
  };
  state.flyingStrikes.push(strike);

  const logMessage = targetPlayerId
    ? `${player.name} 对 ${state.players.find(p => p.id === targetPlayerId)?.name} 发动了【${card.name}】！`
    : `${player.name} 向星系 ${targetSystem} 发射了【${card.name}】！`;
  addLog(state, logMessage, 'combat');
  return true;
}

/**
 * 回收场上门牌
 */
export function recycleCard(state: GameState, playerId: string, cardUid: string): boolean {
  const player = state.players.find(p => p.id === playerId)!;
  const cardIndex = player.faceUpCards.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return false;

  const card = player.faceUpCards[cardIndex];
  const refund = Math.floor(card.energy / 2);

  player.faceUpCards.splice(cardIndex, 1);
  player.energy += refund;
  state.discardPile.push(card);

  addLog(state, `${player.name} 回收了【${card.name}】，获得 ${refund} 点能量`, 'action');
  return true;
}

/**
 * 弃掉手牌
 * @param state 游戏状态
 * @param playerId 玩家 ID
 * @param cardUids 要弃掉的卡牌 UID 列表
 */
export function discardHandCards(state: GameState, playerId: string, cardUids: string[]): boolean {
  const player = state.players.find(p => p.id === playerId)!;
  if (cardUids.length === 0) return false;

  const discardedCards: Card[] = [];
  for (const uid of cardUids) {
    const cardIndex = player.hand.findIndex(c => c.uid === uid);
    if (cardIndex !== -1) {
      const card = player.hand[cardIndex];
      player.hand.splice(cardIndex, 1);
      discardedCards.push(card);
    }
  }

  if (discardedCards.length === 0) return false;

  // 将弃牌放入弃牌堆
  state.discardPile.push(...discardedCards);

  const cardNames = discardedCards.map(c => `【${c.name}】`).join('、');
  addLog(state, `${player.name} 弃掉了 ${discardedCards.length} 张牌：${cardNames}`, 'action');
  return true;
}
