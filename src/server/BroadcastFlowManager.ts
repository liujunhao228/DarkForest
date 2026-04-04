// ============================
// 黑暗森林 - 广播博弈流程管理器
// ============================
// 管理广播博弈的完整流程：发布 → 回应 → 选择 → 结算
// ============================

import type { GameState, Player, BroadcastState, BroadcastResponse, Card } from '@/lib/game/types';
import { getCurrentPlayer, addLog } from '@/lib/game/utils';
import { initiateBroadcast, respondToBroadcast, selectBroadcastResponder, resolveBroadcast, cancelBroadcast } from '@/lib/game/broadcast';
import { processAIResponses as processAIResponsesHook } from '@/lib/game/ai';
import type { StateSyncManager } from './StateSyncManager';

// ============================
// 类型定义
// ============================

export interface BroadcastConfig {
  responseTimeout: number;     // 回应超时时间 (ms)
  selectTimeout: number;       // 选择回应者超时时间 (ms)
  revealTimeout: number;       // 揭示阶段超时时间 (ms)
}

const DEFAULT_BROADCAST_CONFIG: BroadcastConfig = {
  responseTimeout: 30000,      // 30 秒回应时间
  selectTimeout: 20000,        // 20 秒选择时间
  revealTimeout: 5000,         // 5 秒揭示时间
};

export interface BroadcastActionResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  phase?: string;
}

// ============================
// 广播博弈流程管理器
// ============================

export class BroadcastFlowManager {
  private syncManager: StateSyncManager;
  private config: BroadcastConfig;
  private timeoutTimer: NodeJS.Timeout | null;

  constructor(
    syncManager: StateSyncManager,
    config?: Partial<BroadcastConfig>
  ) {
    this.syncManager = syncManager;
    this.config = { ...DEFAULT_BROADCAST_CONFIG, ...config };
    this.timeoutTimer = null;
  }

  // ============================
  // 广播发布阶段
  // ============================

  /**
   * 处理广播发布
   */
  handleBroadcastInitiation(
    state: GameState,
    broadcasterId: string,
    cardUid: string,
    targetSystem: number
  ): BroadcastActionResult {
    try {
      // 调用底层发起广播
      initiateBroadcast(state, broadcasterId, cardUid, targetSystem);

      if (!state.broadcast || !state.broadcast.active) {
        return { success: false, error: '广播创建失败', errorCode: 'BROADCAST_NOT_CREATED' };
      }

      const broadcaster = state.players.find(p => p.id === broadcasterId);
      addLog(state, `${broadcaster?.name} 发布了广播`, 'action');

      // 通知客户端广播开始
      this.syncManager.broadcastGameEvent('broadcastRequest', {
        broadcasterId,
        broadcasterName: broadcaster?.name,
        card: state.broadcast.card,
        targetSystem,
        range: state.broadcast.range,
        responses: this.formatBroadcastResponses(state.broadcast.responses),
        timeout: this.config.responseTimeout,
      });

      // 检查是否有人可以回应
      const canRespondPlayers = state.broadcast.responses.filter(r => r.canRespond && !r.responded);

      if (canRespondPlayers.length === 0) {
        // 无人可以回应，直接结算
        addLog(state, '无人可以回应此广播', 'info');
        return this.handleNoResponses(state);
      }

      // 启动回应超时计时
      this.startResponseTimeout(state);

      return { success: true, phase: 'waiting' };
    } catch (error) {
      console.error('[BroadcastFlow] 广播发布失败:', error);
      return { success: false, error: '广播发布失败', errorCode: 'INITIATE_FAILED' };
    }
  }

  // ============================
  // 广播回应收集阶段
  // ============================

