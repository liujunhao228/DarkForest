// ============================
// 黑暗森林 - 游戏事件监听器
// ============================
// 负责注册 WebSocket 事件监听器
// ============================

import type { Socket } from 'socket.io-client';
import type { ActionType } from '@/server/protocol';
import type { ViewState } from '@/types/viewState';
import type { OnlineGameStore } from './index';

/**
 * 注册游戏事件监听器
 */
export function registerGameEventListeners(
  socket: Socket,
  set: (partial: Partial<OnlineGameStore> | ((state: OnlineGameStore) => Partial<OnlineGameStore>)) => void,
  get: () => OnlineGameStore
): void {
  console.log('[OnlineGame] 注册游戏事件监听器');

  socket.on('connect', () => {
    set({ isConnected: true, error: null });
    console.log('[OnlineGame] 连接到服务器成功, socket ID:', socket.id);
    // 如果已有 roomId，请求同步
    const { roomId } = get();
    if (roomId) {
      console.log('[OnlineGame] 连接成功，立即请求同步 roomId:', roomId);
      socket.emit('game:requestSync', { roomId });
    }
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
    console.log('[OnlineGame] 收到全量同步:', { version: data.version, hasState: !!data.state });
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
    console.log('[OnlineGame] 房间游戏开始:', { version: data.gameState.version });
    set({ gameState: data.gameState, gameVersion: data.gameState.version ?? 0 });
  });

  // 监听错误
  socket.on('game:error', (data: { message: string }) => {
    get().handleError(data.message);
  });
}
