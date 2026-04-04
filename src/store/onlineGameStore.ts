// ============================
// 黑暗森林 - 在线游戏状态管理（权威服务器模式）
// ============================
// 客户端被动接收服务器状态，只能发送操作请求
// ============================

import { create } from 'zustand';
import { wsManager } from '@/lib/websocket';
import type { Socket } from 'socket.io-client';
import type { GameState, Player, Card, FlyingStrike, PendingAction } from '@/lib/game/types';
import type { ActionType } from '@/server/protocol';

// ============================
// 类型定义
// ============================

interface OnlineGameStore {
  // 连接状态
  socket: Socket | null;
  isConnected: boolean;
  roomId: string | null;
  roomCode: string | null;

  // 房间信息
  roomPlayers: Array<{
    playerId: string;
    displayName: string;
    isAI: boolean;
    isHost: boolean;
    playerNumber: number;
    position: number;
    ready: boolean;
    connected: boolean;
  }>;

  // 游戏状态（从服务器同步）
  gameState: GameState | null;
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
  handleFullSync: (state: GameState, version: number) => void;
  handleDeltaSync: (changes: Array<{ path: string; value: unknown; type: string }>, version: number) => void;
  handleGameEvent: (event: string, payload: Record<string, unknown>) => void;
  handleError: (message: string) => void;
  clearError: () => void;
}

// ============================
// Store 实现
// ============================