  /**
   * 处理玩家回应广播
   */
  handleBroadcastResponse(
    state: GameState,
    playerId: string,
    agreed: boolean,
    cardUid?: string
  ): BroadcastActionResult {
    try {
      if (!state.broadcast || !state.broadcast.active) {
        return { success: false, error: '当前没有活跃的广播', errorCode: 'NO_ACTIVE_BROADCAST' };
      }

      if (state.broadcast.phase !== 'waiting') {
        return { success: false, error: '当前不是回应阶段', errorCode: 'INVALID_PHASE' };
      }

      // 验证玩家是否可以回应
      const response = state.broadcast.responses.find(r => r.playerId === playerId);
      if (!response || !response.canRespond) {
        return { success: false, error: '你不能回应此广播', errorCode: 'CANNOT_RESPOND' };
      }

      if (response.responded) {
        return { success: false, error: '你已经回应过了', errorCode: 'ALREADY_RESPONDED' };
      }

      // 如果同意回应，验证卡牌
      if (agreed && cardUid) {
        const player = state.players.find(p => p.id === playerId);
        if (!player) {
          return { success: false, error: '玩家不存在', errorCode: 'PLAYER_NOT_FOUND' };
        }

        const card = player.hand.find(c => c.uid === cardUid);
        if (!card) {
          return { success: false, error: '卡牌不在手中', errorCode: 'CARD_NOT_IN_HAND' };
        }

        if (card.type !== 'broadcast') {
          return { success: false, error: '只能使用广播牌回应', errorCode: 'NOT_BROADCAST_CARD' };
        }

        if (player.energy < card.energy) {
          return { success: false, error: '能量不足', errorCode: 'NOT_ENOUGH_ENERGY' };
        }
      }

      // 记录回应
      respondToBroadcast(state, playerId, agreed, cardUid);

      const player = state.players.find(p => p.id === playerId);
      addLog(state, `${player?.name} ${agreed ? '同意' : '拒绝'}回应广播`, 'action');

      // 通知客户端回应结果
      this.syncManager.broadcastGameEvent('broadcastResponse', {
        playerId,
        playerName: player?.name,
        agreed,
        responses: this.formatBroadcastResponses(state.broadcast.responses),
      });

      // 检查是否所有玩家都已回应
      const allResponded = state.broadcast.responses
        .filter(r => r.canRespond)
        .every(r => r.responded);

      if (allResponded) {
        this.clearTimeout();
        return this.processResponses(state);
      }

      // 检查 AI 玩家并自动回应
      this.processAIResponses(state);

      return { success: true, phase: 'waiting' };
    } catch (error) {
      console.error('[BroadcastFlow] 回应广播失败:', error);
      return { success: false, error: '回应广播失败', errorCode: 'RESPOND_FAILED' };
    }
  }

  /**
   * 处理 AI 玩家的自动回应
   */
  private processAIResponses(state: GameState): void {
    processAIResponsesHook(state);

    // 检查是否所有玩家都已回应
    const allResponded = state.broadcast!.responses
      .filter(r => r.canRespond)
      .every(r => r.responded);

    if (allResponded) {
      this.clearTimeout();
      this.processResponses(state);
    }
  }

  /**
   * 处理无人回应的情况
   */
  private handleNoResponses(state: GameState): BroadcastActionResult {
    if (!state.broadcast) {
      return { success: false, error: '广播不存在', errorCode: 'NO_BROADCAST' };
    }

    this.clearTimeout();

    // 发布者获得 1 点能量
    const broadcaster = state.players.find(p => p.id === state.broadcast!.broadcasterId);
    if (broadcaster) {
      broadcaster.energy += 1;
      addLog(state, `${broadcaster.name} 获得 1 点能量（无人回应）`, 'info');
    }

    // 广播牌弃置
    if (state.broadcast.card) {
      state.discardPile.push(state.broadcast.card);
      addLog(state, `广播牌被弃置`, 'info');
    }

    // 清理广播状态
    state.broadcast = null;
    state.pendingAction = null;

    // 通知客户端广播结束
    this.syncManager.broadcastGameEvent('broadcastEnd', {
      reason: 'no_responses',
      broadcasterEnergy: broadcaster?.energy,
    });

    return { success: true, phase: 'done' };
  }

  // ============================
  // 处理回应结果
  // ============================

