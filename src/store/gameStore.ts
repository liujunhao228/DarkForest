// ============================
// 游戏状态管理 (Zustand Store)
// ============================
//
// 重构后的交互逻辑说明：
// - 玩家直接点击手牌中的卡牌来使用
// - 防御/设施牌：点击直接部署到场上
// - 打击牌：点击弹出星图选择目标星系
// - 广播牌：点击弹出星图选择目标星系
// - 回收：点击"回收门牌"按钮后，点击场上门牌回收
// ============================
import { create } from 'zustand';
import type { Player } from '@/lib/game/types';
import type {
  GameState,
  Card,
  FlyingStrike,
  InitConfig,
} from '@/lib/game/engine';
import {
  initGame,
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
  discardHandCards,
  resolveBroadcast,
  addLogEntry,
} from '@/lib/game/engine';
import { getSystemsInRange } from '@/lib/game/starmap';

/**
 * 创建状态的深度副本
 * 使用 JSON 序列化确保嵌套对象也被复制
 */
function cloneState<T extends GameState>(state: T): T {
  return JSON.parse(JSON.stringify(state));
}

interface GameStore extends GameState {
  // 初始化
  initGame: (config: InitConfig) => void;

  // 回合控制
  skipStrikeMovement: () => void;
  endTurn: (discardCardUids?: string[]) => void;

  // 卡牌操作
  deployDefenseOrFacility: (cardUid: string) => boolean;
  launchStrike: (cardUid: string, targetSystem: number, targetPlayerId?: string) => boolean;
  startBroadcast: (cardUid: string, targetSystem: number) => void;
  doRecycleCard: (cardUid: string) => void;
  doUseLightspeedShip: () => void;
  discardCards: (cardUids: string[]) => void;

  // 打击移动
  moveStrikeTo: (strikeUid: string, targetSystem: number) => void;
  doAnnounceStrike: () => void;

  // 广播交互
  doRespondToBroadcast: (playerId: string, agreed: boolean, cardUid?: string) => void;
  doSelectBroadcastResponder: (responderId: string) => void;
  doCancelBroadcast: () => void;
  
  // AI vs AI 广播自动结算
  scheduleAiVsAiResolve: () => void;

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
  destroyedStars: [],

  // 初始化游戏
  initGame: (config: InitConfig) => {
    const state = initGame(config);
    set(cloneState(state));
    // 开始第一个回合
    startTurn(state);
    set(cloneState(state));
  },

  // 跳过打击移动
  skipStrikeMovement: () => {
    const state = cloneState(get());
    state.pendingAction = null;
    drawPhase(state);
    set(cloneState(state));
  },

  // 结束回合
  endTurn: (discardCardUids?: string[]) => {
    const state = cloneState(get());
    endTurn(state, discardCardUids ?? []);
    set(cloneState(state));
  },

  // 部署防御/设施牌
  deployDefenseOrFacility: (cardUid: string) => {
    const state = cloneState(get());
    const player = state.players.find(p => p.id === state.humanPlayerId);
    if (!player) return false;
    const success = deployCard(state, player.id, cardUid);
    set(cloneState(state));
    return success;
  },

  // 发射打击
  launchStrike: (cardUid: string, targetSystem: number, targetPlayerId?: string) => {
    const state = cloneState(get());
    const success = playStrikeCard(state, state.humanPlayerId, cardUid, targetSystem, targetPlayerId);
    set(cloneState(state));
    return success;
  },

  // 开始广播
  startBroadcast: (cardUid: string, targetSystem: number) => {
    const state = cloneState(get());
    initiateBroadcast(state, state.humanPlayerId, cardUid, targetSystem);
    set(cloneState(state));
    
    // 如果是 AI vs AI 广播，调度自动结算
    if (state.broadcast?.isAIVsAI) {
      get().scheduleAiVsAiResolve();
    }
  },

  // 回收门牌
  doRecycleCard: (cardUid: string) => {
    const state = cloneState(get());
    recycleCard(state, state.humanPlayerId, cardUid);
    set(cloneState(state));
  },

  // 使用光速飞船
  doUseLightspeedShip: () => {
    const state = cloneState(get());
    executeLightspeedShip(state, state.humanPlayerId);
    set(cloneState(state));
  },

  // 弃牌
  discardCards: (cardUids: string[]) => {
    const state = cloneState(get());
    discardHandCards(state, state.humanPlayerId, cardUids);
    set(cloneState(state));
  },

  // 移动打击牌
  moveStrikeTo: (strikeUid: string, targetSystem: number) => {
    const state = cloneState(get());
    moveStrike(state, strikeUid, targetSystem);
    set(cloneState(state));
  },

  // 宣布打击生效
  doAnnounceStrike: () => {
    const state = cloneState(get());
    announceStrike(state);
    set(cloneState(state));
  },

  // 回应广播
  doRespondToBroadcast: (playerId: string, agreed: boolean, cardUid?: string) => {
    const state = cloneState(get());
    respondToBroadcast(state, playerId, agreed, cardUid);
    set(cloneState(state));
  },

  // 选择广播回应者
  doSelectBroadcastResponder: (responderId: string) => {
    const state = cloneState(get());
    selectBroadcastResponder(state, responderId);
    set(cloneState(state));
  },

  // 取消广播
  doCancelBroadcast: () => {
    const state = cloneState(get());
    cancelBroadcast(state);
    set(cloneState(state));
  },

  // AI vs AI 广播自动结算
  scheduleAiVsAiResolve: () => {
    const state = get();
    if (!state.broadcast || !state.broadcast.isAIVsAI) return;
    
    const delay = state.broadcast.autoResolveAfterMs ?? 2500;
    
    setTimeout(() => {
      const currentState = cloneState(get());
      if (!currentState.broadcast || !currentState.broadcast.isAIVsAI) return;
      
      const respondedPlayers = currentState.broadcast.responses.filter(r => r.responded && r.agreed);
      const broadcaster = currentState.players.find(p => p.id === currentState.broadcast!.broadcasterId);
      
      if (respondedPlayers.length > 0) {
        // 有回应者，结算
        currentState.broadcast.selectedResponderId = respondedPlayers[0].playerId;
        currentState.broadcast.phase = 'resolve';
        resolveBroadcast(currentState);
        addLogEntry(currentState, `✅ ${broadcaster?.name} 的广播已自动结算`, 'system');
      } else {
        // 无人回应，取消广播
        broadcaster!.energy += 1;
        currentState.discardPile.push(currentState.broadcast.card);
        addLogEntry(currentState, `❌ 无人回应 ${broadcaster?.name} 的广播，获得 1 点能量`, 'broadcast');
        currentState.broadcast = null;
      }
      
      set(cloneState(currentState));
    }, delay);
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
