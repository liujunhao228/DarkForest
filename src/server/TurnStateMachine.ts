// ============================
// 黑暗森林 - 回合状态机
// ============================
// 管理完整的回合流程，包括阶段转换、超时处理、玩家操作
// ============================

import type { GameState, Player, TurnPhase, PendingAction, Card } from '@/lib/game/types';
import { getCurrentPlayer, addLog, shuffle } from '@/lib/game/utils';
import { drawCard } from '@/lib/game/deck';
import { settlementPhase } from '@/lib/game/settlement';
import { executeAIMoveStrikes, executeAIAction } from '@/lib/game/ai';
import { ADJACENCY } from '@/lib/game/starmap';
import { moveStrike as moveStrikeAction } from '@/lib/game/strike';
import type { AuthoritativeGameEngine } from './AuthoritativeGameEngine';
import type { StateSyncManager } from './StateSyncManager';

// ============================
// 类型定义
// ============================

export type TurnPhaseExtended = TurnPhase | 'gameOver' | 'waiting';

export interface TurnConfig {
  phaseTimeout: Record<TurnPhase, number>;  // 各阶段超时时间 (ms)
  cardsToDraw: number;  // 摸牌数量
  maxHandSize: number;  // 最大手牌数
}

const DEFAULT_TURN_CONFIG: TurnConfig = {
  phaseTimeout: {
    turnBegin: 5000,       // 回合开始 5 秒（展示）
    drawPhase: 5000,       // 摸牌阶段 5 秒（展示）
    actionPhase: 60000,    // 行动阶段 60 秒
    strikeMovement: 30000, // 打击移动 30 秒
    turnEnd: 5000,         // 回合结束 5 秒
    interrupted: 120000,   // 中断状态 120 秒（广播等待）
  },
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
  private timeoutTimer: NodeJS.Timeout | null;
  private phaseStartTime: number;

  constructor(
    engine: AuthoritativeGameEngine,
    syncManager: StateSyncManager,
    config?: Partial<TurnConfig>
  ) {
    this.engine = engine;
    this.syncManager = syncManager;
    this.config = { ...DEFAULT_TURN_CONFIG, ...config };
    this.timeoutTimer = null;
    this.phaseStartTime = Date.now();
  }

  // ============================
  // 回合流程控制
  // ============================

  /**
   * 开始新回合
   */
  startNewTurn(state: GameState): void {
    this.clearTimeout();

    const player = getCurrentPlayer(state);
    if (!player || player.eliminated) {
      this.advanceToNextPlayer(state);
      return;
    }

    // 重置状态
    state.turnPhase = 'turnBegin';
    state.pendingAction = null;
    state.isProcessing = false;
    this.phaseStartTime = Date.now();

    addLog(state, `--- ${player.name} 的回合 (第 ${state.totalTurn} 回合) ---`, 'system');

    // 通知客户端回合开始
    this.syncManager.broadcastGameEvent('turnStart', {
      turnNumber: state.totalTurn,
      currentPlayerId: player.id,
      playerName: player.name,
      phase: 'turnBegin',
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
    this.startPhaseTimeout(state);

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
    this.phaseStartTime = Date.now();
    this.startPhaseTimeout(state);

    const player = getCurrentPlayer(state);
    if (!player) return;

    // 通知客户端打击移动开始
    this.syncManager.broadcastGameEvent('phaseChange', {
      oldPhase: 'turnBegin',
      newPhase: 'strikeMovement',
      turnNumber: state.totalTurn,
    });

    if (player.isAI) {
      // AI 自动移动所有打击
      this.executeAIMoveStrikes(state, strikes);
    } else {
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
      this.syncManager.broadcastGameEvent('strikeMoveRequest', {
        strikeUid: strike.uid,
        currentSystem: strike.position,
        validMoves,
        timeout: this.config.phaseTimeout.strikeMovement,
      });
    }
  }

  /**
   * AI 自动移动打击
   */
  private executeAIMoveStrikes(state: GameState, strikes: Array<{ uid: string }>): void {
    const player = getCurrentPlayer(state);
    if (!player) return;

    // 使用 AI 钩子函数自动移动所有打击
    executeAIMoveStrikes(state, strikes as any);

    // AI 移动完成后进入摸牌
    this.startDrawPhase(state);
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

    if (playerStrikes.length > 0 && !player?.isAI) {
      // 还有打击需要移动
      const nextStrike = playerStrikes[0];
      const nextValidMoves = ADJACENCY[nextStrike.position] ?? [];
      state.pendingAction = {
        type: 'strikeMove',
        strikeUid: nextStrike.uid,
        validMoves: nextValidMoves,
      } as PendingAction;

      this.syncManager.broadcastGameEvent('strikeMoveRequest', {
        strikeUid: nextStrike.uid,
        currentSystem: nextStrike.position,
        validMoves: nextValidMoves,
        timeout: this.config.phaseTimeout.strikeMovement,
      });
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
    this.phaseStartTime = Date.now();
    this.startPhaseTimeout(state, 3000);  // 摸牌阶段只展示 3 秒

    const player = getCurrentPlayer(state);
    if (!player) return;

    // 通知客户端阶段变化
    this.syncManager.broadcastGameEvent('phaseChange', {
      oldPhase: state.turnPhase,
      newPhase: 'drawPhase',
      turnNumber: state.totalTurn,
    });

    // 计算需要摸的牌数
    const cardsNeeded = this.config.cardsToDraw - player.hand.length;
    const cardsToDraw = Math.max(0, Math.min(cardsNeeded, this.config.maxHandSize - player.hand.length));

    if (cardsToDraw > 0) {
      const drawn = drawCard(state, cardsToDraw);
      player.hand.push(...drawn);
      addLog(state, `${player.name} 摸了 ${drawn.length} 张牌（手牌：${player.hand.length}）`, 'info');
    }

    // 摸牌完成后进入行动阶段
    setTimeout(() => {
      this.startActionPhase(state);
    }, 1000);  // 1 秒后进入行动阶段，让玩家看到摸牌结果
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
    this.phaseStartTime = Date.now();
    this.startPhaseTimeout(state, this.config.phaseTimeout.actionPhase);

    const player = getCurrentPlayer(state);
    if (!player) return;

    // 通知客户端阶段变化
    this.syncManager.broadcastGameEvent('phaseChange', {
      oldPhase: 'drawPhase',
      newPhase: 'actionPhase',
      turnNumber: state.totalTurn,
    });

    addLog(state, `${player.name} 可以行动了`, 'info');

    // 通知客户端行动开始
    this.syncManager.broadcastGameEvent('turnStart', {
      turnNumber: state.totalTurn,
      currentPlayerId: player.id,
      playerName: player.name,
      phase: 'actionPhase',
    });

    if (player.isAI) {
      // AI 自动行动
      this.executeAIAction(state, player);
    }
    // 玩家等待操作 - 由客户端发送操作请求
  }

  /**
   * AI 自动行动
   */
  private executeAIAction(state: GameState, player: Player): void {
    // AI 行动完成后结束回合
    const onActionComplete = () => {
      setTimeout(() => {
        this.endTurn(state);
      }, 1500);  // 1.5 秒后结束回合，让玩家看到 AI 操作
    };

    executeAIAction(state, player, onActionComplete);
  }

  // ============================
  // 结束回合
  // ============================

  /**
   * 结束当前回合
   */
  endTurn(state: GameState, discardCardUids: string[] = []): void {
    this.clearTimeout();

    const player = getCurrentPlayer(state);
    if (!player) return;

    // 处理弃牌
    if (discardCardUids.length > 0) {
      // 弃牌逻辑由 AuthoritativeGameEngine 处理
      addLog(state, `${player.name} 弃了 ${discardCardUids.length} 张牌`, 'action');
    }

    addLog(state, `${player.name} 结束了回合`, 'info');

    // 通知客户端回合结束
    this.syncManager.broadcastGameEvent('turnEnd', {
      turnNumber: state.totalTurn,
      endedPlayerId: player.id,
      endedPlayerName: player.name,
    });

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
  // 超时处理
  // ============================

  /**
   * 开始阶段超时计时器
   */
  private startPhaseTimeout(state: GameState, customTimeout?: number): void {
    this.clearTimeout();

    const timeout = customTimeout ?? this.config.phaseTimeout[state.turnPhase] ?? 30000;
    
    this.timeoutTimer = setTimeout(() => {
      this.handlePhaseTimeout(state);
    }, timeout);
  }

  /**
   * 处理阶段超时
   */
  private handlePhaseTimeout(state: GameState): void {
    const player = getCurrentPlayer(state);
    if (!player || player.isAI) return;  // AI 不处理超时

    addLog(state, `${player.name} 超时，自动操作`, 'system');

    // 根据当前阶段处理
    switch (state.turnPhase) {
      case 'strikeMovement':
        // 超时自动移动打击到最近的路径
        if (state.pendingAction?.type === 'strikeMove') {
          const pendingAction = state.pendingAction as { type: 'strikeMove'; strikeUid: string; validMoves: number[] };
          const strike = state.flyingStrikes.find(s => s.uid === pendingAction.strikeUid);
          if (strike && pendingAction.validMoves.length > 0) {
            // 选择最接近目标的移动
            const targetSystem = strike.targetSystem;
            const bestMove = pendingAction.validMoves.reduce((best, current) => {
              const currentDist = Math.abs(current - targetSystem);
              const bestDist = Math.abs(best - targetSystem);
              return currentDist < bestDist ? current : best;
            });
            this.handleStrikeMove(state, strike.uid, bestMove);
          } else {
            this.startDrawPhase(state);
          }
        }
        break;

      case 'actionPhase':
        // 超时自动结束回合
        this.endTurn(state);
        break;

      default:
        // 其他阶段超时，继续到下一阶段
        this.continueToNextPhase(state);
    }
  }

  /**
   * 继续到下一个阶段
   */
  private continueToNextPhase(state: GameState): void {
    switch (state.turnPhase) {
      case 'turnBegin':
        this.startDrawPhase(state);
        break;
      case 'drawPhase':
        this.startActionPhase(state);
        break;
      case 'actionPhase':
        this.endTurn(state);
        break;
      default:
        this.endTurn(state);
    }
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
    this.syncManager.broadcastGameEvent('gameOver', {
      winnerId: state.winner,
      winnerName: state.winner ? alivePlayers[0]?.name : null,
      totalTurns: state.totalTurn,
      reason: alivePlayers.length <= 1 ? 'last_player_standing' : 'all_eliminated',
    });
  }

  // ============================
  // 工具方法
  // ============================

  /**
   * 清除超时计时器
   */
  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * 重置阶段计时器
   */
  resetPhaseTimer(state: GameState): void {
    this.phaseStartTime = Date.now();
    this.startPhaseTimeout(state);
  }

  /**
   * 获取当前阶段已用时间
   */
  getPhaseElapsedTime(): number {
    return Date.now() - this.phaseStartTime;
  }

  /**
   * 获取当前阶段剩余时间
   */
  getPhaseRemaining(state: GameState): number {
    const timeout = this.config.phaseTimeout[state.turnPhase] ?? 30000;
    const elapsed = this.getPhaseElapsedTime();
    return Math.max(0, timeout - elapsed);
  }

  /**
   * 销毁状态机
   */
  destroy(): void {
    this.clearTimeout();
  }
}