  /**
   * 处理所有回应后的逻辑
   */
  private processResponses(state: GameState): BroadcastActionResult {
    if (!state.broadcast) {
      return { success: false, error: '广播不存在', errorCode: 'NO_BROADCAST' };
    }

    // 检查是否有同意的回应
    const agreedResponses = state.broadcast.responses.filter(r => r.responded && r.agreed);

    if (agreedResponses.length === 0) {
      // 无人同意回应
      return this.handleNoResponses(state);
    }

    const broadcaster = state.players.find(p => p.id === state.broadcast?.broadcasterId);

    if (agreedResponses.length === 1 && broadcaster?.isAI) {
      // 只有一个回应且发布者是 AI，自动选择
      state.broadcast.selectedResponderId = agreedResponses[0].playerId;
      return this.executeBroadcastResolution(state);
    }

    // 多个人或人类发布者，进入选择阶段
    state.broadcast.phase = 'select';

    // 通知客户端进入选择阶段
    this.syncManager.broadcastGameEvent('broadcastSelectResponder', {
      broadcasterId: state.broadcast.broadcasterId,
      responders: agreedResponses.map(r => ({
        playerId: r.playerId,
        playerName: r.playerName,
        responseCard: r.responseCard,
      })),
      timeout: this.config.selectTimeout,
    });

    // 启动选择超时计时
    this.startSelectTimeout(state);

    return { success: true, phase: 'select' };
  }

  // ============================
  // 选择回应者阶段
  // ============================

  /**
   * 处理选择回应者
   */
  handleSelectResponder(
    state: GameState,
    broadcasterId: string,
    responderId: string
  ): BroadcastActionResult {
    try {
      if (!state.broadcast || !state.broadcast.active) {
        return { success: false, error: '当前没有活跃的广播', errorCode: 'NO_ACTIVE_BROADCAST' };
      }

      if (state.broadcast.phase !== 'select') {
        return { success: false, error: '当前不是选择阶段', errorCode: 'INVALID_PHASE' };
      }

      // 验证是否是广播发布者
      if (state.broadcast.broadcasterId !== broadcasterId) {
        return { success: false, error: '只有发布者可以选择', errorCode: 'NOT_BROADCASTER' };
      }

      // 验证回应者是否有效
      const agreedResponses = state.broadcast.responses.filter(r => r.responded && r.agreed);
      const validResponder = agreedResponses.find(r => r.playerId === responderId);

      if (!validResponder) {
        return { success: false, error: '无效的回应者', errorCode: 'INVALID_RESPONDER' };
      }

      // 选择回应者
      selectBroadcastResponder(state, responderId);

      const broadcaster = state.players.find(p => p.id === broadcasterId);
      const responder = state.players.find(p => p.id === responderId);
      addLog(state, `${broadcaster?.name} 选择了 ${responder?.name} 的回应`, 'action');

      // 通知客户端选择结果
      this.syncManager.broadcastGameEvent('broadcastResponderSelected', {
        broadcasterId,
        responderId,
        responderName: responder?.name,
      });

      // 执行结算
      return this.executeBroadcastResolution(state);
    } catch (error) {
      console.error('[BroadcastFlow] 选择回应者失败:', error);
      return { success: false, error: '选择回应者失败', errorCode: 'SELECT_FAILED' };
    }
  }

  // ============================
  // 广播结算阶段
  // ============================

