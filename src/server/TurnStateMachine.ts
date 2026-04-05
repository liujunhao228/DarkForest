// ============================
// 黑暗森林 - 回合状态机
// ============================
// 管理完整的回合流程，包括阶段转换、玩家操作
// 开发阶段移除超时自动推进，方便调试
// ============================

import type { GameState, Player, TurnPhase, PendingAction, Card } from '@/lib/game/types';
import { getCurrentPlayer, addLog, shuffle } from '@/lib/game/utils';
import { drawCard } from '@/lib/game/deck';
import { settlementPhase } from '@/lib/game/settlement';
import { ADJACENCY } from '@/lib/game/starmap';
import { moveStrike as moveStrikeAction } from '@/lib/game/strike';
import { discardHandCards } from '@/lib/game/cards-actions';
import type { AuthoritativeGameEngine } from './AuthoritativeGameEngine';
import type { StateSyncManager } from './StateSyncManager';

// ============================
// 类型定义
// ============================

export type TurnPhaseExtended = TurnPhase | 'gameOver' | 'waiting';

export interface TurnConfig {
  cardsToDraw: number;  // 摸牌数量
  maxHandSize: number;  // 最大手牌数
}

const DEFAULT_TURN_CONFIG: TurnConfig = {
  cardsToDraw: 4,
  maxHandSize: 10,
};

// ============================
// 回合状态机
// ============================

export class TurnStateMachine {
  private engine: AuthoritativeGameEngine;
  private syncManager: StateSyncManager;
  private config: TurnConfig;

  constructor(
    engine: AuthoritativeGameEngine,
    syncManager: StateSyncManager,
    config?: Partial<TurnConfig>
  ) {
    this.engine = engine;
    this.syncManager = syncManager;
    this.config = { ...DEFAULT_TURN_CONFIG, ...config };
  }

  // ============================
  // 回合流程控制
  // ============================

  /**
   * 开始新回合
   */
  startNewTurn(state: GameState): void {
    const player = getCurrentPlayer(state);
    if (!player || player.eliminated) {
      this.advanceToNextPlayer(state);
      return;
    }

    // 重置状态
    state.turnPhase = 'turnBegin';
    state.pendingAction = null;
    state.isProcessing = false;

    addLog(state, `--- ${player.name} 的回合 (第 ${state.totalTurn} 回合) ---`, 'system');

    // 通知客户端回合开始
    this.syncManager.broadcastSimpleEvent('turnStart', {
      turnNumber: state.totalTurn,
      currentPlayerId: player.id,
      playerName: player.name,
      phase: 'turnBegin',
      serverTime: Date.now(),
    });

    // 执行回合开始流程
    this.executeTurnStart(state);
  }

  /**
   * 执行回合开始流程
   */
  private executeTurnStart(state: GameState): void {
    const player = getCurrentPlayer(state);
    if (!player) return;

    state.turnPhase = 'turnBegin';

    // 阶段 1: 获得基础能量（每回合 1 点）
    player.energy += 1;
    addLog(state, `${player.name} 获得 1 点基础能量（当前：${player.energy}）`, 'info');

    // 阶段 2: 设施能量产出
    settlementPhase(state);

    // 阶段 3: 检查飞行打击
    const playerStrikes = state.flyingStrikes.filter(
      s => s.ownerId === player.id && s.position !== s.targetSystem
    );

    if (playerStrikes.length > 0) {
      // 有打击需要移动
      this.startStrikeMovement(state, playerStrikes);
    } else {
      // 无打击，直接进入摸牌
      this.startDrawPhase(state);
    }
  }

  // ============================
  // 打击移动阶段
  // ============================

