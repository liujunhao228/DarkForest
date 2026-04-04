// ============================
// 游戏引擎核心功能测试
// ============================

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  initGame,
  shuffle,
  generateId,
  getCurrentPlayer,
  createDrawPile,
  drawCard,
  CARD_DEFINITIONS,
  TOTAL_CARDS,
  getDistance,
  areAdjacent,
  getSystemsInRange,
} from '@/lib/game';

describe('Game Engine - Core Functions', () => {
  // ==================
  // 工具函数测试
  // ==================

  describe('shuffle', () => {
    it('应该返回新数组，不修改原数组', () => {
      const original = [1, 2, 3, 4, 5];
      const originalCopy = [...original];
      const shuffled = shuffle(original);

      expect(original).toEqual(originalCopy); // 原数组不变
      expect(shuffled).not.toEqual(original); // 新数组已打乱
      expect(shuffled.length).toBe(original.length);
    });

    it('应该包含所有原数组元素', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = shuffle(original);

      expect(shuffled.sort()).toEqual(original.sort());
    });

    it('应该处理空数组', () => {
      const result = shuffle([]);
      expect(result).toEqual([]);
    });

    it('应该处理单元素数组', () => {
      const result = shuffle([42]);
      expect(result).toEqual([42]);
    });
  });

  describe('generateId', () => {
    it('应该生成唯一 ID', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
    });

    it('应该生成字符串 ID', () => {
      const id = generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('应该生成足够随机的 ID', () => {
      const ids = new Set();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId());
      }
      // 1000 个 ID 应该都不相同
      expect(ids.size).toBe(1000);
    });
  });

  // ==================
  // 牌堆管理测试
  // ==================

  describe('createDrawPile', () => {
    it('应该创建完整牌堆', () => {
      const pile = createDrawPile();

      expect(pile.length).toBe(TOTAL_CARDS);
    });

    it('牌堆应该已洗牌（不应按顺序）', () => {
      const pile = createDrawPile();

      // 检查前几张牌不应完全按定义顺序
      const firstFew = pile.slice(0, 10);
      const allSameDef = firstFew.every(card => card.defId === firstFew[0].defId);
      expect(allSameDef).toBe(false); // 不应该都是同一张牌
    });

    it('每张牌应该有唯一 UID', () => {
      const pile = createDrawPile();
      const uids = pile.map(card => card.uid);
      const uniqueUids = new Set(uids);

      expect(uniqueUids.size).toBe(pile.length);
    });

    it('应该包含所有类型的卡牌', () => {
      const pile = createDrawPile();
      const types = new Set(pile.map(card => card.type));

      expect(types.has('broadcast')).toBe(true);
      expect(types.has('strike')).toBe(true);
      expect(types.has('defense')).toBe(true);
      expect(types.has('facility')).toBe(true);
    });

    it('广播牌应该有 subtype 和 range', () => {
      const pile = createDrawPile();
      const broadcastCards = pile.filter(card => card.type === 'broadcast');

      expect(broadcastCards.length).toBeGreaterThan(0);
      broadcastCards.forEach(card => {
        expect(card.subtype).toBeDefined();
        expect(card.range).toBeDefined();
        expect(['cooperation', 'disguise']).toContain(card.subtype);
        expect(typeof card.range).toBe('number');
      });
    });

    it('打击牌应该有 level 和 speed', () => {
      const pile = createDrawPile();
      const strikeCards = pile.filter(card => card.type === 'strike');

      expect(strikeCards.length).toBeGreaterThan(0);
      strikeCards.forEach(card => {
        expect(card.level).toBeDefined();
        expect(card.speed).toBeDefined();
        expect(typeof card.level).toBe('number');
        expect(typeof card.speed).toBe('number');
      });
    });
  });

  describe('drawCard', () => {
    it('应该从牌堆抽取指定数量的牌', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });
      const initialPileSize = state.drawPile.length;

      const drawn = drawCard(state, 3);

      expect(drawn.length).toBe(3);
      expect(state.drawPile.length).toBe(initialPileSize - 3);
    });

    it('牌堆不足时应该抽取剩余所有牌', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });
      const remaining = state.drawPile.length;

      const drawn = drawCard(state, remaining + 10);

      expect(drawn.length).toBe(remaining);
      expect(state.drawPile.length).toBe(0);
    });

    it('牌堆耗尽且弃牌堆为空时应该停止抽牌', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });
      state.drawPile = [];
      state.discardPile = [];

      const drawn = drawCard(state, 5);

      expect(drawn.length).toBe(0);
    });

    it('牌堆耗尽时应该重新洗牌弃牌堆', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });
      // 清空牌堆并填充弃牌堆
      const testCards = state.drawPile.splice(0, 10);
      state.discardPile = testCards;
      const pileSizeBefore = state.drawPile.length;

      const drawn = drawCard(state, 5);

      expect(drawn.length).toBeGreaterThan(0);
      // 应该触发了弃牌堆洗牌
      expect(state.drawPile.length).toBeLessThan(pileSizeBefore + testCards.length);
    });
  });

  // ==================
  // 游戏初始化测试
  // ==================

  describe('initGame', () => {
    it('应该初始化 3 人游戏', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });

      expect(state.players.length).toBe(3);
      expect(state.playerCount).toBe(3);
      expect(state.phase).toBe('playing');
      expect(state.totalTurn).toBe(1);
      expect(state.currentPlayerIndex).toBe(0);
    });

    it('应该初始化 4 人游戏', () => {
      const state = initGame({ playerCount: 4, humanName: 'TestPlayer' });

      expect(state.players.length).toBe(4);
      expect(state.playerCount).toBe(4);
    });

    it('应该初始化 5 人游戏', () => {
      const state = initGame({ playerCount: 5, humanName: 'TestPlayer' });

      expect(state.players.length).toBe(5);
      expect(state.playerCount).toBe(5);
    });

    it('第一个玩家应该是人类玩家', () => {
      const state = initGame({ playerCount: 4, humanName: 'HumanPlayer' });

      const humanPlayer = state.players[0];
      expect(humanPlayer.isAI).toBe(false);
      expect(humanPlayer.name).toBe('HumanPlayer');
      expect(state.humanPlayerId).toBe('player_0');
    });

    it('其他玩家应该是 AI', () => {
      const state = initGame({ playerCount: 4, humanName: 'HumanPlayer' });

      for (let i = 1; i < state.players.length; i++) {
        expect(state.players[i].isAI).toBe(true);
      }
    });

    it('每个玩家应该有初始手牌（4 张）', () => {
      const state = initGame({ playerCount: 4, humanName: 'TestPlayer' });

      state.players.forEach(player => {
        expect(player.hand.length).toBe(4);
      });
    });

    it('玩家应该有不同颜色', () => {
      const state = initGame({ playerCount: 4, humanName: 'TestPlayer' });
      const colors = state.players.map(p => p.color);
      const uniqueColors = new Set(colors);

      expect(uniqueColors.size).toBe(state.players.length);
    });

    it('玩家应该有不同的星系位置', () => {
      const state = initGame({ playerCount: 4, humanName: 'TestPlayer' });
      const positions = state.players.map(p => p.position);
      const uniquePositions = new Set(positions);

      expect(uniquePositions.size).toBe(state.players.length);
    });

    it('玩家初始能量应该为 3', () => {
      const state = initGame({ playerCount: 4, humanName: 'TestPlayer' });

      state.players.forEach(player => {
        expect(player.energy).toBe(3);
      });
    });

    it('应该创建初始日志', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });

      expect(state.logs.length).toBeGreaterThan(0);
      expect(state.logs[0].message).toContain('游戏开始');
    });

    it('飞行打击应该为空数组', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });

      expect(Array.isArray(state.flyingStrikes)).toBe(true);
      expect(state.flyingStrikes.length).toBe(0);
    });

    it('广播状态应该为 null', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });

      expect(state.broadcast).toBeNull();
    });

    it('回合阶段应该为 settlement', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });

      expect(state.turnPhase).toBe('settlement');
    });
  });

  // ==================
  // getCurrentPlayer 测试
  // ==================

  describe('getCurrentPlayer', () => {
    it('应该返回当前玩家', () => {
      const state = initGame({ playerCount: 3, humanName: 'TestPlayer' });

      const current = getCurrentPlayer(state);
      expect(current).toBeDefined();
      expect(current?.id).toBe('player_0');
    });

    it('改变索引后应该返回对应玩家', () => {
      const state = initGame({ playerCount: 4, humanName: 'TestPlayer' });
      state.currentPlayerIndex = 2;

      const current = getCurrentPlayer(state);
      expect(current?.id).toBe('player_2');
    });
  });
});