  /**
   * 执行广播结算
   */
  private executeBroadcastResolution(state: GameState): BroadcastActionResult {
    try {
      if (!state.broadcast) {
        return { success: false, error: '广播不存在', errorCode: 'NO_BROADCAST' };
      }

      // 通知客户端进入揭示阶段
      this.syncManager.broadcastGameEvent('broadcastReveal', {
        broadcasterCard: state.broadcast.card,
        responderCard: state.broadcast.responseCard,
        timeout: this.config.revealTimeout,
      });

      // 短暂延迟后结算（让玩家看到揭示）
      setTimeout(() => {
        // 执行结算
        resolveBroadcast(state);

        const broadcaster = state.players.find(p => p.id === state.broadcast?.broadcasterId);
        const responder = state.players.find(p => p.id === state.broadcast?.selectedResponderId);

        addLog(state, `广播博弈结算：${broadcaster?.name} vs ${responder?.name}`, 'system');

        // 通知客户端结算结果
        this.syncManager.broadcastGameEvent('broadcastResolved', {
          broadcasterId: state.broadcast?.broadcasterId,
          broadcasterName: broadcaster?.name,
          broadcasterEnergy: broadcaster?.energy,
          responderId: state.broadcast?.selectedResponderId,
          responderName: responder?.name,
          responderEnergy: responder?.energy,
          subtype: state.broadcast?.subtype,
        });

        // 清理状态
        state.broadcast = null;
        state.pendingAction = null;

        // 检查游戏是否结束
        const alivePlayers = state.players.filter(p => !p.eliminated);
        if (alivePlayers.length <= 1) {
          // 游戏结束逻辑由 TurnStateMachine 处理
        }
      }, this.config.revealTimeout);

      return { success: true, phase: 'resolve' };
    } catch (error) {
      console.error('[BroadcastFlow] 广播结算失败:', error);
      return { success: false, error: '广播结算失败', errorCode: 'RESOLVE_FAILED' };
    }
  }

  // ============================
  // 超时处理
  // ============================

  /**
   * 启动回应超时计时
   */
  private startResponseTimeout(state: GameState): void {
    this.clearTimeout();

    this.timeoutTimer = setTimeout(() => {
      this.handleResponseTimeout(state);
    }, this.config.responseTimeout);
  }

  /**
   * 启动选择超时计时
   */
  private startSelectTimeout(state: GameState): void {
    this.clearTimeout();

    this.timeoutTimer = setTimeout(() => {
      this.handleSelectTimeout(state);
    }, this.config.selectTimeout);
  }

  /**
   * 处理回应超时
   */
  private handleResponseTimeout(state: GameState): void {
    if (!state.broadcast) return;

    const currentPlayer = getCurrentPlayer(state);
    addLog(state, `${currentPlayer?.name} 回应超时`, 'system');

    // 自动处理所有未回应的玩家（视为拒绝）
    const unansweredResponses = state.broadcast.responses.filter(r => r.canRespond && !r.responded);
    for (const response of unansweredResponses) {
      respondToBroadcast(state, response.playerId, false);
    }

    // 处理回应结果
    this.processResponses(state);
  }

  /**
   * 处理选择超时
   */
  private handleSelectTimeout(state: GameState): void {
    if (!state.broadcast) return;

    const currentPlayer = getCurrentPlayer(state);
    addLog(state, `${currentPlayer?.name} 选择超时`, 'system');

    // 自动选择第一个回应者
    const agreedResponse = state.broadcast.responses.find(r => r.responded && r.agreed);
    if (agreedResponse) {
      state.broadcast.selectedResponderId = agreedResponse.playerId;
      this.executeBroadcastResolution(state);
    } else {
      // 没有回应，取消广播
      this.handleNoResponses(state);
    }
  }

  /**
   * 清除超时计时器
   */
  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  // ============================
  // 工具方法
  // ============================

  /**
   * 格式化广播回应列表
   */
  private formatBroadcastResponses(responses: BroadcastResponse[]): Array<{
    playerId: string;
    playerName: string;
    canRespond: boolean;
    mustRespond: boolean;
    responded: boolean;
    agreed?: boolean;
  }> {
    return responses.map(r => ({
      playerId: r.playerId,
      playerName: r.playerName,
      canRespond: r.canRespond,
      mustRespond: r.mustRespond,
      responded: r.responded,
      agreed: r.responded ? r.agreed : undefined,
    }));
  }

  /**
   * 取消当前广播
   */
  cancelBroadcastFlow(state: GameState): void {
    this.clearTimeout();

    if (state.broadcast) {
      cancelBroadcast(state);
      this.syncManager.broadcastGameEvent('broadcastCancelled', {});
    }
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.clearTimeout();
  }
}
