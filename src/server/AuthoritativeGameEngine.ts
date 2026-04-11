// ============================
// 黑暗森林 - 权威游戏引擎
// ============================
// 服务器端运行完整的游戏逻辑
// 所有状态变化都在这里发生，客户端只能观察
// 采用事件驱动架构 + 视角过滤
// ============================

import type { GameState, InitConfig, Player, Card, TurnPhase } from '@/lib/game/types';
import { initGame } from '@/lib/game/engine';
import { playStrikeCard, deployCard, recycleCard as recycleCardAction, discardHandCards } from '@/lib/game/cards-actions';
import { announceStrike, skipAnnounceStrike } from '@/lib/game/strike';
import { executeLightspeedShip } from '@/lib/game/turn';
import type { ActionType, ValidationResult, StateChange } from './protocol';
import { validateGameAction } from './GameValidator';
import type { StateSyncManager } from './StateSyncManager';
import { TurnStateMachine } from './TurnStateMachine';
import { BroadcastFlowManager } from './BroadcastFlowManager';
import type { GameEvent as ViewGameEvent } from './ViewManager';

// ============================
// 类型定义
// ============================

export interface ActionResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  action?: ActionType;
  changes?: Record<string, unknown>[];
}

export interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

// 已处理请求的缓存
interface ProcessedRequest {
  requestId: string;
  playerId: string;
  result: ActionResult;
  timestamp: number;
}

// ============================
// 权威游戏引擎
// ============================

export class AuthoritativeGameEngine {
  private state: GameState;
  private roomId: string;
  private syncManager: StateSyncManager;
  private eventHistory: GameEvent[];
  private isProcessing: boolean;
  private turnStateMachine: TurnStateMachine;
  private broadcastFlowManager: BroadcastFlowManager;
  private processedRequests: Map<string, ProcessedRequest>;  // requestId -> 结果
  private readonly MAX_REQUEST_CACHE_AGE = 60000;  // 60秒过期
  private readonly MAX_REQUEST_CACHE_SIZE = 200;   // 最多缓存200个请求

  constructor(roomId: string, config: InitConfig, syncManager: StateSyncManager) {
    this.roomId = roomId;
    this.syncManager = syncManager;
    this.eventHistory = [];
    this.isProcessing = false;
    this.processedRequests = new Map();

    // 初始化游戏
    this.state = initGame(config);
    this.state.version = 0;

    // 创建管理器
    this.turnStateMachine = new TurnStateMachine(this, syncManager);
    this.broadcastFlowManager = new BroadcastFlowManager(syncManager);

    // 开始第一个回合
    this.turnStateMachine.startNewTurn(this.state);

    this.recordEvent('game:start', { config });
  }

  // ============================
  // 处理玩家操作
  // ============================

