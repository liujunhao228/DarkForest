// ============================
// 黑暗森林 - 权威游戏引擎
// ============================
// 服务器端运行完整的游戏逻辑
// 所有状态变化都在这里发生，客户端只能观察
// ============================

import type { GameState, InitConfig, Player, Card, TurnPhase } from '@/lib/game/types';
import { initGame, startTurn, endTurn } from '@/lib/game/engine';
import { 
  playCard, 
  deployCard, 
  playStrikeCard, 
  initiateBroadcast, 
  respondToBroadcast,
  selectBroadcastResponder,
  moveStrike,
  announceStrike,
  recycleCard,
  executeLightspeedShip,
  discardHandCards,
} from '@/lib/game/engine';
import type { ActionType, ValidationResult, StateChange } from './protocol';
import { validateGameAction } from './GameValidator';
import type { StateSyncManager } from './StateSyncManager';

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

// ============================
// 权威游戏引擎
// ============================

export class AuthoritativeGameEngine {
  private state: GameState;
  private roomId: string;
  private syncManager: StateSyncManager;
  private eventHistory: GameEvent[];
  private isProcessing: boolean;

  constructor(roomId: string, config: InitConfig, syncManager: StateSyncManager) {
    this.roomId = roomId;
    this.syncManager = syncManager;
    this.eventHistory = [];
    this.isProcessing = false;

    // 初始化游戏
    this.state = initGame(config);
    this.state.version = 0;
    
    // 开始第一个回合
    startTurn(this.state);
    
    this.recordEvent('game:start', { config });
  }

  // ============================
  // 处理玩家操作
  // ============================

  /**
   * 处理玩家操作
   */
  async processAction(playerId: string, action: ActionType, payload?: Record<string, unknown>): Promise<ActionResult> {
    // 防止并发处理
    if (this.isProcessing) {
      return { success: false, error: '操作处理中', errorCode: 'IS_PROCESSING' };
    }

    this.isProcessing = true;

    try {
      // 1. 验证操作
      const validation = validateGameAction(this.state, playerId, action, payload);
      if (!validation.valid) {
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
        case 'recycleCard':
          result = await this.executeRecycleCard(playerId, payload!);
          break;
        case 'useLightspeedShip':
          result = await this.executeUseLightspeedShip(playerId);
          break;
        case 'discardCards':
          result = await this.executeDiscardCards(playerId, payload!);
          break;
        default:
          result = { success: false, error: '未知操作', errorCode: 'UNKNOWN_ACTION' };
      }

      // 4. 如果操作成功，同步状态
      if (result.success) {
        // 计算状态变化
        const changes = this.calculateChanges(prevState, this.state);
        
        // 更新版本号
        this.state.version = (this.state.version ?? 0) + 1;

        // 触发同步
        this.syncManager.updateState(this.state, changes);

        // 记录事件
        this.recordEvent('game:action', { playerId, action, result });
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
        respondToBroadcast(this.state, playerId, true, cardUid);
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
          initiateBroadcast(this.state, playerId, cardUid, targetSystem);
          break;

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
      moveStrike(this.state, strikeUid, targetSystem);
      
      // 检查是否到达目标
      const strike = this.state.flyingStrikes.find(s => s.uid === strikeUid);
      if (strike && strike.position === strike.targetSystem) {
        // 触发宣布打击
        this.state.pendingAction = {
          type: 'announceStrike',
          strikeUid,
          targetSystem,
          targetPlayerIds: this.getPlayersAtSystem(targetSystem).map(p => p.id),
        };
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
      endTurn(this.state, discardCards);

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
      respondToBroadcast(this.state, playerId, agreed, cardUid);
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
      selectBroadcastResponder(this.state, responderId);
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
   * 执行回收卡牌
   */
  private async executeRecycleCard(playerId: string, payload: Record<string, unknown>): Promise<ActionResult> {
    const cardUid = payload.cardUid as string;

    try {
      recycleCard(this.state, playerId, cardUid);
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

  // ============================
  // 生命周期
  // ============================

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.eventHistory = [];
    // 状态由 RoomManager 清理
  }
}
