// ============================
// 黑暗森林 - 在线游戏状态管理（权威服务器模式）
// ============================
// 客户端被动接收服务器状态，只能发送操作请求
// 服务器发送的是 ViewState（经过滤），而非完整 GameState
// ============================

import { create } from 'zustand';
import { produce } from 'immer';
import { wsManager } from '@/lib/websocket';
import type { Socket } from 'socket.io-client';
import type { GameState, Player, Card, FlyingStrike, PendingAction } from '@/lib/game/types';
import type { ActionType } from '@/server/protocol';
import type { ViewState } from '@/types/viewState';

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
  // 初始状态
  socket: null,
  isConnected: false,
  roomId: null,
  roomCode: null,
  roomPlayers: [],
  disconnectedPlayers: [],
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

    // 使用标记位确保 room:join 只执行一次
    let hasJoinedRoom = false;

    // 如果已经连接，立即加入房间
    if (socket.connected && !hasJoinedRoom) {
      hasJoinedRoom = true;
      console.log('[OnlineGame] 已连接，加入房间:', roomCode);
      socket.emit('room:join', { roomCode });
      // 注意：不要在这里请求同步，等待 'connect' 事件或服务器主动推送
    }

    // 监听连接事件（用于连接尚未建立的情况）
    socket.on('connect', () => {
      set({ isConnected: true, error: null });
      console.log('[OnlineGame] 连接到服务器成功');

      // 加入房间（如果还没加入）
      if (!hasJoinedRoom) {
        hasJoinedRoom = true;
        socket.emit('room:join', { roomCode });
      }

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

      // 清除超时定时器
      const timeoutId = (socket as any)._actionTimeout;
      if (timeoutId) {
        clearTimeout(timeoutId);
        delete (socket as any)._actionTimeout;
      }

      if (!result.success) {
        // 提供更详细的错误信息
        const errorMessage = result.errorCode
          ? `${result.error} [${result.errorCode}]`
          : result.error ?? '操作失败';
        get().handleError(errorMessage);
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

    socket.on('room:playerDisconnected', (data: {
      roomId: string;
      disconnectedPlayerId: string;
      disconnectedPlayerName: string;
      players: OnlineGameStore['roomPlayers'];
      reason: 'timeout' | 'network_error' | 'client_closed';
      canReconnect: boolean;
      reconnectTimeout?: number;
    }) => {
      console.log('[OnlineGame] 玩家断线通知:', data);

      // 更新房间玩家列表
      set({ roomPlayers: data.players });

      // 添加断线玩家到列表
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

      // 显示提示（可以在 UI 层监听此事件）
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
      socket.off(); // 移除所有监听器
    }
    wsManager.disconnect();

    set({
      socket: null,
      isConnected: false,
      roomId: null,
      roomCode: null,
      roomPlayers: [],
      disconnectedPlayers: [],
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

    // 生成唯一请求 ID（用于幂等性和超时处理）
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    set({
      pendingAction: action,
      isProcessing: true,
      error: null,
    });

    // 设置超时处理（10 秒）
    const timeoutId = setTimeout(() => {
      const current = get();
      if (current.isProcessing && current.pendingAction === action) {
        set({
          isProcessing: false,
          pendingAction: null,
          error: '服务器响应超时，请重试',
        });
        console.warn('[OnlineGame] ⏰ 请求超时:', { requestId, action });
      }
    }, 10000);

    socket.emit('game:action', {
      roomId,
      action,
      payload: {
        ...payload,
        requestId,  // 添加 requestId 用于幂等性
      },
    });

    // 存储超时 ID，以便在收到响应时清除
    (socket as any)._actionTimeout = timeoutId;
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
    set({
      gameState: state,
      gameVersion: version,
      error: null,
    });

    // 验证状态 Hash（如果服务器提供了 Hash）
    if (stateHash) {
      const localHash = await calculateStateHash(state as GameState);
      if (localHash !== stateHash) {
        console.error('[OnlineGame] ⚠️ 状态 Hash 不匹配！');
        console.error('[OnlineGame] 服务器 Hash:', stateHash);
        console.error('[OnlineGame] 本地 Hash:', localHash);

        // 请求重新同步
        setTimeout(() => {
          get().requestSync();
        }, 100);
      } else {
        console.log(`[OnlineGame] ✅ 状态 Hash 验证通过: ${stateHash.slice(0, 8)}...`);
      }
    }

    console.log(`[OnlineGame] 全量同步: version ${version}, role=${(state as any)._viewMeta?.role ?? 'unknown'}`);
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
          set((state) => ({
            gameState: state.gameState ? produce(state.gameState, (draft) => {
              draft.turnPhase = newPhase as GameState['turnPhase'];
            }) : null,
          }));
          console.log(`[OnlineGame] 本地状态已更新: turnPhase -> ${newPhase}`);
        }
        break;
      }
      case 'turnStart': {
        const currentPlayerId = payload.currentPlayerId as string;
        const phase = payload.phase as string;
        set((state) => ({
          gameState: state.gameState ? produce(state.gameState, (draft) => {
            if (phase) {
              draft.turnPhase = phase as GameState['turnPhase'];
            }
          }) : null,
        }));
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
    console.error('[OnlineGame] ❌ 操作失败:', message);
    console.error('[OnlineGame] 💡 提示: 请检查错误代码，确认操作是否合法');
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
 * 应用状态变化（使用 Immer 进行高效的不可变更新）
 */
function applyChanges(
  state: GameState | ViewState,
  changes: Array<{ path: string; value: unknown; type: string }>
): GameState | ViewState {
  return produce(state, draft => {
    for (const change of changes) {
      setPathValue(draft as Record<string, unknown>, change.path, change.value);
    }
  });
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

/**
 * 计算游戏状态的 Hash 值（用于校验一致性）
 * 与服务器的 calculateStateHash 保持完全相同的逻辑
 * 注意：客户端收到的是 ViewState（经过滤），需要适配为与服务器 GameState 一致的结构
 */
async function calculateStateHash(state: GameState | ViewState): Promise<string> {
  // 适配：ViewState.players 是 PlayerView[]，需要转换为与服务器一致的结构
  const players = state.players.map((p: any) => ({
    id: p.id,
    position: p.position,
    energy: p.energy,
    // ViewState 中 hand 可能不存在（只有自己能看），需要用 handCount
    handCount: p.hand ? p.hand.length : (p.handCount ?? 0),
    // faceUpCards 在 ViewState 中是 Card[]，在 GameState 中也是 Card[]
    faceUpCards: (p.faceUpCards ?? []).map((c: Card) => c.uid),
    eliminated: p.eliminated,
  }));

  const hashData = {
    players,
    currentPlayerIndex: state.currentPlayerIndex,
    turnPhase: state.turnPhase,
    totalTurn: state.totalTurn,
    // flyingStrikes 在 ViewState 中是 FlyingStrikeView[]
    flyingStrikes: (state.flyingStrikes ?? []).map((s: any) => ({
      uid: s.uid,
      ownerId: s.ownerId,
      position: s.position,
      targetSystem: s.targetSystem,
    })),
    // broadcast 在 ViewState 中是 BroadcastStateView
    broadcast: state.broadcast ? {
      active: state.broadcast.active,
      broadcasterId: state.broadcast.broadcasterId,
      phase: state.broadcast.phase,
    } : null,
    destroyedStars: state.destroyedStars,
    winner: state.winner,
  };

  // 使用 Web Crypto API
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(hashData));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