  /**
   * 处理玩家操作（支持幂等性）
   */
  async processAction(
    playerId: string,
    action: ActionType,
    payload?: Record<string, unknown>,
    requestId?: string  // 新增：唯一请求 ID
  ): Promise<ActionResult> {
    // 幂等性检查：如果这个 requestId 已经处理过，直接返回上次结果
    if (requestId && this.processedRequests.has(requestId)) {
      const cached = this.processedRequests.get(requestId)!;
      console.log(`[AuthoritativeGameEngine] 幂等性命中: requestId=${requestId}, 返回缓存结果`);
      return cached.result;
    }

    // 防止并发处理
    if (this.isProcessing) {
      return { success: false, error: '操作处理中', errorCode: 'IS_PROCESSING' };
    }

    this.isProcessing = true;

    try {
      // 调试日志：打印当前回合状态
      const currentPlayer = this.state.players[this.state.currentPlayerIndex];
      console.log(`[AuthoritativeGameEngine] 玩家操作:`, {
        requestingPlayerId: playerId,
        currentPlayerIndex: this.state.currentPlayerIndex,
        currentPlayerId: currentPlayer?.id,
        currentPlayerName: currentPlayer?.name,
        turnPhase: this.state.turnPhase,
        totalTurn: this.state.totalTurn,
        action,
      });

      // 1. 验证操作
      const validation = validateGameAction(this.state, playerId, action, payload);
      if (!validation.valid) {
        console.warn(`[AuthoritativeGameEngine] 验证失败: ${validation.error}`, { playerId, action });
        return {
          success: false,
          error: validation.error,
          errorCode: validation.errorCode
        };
      }

      // 2. 保存操作前状态
      const prevState = JSON.parse(JSON.stringify(this.state));

      // 3. 执行操作
      let result: ActionResult;
      switch (action) {
        case 'playCard':
          result = await this.executePlayCard(playerId, payload!);
          break;
        case 'moveStrike':
          result = await this.executeMoveStrike(playerId, payload!);
          break;
        case 'endTurn':
          result = await this.executeEndTurn(playerId, payload);
          break;
        case 'respondBroadcast':
          result = await this.executeRespondBroadcast(playerId, payload!);
          break;
        case 'selectResponder':
          result = await this.executeSelectResponder(playerId, payload!);
          break;
        case 'announceStrike':
          result = await this.executeAnnounceStrike(playerId, payload!);
          break;
        case 'skipAnnounceStrike':
          result = await this.executeSkipAnnounceStrike(playerId);
          break;
        case 'recycleCard':
          result = await this.executeRecycleCard(playerId, payload!);
          break;
        case 'useLightspeedShip':
          result = await this.executeUseLightspeedShip(playerId);
          break;
        case 'discardCards':
          result = await this.executeDiscardCards(playerId, payload!);
          break;
        case 'cancelBroadcast':
          result = await this.executeCancelBroadcast(playerId);
          break;
        default:
          result = { success: false, error: '未知操作', errorCode: 'UNKNOWN_ACTION' };
      }

      // 4. 如果操作成功，同步状态并广播事件
      if (result.success) {
        // 计算状态变化
        const changes = this.calculateChanges(prevState, this.state);

        // 更新版本号
        this.state.version = (this.state.version ?? 0) + 1;

        // 触发同步（带视角过滤）
        this.syncManager.updateState(this.state, changes);

        // 广播事件（带视角过滤）
        this.broadcastActionEvent(playerId, action, result, payload);

        // 记录事件
        this.recordEvent('game:action', { playerId, action, result });
      }

      // 5. 缓存结果（用于幂等性）
      if (requestId) {
        this.cacheRequestResult(requestId, playerId, result);
      }

      return result;
    } catch (error) {
      console.error(`[AuthoritativeEngine] 处理操作失败:`, error);
      return { 
        success: false, 
        error: '服务器内部错误', 
        errorCode: 'INTERNAL_ERROR' 
      };
    } finally {
      this.isProcessing = false;
    }
  }

  // ============================
  // 具体操作执行
  // ============================

  /**
   * 执行出牌
   */
  private async executePlayCard(playerId: string, payload: Record<string, unknown>): Promise<ActionResult> {
    const cardUid = payload.cardUid as string;
    const targetSystem = payload.targetSystem as number | undefined;
    const targetPlayerId = payload.targetPlayerId as string | undefined;

    try {
      // 检查是否是广播回应
      if (this.state.broadcast?.active && this.state.broadcast.phase === 'waiting') {
        const agreed = (payload.agreed as boolean) ?? true;
        const result = this.broadcastFlowManager.handleBroadcastResponse(
          this.state,
          playerId,
          agreed,
          agreed ? cardUid : undefined
        );

        if (!result.success) {
          return { success: false, error: result.error, errorCode: result.errorCode };
        }

        return { success: true, action: 'playCard' };
      }

      // 获取卡牌
      const player = this.state.players.find(p => p.id === playerId)!;
      const card = player.hand.find(c => c.uid === cardUid);
      if (!card) {
        return { success: false, error: '卡牌不存在', errorCode: 'CARD_NOT_FOUND' };
      }

      // 根据卡牌类型执行
      switch (card.type) {
        case 'broadcast':
          if (!targetSystem) {
            return { success: false, error: '缺少目标星系', errorCode: 'MISSING_TARGET' };
          }
          const result = this.broadcastFlowManager.handleBroadcastInitiation(
            this.state,
            playerId,
            cardUid,
            targetSystem
          );

          if (!result.success) {
            return { success: false, error: result.error, errorCode: result.errorCode };
          }

          return { success: true, action: 'playCard' };

        case 'strike':
          if (!targetSystem) {
            return { success: false, error: '缺少目标星系', errorCode: 'MISSING_TARGET' };
          }
          playStrikeCard(this.state, playerId, cardUid, targetSystem, targetPlayerId);
          break;

        case 'defense':
        case 'facility':
          deployCard(this.state, playerId, cardUid);
          break;

        default:
          return { success: false, error: '不支持的卡牌类型', errorCode: 'UNSUPPORTED_CARD_TYPE' };
      }

      return { success: true, action: 'playCard' };
    } catch (error) {
      return { success: false, error: '出牌失败', errorCode: 'PLAY_CARD_FAILED' };
    }
  }

