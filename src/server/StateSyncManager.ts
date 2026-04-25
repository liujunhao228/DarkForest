// ============================
// 黑暗森林 - 状态同步管理器
// ============================
// 管理游戏状态的同步，支持全量和增量同步
// 集成视角过滤系统，确保信息隔离
// ============================

import { Server, Socket } from 'socket.io';
import type { GameState, ReplayData, ReplayMetadata, ReplayStateNode, ReplayDelta } from '@/lib/game/types';
import type { StateChange } from './protocol';
import { ServerEvents } from './protocol';
import { createViewState, type ViewRole, type ViewState, type GameEvent } from './ViewManager';
import type { PlayerView, FlyingStrikeView } from '@/types/viewState';
import { createHash } from 'crypto';
import { createLogger } from '@/lib/logger';

const logger = createLogger('StateSyncManager');

// ============================
// 类型定义
// ============================

interface ClientState {
  socketId: string;
  playerId: string;        // 玩家 ID（用于视角过滤）
  lastVersion: number;     // 客户端最后接收的版本
  requestedFullSync: boolean;  // 是否请求了全量同步
  lastPing: number;        // 最后心跳时间
  role: ViewRole;          // 视图角色（PLAYER/SPECTATOR/REPLAY）
}

interface SyncOptions {
  forceFullSync?: boolean;    // 强制全量同步
  maxDeltaVersions?: number;  // 最大保留版本数
  priority?: 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW';  // 同步优先级
}

const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  forceFullSync: false,
  maxDeltaVersions: 20,
  priority: 'NORMAL',
};

// 同步优先级映射到防抖时间（毫秒）
const SYNC_PRIORITY_DELAYS = {
  IMMEDIATE: 0,    // 立即同步（游戏结束、打击命中）
  HIGH: 16,         // 高优先级（出牌、移动）
  NORMAL: 33,       // 正常优先级（能量变化）
  LOW: 100,         // 低优先级（日志、装饰性变化）
};

// ============================
// 状态同步管理器
// ============================

export class StateSyncManager {
  private roomId: string;
  private io: Server;
  private clients: Map<string, ClientState>;  // socketId -> ClientState
  private stateHistory: GameState[];          // 历史状态（用于增量同步和回放）
  private currentVersion: number;
  private syncTimer: NodeJS.Timeout | null;
  private pendingChanges: Map<number, StateChange[]>;  // version -> changes
  private snapshots: Map<number, GameState>;   // 关键时间点快照
  private checkpoints: Set<number>;           // 检查点版本号

  constructor(roomId: string, io: Server) {
    this.roomId = roomId;
    this.io = io;
    this.clients = new Map();
    this.stateHistory = [];
    this.currentVersion = 0;
    this.syncTimer = null;
    this.pendingChanges = new Map();
    this.snapshots = new Map();
    this.checkpoints = new Set();
  }

  // ============================
  // 客户端管理
  // ============================

  /**
   * 添加客户端
   */
  addClient(socketId: string, playerId: string, role: ViewRole = 'PLAYER'): void {
    logger.debug(`addClient: socketId=${socketId}, playerId=${playerId}, role=${role}`);
    this.clients.set(socketId, {
      socketId,
      playerId,
      lastVersion: 0,
      requestedFullSync: true,  // 初始需要全量同步
      lastPing: Date.now(),
      role,
    });
  }

  /**
   * 移除客户端
   */
  removeClient(socketId: string): void {
    this.clients.delete(socketId);
  }

  /**
   * 更新客户端心跳
   */
  updateHeartbeat(socketId: string): void {
    const client = this.clients.get(socketId);
    if (client) {
      client.lastPing = Date.now();
    }
  }

  /**
   * 获取客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  // ============================
  // 状态更新
  // ============================

  /**
   * 更新游戏状态
   */
  updateState(newState: GameState, changes?: StateChange[], priority: 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL'): void {
    this.currentVersion++;
    newState.version = this.currentVersion;
    newState.replayTimestamp = Date.now();

    // 保存历史状态 - 使用结构化克隆创建真正的副本（避免 immer 冻结原始对象）
    const stateSnapshot = structuredClone(newState);
    this.stateHistory.push(stateSnapshot);

    // 移除历史版本数量限制，用于回放
    // const maxVersions = DEFAULT_SYNC_OPTIONS.maxDeltaVersions ?? 20;
    // if (this.stateHistory.length > maxVersions) {
    //   this.stateHistory = this.stateHistory.slice(-maxVersions);
    // }

    // 创建快照
    this.createSnapshotIfNeeded(stateSnapshot);

    // 记录变化
    if (changes && changes.length > 0) {
      this.pendingChanges.set(this.currentVersion, changes);
    }

    // 触发同步
    this.scheduleSync(priority);
  }

