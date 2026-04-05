// ============================
// 黑暗森林 - 广播博弈流程管理器
// ============================
// 管理广播博弈的完整流程：发布 → 回应 → 选择 → 结算
// ============================

import type { GameState, Player, BroadcastState, BroadcastResponse, Card } from '@/lib/game/types';
import { getCurrentPlayer, addLog } from '@/lib/game/utils';
import { initiateBroadcast, respondToBroadcast, selectBroadcastResponder, resolveBroadcast, cancelBroadcast } from '@/lib/game/broadcast';
import { StateSyncManager } from './StateSyncManager';

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
      // 调试日志
      const player = state.players.find(p => p.id === broadcasterId);
      const card = player?.hand.find(c => c.uid === cardUid);
      console.log('[BroadcastFlow] 尝试创建广播:', {
        broadcasterId,
        broadcasterName: player?.name,
        cardUid,
        cardName: card?.name,
        cardType: card?.type,
        targetSystem,
        playerEnergy: player?.energy,
        cardEnergy: card?.energy,
        playerPosition: player?.position,
        cardRange: card?.range,
      });

      // 验证基本条件
      if (!player) {
        return { success: false, error: '玩家不存在', errorCode: 'PLAYER_NOT_FOUND' };
      }

      if (!card) {
        return { success: false, error: '卡牌不在手中', errorCode: 'CARD_NOT_IN_HAND' };
      }

      if (card.type !== 'broadcast') {
        return { success: false, error: '不是广播牌', errorCode: 'NOT_BROADCAST_CARD' };
      }

      if (player.energy < card.energy) {
        return { success: false, error: `能量不足（需要 ${card.energy}，当前 ${player.energy}）`, errorCode: 'NOT_ENOUGH_ENERGY' };
      }

      // 检查连续广播限制
      const recentBroadcast = player.broadcastHistory.find(
        h => h.systemId === targetSystem && state.totalTurn - h.turn < 2
      );
      if (recentBroadcast) {
        return { success: false, error: `不能连续在同一星系广播（上次在第 ${recentBroadcast.turn} 回合）`, errorCode: 'RECENT_BROADCAST' };
      }

      // 调用底层发起广播
      const success = initiateBroadcast(state, broadcasterId, cardUid, targetSystem);

      // 处理无人可以回应的情况（initiateBroadcast 会自动结算并清理 broadcast 状态）
      if (success && (!state.broadcast || !state.broadcast.active)) {
        console.log('[BroadcastFlow] 无人可以回应广播，已自动结算');
        return { success: true, phase: 'done' };
      }

      if (!success || !state.broadcast || !state.broadcast.active) {
        console.warn('[BroadcastFlow] 广播创建失败:', {
          broadcasterId,
          cardUid,
          targetSystem,
          broadcastExists: !!state.broadcast,
          broadcastActive: state.broadcast?.active,
          success,
        });
        return { success: false, error: '广播创建失败，请检查日志', errorCode: 'BROADCAST_NOT_CREATED' };
      }

      const broadcaster = state.players.find(p => p.id === broadcasterId);
      addLog(state, `${broadcaster?.name} 发布了广播`, 'action');

      // 通知客户端广播开始
      this.syncManager.broadcastGameEvent({
        type: 'broadcastRequest',
        payload: {
          broadcasterId,
          broadcasterName: broadcaster?.name,
          card: state.broadcast.card,
          targetSystem,
          range: state.broadcast.range,
          responses: this.formatBroadcastResponses(state.broadcast.responses),
          timeout: this.config.responseTimeout,
        },
        timestamp: Date.now(),
        turnNumber: state.totalTurn,
      }, state);

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
      this.syncManager.broadcastGameEvent({
        type: 'broadcastResponse',
        payload: {
          playerId,
          playerName: player?.name,
          agreed,
          responses: this.formatBroadcastResponses(state.broadcast.responses),
        },
        timestamp: Date.now(),
        turnNumber: state.totalTurn,
      }, state);

      // 检查是否所有玩家都已回应
      const allResponded = state.broadcast.responses
        .filter(r => r.canRespond)
        .every(r => r.responded);

      // 调试日志：检查回应状态
      const respondedCount = state.broadcast.responses.filter(r => r.responded).length;
      const canRespondCount = state.broadcast.responses.filter(r => r.canRespond).length;
      const agreedCount = state.broadcast.responses.filter(r => r.responded && r.agreed).length;
      console.log('[BroadcastFlow] 回应状态:', {
        playerId,
        agreed,
        respondedCount,
        canRespondCount,
        agreedCount,
        allResponded,
        phase: state.broadcast.phase,
        responses: state.broadcast.responses.map(r => ({
          playerId: r.playerId,
          playerName: r.playerName,
          canRespond: r.canRespond,
          responded: r.responded,
          agreed: r.agreed,
        })),
      });

      if (allResponded) {
        console.log('[BroadcastFlow] 所有玩家已回应，准备进入选择阶段');
        this.clearTimeout();
        return this.processResponses(state);
      }

      return { success: true, phase: 'waiting' };
    } catch (error) {
      console.error('[BroadcastFlow] 回应广播失败:', error);
      return { success: false, error: '回应广播失败', errorCode: 'RESPOND_FAILED' };
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
    this.syncManager.broadcastGameEvent({
      type: 'broadcastEnd',
      payload: {
        reason: 'no_responses',
        broadcasterEnergy: broadcaster?.energy,
      },
      timestamp: Date.now(),
      turnNumber: state.totalTurn,
    }, state);

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

    console.log('[BroadcastFlow] processResponses 被调用', {
      phase: state.broadcast.phase,
      responses: state.broadcast.responses.map(r => ({
        playerId: r.playerId,
        responded: r.responded,
        agreed: r.agreed,
      })),
    });

    // 检查是否有同意的回应
    const agreedResponses = state.broadcast.responses.filter(r => r.responded && r.agreed);

    console.log('[BroadcastFlow] 同意的回应者数量:', agreedResponses.length);

    if (agreedResponses.length === 0) {
      // 无人同意回应
      console.log('[BroadcastFlow] 无人同意回应，处理无人回应情况');
      return this.handleNoResponses(state);
    }

    // 进入选择阶段
    console.log('[BroadcastFlow] 设置 phase = select');
    state.broadcast.phase = 'select';

    // 通知客户端进入选择阶段
    this.syncManager.broadcastGameEvent({
      type: 'broadcastSelectResponder',
      payload: {
        broadcasterId: state.broadcast.broadcasterId,
        responders: agreedResponses.map(r => ({
          playerId: r.playerId,
          playerName: r.playerName,
          responseCard: r.responseCard,
        })),
      },
      timestamp: Date.now(),
      turnNumber: state.totalTurn,
    }, state);

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

      // 支持 'select' 和 'reveal' 阶段（幂等性）
      // 如果已经选择了回应者，直接返回成功（防止客户端重试导致错误）
      if (state.broadcast.phase !== 'select' && state.broadcast.phase !== 'reveal') {
        return { success: false, error: '当前不是选择阶段', errorCode: 'INVALID_PHASE' };
      }

      // 如果已经选择了回应者（幂等性检查），直接返回成功
      if (state.broadcast.selectedResponderId) {
        console.log('[BroadcastFlow] 已经选择了回应者，返回幂等成功', {
          selectedResponderId: state.broadcast.selectedResponderId,
          requestedResponderId: responderId,
          phase: state.broadcast.phase,
        });
        
        // 如果是选择同一个回应者，返回成功
        if (state.broadcast.selectedResponderId === responderId) {
          return { success: true, phase: state.broadcast.phase };
        }
        
        // 如果是不同的回应者，说明用户想改选，但目前不支持改选
        return { success: false, error: '已经选择了回应者，无法更改', errorCode: 'ALREADY_SELECTED' };
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

      console.log('[BroadcastFlow] 正在选择回应者', {
        broadcasterId,
        responderId,
        phase: state.broadcast.phase,
      });

      // 选择回应者
      selectBroadcastResponder(state, responderId);

      console.log('[BroadcastFlow] 选择回应者成功', {
        responderId,
        newPhase: state.broadcast.phase,
        selectedResponderId: state.broadcast.selectedResponderId,
      });

      const broadcaster = state.players.find(p => p.id === broadcasterId);
      const responder = state.players.find(p => p.id === responderId);
      addLog(state, `${broadcaster?.name} 选择了 ${responder?.name} 的回应`, 'action');

      // 通知客户端选择结果
      this.syncManager.broadcastGameEvent({
        type: 'broadcastResponderSelected',
        payload: {
          broadcasterId,
          responderId,
          responderName: responder?.name,
        },
        timestamp: Date.now(),
        turnNumber: state.totalTurn,
      }, state);

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

      // 保存必要的引用（因为 resolveBroadcast 会清理 state.broadcast）
      const broadcasterId = state.broadcast.broadcasterId;
      const selectedResponderId = state.broadcast.selectedResponderId;
      const subtype = state.broadcast.subtype;

      // 通知客户端进入揭示阶段
      this.syncManager.broadcastGameEvent({
        type: 'broadcastReveal',
        payload: {
          broadcasterCard: state.broadcast.card,
          responderCard: state.broadcast.responseCard,
        },
        timestamp: Date.now(),
        turnNumber: state.totalTurn,
      }, state);

      // 短暂延迟后结算（让玩家看到揭示）
      setTimeout(() => {
        try {
          console.log('[BroadcastFlow] 开始执行广播结算 (setTimeout)');
          
          // 保存结算前的状态快照
          const prevState = JSON.parse(JSON.stringify(state));

          // 执行结算（这会清理 state.broadcast）
          resolveBroadcast(state);

          // 使用保存的引用获取玩家信息
          const broadcaster = state.players.find(p => p.id === broadcasterId);
          const responder = state.players.find(p => p.id === selectedResponderId);

          addLog(state, `广播博弈结算：${broadcaster?.name} vs ${responder?.name}`, 'system');

          console.log('[BroadcastFlow] 广播结算完成', {
            broadcaster: broadcaster?.name,
            broadcasterEnergy: broadcaster?.energy,
            responder: responder?.name,
            responderEnergy: responder?.energy,
            broadcastCleared: !state.broadcast,
          });

          // 通知客户端结算结果
          this.syncManager.broadcastGameEvent({
            type: 'broadcastResolved',
            payload: {
              broadcasterId,
              broadcasterName: broadcaster?.name,
              broadcasterEnergy: broadcaster?.energy,
              responderId: selectedResponderId,
              responderName: responder?.name,
              responderEnergy: responder?.energy,
              subtype,
            },
            timestamp: Date.now(),
            turnNumber: state.totalTurn,
          }, state);

          // 关键：触发状态同步，让客户端收到更新
          const changes = StateSyncManager.calculateChanges(prevState, state);
          state.version = (state.version ?? 0) + 1;
          this.syncManager.updateState(state, changes);

          console.log('[BroadcastFlow] 状态同步已触发，版本号:', state.version);
        } catch (error) {
          console.error('[BroadcastFlow] setTimeout 中的结算逻辑失败:', error);
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
      this.syncManager.broadcastGameEvent({
        type: 'broadcastCancelled',
        payload: {},
        timestamp: Date.now(),
        turnNumber: state.totalTurn,
      }, state);
    }
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.clearTimeout();
  }
}