  /**
   * 执行移动打击
   */
  private async executeMoveStrike(playerId: string, payload: Record<string, unknown>): Promise<ActionResult> {
    const strikeUid = payload.strikeUid as string;
    const targetSystem = payload.targetSystem as number;

    try {
      const result = this.turnStateMachine.handleStrikeMove(this.state, strikeUid, targetSystem);
      
      if (!result.success) {
        return { success: false, error: result.error, errorCode: 'INVALID_MOVE' };
      }

      return { success: true, action: 'moveStrike' };
    } catch (error) {
      return { success: false, error: '移动打击失败', errorCode: 'MOVE_STRIKE_FAILED' };
    }
  }

  /**
   * 执行结束回合
   */
  private async executeEndTurn(playerId: string, payload?: Record<string, unknown>): Promise<ActionResult> {
    try {
      const discardCards = (payload?.discardCards as string[]) ?? [];
      const publicDiscard = (payload?.publicDiscard as boolean) ?? false;
      this.turnStateMachine.endTurn(this.state, discardCards, publicDiscard);

      return { success: true, action: 'endTurn' };
    } catch (error) {
      return { success: false, error: '结束回合失败', errorCode: 'END_TURN_FAILED' };
    }
  }

  /**
   * 执行回应广播
   */
  private async executeRespondBroadcast(playerId: string, payload: Record<string, unknown>): Promise<ActionResult> {
    const agreed = payload.agreed as boolean;
    const cardUid = payload.cardUid as string | undefined;

    try {
      const result = this.broadcastFlowManager.handleBroadcastResponse(
        this.state,
        playerId,
        agreed,
        agreed ? cardUid : undefined
      );

      if (!result.success) {
        return { success: false, error: result.error, errorCode: result.errorCode };
      }

      return { success: true, action: 'respondBroadcast' };
    } catch (error) {
      return { success: false, error: '回应广播失败', errorCode: 'RESPOND_BROADCAST_FAILED' };
    }
  }

  /**
   * 执行选择回应者
   */
  private async executeSelectResponder(playerId: string, payload: Record<string, unknown>): Promise<ActionResult> {
    const responderId = payload.responderId as string;

    try {
      const result = this.broadcastFlowManager.handleSelectResponder(
        this.state,
        playerId,
        responderId
      );

      if (!result.success) {
        return { success: false, error: result.error, errorCode: result.errorCode };
      }

      return { success: true, action: 'selectResponder' };
    } catch (error) {
      return { success: false, error: '选择回应者失败', errorCode: 'SELECT_RESPONDER_FAILED' };
    }
  }

  /**
   * 执行宣布打击
   */
  private async executeAnnounceStrike(playerId: string, payload: Record<string, unknown>): Promise<ActionResult> {
    const strikeUid = payload.strikeUid as string;

    try {
      announceStrike(this.state);
      return { success: true, action: 'announceStrike' };
    } catch (error) {
      return { success: false, error: '宣布打击失败', errorCode: 'ANNOUNCE_STRIKE_FAILED' };
    }
  }

  /**
   * 执行跳过宣布打击(延迟宣布)
   */
  private async executeSkipAnnounceStrike(playerId: string): Promise<ActionResult> {
    try {
      skipAnnounceStrike(this.state);
      return { success: true, action: 'skipAnnounceStrike' };
    } catch (error) {
      return { success: false, error: '跳过宣布失败', errorCode: 'SKIP_ANNOUNCE_FAILED' };
    }
  }

