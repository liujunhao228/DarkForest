// ============================
// 游戏状态管理 (Zustand Store)
// ============================
import { create } from 'zustand';
import {
  GameState, Card, FlyingStrike,
} from '@/lib/game/types';
import {
  initGame as engineInitGame,
  startTurn,
  drawPhase,
  endTurn,
  playStrikeCard,
  deployCard,
  initiateBroadcast,
  respondToBroadcast,
  selectBroadcastResponder,
  moveStrike,
  announceStrike,
  cancelBroadcast,
  recycleCard,
  executeLightspeedShip,
} from '@/lib/game/engine';
import type { InitConfig } from '@/lib/game/engine';
import { getSystemsInRange } from '@/lib/game/starmap';

interface GameStore extends GameState {
  // 初始化
  initGame: (config: InitConfig) => void;

  // 回合控制
  startDiscardPhase: () => void;
  endPlayerTurnWithDiscard: (discardUids: string[]) => void;
  skipStrikeMovement: () => void;

  // 卡牌操作
  deployDefenseOrFacility: (cardUid: string) => boolean;
  launchStrike: (cardUid: string, targetSystem: number) => boolean;
  startBroadcast: (cardUid: string, targetSystem: number) => void;
  doRecycleCard: (cardUid: string) => void;
  doUseLightspeedShip: () => void;

  // 打击移动
  moveStrikeTo: (strikeUid: string, targetSystem: number) => void;
  doAnnounceStrike: () => void;

  // 广播交互
  doRespondToBroadcast: (playerId: string, agreed: boolean, cardUid?: string) => void;
  doSelectBroadcastResponder: (responderId: string) => void;
  doCancelBroadcast: () => void;

  // 工具方法
  getHumanPlayer: () => Player | undefined;
  getCurrentPlayer: () => Player | undefined;
  getStrikeAtPosition: (systemId: number) => FlyingStrike | undefined;
  isHumanTurn: () => boolean;
  canPlayCard: (card: Card) => boolean;
  getValidBroadcastTargets: (card: Card) => number[];
  getValidStrikeTargets: (card: Card) => number[];
}