  /**
   * 开始打击移动阶段
   */
  private startStrikeMovement(state: GameState, strikes: Array<{ uid: string; position: number; targetSystem: number; speed: number }>): void {
    state.turnPhase = 'strikeMovement';

    const player = getCurrentPlayer(state);
    if (!player) return;

    // 通知客户端打击移动开始
    this.syncManager.broadcastGameEvent({
      type: 'phaseChange',
      payload: {
        oldPhase: 'turnBegin',
        newPhase: 'strikeMovement',
        turnNumber: state.totalTurn,
      },
      timestamp: Date.now(),
      turnNumber: state.totalTurn,
    }, state);

    // 等待玩家操作
    const strike = strikes[0];
    const validMoves = ADJACENCY[strike.position] ?? [];
    state.pendingAction = {
      type: 'strikeMove',
      strikeUid: strike.uid,
      validMoves,
    } as PendingAction;

    addLog(state, `${player.name} 需要移动打击牌`, 'action');

    // 通知客户端需要移动打击
    this.syncManager.broadcastSimpleEvent('strikeMoveRequest', {
      strikeUid: strike.uid,
      currentSystem: strike.position,
      validMoves,
    });

    // 触发状态同步
    this.syncState(state);
  }

  /**
   * 处理打击移动
   */
  handleStrikeMove(state: GameState, strikeUid: string, targetSystem: number): { success: boolean; error?: string } {
    const strike = state.flyingStrikes.find(s => s.uid === strikeUid);
    if (!strike) {
      return { success: false, error: '打击牌不存在' };
    }

    // 验证移动
    const validMoves = ADJACENCY[strike.position] ?? [];
    if (!validMoves.includes(targetSystem)) {
      return { success: false, error: '非法移动' };
    }

    // 执行移动
    moveStrikeAction(state, strikeUid, targetSystem);

    const player = getCurrentPlayer(state);
    addLog(state, `${player?.name} 移动打击牌到星系 ${targetSystem}`, 'action');

    // 检查是否到达目标
    if (strike.position === strike.targetSystem) {
      addLog(state, `打击牌到达目标！`, 'system');
      // 注意：打击结算由客户端请求/服务器验证后执行
    }

    // 检查是否还有其他打击需要移动
    const playerStrikes = state.flyingStrikes.filter(
      s => s.ownerId === player?.id && s.position !== s.targetSystem
    );

    if (playerStrikes.length > 0) {
      // 还有打击需要移动
      const nextStrike = playerStrikes[0];
      const nextValidMoves = ADJACENCY[nextStrike.position] ?? [];
      state.pendingAction = {
        type: 'strikeMove',
        strikeUid: nextStrike.uid,
        validMoves: nextValidMoves,
      } as PendingAction;

      this.syncManager.broadcastGameEvent({
        type: 'strikeMoveRequest',
        payload: {
          strikeUid: nextStrike.uid,
          currentSystem: nextStrike.position,
          validMoves: nextValidMoves,
        },
        timestamp: Date.now(),
        turnNumber: state.totalTurn,
      }, state);
    } else {
      // 所有打击移动完成，进入摸牌
      this.startDrawPhase(state);
    }

    return { success: true };
  }

  // ============================
  // 摸牌阶段
  // ============================

  /**
   * 开始摸牌阶段
   */
  private startDrawPhase(state: GameState): void {
    state.turnPhase = 'drawPhase';

    const player = getCurrentPlayer(state);
    if (!player) return;

    // 通知客户端阶段变化
    this.syncManager.broadcastGameEvent({
      type: 'phaseChange',
      payload: {
        oldPhase: state.turnPhase,
        newPhase: 'drawPhase',
        turnNumber: state.totalTurn,
      },
      timestamp: Date.now(),
      turnNumber: state.totalTurn,
    }, state);

    // 计算需要摸的牌数
    const cardsNeeded = this.config.cardsToDraw - player.hand.length;
    const cardsToDraw = Math.max(0, Math.min(cardsNeeded, this.config.maxHandSize - player.hand.length));

    if (cardsToDraw > 0) {
      const drawn = drawCard(state, cardsToDraw);
      player.hand.push(...drawn);
      addLog(state, `${player.name} 摸了 ${drawn.length} 张牌（手牌：${player.hand.length}）`, 'info');
    }

    // 触发状态同步
    this.syncState(state);

    // 摸牌完成后进入行动阶段
    this.startActionPhase(state);
  }

  // ============================
  // 行动阶段
  // ============================