  /**
   * 执行回收卡牌
   */
  private async executeRecycleCard(playerId: string, payload: Record<string, unknown>): Promise<ActionResult> {
    const cardUid = payload.cardUid as string;

    try {
      recycleCardAction(this.state, playerId, cardUid);
      return { success: true, action: 'recycleCard' };
    } catch (error) {
      return { success: false, error: '回收卡牌失败', errorCode: 'RECYCLE_CARD_FAILED' };
    }
  }

  /**
   * 执行使用光速飞船
   */
  private async executeUseLightspeedShip(playerId: string): Promise<ActionResult> {
    try {
      executeLightspeedShip(this.state, playerId);
      return { success: true, action: 'useLightspeedShip' };
    } catch (error) {
      return { success: false, error: '使用光速飞船失败', errorCode: 'LIGHTSPEED_FAILED' };
    }
  }

  /**
   * 执行弃牌
   */
  private async executeDiscardCards(playerId: string, payload: Record<string, unknown>): Promise<ActionResult> {
    const cardUids = payload.cardUids as string[];

    try {
      discardHandCards(this.state, playerId, cardUids);
      return { success: true, action: 'discardCards' };
    } catch (error) {
      return { success: false, error: '弃牌失败', errorCode: 'DISCARD_FAILED' };
    }
  }

  /**
   * 执行取消广播（仅广播发起者在无人回应时可用）
   */
  private async executeCancelBroadcast(playerId: string): Promise<ActionResult> {
    try {
      // 验证当前玩家是广播发起者
      if (!this.state.broadcast || this.state.broadcast.broadcasterId !== playerId) {
        return { success: false, error: '你不是广播发起者，无法取消', errorCode: 'NOT_BROADCASTER' };
      }

      // 使用 BroadcastFlowManager 取消广播
      this.broadcastFlowManager.cancelBroadcastFlow(this.state);
      return { success: true, action: 'cancelBroadcast' };
    } catch (error) {
      return { success: false, error: '取消广播失败', errorCode: 'CANCEL_BROADCAST_FAILED' };
    }
  }

  // ============================
  // 状态查询
  // ============================

  /**
   * 获取当前游戏状态
   */
  getState(): GameState {
    return this.state;
  }

  /**
   * 获取房间 ID
   */
  getRoomId(): string {
    return this.roomId;
  }

  /**
   * 获取事件历史
   */
  getEventHistory(): GameEvent[] {
    return [...this.eventHistory];
  }

  // ============================
  // 内部辅助
  // ============================

  /**
   * 计算状态变化
   */
  private calculateChanges(oldState: GameState, newState: GameState): StateChange[] {
    // 使用 StateSyncManager 的方法计算变化
    const changes: StateChange[] = [];
    this.compareObjects('', oldState, newState, changes);
    return changes;
  }

  /**
   * 递归比较对象
   */
  private compareObjects(path: string, oldVal: unknown, newVal: unknown, changes: StateChange[]): void {
    if (typeof oldVal !== typeof newVal) {
      changes.push({ path, value: newVal, type: 'set' });
      return;
    }

    if (typeof oldVal !== 'object' || oldVal === null || newVal === null) {
      if (oldVal !== newVal) {
        changes.push({ path, value: newVal, type: 'set' });
      }
      return;
    }

    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      if (oldVal.length !== newVal.length) {
        changes.push({ path, value: newVal, type: 'set' });
        return;
      }
      
      for (let i = 0; i < oldVal.length; i++) {
        this.compareObjects(`${path}[${i}]`, oldVal[i], newVal[i], changes);
      }
      return;
    }