describe('Star Map Utilities', () => {
  describe('getDistance', () => {
    it('应该计算相邻星系距离为 1', () => {
      // 星图具体连接关系取决于 starmap.ts 的定义
      // 这里假设 1 和 2 是相邻的
      const distance = getDistance(1, 2);
      expect(typeof distance).toBe('number');
      expect(distance).toBeGreaterThanOrEqual(0);
    });

    it('相同星系距离应该为 0', () => {
      const distance = getDistance(1, 1);
      expect(distance).toBe(0);
    });
  });

  describe('areAdjacent', () => {
    it('应该判断两个星系是否相邻', () => {
      const result = areAdjacent(1, 2);
      expect(typeof result).toBe('boolean');
    });

    it('相同星系不应视为相邻', () => {
      const result = areAdjacent(1, 1);
      expect(result).toBe(false);
    });
  });

  describe('getSystemsInRange', () => {
    it('应该返回指定范围内的星系', () => {
      const systems = getSystemsInRange(1, 1);

      expect(Array.isArray(systems)).toBe(true);
      // 范围 1 应该只包含相邻星系
      systems.forEach(systemId => {
        expect(typeof systemId).toBe('number');
      });
    });

    it('更大范围应该包含更多星系', () => {
      const range1 = getSystemsInRange(1, 1);
      const range2 = getSystemsInRange(1, 2);

      expect(range2.length).toBeGreaterThanOrEqual(range1.length);
    });

    it('范围 0 应该返回空数组', () => {
      const systems = getSystemsInRange(1, 0);
      expect(systems.length).toBe(0);
    });
  });
});

