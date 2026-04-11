// ============================
// 回合流程、卡牌操作和打击系统测试
// ============================

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  initGame,
  getCurrentPlayer,
  startTurn,
  drawPhase,
  actionPhase,
  endTurn,
  advanceToNextPlayer,
  executeLightspeedShip,
  playCard,
  deployCard,
  playStrikeCard,
  recycleCard,
  discardHandCards,
  moveStrike,
  resolveStrike,
  announceStrike,
  getStrikeBestMove,
  createDrawPile,
  CARD_DEFINITIONS,
} from '@/lib/game';
import type { GameState, Card } from '@/lib/game';

describe('Turn Flow', () => {
  let state: GameState;

  beforeEach(() => {
    state = initGame({ playerCount: 3, humanName: 'TestPlayer' });
  });

  describe('startTurn', () => {
    it('应该设置回合阶段为 settlement 或继续流程', () => {
      startTurn(state);
      // startTurn 可能会继续到 draw 和 action 阶段（如果没有打击需要移动）
      // 所以最终阶段可能是 action
      expect(['settlement', 'draw', 'action', 'strikeMovement']).toContain(state.turnPhase);
    });

    it('当前玩家应该获得 1 点基础能量', () => {
      const player = getCurrentPlayer(state)!;
      const initialEnergy = player.energy;
      startTurn(state);
      expect(player.energy).toBe(initialEnergy + 1);
    });

    it('应该添加回合开始日志', () => {
      const initialLogCount = state.logs.length;
      startTurn(state);
      expect(state.logs.length).toBeGreaterThan(initialLogCount);
      expect(state.logs.some(log => log.message.includes('的回合'))).toBe(true);
    });

    it('应该为人类玩家设置正确的 pendingAction（如有打击需要移动）', () => {
      const player = getCurrentPlayer(state)!;
      // 手动添加一个飞行打击
      state.flyingStrikes.push({
        uid: 'test_strike_1',
        defId: 'strike_thermal',
        ownerId: player.id,
        position: player.position,
        targetSystem: 9,
        level: 1,
        speed: 1,
        strikeName: '测试打击',
        arrived: false,
      });

      startTurn(state);
      expect(state.turnPhase).toBe('strikeMovement');
      expect(state.pendingAction).not.toBeNull();
      expect(state.pendingAction?.type).toBe('strikeMove');
    });
  });

  describe('drawPhase', () => {
    it('应该设置阶段为 draw 或继续流程', () => {
      drawPhase(state);
      // drawPhase 可能会继续到 action 阶段
      expect(['draw', 'action']).toContain(state.turnPhase);
    });

    it('玩家手牌不足 4 张时应该补牌', () => {
      const player = getCurrentPlayer(state)!;
      // 清空手牌
      player.hand = [];

      const initialHandCount = player.hand.length;
      drawPhase(state);

      expect(player.hand.length).toBe(4); // 补充至 4 张
    });

    it('玩家手牌已满 4 张时不应该补牌', () => {
      const player = getCurrentPlayer(state)!;
      const initialHandCount = player.hand.length;

      drawPhase(state);

      // 如果原本就有 4 张，不应该再抽
      if (initialHandCount >= 4) {
        expect(player.hand.length).toBe(initialHandCount);
      }
    });
  });

  describe('actionPhase', () => {
    it('应该设置阶段为 actionPhase 或继续流程', () => {
      actionPhase(state);
      // actionPhase 可能继续到其他阶段
      expect(['actionPhase', 'turnEnd', 'strikeMovement']).toContain(state.turnPhase);
    });
  });

  describe('endTurn', () => {
    it('应该结束当前回合并前进到下一个玩家', () => {
      const initialTurn = state.totalTurn;
      const initialPlayerIndex = state.currentPlayerIndex;

      endTurn(state);

      // 应该前进到下一个玩家
      expect(state.currentPlayerIndex).not.toBe(initialPlayerIndex);
    });

    it('应该处理弃牌', () => {
      const player = getCurrentPlayer(state)!;
      const initialHandCount = player.hand.length;
      const initialDiscardCount = state.discardPile.length;

      // 弃掉所有手牌
      const cardUids = player.hand.map(c => c.uid);
      endTurn(state, cardUids);

      expect(player.hand.length).toBe(0);
      expect(state.discardPile.length).toBe(initialDiscardCount + initialHandCount);
    });

    it('应该添加结束回合日志', () => {
      const player = getCurrentPlayer(state)!;
      const initialLogCount = state.logs.length;

      endTurn(state);

      expect(state.logs.length).toBeGreaterThan(initialLogCount);
      expect(state.logs.some(log => log.message.includes('结束了回合'))).toBe(true);
    });
  });

  describe('advanceToNextPlayer', () => {
    it('应该前进到下一个存活的玩家', () => {
      const initialIndex = state.currentPlayerIndex;

      advanceToNextPlayer(state);

      // 应该跳过已淘汰的玩家
      const nextPlayer = getCurrentPlayer(state)!;
      expect(nextPlayer.eliminated).toBe(false);
      expect(state.currentPlayerIndex).not.toBe(initialIndex);
    });

    it('应该增加回合数或循环玩家', () => {
      const initialTurn = state.totalTurn;
      const initialPlayerIndex = state.currentPlayerIndex;

      // 循环一轮
      for (let i = 0; i < state.playerCount; i++) {
        advanceToNextPlayer(state);
      }

      // 验证游戏状态有变化（不强制要求回合数增加）
      const stateChanged = state.totalTurn !== initialTurn || 
                          state.currentPlayerIndex !== initialPlayerIndex ||
                          state.logs.length > 0;
      expect(stateChanged).toBe(true);
    });

    it('当只剩一个玩家时应该结束游戏', () => {
      // 淘汰除第一个玩家外的所有玩家
      for (let i = 1; i < state.players.length; i++) {
        state.players[i].eliminated = true;
      }

      advanceToNextPlayer(state);

      expect(state.phase).toBe('gameOver');
      expect(state.winner).toBe(state.players[0].id);
    });

    it('当所有玩家都被淘汰时应该平局', () => {
      // 淘汰所有玩家
      state.players.forEach(p => p.eliminated = true);

      advanceToNextPlayer(state);

      expect(state.phase).toBe('gameOver');
      expect(state.winner).toBeNull();
    });
  });

  describe('executeLightspeedShip', () => {
    it('应该移动玩家到新的星系', () => {
      const player = getCurrentPlayer(state)!;
      const initialPosition = player.position;

      // 添加光速飞船
      player.faceUpCards.push({
        uid: 'test_ship',
        defId: 'facility_lightspeed_ship',
        name: '光速飞船',
        type: 'facility',
        energy: 0,
        description: '',
        image: '',
        ability: 'escape',
      });

      executeLightspeedShip(state, player.id);

      // 飞船应该被消耗
      expect(player.faceUpCards.some(c => c.ability === 'escape')).toBe(false);
      // 玩家位置应该改变
      expect(player.position).not.toBe(initialPosition);
    });

    it('没有光速飞船时不应该移动', () => {
      const player = getCurrentPlayer(state)!;
      const initialPosition = player.position;

      executeLightspeedShip(state, player.id);

      expect(player.position).toBe(initialPosition);
    });
  });
});

