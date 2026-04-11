// ============================
// 黑暗森林 - 在线游戏状态管理（权威服务器模式）
// ============================
// 客户端被动接收服务器状态，只能发送操作请求
// ============================

import { create } from 'zustand';
import { produce } from 'immer';
import { wsManager } from '@/lib/websocket';
import type { Socket } from 'socket.io-client';
import type { GameState, Player, Card, FlyingStrike, PendingAction } from '@/lib/game/types';
import type { ActionType } from '@/server/protocol';
import type { ViewState, PlayerView, FlyingStrikeView } from '@/types/viewState';
import { initialState } from './connection';
import { handleFullSync as handleFullSyncImpl, handleDeltaSync as handleDeltaSyncImpl, calculateStateHash } from './sync';
import { sendAction as sendActionImpl, handleGameEvent as handleGameEventImpl } from './events';

// ============================
// 类型定义
// ============================

export interface OnlineGameStore {
  // 连接状态
  socket: Socket | null;
  isConnected: boolean;
  roomId: string | null;
  roomCode: string | null;

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
    const { socket: existingSocket, isConnected: currentlyConnected } = get();

    if (existingSocket && currentlyConnected) {
      existingSocket.off();
      wsManager.disconnect();
    }

    set({ roomId, roomCode, error: null });

    const socket = wsManager.connect();
    set({ socket, isConnected: socket.connected });

    let hasJoinedRoom = false;

    if (socket.connected && !hasJoinedRoom) {
      hasJoinedRoom = true;
      console.log('[OnlineGame] 已连接，加入房间:', roomCode);
      socket.emit('room:join', { roomCode });
    }

    socket.on('connect', () => {
      set({ isConnected: true, error: null });
      console.log('[OnlineGame] 连接到服务器成功');

      if (!hasJoinedRoom) {
        hasJoinedRoom = true;
        socket.emit('room:join', { roomCode });
      }

      socket.emit('game:requestSync', { roomId });
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
      console.log('[OnlineGame] 与服务器断开连接');
    });

    socket.on('connect_error', (error: Error) => {
      set({
        isConnected: false,
        error: `连接失败：${error.message}`
      });
      console.error('[OnlineGame] 连接错误:', error);
    });

    // 监听全量同步
    socket.on('game:fullSync', (data: { state: ViewState; version: number; stateHash?: string }) => {
      get().handleFullSync(data.state, data.version, data.stateHash);
    });

    // 监听增量同步
    socket.on('game:deltaSync', (data: {
      changes: Array<{ path: string; value: unknown; type: string }>;
      version: number
    }) => {
      get().handleDeltaSync(data.changes, data.version);
    });

    // 监听操作结果
    socket.on('game:actionResult', (result: {
      success: boolean;
      error?: string;
      errorCode?: string;
      action?: ActionType
    }) => {
      console.log('[OnlineGame] 收到 actionResult:', result);

      const socketRef = socket as Socket & { _actionTimeout?: ReturnType<typeof setTimeout> };
      const timeoutId = socketRef._actionTimeout;
      if (timeoutId) {
        clearTimeout(timeoutId);
        delete socketRef._actionTimeout;
      }

      if (!result.success) {
        const errorMessage = result.errorCode
          ? `${result.error} [${result.errorCode}]`
          : result.error ?? '操作失败';
        get().handleError(errorMessage);
      }
      set({ pendingAction: null, isProcessing: false });
      console.log('[OnlineGame] isProcessing 已设置为 false');
    });

    // 监听游戏事件
    socket.on('game:turnStart', (data) => {
      get().handleGameEvent('turnStart', data);
    });

    socket.on('game:turnEnd', (data) => {
      get().handleGameEvent('turnEnd', data);
    });

    socket.on('game:phaseChange', (data) => {
      get().handleGameEvent('phaseChange', data);
    });

    socket.on('game:broadcastRequest', (data) => {
      get().handleGameEvent('broadcastRequest', data);
    });

    socket.on('game:strikeMoveRequest', (data) => {
      get().handleGameEvent('strikeMoveRequest', data);
    });

    socket.on('game:gameOver', (data) => {
      get().handleGameEvent('gameOver', data);
    });

    // 监听房间事件
    socket.on('room:playerJoined', (data: { players: OnlineGameStore['roomPlayers'] }) => {
      set({ roomPlayers: data.players });
    });

    socket.on('room:playerLeft', (data: { players: OnlineGameStore['roomPlayers'] }) => {
      set({ roomPlayers: data.players });
    });

    socket.on('room:playerReady', (data: { players: OnlineGameStore['roomPlayers'] }) => {
      set({ roomPlayers: data.players });
    });

    socket.on('room:playerDisconnected', (data) => {
      console.log('[OnlineGame] 玩家断线通知:', data);

      set({ roomPlayers: data.players });

      const disconnectedPlayer = {
        playerId: data.disconnectedPlayerId,
        displayName: data.disconnectedPlayerName,
        reason: data.reason,
        canReconnect: data.canReconnect,
        reconnectTimeout: data.reconnectTimeout,
        disconnectedAt: Date.now(),
      };

      set((state) => ({
        disconnectedPlayers: [...state.disconnectedPlayers, disconnectedPlayer],
      }));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('playerDisconnected', { detail: disconnectedPlayer }));
      }
    });

    socket.on('room:gameStarting', (data: { gameState: ViewState }) => {
      set({ gameState: data.gameState, gameVersion: data.gameState.version ?? 0 });
    });

    // 监听错误
    socket.on('game:error', (data: { message: string }) => {
      get().handleError(data.message);
    });
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
