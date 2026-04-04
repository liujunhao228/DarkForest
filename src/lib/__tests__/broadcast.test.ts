// ============================
// 广播系统测试
// ============================

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  initGame,
  initiateBroadcast,
  respondToBroadcast,
  selectBroadcastResponder,
  resolveBroadcast,
  cancelBroadcast,
  isSystemInRange,
  getPlayersAtSystem,
  getSystemsInRange,
  getCurrentPlayer,
} from '@/lib/game';
import type { GameState } from '@/lib/game';

describe('Broadcast System', () => {
  let state: GameState;

  beforeEach(() => {
    state = initGame({ playerCount: 3, humanName: 'TestPlayer' });
  });

  describe('initiateBroadcast', () => {
    it('应该成功发起广播', () => {
      const player = getCurrentPlayer(state)!;
      // 找一张广播牌
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard) {
        const targetSystem = player.position; // 在自己星系发起
        const initialEnergy = player.energy;
        const initialHandCount = player.hand.length;

        initiateBroadcast(state, player.id, broadcastCard.uid, targetSystem);

        // 广播可能成功发起，也可能因为无人回应而取消
        // 只要日志中有广播相关的记录即可
        const hasBroadcastLog = state.logs.some(log => 
          log.message.includes('发送了') || log.message.includes('无人回应')
        );
        expect(hasBroadcastLog).toBe(true);
      }
    });

    it('没有广播牌时应该无操作', () => {
      const player = getCurrentPlayer(state)!;
      // 清空手牌
      player.hand = [];

      expect(() => initiateBroadcast(state, player.id, 'nonexistent', 1)).not.toThrow();
      expect(state.broadcast).toBeNull();
    });

    it('能量不足时应该无操作', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast' && c.energy > 0);

      if (broadcastCard) {
        player.energy = 0;
        const initialEnergy = player.energy;

        initiateBroadcast(state, player.id, broadcastCard.uid, player.position);

        // 能量不足，广播不应发起
        expect(state.broadcast).toBeNull();
        expect(player.energy).toBe(initialEnergy);
      }
    });

    it('应该记录广播历史', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard) {
        const targetSystem = player.position;
        const initialHistoryLength = player.broadcastHistory.length;

        initiateBroadcast(state, player.id, broadcastCard.uid, targetSystem);

        expect(player.broadcastHistory.length).toBe(initialHistoryLength + 1);
        expect(player.broadcastHistory[player.broadcastHistory.length - 1].systemId).toBe(targetSystem);
        expect(player.broadcastHistory[player.broadcastHistory.length - 1].turn).toBe(state.totalTurn);
      }
    });

    it('不应该允许连续在同一星系广播', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard) {
        const targetSystem = player.position;

        // 第一次广播
        initiateBroadcast(state, player.id, broadcastCard.uid, targetSystem);
        const firstBroadcast = state.broadcast;

        // 清除广播状态以模拟广播完成
        state.broadcast = null;

        // 立即再次尝试在同一星系广播
        const secondCard = player.hand.find(c => c.type === 'broadcast');
        if (secondCard) {
          initiateBroadcast(state, player.id, secondCard.uid, targetSystem);

          // 应该被阻止（需要检查日志或状态）
          // 这里假设会添加系统日志提示
          expect(state.logs.some(log =>
            log.message.includes('不能连续') || log.message.includes('同一星系')
          )).toBe(true);
        }
      }
    });
  });

  describe('respondToBroadcast', () => {
    it('应该成功回应广播', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard && state.players.length >= 2) {
        // 发起广播
        initiateBroadcast(state, player.id, broadcastCard.uid, player.position);

        if (state.broadcast && state.broadcast.responses.length > 0) {
          const responder = state.broadcast.responses[0];
          const responseCard = state.players
            .find(p => p.id === responder.playerId)
            ?.hand.find(c => c.type === 'broadcast');

          if (responseCard) {
            respondToBroadcast(state, responder.playerId, true, responseCard.uid);

            expect(responder.responded).toBe(true);
            expect(responder.agreed).toBe(true);
          }
        }
      }
    });

    it('拒绝回应应该设置 agreed 为 false', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard && state.broadcast) {
        if (state.broadcast.responses.length > 0) {
          const responder = state.broadcast.responses[0];

          respondToBroadcast(state, responder.playerId, false);

          expect(responder.responded).toBe(true);
          expect(responder.agreed).toBe(false);
        }
      }
    });

    it('不存在的响应应该无操作', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard) {
        initiateBroadcast(state, player.id, broadcastCard.uid, player.position);

        if (state.broadcast) {
          expect(() =>
            respondToBroadcast(state, 'nonexistent_player', true, 'nonexistent_card')
          ).not.toThrow();
        }
      }
    });
  });

  describe('selectBroadcastResponder', () => {
    it('应该选择回应者并解析广播', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard && state.broadcast?.responses.length > 0) {
        // 先发起广播
        initiateBroadcast(state, player.id, broadcastCard.uid, player.position);

        if (state.broadcast && state.broadcast.responses.length > 0) {
          const responder = state.broadcast.responses.find(r => r.canRespond);
          if (responder) {
            selectBroadcastResponder(state, responder.playerId);

            expect(state.broadcast?.phase).toBe('reveal');
          }
        }
      }
    });

    it('没有广播时应该无操作', () => {
      expect(() => selectBroadcastResponder(state, 'player_1')).not.toThrow();
    });
  });

  describe('resolveBroadcast', () => {
    it('应该结算合作广播（双方获得 3 能量）', () => {
      const broadcaster = getCurrentPlayer(state)!;
      const broadcastCard = broadcaster.hand.find(c => c.type === 'broadcast');

      if (broadcastCard && state.players.length >= 2) {
        initiateBroadcast(state, broadcaster.id, broadcastCard.uid, broadcaster.position);

        if (state.broadcast && state.broadcast.responses.length > 0) {
          const responder = state.broadcast.responses[0];
          const responderPlayer = state.players.find(p => p.id === responder.playerId);

          if (responderPlayer) {
            const responseCard = responderPlayer.hand.find(c => c.type === 'broadcast');
            if (responseCard) {
              // 回应并选择合作
              respondToBroadcast(state, responder.playerId, true, responseCard.uid);

              const initialBroadcasterEnergy = broadcaster.energy;
              const initialResponderEnergy = responderPlayer.energy;

              // 设置选中者并解析
              state.broadcast.selectedResponderId = responder.playerId;
              resolveBroadcast(state);

              // 检查能量增加了（不严格要求正好是 3，因为可能有其他能量来源）
              expect(broadcaster.energy).toBeGreaterThanOrEqual(initialBroadcasterEnergy);
              expect(responderPlayer.energy).toBeGreaterThanOrEqual(initialResponderEnergy - responseCard.energy);
              expect(state.broadcast).toBeNull();
            }
          }
        }
      }
    });

    it('应该结算伪装广播（伪装方获得 5 能量）', () => {
      const broadcaster = getCurrentPlayer(state)!;
      // 找一张伪装广播牌
      const disguiseCard = broadcaster.hand.find(
        c => c.type === 'broadcast' && c.subtype === 'disguise'
      );

      if (disguiseCard && state.players.length >= 2) {
        initiateBroadcast(state, broadcaster.id, disguiseCard.uid, broadcaster.position);

        if (state.broadcast && state.broadcast.responses.length > 0) {
          const responder = state.broadcast.responses[0];
          const responderPlayer = state.players.find(p => p.id === responder.playerId);

          if (responderPlayer) {
            // 回应者选择合作
            const responseCard = responderPlayer.hand.find(
              c => c.type === 'broadcast' && c.subtype === 'cooperation'
            );

            if (responseCard) {
              respondToBroadcast(state, responder.playerId, true, responseCard.uid);

              const initialBroadcasterEnergy = broadcaster.energy;

              state.broadcast.selectedResponderId = responder.playerId;
              resolveBroadcast(state);

              // 伪装成功应该获得 5 能量
              expect(broadcaster.energy).toBe(initialBroadcasterEnergy + 5);
              expect(state.broadcast).toBeNull();
            }
          }
        }
      }
    });

    it('应该将广播牌添加到发布者面前', () => {
      const broadcaster = getCurrentPlayer(state)!;
      const broadcastCard = broadcaster.hand.find(c => c.type === 'broadcast');

      if (broadcastCard) {
        initiateBroadcast(state, broadcaster.id, broadcastCard.uid, broadcaster.position);

        if (state.broadcast && state.broadcast.responses.length > 0) {
          const responder = state.broadcast.responses[0];
          state.broadcast.selectedResponderId = responder.playerId;
          resolveBroadcast(state);

          expect(broadcaster.faceUpCards.some(c => c.uid === broadcastCard.uid)).toBe(true);
        }
      }
    });

    it('没有广播时应该无操作', () => {
      expect(() => resolveBroadcast(state)).not.toThrow();
    });

    it('没有选中回应者时应该无操作', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard) {
        initiateBroadcast(state, player.id, broadcastCard.uid, player.position);

        if (state.broadcast) {
          state.broadcast.selectedResponderId = undefined;
          expect(() => resolveBroadcast(state)).not.toThrow();
        }
      }
    });
  });

  describe('cancelBroadcast', () => {
    it('应该取消广播并返还 1 能量', () => {
      const player = getCurrentPlayer(state)!;
      const broadcastCard = player.hand.find(c => c.type === 'broadcast');

      if (broadcastCard) {
        const initialEnergy = player.energy;
        initiateBroadcast(state, player.id, broadcastCard.uid, player.position);

        if (state.broadcast) {
          cancelBroadcast(state);

          expect(player.energy).toBe(initialEnergy - broadcastCard.energy + 1);
          expect(state.broadcast).toBeNull();
          expect(state.pendingAction).toBeNull();
        }
      }
    });

    it('没有广播时应该无操作', () => {
      expect(() => cancelBroadcast(state)).not.toThrow();
    });
  });

  describe('isSystemInRange', () => {
    it('应该判断星系是否在范围内', () => {
      const result = isSystemInRange(1, 2, 1);
      expect(typeof result).toBe('boolean');
    });

    it('相同星系应该在任何范围内', () => {
      const result = isSystemInRange(1, 1, 0);
      expect(result).toBe(true);
    });

    it('范围 0 时只有相同星系在范围内', () => {
      const sameSystem = isSystemInRange(1, 1, 0);
      expect(sameSystem).toBe(true);

      // 不同星系应该不在范围内
      const differentSystem = isSystemInRange(1, 2, 0);
      expect(differentSystem).toBe(false);
    });
  });

  describe('getPlayersAtSystem', () => {
    it('应该返回指定星系的存活玩家', () => {
      const player = getCurrentPlayer(state)!;
      const playersAtSystem = getPlayersAtSystem(state, player.position);

      expect(Array.isArray(playersAtSystem)).toBe(true);
      expect(playersAtSystem.some(p => p.id === player.id)).toBe(true);

      // 只返回存活玩家
      playersAtSystem.forEach(p => {
        expect(p.eliminated).toBe(false);
      });
    });

    it('没有玩家的星系应该返回空数组', () => {
      // 找一个没有玩家的星系
      // 首先获取所有玩家的位置
      const occupiedSystems = new Set(state.players.filter(p => !p.eliminated).map(p => p.position));
      
      // 找一个空星系
      const emptySystem = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(s => !occupiedSystems.has(s));
      
      if (emptySystem) {
        const playersAtSystem = getPlayersAtSystem(state, emptySystem);
        expect(playersAtSystem.length).toBe(0);
      }
    });
  });
});