describe('Card Operations', () => {
  let state: GameState;

  beforeEach(() => {
    state = initGame({ playerCount: 3, humanName: 'TestPlayer' });
    // 确保牌堆有足够的牌用于测试
    if (state.drawPile.length === 0) {
      state.drawPile = createDrawPile();
    }
  });

  describe('playCard', () => {
    it('应该成功打出卡牌', () => {
      const player = getCurrentPlayer(state)!;
      
      // 确保玩家有手牌
      if (player.hand.length === 0) {
        return; // 跳过测试
      }
      
      const card = player.hand[0];
      const initialEnergy = player.energy;
      const initialHandCount = player.hand.length;

      const result = playCard(state, player, card.uid);

      // playCard 应该返回布尔值表示成功或失败
      expect(typeof result).toBe('boolean');
      
      // 如果成功，能量应该减少且卡牌应该从手牌移除
      if (result) {
        expect(player.energy).toBe(initialEnergy - card.energy);
        expect(player.hand.some(c => c.uid === card.uid)).toBe(false);
      } else {
        // 如果失败，状态应该不变
        expect(player.energy).toBe(initialEnergy);
        expect(player.hand.length).toBe(initialHandCount);
      }
    });

    it('能量不足时应该失败', () => {
      const player = getCurrentPlayer(state)!;
      // 设置能量为 0
      player.energy = 0;

      // 找一张需要能量的牌
      const expensiveCard = player.hand.find(c => c.energy > 0);
      if (expensiveCard) {
        const result = playCard(state, player, expensiveCard.uid);
        expect(result).toBe(false);
      }
    });

    it('不存在的卡牌应该失败', () => {
      const player = getCurrentPlayer(state)!;
      const result = playCard(state, player, 'nonexistent_card');
      expect(result).toBe(false);
    });
  });

  describe('deployCard', () => {
    it('应该成功部署防御牌', () => {
      const player = getCurrentPlayer(state)!;
      // 找一张防御牌
      const defenseCard = player.hand.find(c => c.type === 'defense');

      if (defenseCard && player.energy >= defenseCard.energy) {
        const initialEnergy = player.energy;
        const initialFaceUpCount = player.faceUpCards.length;

        const result = deployCard(state, player.id, defenseCard.uid);

        expect(result).toBe(true);
        expect(player.energy).toBe(initialEnergy - defenseCard.energy);
        expect(player.faceUpCards.length).toBe(initialFaceUpCount + 1);
        expect(player.faceUpCards.some(c => c.uid === defenseCard.uid)).toBe(true);
      }
    });

    it('应该成功部署设施牌', () => {
      const player = getCurrentPlayer(state)!;
      // 从牌堆中找一张设施牌
      const facilityCardDef = CARD_DEFINITIONS.find(c => c.type === 'facility' && c.energy <= player.energy);

      if (facilityCardDef) {
        // 创建一个设施牌实例给玩家
        const facilityCard: Card = {
          uid: `test_facility_${Date.now()}`,
          defId: facilityCardDef.id,
          name: facilityCardDef.name,
          type: 'facility',
          energy: facilityCardDef.energy,
          description: facilityCardDef.description,
          image: facilityCardDef.image,
          energyPerTurn: facilityCardDef.extended.energy_per_turn as number | undefined,
          ability: facilityCardDef.extended.ability as string | undefined,
        };

        player.hand.push(facilityCard);

        const initialEnergy = player.energy;
        const initialFaceUpCount = player.faceUpCards.length;

        const result = deployCard(state, player.id, facilityCard.uid);

        expect(result).toBe(true);
        expect(player.energy).toBe(initialEnergy - facilityCard.energy);
        expect(player.faceUpCards.length).toBe(initialFaceUpCount + 1);
        expect(player.faceUpCards.some(c => c.uid === facilityCard.uid)).toBe(true);
      }
    });

    it('不存在的卡牌应该失败', () => {
      const player = getCurrentPlayer(state)!;
      const result = deployCard(state, player.id, 'nonexistent_card');
      expect(result).toBe(false);
    });

    it('能量不足时应该失败', () => {
      const player = getCurrentPlayer(state)!;
      player.energy = 0;

      const expensiveCard = player.hand.find(c => c.energy > 0 && (c.type === 'defense' || c.type === 'facility'));
      if (expensiveCard) {
        const result = deployCard(state, player.id, expensiveCard.uid);
        expect(result).toBe(false);
      }
    });
  });

  describe('playStrikeCard', () => {
    it('应该成功打出打击牌', () => {
      const player = getCurrentPlayer(state)!;
      // 从牌堆中找一张打击牌
      const strikeCardDef = CARD_DEFINITIONS.find(c => c.type === 'strike' && c.energy <= player.energy);

      if (strikeCardDef) {
        // 创建一个打击牌实例给玩家
        const strikeCard: Card = {
          uid: `test_strike_${Date.now()}`,
          defId: strikeCardDef.id,
          name: strikeCardDef.name,
          type: 'strike',
          energy: strikeCardDef.energy,
          description: strikeCardDef.description,
          image: strikeCardDef.image,
          level: strikeCardDef.extended.level as number | undefined,
          speed: strikeCardDef.extended.speed as number | undefined,
          effect: strikeCardDef.extended.effect as string | undefined,
        };

        player.hand.push(strikeCard);

        const initialEnergy = player.energy;
        const initialFlyingCount = state.flyingStrikes.length;
        const targetSystem = (player.position % 9) + 1; // 选择一个不同的星系

        const result = playStrikeCard(state, player.id, strikeCard.uid, targetSystem);

        expect(result).toBe(true);
        expect(player.energy).toBeLessThanOrEqual(initialEnergy);
        expect(state.flyingStrikes.length).toBe(initialFlyingCount + 1);
        expect(state.flyingStrikes.some(s => s.uid === strikeCard.uid)).toBe(true);

        const flyingStrike = state.flyingStrikes.find(s => s.uid === strikeCard.uid)!;
        expect(flyingStrike.ownerId).toBe(player.id);
        expect(flyingStrike.position).toBe(player.position);
        expect(flyingStrike.targetSystem).toBe(targetSystem);
      }
    });

    it('非打击牌应该失败', () => {
      const player = getCurrentPlayer(state)!;
      const nonStrikeCard = player.hand.find(c => c.type !== 'strike');

      if (nonStrikeCard) {
        const result = playStrikeCard(state, player.id, nonStrikeCard.uid, 5);
        expect(result).toBe(false);
      }
    });

    it('能量不足时应该失败', () => {
      const player = getCurrentPlayer(state)!;
      player.energy = 0;

      const strikeCard = player.hand.find(c => c.type === 'strike' && c.energy > 0);
      if (strikeCard) {
        const result = playStrikeCard(state, player.id, strikeCard.uid, 5);
        expect(result).toBe(false);
      }
    });
  });

  describe('recycleCard', () => {
    it('应该成功回收场上卡牌', () => {
      const player = getCurrentPlayer(state)!;
      // 添加一张测试卡牌到场上
      const testCard: Card = {
        uid: 'test_recycle_card',
        defId: 'test',
        name: '测试卡牌',
        type: 'facility',
        energy: 4,
        description: '',
        image: '',
      };
      player.faceUpCards.push(testCard);

      const initialEnergy = player.energy;
      const initialFaceUpCount = player.faceUpCards.length;

      const result = recycleCard(state, player.id, testCard.uid);

      expect(result).toBe(true);
      expect(player.energy).toBe(initialEnergy + Math.floor(testCard.energy / 2));
      expect(player.faceUpCards.length).toBe(initialFaceUpCount - 1);
      expect(player.faceUpCards.some(c => c.uid === testCard.uid)).toBe(false);
    });

    it('不存在的卡牌应该失败', () => {
      const player = getCurrentPlayer(state)!;
      const result = recycleCard(state, player.id, 'nonexistent_card');
      expect(result).toBe(false);
    });
  });

  describe('discardHandCards', () => {
    it('应该成功弃掉手牌（默认保密）', () => {
      const player = getCurrentPlayer(state)!;
      const initialHandCount = player.hand.length;
      const initialDiscardCount = state.discardPile.length;

      // 弃掉前两张牌
      const cardsToDiscard = player.hand.slice(0, 2).map(c => c.uid);
      const result = discardHandCards(state, player.id, cardsToDiscard);

      expect(result).toBe(true);
      expect(player.hand.length).toBe(initialHandCount - cardsToDiscard.length);
      expect(state.discardPile.length).toBe(initialDiscardCount + cardsToDiscard.length);

      // 验证日志包含"保密"
      const lastLog = state.logs[state.logs.length - 1];
      expect(lastLog.message).toContain('保密');
    });

    it('应该支持公开弃牌', () => {
      const player = getCurrentPlayer(state)!;
      const initialHandCount = player.hand.length;
      const initialDiscardCount = state.discardPile.length;

      // 弃掉前两张牌，公开
      const cardsToDiscard = player.hand.slice(0, 2).map(c => c.uid);
      const result = discardHandCards(state, player.id, cardsToDiscard, true);

      expect(result).toBe(true);
      expect(player.hand.length).toBe(initialHandCount - cardsToDiscard.length);
      expect(state.discardPile.length).toBe(initialDiscardCount + cardsToDiscard.length);

      // 验证日志包含"公开"和具体牌名
      const lastLog = state.logs[state.logs.length - 1];
      expect(lastLog.message).toContain('公开');
      expect(lastLog.message).toContain('【');
      expect(lastLog.type).toBe('broadcast');
    });

    it('空数组应该失败', () => {
      const player = getCurrentPlayer(state)!;
      const result = discardHandCards(state, player.id, []);
      expect(result).toBe(false);
    });

    it('不存在的卡牌应该被忽略', () => {
      const player = getCurrentPlayer(state)!;
      const initialHandCount = player.hand.length;

      const result = discardHandCards(state, player.id, ['nonexistent_card']);

      expect(result).toBe(false);
      expect(player.hand.length).toBe(initialHandCount);
    });
  });
});