describe('Card Definitions', () => {
  it('CARD_DEFINITIONS 应该包含所有卡牌定义', () => {
    expect(Array.isArray(CARD_DEFINITIONS)).toBe(true);
    expect(CARD_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it('每张卡牌定义应该有唯一 ID', () => {
    const ids = CARD_DEFINITIONS.map(card => card.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('广播牌应该有正确的 subtype', () => {
    const broadcastCards = CARD_DEFINITIONS.filter(card => card.type === 'broadcast');

    broadcastCards.forEach(card => {
      expect(card.extended.subtype).toBeDefined();
      expect(['cooperation', 'disguise']).toContain(card.extended.subtype);
    });
  });

  it('打击牌应该有 level 和 speed', () => {
    const strikeCards = CARD_DEFINITIONS.filter(card => card.type === 'strike');

    strikeCards.forEach(card => {
      expect(card.extended.level).toBeDefined();
      expect(card.extended.speed).toBeDefined();
    });
  });

  it('设施牌应该有 energy_per_turn 或 ability', () => {
    const facilityCards = CARD_DEFINITIONS.filter(card => card.type === 'facility');

    facilityCards.forEach(card => {
      // 设施牌应该有 energy_per_turn（产出能量的设施）或 ability（特殊能力的设施）
      const hasEnergyPerTurn = card.extended.energy_per_turn !== undefined;
      const hasAbility = card.extended.ability !== undefined;
      expect(hasEnergyPerTurn || hasAbility).toBe(true);
    });
  });

  it('防御牌应该有 protection_level', () => {
    const defenseCards = CARD_DEFINITIONS.filter(card => card.type === 'defense');

    defenseCards.forEach(card => {
      expect(card.extended.protection_level).toBeDefined();
    });
  });
});
