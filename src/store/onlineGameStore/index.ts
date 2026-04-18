// ============================
// 黑暗森林 - 在线游戏状态管理（权威服务器模式）
// ============================
// 客户端被动接收服务器状态，只能发送操作请求
// ============================

import { create } from 'zustand';
import { wsManager } from '@/lib/websocket';
import type { Socket } from 'socket.io-client';
import type { GameState } from '@/lib/game/types';
import type { ActionType } from '@/server/protocol';
import type { ViewState } from '@/types/viewState';
import { initialState } from './connection';
import { handleFullSync as handleFullSyncImpl, handleDeltaSync as handleDeltaSyncImpl } from './sync';
import { sendAction as sendActionImpl, handleGameEvent as handleGameEventImpl } from './events';
import { registerGameEventListeners } from './eventListeners';

// ============================
// 类型定义
// ============================

export interface OnlineGameStore {
  // 连接状态
  socket: Socket | null;
  isConnected: boolean;
  roomId: string | null;
  roomCode: string | null;

  // 事件监听器初始化标志（防止重复注册）
  hasInitializedListeners: boolean;

  // 房间信息
  roomPlayers: Array<{
    playerId: string;
    displayName: string;
    isHost: boolean;
    playerNumber: number;
    position: number;
    ready: boolean;
    connected: boolean;
  }>;

  // 断线玩家信息
  disconnectedPlayers: Array<{
    playerId: string;
    displayName: string;
    reason: 'timeout' | 'network_error' | 'client_closed';
    canReconnect: boolean;
    reconnectTimeout?: number;
    disconnectedAt: number;
  }>;

  // 游戏状态（从服务器同步 - ViewState 是过滤后的状态）
  gameState: GameState | ViewState | null;
  gameVersion: number;

  // 操作状态
  pendingAction: ActionType | null;
  isProcessing: boolean;

  // 错误
  error: string | null;

  // 连接操作
  connect: (roomId: string, roomCode: string) => void;
  disconnect: () => void;

  // 发送操作请求
  sendAction: (action: ActionType, payload?: Record<string, unknown>) => void;

  // 同步请求
  requestSync: () => void;
  ackState: (version: number) => void;

  // 内部处理方法
  handleFullSync: (state: GameState | ViewState, version: number, stateHash?: string) => Promise<void>;
  handleDeltaSync: (changes: Array<{ path: string; value: unknown; type: string }>, version: number) => void;
  handleGameEvent: (event: string, payload: Record<string, unknown>) => void;
  handleError: (message: string) => void;
  clearError: () => void;
}

// ============================
// Store 实现
// ============================

export const useOnlineGameStore = create<OnlineGameStore>((set, get) => ({
  ...initialState,

  // 连接到房间
  connect: (roomId: string, roomCode: string) => {
    console.log('[OnlineGame] connect 被调用:', { roomId, roomCode });
    const { socket: existingSocket, isConnected: currentlyConnected, hasInitializedListeners } = get();

    // 如果已有连接且已连接，只更新房间信息
    if (existingSocket && currentlyConnected) {
      console.log('[OnlineGame] 复用已有 WebSocket 连接，更新房间信息');
      set({ roomId, roomCode, error: null });

      // 如果事件监听器还未注册，立即注册
      if (!hasInitializedListeners) {
        console.log('[OnlineGame] 注册游戏事件监听器');
        set({ hasInitializedListeners: true });
        registerGameEventListeners(existingSocket, set, get);
      }

      // 如果已连接，立即请求同步
      console.log('[OnlineGame] 连接已存在，请求同步');
      existingSocket.emit('game:requestSync', { roomId });
      return;
    }

    set({ roomId, roomCode, error: null });

    const socket = wsManager.connect();
    set({ socket, isConnected: socket.connected });

    // 防止重复注册事件监听器
    // 只有在 socket 是同一个实例时才跳过（单例复用场景）
    // 如果是新 socket 但标志未重置，说明状态异常，应重新注册
    if (hasInitializedListeners && existingSocket === socket) {
      console.log('[OnlineGame] 事件监听器已注册（同一 socket 实例），跳过');
      // 即使是同一 socket，也要确保请求同步
      if (socket.connected) {
        socket.emit('game:requestSync', { roomId });
      }
      return;
    }

    set({ hasInitializedListeners: true });
    registerGameEventListeners(socket, set, get);

    // 如果 socket 已连接，立即请求同步
    if (socket.connected) {
      console.log('[OnlineGame] Socket 已连接，立即请求同步');
      socket.emit('game:requestSync', { roomId });
    }
  },

  // 断开连接
  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.off();
    }
    wsManager.disconnect();

    set({
      ...initialState,
    });
  },

  // 发送操作请求
  sendAction: (action: ActionType, payload?: Record<string, unknown>) => {
    sendActionImpl(action, payload, get, set);
  },

  // 请求同步
  requestSync: () => {
    const { isConnected, roomId, socket } = get();
    if (!isConnected || !roomId || !socket) return;
    socket.emit('game:requestSync', { roomId });
  },

  // 确认状态
  ackState: (version: number) => {
    const { isConnected, roomId, socket } = get();
    if (!isConnected || !roomId || !socket) return;
    socket.emit('game:ackState', { roomId, version });
  },

  // 处理全量同步
  handleFullSync: async (state: GameState | ViewState, version: number, stateHash?: string) => {
    await handleFullSyncImpl(state, version, stateHash, set, get);
  },

  // 处理增量同步
  handleDeltaSync: (changes: Array<{ path: string; value: unknown; type: string }>, version: number) => {
    handleDeltaSyncImpl(changes, version, set, get);
  },

  // 处理游戏事件
  handleGameEvent: (event: string, payload: Record<string, unknown>) => {
    handleGameEventImpl(event, payload, get, set);
  },

  // 处理错误
  handleError: (message: string) => {
    set({ error: message, pendingAction: null, isProcessing: false });
    console.error('[OnlineGame] ❌ 操作失败:', message);
    console.error('[OnlineGame] 💡 提示: 请检查错误代码，确认操作是否合法');
  },

  // 清除错误
  clearError: () => {
    set({ error: null });
  },
}));