  /**
   * 开始行动阶段
   */
  private startActionPhase(state: GameState): void {
    state.turnPhase = 'actionPhase';
    state.pendingAction = null;

    const player = getCurrentPlayer(state);
    if (!player) return;

    // 通知客户端阶段变化
    this.syncManager.broadcastSimpleEvent('phaseChange', {
      oldPhase: 'drawPhase',
      newPhase: 'actionPhase',
      turnNumber: state.totalTurn,
      serverTime: Date.now(),
    });

    addLog(state, `${player.name} 可以行动了`, 'info');

    // 通知客户端行动开始
    this.syncManager.broadcastSimpleEvent('turnStart', {
      turnNumber: state.totalTurn,
      currentPlayerId: player.id,
      playerName: player.name,
      phase: 'actionPhase',
      serverTime: Date.now(),
    });

    // 触发状态同步（关键修复：确保 turnPhase 变化同步到客户端）
    this.syncState(state);

    // 玩家等待操作 - 由客户端发送操作请求
  }

  // ============================
  // 结束回合
  // ============================

  /**
   * 结束当前回合
   * @param state 游戏状态
   * @param discardCardUids 要弃牌的手牌 UID 列表
   * @param publicDiscard 是否公开弃牌（默认 false 保密）
   */
  endTurn(state: GameState, discardCardUids: string[] = [], publicDiscard: boolean = false): void {
    const player = getCurrentPlayer(state);
    if (!player) return;

    // 处理弃牌
    if (discardCardUids.length > 0) {
      const success = discardHandCards(state, player.id, discardCardUids, publicDiscard);
      if (!success) {
        addLog(state, `${player.name} 弃牌失败（卡牌不存在）`, 'system');
      }
    }

    addLog(state, `${player.name} 结束了回合`, 'info');

    // 通知客户端回合结束
    this.syncManager.broadcastGameEvent({
      type: 'turnEnd',
      payload: {
        turnNumber: state.totalTurn,
        endedPlayerId: player.id,
        endedPlayerName: player.name,
      },
      timestamp: Date.now(),
      turnNumber: state.totalTurn,
    }, state);

    // 前进到下一个玩家
    this.advanceToNextPlayer(state);
  }

  /**
   * 前进到下一个玩家
   */
  advanceToNextPlayer(state: GameState): void {
    const alivePlayers = state.players.filter(p => !p.eliminated);

    if (alivePlayers.length <= 1) {
      // 游戏结束
      this.handleGameOver(state);
      return;
    }

    // 找到下一个存活玩家
    let nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
    let looped = false;

    while (state.players[nextIndex].eliminated) {
      nextIndex = (nextIndex + 1) % state.players.length;
      if (nextIndex <= state.currentPlayerIndex) {
        if (looped) break;
        looped = true;
      }
    }

    // 检查是否完成一轮
    if (nextIndex <= state.currentPlayerIndex && looped) {
      state.totalTurn++;
    }

    state.currentPlayerIndex = nextIndex;

    // 开始新回合
    this.startNewTurn(state);
  }

  // ============================
  // 游戏结束
  // ============================

  /**
   * 处理游戏结束
   */
  private handleGameOver(state: GameState): void {
    state.phase = 'gameOver';
    state.turnPhase = 'turnEnd';

    const alivePlayers = state.players.filter(p => !p.eliminated);

    if (alivePlayers.length === 1) {
      state.winner = alivePlayers[0].id;
      addLog(state, `🏆 游戏结束！${alivePlayers[0].name} 获胜！`, 'system');
    } else {
      state.winner = null;
      addLog(state, '💀 游戏结束！所有文明陨落，永恒黑暗降临。', 'system');
    }

    // 通知客户端游戏结束
    this.syncManager.broadcastGameEvent({
      type: 'gameOver',
      payload: {
        winnerId: state.winner,
        winnerName: state.winner ? alivePlayers[0]?.name : null,
        totalTurns: state.totalTurn,
        reason: alivePlayers.length <= 1 ? 'last_player_standing' : 'all_eliminated',
      },
      timestamp: Date.now(),
      turnNumber: state.totalTurn,
    }, state);
  }

  // ============================
  // 工具方法
  // ============================

  /**
   * 销毁状态机
   */
  destroy(): void {
    // 无需清理
  }

  /**
   * 触发状态同步（确保状态变更被推送到客户端）
   */
  private syncState(state: GameState): void {
    // 增加版本号
    state.version = (state.version ?? 0) + 1;
    // 触发同步
    this.syncManager.updateState(state);
  }
}