export const useOnlineGameStore = create<OnlineGameStore>((set, get) => ({
  // 初始状态
  socket: null,
  isConnected: false,
  roomId: null,
  roomCode: null,
  roomPlayers: [],
  gameState: null,
  gameVersion: 0,
  pendingAction: null,
  isProcessing: false,
  error: null,

  // 连接到房间
  connect: (roomId: string, roomCode: string) => {
    const { isConnected: currentlyConnected } = get();

    if (currentlyConnected) {
      wsManager.disconnect();
    }

    set({ roomId, roomCode, error: null });

    const socket = wsManager.connect();
    set({ socket, isConnected: socket.connected });

    // 如果已经连接，立即加入房间
    if (socket.connected) {
      console.log('[OnlineGame] 已连接，加入房间:', roomCode);
      socket.emit('room:join', { roomCode });
      // 注意：不要在这里请求同步，等待 'connect' 事件或服务器主动推送
    }

    // 监听连接事件（用于连接尚未建立的情况）
    socket.on('connect', () => {
      set({ isConnected: true, error: null });
      console.log('[OnlineGame] 连接到服务器成功');

      // 加入房间（如果还没加入）
      socket.emit('room:join', { roomCode });

      // 请求全量同步（只请求一次）
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
    socket.on('game:fullSync', (data: { state: GameState; version: number }) => {
      get().handleFullSync(data.state, data.version);
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
      action?: ActionType
    }) => {
      console.log('[OnlineGame] 收到 actionResult:', result);
      if (!result.success) {
        get().handleError(result.error ?? '操作失败');
      }
      set({ pendingAction: null, isProcessing: false });
      console.log('[OnlineGame] isProcessing 已设置为 false');
    });

    // 监听游戏事件
    socket.on('game:turnStart', (data: { turnNumber: number; currentPlayerId: string; phase: string }) => {
      get().handleGameEvent('turnStart', data);
    });

    socket.on('game:turnEnd', (data: { turnNumber: number; nextPlayerId: string; phase: string }) => {
      get().handleGameEvent('turnEnd', data);
    });

    socket.on('game:phaseChange', (data: { oldPhase: string; newPhase: string; turnNumber: number }) => {
      get().handleGameEvent('phaseChange', data);
    });

    socket.on('game:broadcastRequest', (data: Record<string, unknown>) => {
      get().handleGameEvent('broadcastRequest', data);
    });

    socket.on('game:strikeMoveRequest', (data: Record<string, unknown>) => {
      get().handleGameEvent('strikeMoveRequest', data);
    });

    socket.on('game:gameOver', (data: Record<string, unknown>) => {
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

    socket.on('room:gameStarting', (data: { gameState: GameState }) => {
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
      socket.off(); // 移除所有监听器
    }
    wsManager.disconnect();

    set({
      socket: null,
      isConnected: false,
      roomId: null,
      roomCode: null,
      roomPlayers: [],
      gameState: null,
      gameVersion: 0,
      pendingAction: null,
      isProcessing: false,
      error: null,
    });
  },

  // 发送操作请求
  sendAction: (action: ActionType, payload?: Record<string, unknown>) => {
    const { isConnected, roomId, socket, gameState } = get();

    if (!isConnected || !roomId || !socket) {
      set({ error: '未连接到服务器' });
      return;
    }

    // 检查游戏是否已经开始
    if (!gameState) {
      set({ error: '游戏尚未开始，请等待房主开始游戏' });
      return;
    }

    set({ pendingAction: action, isProcessing: true, error: null });

    socket.emit('game:action', {
      roomId,
      action,
      payload,
    });
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
  handleFullSync: (state: GameState, version: number) => {
    set({
      gameState: state,
      gameVersion: version,
      error: null,
    });
    console.log(`[OnlineGame] 全量同步: version ${version}`);
  },

  // 处理增量同步
  handleDeltaSync: (
    changes: Array<{ path: string; value: unknown; type: string }>,
    version: number
  ) => {
    const { gameState } = get();
    if (!gameState) {
      // 如果没有状态，请求全量同步（但要避免循环）
      console.warn('[OnlineGame] 收到增量同步但没有本地状态，请求全量同步');
      // 只在确实需要时才请求，避免循环
      setTimeout(() => {
        if (!get().gameState) {
          get().requestSync();
        }
      }, 100);
      return;
    }

    // 应用变化
    const newState = applyChanges(gameState, changes);
    set({
      gameState: newState,
      gameVersion: version,
    });
  },

  // 处理游戏事件
  handleGameEvent: (event: string, payload: Record<string, unknown>) => {
    console.log(`[OnlineGame] 游戏事件: ${event}`, payload);

    const { gameState } = get();
    if (!gameState) return;

    // 根据事件类型更新本地状态
    switch (event) {
      case 'phaseChange': {
        const newPhase = payload.newPhase as string;
        if (newPhase) {
          gameState.turnPhase = newPhase as any;
          set({ gameState: { ...gameState } });
          console.log(`[OnlineGame] 本地状态已更新: turnPhase -> ${newPhase}`);
        }
        break;
      }
      case 'turnStart': {
        const currentPlayerId = payload.currentPlayerId as string;
        const phase = payload.phase as string;
        if (phase) {
          gameState.turnPhase = phase as any;
        }
        // 注意：currentPlayerIndex 应该在全量同步时更新
        set({ gameState: { ...gameState } });
        break;
      }
      case 'turnEnd': {
        // 回合结束，等待下一个玩家的回合开始
        break;
      }
      case 'broadcastRequest':
        // 处理广播请求
        break;
      case 'strikeMoveRequest':
        // 处理打击移动请求
        break;
      case 'gameOver':
        // 处理游戏结束
        break;
    }
  },

  // 处理错误
  handleError: (message: string) => {
    set({ error: message, pendingAction: null, isProcessing: false });
    console.error('[OnlineGame] 错误:', message);
  },

  // 清除错误
  clearError: () => {
    set({ error: null });
  },
}));

// ============================
// 辅助函数
// ============================

/**
 * 应用状态变化
 */
function applyChanges(
  state: GameState,
  changes: Array<{ path: string; value: unknown; type: string }>
): GameState {
  const newState = JSON.parse(JSON.stringify(state));

  for (const change of changes) {
    setPathValue(newState, change.path, change.value);
  }

  return newState;
}

/**
 * 设置路径值
 */
function setPathValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: any = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    
    // 处理数组索引
    const match = part.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      const [, arrayName, index] = match;
      if (!current[arrayName]) {
        current[arrayName] = [];
      }
      if (!current[arrayName][parseInt(index)]) {
        current[arrayName][parseInt(index)] = {};
      }
      current = current[arrayName][parseInt(index)];
    } else {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}
