// ============================
// 游戏引擎 - 牌堆管理
// ============================
import type { Card, CardDef, GameState, BroadcastSubtype } from './types';
import { shuffle, addLog } from './utils';
import { CARD_DEFINITIONS } from './cards';

/**
 * 从 CardDef 生成卡牌实例
 */
function createCardInstances(def: CardDef): Card[] {
  const instances: Card[] = [];
  for (let i = 0; i < def.quantity; i++) {
    instances.push({
      uid: `${def.id}_${i}_${Math.random().toString(36).substring(2, 8)}`,
      defId: def.id,
      name: def.name,
      type: def.type,
      energy: def.energy,
      description: def.description,
      image: def.image,
      subtype: def.extended.subtype as BroadcastSubtype | undefined,
      range: def.extended.range as number | undefined,
      level: def.extended.level as number | undefined,
      speed: def.extended.speed as number | undefined,
      effect: def.extended.effect as string | undefined,
      protectionLevel: def.extended.protection_level as number | undefined,
      energyPerTurn: def.extended.energy_per_turn as number | undefined,
      ability: def.extended.ability as string | undefined,
    });
  }
  return instances;
}

/**
 * 创建初始牌堆
 */
export function createDrawPile(): Card[] {
  const allCards: Card[] = [];
  for (const def of CARD_DEFINITIONS) {
    allCards.push(...createCardInstances(def));
  }
  return shuffle(allCards);
}

/**
 * 摸牌（处理牌堆耗尽）
 */
export function drawCard(state: GameState, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) break;
      // 重新洗牌
      state.drawPile = shuffle(state.discardPile);
      state.discardPile = [];
      addLog(state, '牌堆已耗尽，弃牌堆重新洗牌。', 'system');
    }
    if (state.drawPile.length > 0) {
      drawn.push(state.drawPile.pop()!);
    }
  }
  return drawn;
}