    if (typeof oldVal === 'object' && typeof newVal === 'object') {
      const oldKeys = Object.keys(oldVal);
      const newKeys = Object.keys(newVal);
      const allKeys = new Set([...oldKeys, ...newKeys]);

      for (const key of allKeys) {
        const oldProp = (oldVal as Record<string, unknown>)[key];
        const newProp = (newVal as Record<string, unknown>)[key];
        const newPath = path ? `${path}.${key}` : key;
        
        this.compareObjects(newPath, oldProp, newProp, changes);
      }
    }
  }

  /**
   * 获取指定星系的玩家
   */
  private getPlayersAtSystem(systemId: number): Player[] {
    return this.state.players.filter(p => p.position === systemId && !p.eliminated);
  }

  /**
   * 记录事件
   */
  private recordEvent(type: string, payload: Record<string, unknown>): void {
    this.eventHistory.push({
      type,
      payload,
      timestamp: Date.now(),
    });

    // 限制事件历史数量
    if (this.eventHistory.length > 500) {
      this.eventHistory = this.eventHistory.slice(-400);
    }
  }

  /**
   * 缓存请求结果（用于幂等性）
   */
  private cacheRequestResult(requestId: string, playerId: string, result: ActionResult): void {
    // 清理过期条目
    this.cleanupExpiredRequests();

    // 添加新条目
    this.processedRequests.set(requestId, {
      requestId,
      playerId,
      result,
      timestamp: Date.now(),
    });

    // 限制缓存大小
    if (this.processedRequests.size > this.MAX_REQUEST_CACHE_SIZE) {
      // 删除最早的条目
      const firstKey = this.processedRequests.keys().next().value;
      if (firstKey) {
        this.processedRequests.delete(firstKey);
      }
    }
  }

  /**
   * 清理过期的请求缓存
   */
  private cleanupExpiredRequests(): void {
    const now = Date.now();
    for (const [requestId, cached] of this.processedRequests.entries()) {
      if (now - cached.timestamp > this.MAX_REQUEST_CACHE_AGE) {
        this.processedRequests.delete(requestId);
      }
    }
  }

  /**
   * 广播操作事件（带视角过滤）
   * 事件驱动架构的核心：通知所有玩家发生了什么
   */
  private broadcastActionEvent(
    playerId: string,
    action: ActionType,
    result: ActionResult,
    payload?: Record<string, unknown>
  ): void {
    // 构建事件对象
    const event: ViewGameEvent = {
      type: this.getActionEventType(action),
      payload: {
        playerId,
        action,
        success: result.success,
        ...this.buildEventPayload(action, payload),
      },
      timestamp: Date.now(),
      turnNumber: this.state.totalTurn,
    };

    // 广播给所有玩家（每个玩家收到不同的视角）
    this.syncManager.broadcastGameEvent(event, this.state);
  }

  /**
   * 获取事件类型
   */
  private getActionEventType(action: ActionType): string {
    switch (action) {
      case 'playCard': return 'card_played';
      case 'moveStrike': return 'strike_moved';
      case 'endTurn': return 'turn_ended';
      case 'respondBroadcast': return 'broadcast_responded';
      case 'selectResponder': return 'broadcast_responder_selected';
      case 'announceStrike': return 'strike_announced';
      case 'recycleCard': return 'card_recycled';
      case 'useLightspeedShip': return 'lightspeed_escape';
      case 'discardCards': return 'cards_discarded';
      default: return 'unknown_action';
    }
  }

  /**
   * 构建事件载荷（只包含公开信息）
   * 注意：敏感信息（如 targetPlayerId）会在 ViewManager 中根据视角进一步过滤
   */
  private buildEventPayload(action: ActionType, payload?: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'playCard': {
        const cardUid = payload?.cardUid as string | undefined;
        return {
          cardUid,
          targetSystem: payload?.targetSystem,
          targetPlayerId: payload?.targetPlayerId,  // 会在 ViewManager.filterEventPayload 中根据视角过滤
        };
      }
      case 'moveStrike':
        return {
          strikeUid: payload?.strikeUid,
          targetSystem: payload?.targetSystem,
        };
      case 'endTurn':
        return {
          discardedCards: payload?.discardCards,
        };
      case 'respondBroadcast':
        return {
          agreed: payload?.agreed,
        };
      case 'selectResponder':
        return {
          selectedResponderId: payload?.selectedResponderId,
        };
      case 'announceStrike':
        return {
          strikeUid: payload?.strikeUid,
          targetSystem: payload?.targetSystem,
        };
      case 'recycleCard':
        return {
          cardUid: payload?.cardUid,
        };
      case 'useLightspeedShip':
        return {};
      case 'discardCards':
        return {
          discardedCards: payload?.discardedCards,
        };
      default:
        return {};
    }
  }

  // ============================
  // 生命周期
  // ============================

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.eventHistory = [];
    this.turnStateMachine.destroy();
    this.broadcastFlowManager.destroy();
    // 状态由 RoomManager 清理
  }
}
