// ============================
// 游戏引擎 - 核心入口
// ============================
// 本文件聚合所有游戏引擎模块，提供统一的导出接口
// ============================

import { GameState, Player, InitConfig } from './types';
import { shuffle, generateId } from './utils';
import { createDrawPile } from './deck';

// ==================
// 初始化游戏
// ==================

const AI_NAMES = ['三体文明', '歌者文明', '归零者', '魔戒文明'];
const PLAYER_COLORS: Array<'red' | 'blue' | 'green' | 'amber' | 'purple'> = ['red', 'blue', 'green', 'amber', 'purple'];

/**
 * 初始化游戏状态
 */
export function initGame(config: InitConfig): GameState {
  const drawPile = createDrawPile();
  const players: Player[] = [];

  // 生成不重复的星系位置
  const positions = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, config.playerCount);

  for (let i = 0; i < config.playerCount; i++) {
    players.push({
      id: `player_${i}`,
      name: i === 0 ? config.humanName : AI_NAMES[i - 1],
      color: PLAYER_COLORS[i],
      position: positions[i],
      energy: 3,
      hand: [],
      faceUpCards: [],
      eliminated: false,
      broadcastHistory: [],
    });
  }

  // 发初始手牌（每人 4 张）
  for (const player of players) {
    for (let i = 0; i < 4; i++) {
      if (drawPile.length > 0) {
        player.hand.push(drawPile.pop()!);
      }
    }
  }

  return {
    phase: 'playing',
    totalTurn: 1,
    playerCount: config.playerCount,
    players,
    currentPlayerIndex: 0,
    currentPlayerId: players[0].id,
    localPlayerId: 'player_0',
    drawPile,
    discardPile: [],
    flyingStrikes: [],
    broadcast: null,
    turnPhase: 'turnBegin',
    pendingAction: null,
    logs: [{ id: generateId(), turn: 0, phase: 'system', message: '游戏开始！隐藏自己，做好清理。', type: 'system' }],
    winner: null,
    isProcessing: false,
    destroyedStars: [],
  };
}

// ==================
// 模块导出
// ==================

// 牌堆管理
export { createDrawPile, drawCard } from './deck';

// 工具函数
export { shuffle, generateId, addLog, getCurrentPlayer } from './utils';

// 回合流程
export {
  startTurn,
  drawPhase,
  actionPhase,
  afterStrikeMove,
  endTurn,
  advanceToNextPlayer,
  executeLightspeedShip,
  interruptTurn,
  resumeTurn,
} from './turn';

// 结算阶段
export { settlementPhase } from './settlement';

// 打击系统
export {
  moveStrike,
  resolveStrike,
  announceStrike,
  skipAnnounceStrike,
  getStrikeBestMove,
} from './strike';

// 广播系统
export {
  initiateBroadcast,
  respondToBroadcast,
  selectBroadcastResponder,
  resolveBroadcast,
  cancelBroadcast,
  isSystemInRange,
  getPlayersAtSystem,
} from './broadcast';

// 卡牌操作
export {
  playCard,
  deployCard,
  playStrikeCard,
  recycleCard,
  discardHandCards,
} from './cards-actions';

// 游戏数据
export { CARD_DEFINITIONS, TOTAL_CARDS } from './cards';
export {
  STAR_NODES,
  STAR_EDGES,
  ADJACENCY,
  getDistance,
  getSystemsInRange,
  areAdjacent,
} from './starmap';

// 类型导出
export type {
  CardType,
  BroadcastSubtype,
  GamePhase,
  TurnPhase,
  PlayerColor,
  CardDef,
  Card,
  Player,
  FlyingStrike,
  BroadcastState,
  BroadcastResponse,
  LogEntry,
  GameState,
  PendingAction,
  BroadcastResult,
  StarNode,
  StarEdge,
  InitConfig,
} from './types';