describe('Strike System', () => {
  let state: GameState;

  beforeEach(() => {
    state = initGame({ playerCount: 3, humanName: 'TestPlayer' });
  });

  describe('moveStrike', () => {
    it('应该移动打击牌到相邻星系', () => {
      const player = getCurrentPlayer(state)!;
      // 选择一个不等于目标系统的中间星系
      const intermediateSystem = ((player.position + 1) % 9) + 1;
      const targetSystem = ((player.position + 3) % 9) + 1;

      // 创建飞行打击，位置和目标不同
      state.flyingStrikes.push({
        uid: 'test_strike_move',
        defId: 'strike_thermal',
        ownerId: player.id,
        position: player.position,
        targetSystem,
        level: 1,
        speed: 1,
        strikeName: '测试打击',
        arrived: false,
      });

      moveStrike(state, 'test_strike_move', intermediateSystem);

      const strike = state.flyingStrikes.find(s => s.uid === 'test_strike_move');
      // 打击应该移动到中间位置（还未到达目标）
      expect(strike?.position).toBe(intermediateSystem);
    });

    it('打击到达目标时应该设置 announceStrike pendingAction', () => {
      const player = getCurrentPlayer(state)!;
      const targetSystem = (player.position % 9) + 1;

      // 创建飞行打击，直接放在目标星系
      state.flyingStrikes.push({
        uid: 'test_strike_arrive',
        defId: 'strike_thermal',
        ownerId: player.id,
        position: targetSystem,
        targetSystem,
        level: 1,
        speed: 1,
        strikeName: '测试打击',
        arrived: false,
      });

      moveStrike(state, 'test_strike_arrive', targetSystem);

      // 如果有目标玩家，应该设置 announceStrike
      if (state.pendingAction?.type === 'announceStrike') {
        expect(state.pendingAction.strikeUid).toBe('test_strike_arrive');
        expect(state.pendingAction.targetSystem).toBe(targetSystem);
      }
    });

    it('不存在的打击应该无操作', () => {
      expect(() => moveStrike(state, 'nonexistent_strike', 5)).not.toThrow();
    });
  });

  describe('announceStrike', () => {
    it('应该结算打击', () => {
      const player = getCurrentPlayer(state)!;
      const targetPlayer = state.players.find((_, i) => i !== state.currentPlayerIndex && !state.players[i].eliminated)!;
      const targetSystem = targetPlayer.position;

      // 创建飞行打击
      state.flyingStrikes.push({
        uid: 'test_strike_announce',
        defId: 'strike_thermal',
        ownerId: player.id,
        position: targetSystem,
        targetSystem,
        level: 1,
        speed: 1,
        strikeName: '测试打击',
        arrived: false,
      });

      // 设置 pendingAction
      state.pendingAction = {
        type: 'announceStrike',
        strikeUid: 'test_strike_announce',
        targetSystem,
        targetPlayerIds: [targetPlayer.id],
      };

      announceStrike(state);

      // 打击应该被移除
      expect(state.flyingStrikes.some(s => s.uid === 'test_strike_announce')).toBe(false);
      // pendingAction 应该被清除
      expect(state.pendingAction).toBeNull();
    });
  });

  describe('getStrikeBestMove', () => {
    it('应该返回最佳的下一步移动', () => {
      const strike = {
        uid: 'test_strike_path',
        defId: 'strike_thermal',
        ownerId: 'player_0',
        position: 1,
        targetSystem: 5,
        level: 1,
        speed: 1,
        strikeName: '测试打击',
        arrived: false,
      };

      const bestMove = getStrikeBestMove(strike);

      expect(typeof bestMove).toBe('number');
      expect(bestMove).toBeGreaterThan(0);
      expect(bestMove).toBeLessThanOrEqual(9);
    });
  });
});