  /**
   * 获取当前版本号
   */
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * 获取当前游戏状态
   */
  getCurrentState(): GameState | null {
    return this.stateHistory.length > 0 
      ? this.stateHistory[this.stateHistory.length - 1] 
      : null;
  }

  /**
   * 在关键时间点创建快照
   */
  private createSnapshotIfNeeded(state: GameState): void {
    const version = state.version || 0;
    
    // 快照创建条件
    const shouldCreateSnapshot = (
      // 每10个版本创建一次快照
      version % 10 === 0 ||
      // 游戏开始
      version === 1 ||
      // 回合结束
      state.turnPhase === 'turnEnd' ||
      // 玩家淘汰
      state.players.some(p => p.eliminated && !this.checkpoints.has(version - 1)) ||
      // 游戏结束
      state.phase === 'gameOver'
    );
    
    if (shouldCreateSnapshot) {
      this.snapshots.set(version, structuredClone(state));
      this.checkpoints.add(version);
      logger.debug(`Created snapshot at version ${version}, phase: ${state.phase}, turnPhase: ${state.turnPhase}`);
    }
  }

  // ============================
  // 同步操作
  // ============================

  /**
   * 安排同步（防抖）
   */
  private scheduleSync(priority: 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL'): void {
    if (this.syncTimer) {
      // 已经有同步在等待，但如果新的优先级更高，需要重新安排
      const currentDelay = this.getSyncDelay('NORMAL'); // 假设当前是默认延迟
      const newDelay = this.getSyncDelay(priority);
      
      if (newDelay < currentDelay) {
        // 更高优先级，重新安排
        clearTimeout(this.syncTimer);
        this.syncTimer = null;
      } else {
        // 已经有更早或相同的同步，不需要重新安排
        return;
      }
    }

    // 根据优先级设置防抖时间
    const delay = this.getSyncDelay(priority);
    
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.executeSync();
    }, delay);
  }

  /**
   * 获取同步延迟时间（毫秒）
   */
  private getSyncDelay(priority: 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW'): number {
    return SYNC_PRIORITY_DELAYS[priority] || SYNC_PRIORITY_DELAYS.NORMAL;
  }

  /**
   * 执行同步
   */
  private executeSync(): void {
    const currentState = this.getCurrentState();
    if (!currentState) return;

    for (const [socketId, client] of this.clients.entries()) {
      this.syncClient(socketId, client, currentState);
    }
  }

  /**
   * 同步单个客户端 - 关键：使用视角过滤
   */
  private syncClient(socketId: string, client: ClientState, currentState: GameState): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) {
      this.clients.delete(socketId);
      return;
    }

    // 检查是否连接
    if (!socket.connected) return;

    // 决定同步类型
    const maxDelta = DEFAULT_SYNC_OPTIONS.maxDeltaVersions ?? 20;
    const currentVersion = currentState.version ?? 0;
    const needsFullSync =
      client.requestedFullSync ||
      client.lastVersion === 0 ||
      currentVersion - client.lastVersion > maxDelta / 2;

    if (needsFullSync) {
      // 全量同步 - 使用视角过滤
      this.sendFullSync(socket, currentState, client.playerId, client.role);
      client.lastVersion = currentState.version ?? 0;
      client.requestedFullSync = false;
    } else {
      // 增量同步 - 使用视角过滤
      const changes = this.getChangesSince(client.lastVersion);
      if (changes.length > 0) {
        this.sendDeltaSync(socket, changes, currentState.version ?? 0, client.playerId, client.role, currentState);
        client.lastVersion = currentState.version ?? 0;
      }
    }
  }

  /**
   * 获取指定版本之后的变化
   */
  private getChangesSince(version: number): StateChange[] {
    const changes: StateChange[] = [];
    
    for (let v = version + 1; v <= this.currentVersion; v++) {
      const versionChanges = this.pendingChanges.get(v);
      if (versionChanges) {
        changes.push(...versionChanges);
      }
    }

    return changes;
  }

  /**
   * 计算游戏状态的 Hash 值（用于校验一致性）
   * 使用 SHA-256 算法，只包含关键游戏状态，避免版本等元数据影响
   */
  calculateStateHash(state: GameState): string {
    // 提取关键状态数据（排除 version、timestamp 等元数据）
    const hashData = {
      players: state.players.map(p => ({
        id: p.id,
        position: p.position,
        energy: p.energy,
        handCount: p.hand.length,
        faceUpCards: p.faceUpCards.map(c => c.uid),
        eliminated: p.eliminated,
      })),
      currentPlayerIndex: state.currentPlayerIndex,
      turnPhase: state.turnPhase,
      totalTurn: state.totalTurn,
      flyingStrikes: state.flyingStrikes.map(s => ({
        uid: s.uid,
        ownerId: s.ownerId,
        position: s.position,
        targetSystem: s.targetSystem,
      })),
      broadcast: state.broadcast ? {
        active: state.broadcast.active,
        broadcasterId: state.broadcast.broadcasterId,
        phase: state.broadcast.phase,
      } : null,
      destroyedStars: state.destroyedStars,
      winner: state.winner,
    };

    const hash = createHash('sha256');
    hash.update(JSON.stringify(hashData));
    return hash.digest('hex');
  }

  /**
   * 计算视图状态的 Hash 值（用于客户端校验）
   * 基于 ViewState 计算，与客户端 calculateStateHash 保持完全相同的逻辑
   */
  calculateViewStateHash(viewState: ViewState): string {
    const hashData = {
      players: viewState.players.map((p: PlayerView) => ({
        id: p.id,
        position: p.position,
        energy: p.energy,
        handCount: p.hand ? p.hand.length : (p.handCount ?? 0),
        faceUpCards: (p.faceUpCards ?? []).map((c) => c.uid),
        eliminated: p.eliminated,
      })),
      currentPlayerIndex: viewState.currentPlayerIndex,
      turnPhase: viewState.turnPhase,
      totalTurn: viewState.totalTurn,
      flyingStrikes: (viewState.flyingStrikes ?? []).map((s: FlyingStrikeView) => ({
        uid: s.uid,
        ownerId: s.ownerId,
        position: s.position,
        targetSystem: s.targetSystem,
      })),
      broadcast: viewState.broadcast ? {
        active: viewState.broadcast.active,
        broadcasterId: viewState.broadcast.broadcasterId,
        phase: viewState.broadcast.phase,
      } : null,
      destroyedStars: viewState.destroyedStars,
      winner: viewState.winner,
    };

    const hash = createHash('sha256');
    hash.update(JSON.stringify(hashData));
    return hash.digest('hex');
  }

  /**
   * 发送全量同步 - 使用视角过滤
   */
  private sendFullSync(socket: Socket, state: GameState, playerId: string, role: ViewRole): void {
    // 关键：生成视图状态，而非发送完整状态
    const viewState = createViewState(state, { role, playerId });

    // 计算视图状态 Hash 值（基于 ViewState，与客户端计算方式一致）
    const stateHash = this.calculateViewStateHash(viewState);

    logger.debug(`sendFullSync: socketId=${socket.id}, playerId=${playerId}, role=${role}, version=${viewState.version}, hash=${stateHash.slice(0, 8)}...`);
    socket.emit(ServerEvents.GAME_FULL_SYNC, {
      state: viewState,
      version: viewState.version,
      stateHash,  // 添加 Hash 校验值
      timestamp: Date.now(),
    });
  }

  /**
   * 发送增量同步 - 使用视角过滤
   */
  private sendDeltaSync(
    socket: Socket,
    changes: StateChange[],
    version: number,
    playerId: string,
    role: ViewRole,
    currentState: GameState
  ): void {
    // 关键修复：过滤 changes，确保不泄露敏感信息
    const filteredChanges = this.filterChangesForPlayer(changes, playerId, role, currentState);

    socket.emit(ServerEvents.GAME_DELTA_SYNC, {
      changes: filteredChanges,
      version,
      timestamp: Date.now(),
    });
  }

  /**
   * 过滤状态变化，确保不泄露敏感信息
   * 规则：
   * 1. 其他玩家的手牌变化对当前玩家不可见
   * 2. 广播 subtype 在揭示阶段前对其他玩家隐藏
   * 3. 打击的 targetPlayerId 对非拥有者隐藏
   * 4. 其他玩家的位置变化对当前玩家隐藏（黑暗森林核心机制）
   */
  private filterChangesForPlayer(
    changes: StateChange[],
    playerId: string,
    role: ViewRole,
    currentState: GameState
  ): StateChange[] {
    return changes.filter(change => {
      const path = change.path;

      // 规则 1: 过滤其他玩家的手牌变化（精确匹配）
      const handPattern = /^players\.(\d+)\.hand(?:\.|$)/;
      const handMatch = path.match(handPattern);
      if (handMatch) {
        const playerIndex = parseInt(handMatch[1], 10);
        const player = currentState.players[playerIndex];
        if (player && player.id !== playerId) {
          // 这是其他玩家的手牌变化，过滤掉
          return false;
        }
      }

      // 规则 2: 其他玩家的位置变化对当前玩家隐藏（黑暗森林核心机制）
      const positionPattern = /^players\.(\d+)\.position$/;
      const positionMatch = path.match(positionPattern);
      if (positionMatch) {
        const playerIndex = parseInt(positionMatch[1], 10);
        const player = currentState.players[playerIndex];
        if (player && player.id !== playerId) {
          // 这是其他玩家的位置变化，过滤掉
          return false;
        }
      }

      // 规则 3: 广播 subtype 在揭示阶段前对其他玩家隐藏
      const broadcastSubtypePattern = /^broadcast\.subtype$/;
      if (broadcastSubtypePattern.test(path)) {
        const broadcast = currentState.broadcast;
        if (broadcast) {
          const isBroadcaster = broadcast.broadcasterId === playerId;
          const isRevealed = broadcast.phase === 'reveal' || broadcast.phase === 'resolve' || broadcast.phase === 'done';
          const isReplay = role === 'REPLAY';

          if (!isBroadcaster && !isRevealed && !isReplay) {
            return false;  // 过滤掉未揭示的 subtype
          }
        }
      }

      // 规则 4: 飞行打击的 targetPlayerId 对非拥有者隐藏
      const targetPlayerIdPattern = /^flyingStrikes\.(\d+)\.targetPlayerId$/;
      const targetPlayerIdMatch = path.match(targetPlayerIdPattern);
      if (targetPlayerIdMatch) {
        const strikeIndex = parseInt(targetPlayerIdMatch[1], 10);
        const strike = currentState.flyingStrikes[strikeIndex];
        if (strike && strike.ownerId !== playerId) {
          return false;  // 过滤掉非拥有者的打击目标
        }
      }

      // 规则 5: 广播回应者的 subtype 在揭示前隐藏
      const responseSubtypePattern = /^broadcast\.responses\.(\d+)\.subtype$/;
      if (responseSubtypePattern.test(path)) {
        const broadcast = currentState.broadcast;
        if (broadcast) {
          const isRevealed = broadcast.phase === 'reveal' || broadcast.phase === 'resolve' || broadcast.phase === 'done';
          const isReplay = role === 'REPLAY';

          if (!isRevealed && !isReplay) {
            return false;
          }
        }
      }

      return true;
    });
  }

  // ============================
  // 广播操作
  // ============================

  /**
   * 广播消息给房间内所有玩家（带视角过滤）
   */
  broadcast(event: string, data: unknown, excludeSocketId?: string): void {
    for (const [socketId, client] of this.clients.entries()) {
      if (socketId === excludeSocketId) continue;

      const socket = this.io.sockets.sockets.get(socketId);
      if (socket?.connected) {
        socket.emit(event, data);
      }
    }
  }

  /**
   * 广播游戏事件（带视角过滤）
   * 关键：为每个玩家生成不同的事件数据
   */
  async broadcastGameEvent(event: GameEvent, absoluteState: GameState): Promise<void> {
    const { createEventForPlayer } = await import('./ViewManager');
    
    for (const [socketId, client] of this.clients.entries()) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket?.connected) continue;

      // 为每个玩家生成视角过滤后的事件
      const filteredEvent = createEventForPlayer(event, absoluteState, client.playerId);
      
      socket.emit(`game:${event.type}`, {
        roomId: this.roomId,
        ...filteredEvent.payload,
      });
    }
  }

  /**
   * 广播简单事件（不带视角过滤，用于公开事件）
   */
  broadcastSimpleEvent(event: string, payload: Record<string, unknown>): void {
    for (const [socketId] of this.clients.entries()) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket?.connected) {
        socket.emit(`game:${event}`, {
          roomId: this.roomId,
          ...payload,
        });
      }
    }
  }

  // ============================
  // 请求同步
  // ============================

  /**
   * 客户端请求全量同步
   */
  requestFullSync(socketId: string): void {
    const client = this.clients.get(socketId);
    if (client) {
      logger.debug(`requestFullSync: socketId=${socketId}, 安排同步`);
      client.requestedFullSync = true;
      this.scheduleSync();
    } else {
      logger.warn(`客户端不存在: socketId=${socketId}`);
    }
  }

  /**
   * 客户端确认收到状态
   */
  ackState(socketId: string, version: number): void {
    const client = this.clients.get(socketId);
    if (client) {
      client.lastVersion = version;
    }
  }

  // ============================
  // 清理
  // ============================

  /**
   * 清理超时客户端
   */
  cleanupTimeoutClients(timeout: number = 60000): void {
    const now = Date.now();
    for (const [socketId, client] of this.clients.entries()) {
      if (now - client.lastPing > timeout) {
        this.clients.delete(socketId);
      }
    }
  }

  /**
   * 导出回放数据
   */
  exportReplayData(gameId: string): ReplayData {
    const currentState = this.getCurrentState();
    if (!currentState) {
      throw new Error('No game state available for replay export');
    }

    // 生成元数据
    const metadata: ReplayMetadata = {
      id: `replay_${gameId}_${Date.now()}`,
      gameId,
      startTime: currentState.replayTimestamp || Date.now(),
      endTime: Date.now(),
      duration: Math.floor((Date.now() - (currentState.replayTimestamp || Date.now())) / 1000),
      playerCount: currentState.playerCount,
      players: currentState.players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color
      })),
      winner: currentState.winner,
      version: '1.0.0'
    };

    // 收集快照
    const snapshots: ReplayStateNode[] = [];
    this.snapshots.forEach((state, version) => {
      snapshots.push({
        timestamp: state.replayTimestamp || Date.now(),
        version,
        state: structuredClone(state),
        hash: this.calculateStateHash(state)
      });
    });

    // 收集增量变化
    const deltas: ReplayDelta[] = [];
    this.pendingChanges.forEach((changes, version) => {
      const state = this.stateHistory.find(s => s.version === version);
      if (state) {
        deltas.push({
          timestamp: state.replayTimestamp || Date.now(),
          version,
          changes: structuredClone(changes)
        });
      }
    });

    // 收集检查点
    const checkpoints = Array.from(this.checkpoints).sort((a, b) => a - b);

    return {
      metadata,
      snapshots,
      deltas,
      checkpoints
    };
  }

  /**
   * 销毁同步器
   */
  destroy(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.clients.clear();
    this.stateHistory = [];
    this.pendingChanges.clear();
    this.snapshots.clear();
    this.checkpoints.clear();
  }

  // ============================
  // 状态计算辅助
  // ============================

  /**
   * 计算两个状态之间的差异
   */
  static calculateChanges(oldState: GameState, newState: GameState): StateChange[] {
    const changes: StateChange[] = [];
    
    // 深度比较两个对象
    StateSyncManager.compareObjects('', oldState, newState, changes);
    
    return changes;
  }

  /**
   * 递归比较对象
   */
  private static compareObjects(
    path: string, 
    oldVal: unknown, 
    newVal: unknown, 
    changes: StateChange[]
  ): void {
    // 类型不同，直接设置
    if (typeof oldVal !== typeof newVal) {
      changes.push({ path, value: newVal, type: 'set' });
      return;
    }

    // 都是基本类型
    if (typeof oldVal !== 'object' || oldVal === null || newVal === null) {
      if (oldVal !== newVal) {
        changes.push({ path, value: newVal, type: 'set' });
      }
      return;
    }

    // 都是数组
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      if (oldVal.length !== newVal.length) {
        changes.push({ path, value: newVal, type: 'set' });
        return;
      }
      
      for (let i = 0; i < oldVal.length; i++) {
        StateSyncManager.compareObjects(`${path}.${i}`, oldVal[i], newVal[i], changes);
      }
      return;
    }

    // 都是对象
    if (typeof oldVal === 'object' && typeof newVal === 'object') {
      const oldKeys = Object.keys(oldVal as object);
      const newKeys = Object.keys(newVal as object);
      const allKeys = new Set([...oldKeys, ...newKeys]);

      for (const key of allKeys) {
        const oldProp = (oldVal as Record<string, unknown>)[key];
        const newProp = (newVal as Record<string, unknown>)[key];
        const newPath = path ? `${path}.${key}` : key;
        
        StateSyncManager.compareObjects(newPath, oldProp, newProp, changes);
      }
    }
  }
}
