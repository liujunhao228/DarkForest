// ============================
// 黑暗森林 - 状态同步管理器
// ============================
// 管理游戏状态的同步，支持全量和增量同步
// ============================

import { Server, Socket } from 'socket.io';
import type { GameState } from '@/lib/game/types';
import type { Room, RoomPlayer, StateChange } from './protocol';

// ============================
// 类型定义
// ============================

interface ClientState {
  socketId: string;
  lastVersion: number;     // 客户端最后接收的版本
  requestedFullSync: boolean;  // 是否请求了全量同步
  lastPing: number;        // 最后心跳时间
}

interface SyncOptions {
  forceFullSync?: boolean;    // 强制全量同步
  maxDeltaVersions?: number;  // 最大保留版本数
}

const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  forceFullSync: false,
  maxDeltaVersions: 20,
};

// ============================
// 状态同步管理器
// ============================

export class StateSyncManager {
  private roomId: string;
  private io: Server;
  private clients: Map<string, ClientState>;  // socketId -> ClientState
  private stateHistory: GameState[];          // 历史状态（用于增量同步）
  private currentVersion: number;
  private syncTimer: NodeJS.Timeout | null;
  private pendingChanges: Map<number, StateChange[]>;  // version -> changes

  constructor(roomId: string, io: Server) {
    this.roomId = roomId;
    this.io = io;
    this.clients = new Map();
    this.stateHistory = [];
    this.currentVersion = 0;
    this.syncTimer = null;
    this.pendingChanges = new Map();
  }

  // ============================
  // 客户端管理
  // ============================

  /**
   * 添加客户端
   */
  addClient(socketId: string): void {
    console.log(`[StateSyncManager] addClient: socketId=${socketId}`);
    this.clients.set(socketId, {
      socketId,
      lastVersion: 0,
      requestedFullSync: true,  // 初始需要全量同步
      lastPing: Date.now(),
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
  updateState(newState: GameState, changes?: StateChange[]): void {
    this.currentVersion++;
    newState.version = this.currentVersion;

    // 保存历史状态
    this.stateHistory.push(JSON.parse(JSON.stringify(newState)));

    // 限制历史状态数量
    const maxVersions = DEFAULT_SYNC_OPTIONS.maxDeltaVersions ?? 20;
    if (this.stateHistory.length > maxVersions) {
      this.stateHistory = this.stateHistory.slice(-maxVersions);
    }

    // 记录变化
    if (changes && changes.length > 0) {
      this.pendingChanges.set(this.currentVersion, changes);
    }

    // 触发同步
    this.scheduleSync();
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

  // ============================
  // 同步操作
  // ============================

  /**
   * 安排同步（防抖）
   */
  private scheduleSync(): void {
    if (this.syncTimer) {
      // 已经有同步在等待，不需要重新安排
      return;
    }

    // 100ms 后执行同步（防抖）
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.executeSync();
    }, 100);
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
   * 同步单个客户端
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
      // 全量同步
      this.sendFullSync(socket, currentState);
      client.lastVersion = currentState.version ?? 0;
      client.requestedFullSync = false;
    } else {
      // 增量同步
      const changes = this.getChangesSince(client.lastVersion);
      if (changes.length > 0) {
        this.sendDeltaSync(socket, changes, currentState.version ?? 0);
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
   * 发送全量同步
   */
  private sendFullSync(socket: Socket, state: GameState): void {
    console.log(`[StateSyncManager] sendFullSync: socketId=${socket.id}, version=${state.version}`);
    socket.emit('game:fullSync', {
      state,
      version: state.version,
      timestamp: Date.now(),
    });
  }

  /**
   * 发送增量同步
   */
  private sendDeltaSync(socket: Socket, changes: StateChange[], version: number): void {
    socket.emit('game:deltaSync', {
      changes,
      version,
      timestamp: Date.now(),
    });
  }

  // ============================
  // 广播操作
  // ============================

  /**
   * 广播消息给房间内所有玩家
   */
  broadcast(event: string, data: unknown, excludeSocketId?: string): void {
    for (const [socketId] of this.clients.entries()) {
      if (socketId === excludeSocketId) continue;
      
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket?.connected) {
        socket.emit(event, data);
      }
    }
  }

  /**
   * 广播游戏事件
   */
  broadcastGameEvent(event: string, payload: Record<string, unknown>): void {
    this.broadcast(`game:${event}`, {
      roomId: this.roomId,
      ...payload,
    });
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
      console.log(`[StateSyncManager] requestFullSync: socketId=${socketId}, 安排同步`);
      client.requestedFullSync = true;
      this.scheduleSync();
    } else {
      console.warn(`[StateSyncManager] 客户端不存在: socketId=${socketId}`);
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
        StateSyncManager.compareObjects(`${path}[${i}]`, oldVal[i], newVal[i], changes);
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