export const useGameStore = create<GameStore>((set, get) => ({
  // 初始状态
  phase: 'setup',
  totalTurn: 0,
  playerCount: 4,
  players: [],
  currentPlayerIndex: 0,
  humanPlayerId: 'player_0',
  drawPile: [],
  discardPile: [],
  flyingStrikes: [],
  broadcast: null,
  turnPhase: 'settlement',
  pendingAction: null,
  logs: [],
  winner: null,
  isProcessing: false,

  // 初始化游戏
  initGame: (config: InitConfig) => {
    const state = engineInitGame(config);
    set({
      ...state,
    });
    // 开始第一个回合
    const s = get();
    const newState = { ...s };
    startTurn(newState);
    set(newState);
  },

  // 进入弃牌阶段
  startDiscardPhase: () => {
    // 只是标记状态，让 UI 进入弃牌选择模式
    // 实际弃牌在 endPlayerTurnWithDiscard 中处理
  },

  // 弃牌并结束回合
  endPlayerTurnWithDiscard: (discardUids: string[]) => {
    const state = { ...get() };
    const player = state.players.find(p => p.id === state.humanPlayerId);
    if (!player) return;

    // 弃掉选择的牌
    for (const uid of discardUids) {
      const idx = player.hand.findIndex(c => c.uid === uid);
      if (idx >= 0) {
        const card = player.hand.splice(idx, 1)[0];
        state.discardPile.push(card);
      }
    }

    state.pendingAction = null;
    endTurn(state);
    set(state);
  },

  // 跳过打击移动（实际上不应该跳过，但UI可能需要）
  skipStrikeMovement: () => {
    const state = { ...get() };
    state.pendingAction = null;
    drawPhase(state);
    set(state);
  },

  // 部署防御/设施牌
  deployDefenseOrFacility: (cardUid: string) => {
    const state = { ...get() };
    const player = state.players.find(p => p.id === state.humanPlayerId);
    if (!player) return false;
    const success = deployCard(state, player.id, cardUid);
    if (success) {
      // 打出后补1张牌
      const drawn: Card[] = [];
      if (state.drawPile.length === 0 && state.discardPile.length > 0) {
        state.drawPile = [...state.discardPile].sort(() => Math.random() - 0.5);
        state.discardPile = [];
      }
      if (state.drawPile.length > 0) {
        drawn.push(state.drawPile.pop()!);
      }
      player.hand.push(...drawn);
    }
    set(state);
    return success;
  },

  // 发射打击
  launchStrike: (cardUid: string, targetSystem: number) => {
    const state = { ...get() };
    const success = playStrikeCard(state, state.humanPlayerId, cardUid, targetSystem);
    if (success) {
      // 补1张牌
      const drawn: Card[] = [];
      if (state.drawPile.length === 0 && state.discardPile.length > 0) {
        state.drawPile = [...state.discardPile].sort(() => Math.random() - 0.5);
        state.discardPile = [];
      }
      if (state.drawPile.length > 0) {
        drawn.push(state.drawPile.pop()!);
      }
      const p = state.players.find(pp => pp.id === state.humanPlayerId)!;
      p.hand.push(...drawn);
    }
    set(state);
    return success;
  },

  // 开始广播
  startBroadcast: (cardUid: string, targetSystem: number) => {
    const state = { ...get() };
    initiateBroadcast(state, state.humanPlayerId, cardUid, targetSystem);
    set(state);
  },

  // 回收门牌
  doRecycleCard: (cardUid: string) => {
    const state = { ...get() };
    recycleCard(state, state.humanPlayerId, cardUid);
    set(state);
  },

  // 使用光速飞船
  doUseLightspeedShip: () => {
    const state = { ...get() };
    executeLightspeedShip(state, state.humanPlayerId);
    set(state);
  },

  // 移动打击牌
  moveStrikeTo: (strikeUid: string, targetSystem: number) => {
    const state = { ...get() };
    moveStrike(state, strikeUid, targetSystem);
    set(state);
  },

  // 宣布打击生效
  doAnnounceStrike: () => {
    const state = { ...get() };
    announceStrike(state);
    set(state);
  },

  // 回应广播
  doRespondToBroadcast: (playerId: string, agreed: boolean, cardUid?: string) => {
    const state = { ...get() };
    respondToBroadcast(state, playerId, agreed, cardUid);
    set(state);
  },

  // 选择广播回应者
  doSelectBroadcastResponder: (responderId: string) => {
    const state = { ...get() };
    selectBroadcastResponder(state, responderId);
    set(state);
  },

  // 取消广播
  doCancelBroadcast: () => {
    const state = { ...get() };
    cancelBroadcast(state);
    set(state);
  },

  // 工具方法
  getHumanPlayer: () => {
    const state = get();
    return state.players.find(p => p.id === state.humanPlayerId);
  },

  getCurrentPlayer: () => {
    const state = get();
    return state.players[state.currentPlayerIndex];
  },

  getStrikeAtPosition: (systemId: number) => {
    const state = get();
    return state.flyingStrikes.find(s => s.position === systemId);
  },

  isHumanTurn: () => {
    const state = get();
    return state.players[state.currentPlayerIndex]?.id === state.humanPlayerId;
  },

  canPlayCard: (card: Card) => {
    const state = get();
    const player = state.players.find(p => p.id === state.humanPlayerId);
    if (!player) return false;
    return player.energy >= card.energy;
  },

  getValidBroadcastTargets: (card: Card) => {
    const state = get();
    const player = state.players.find(p => p.id === state.humanPlayerId);
    if (!player) return [];
    const range = card.range ?? 1;
    if (range >= 100) return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(s => s !== player.position);
    return getSystemsInRange(player.position, range);
  },

  getValidStrikeTargets: (_card: Card) => {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  },
}));
