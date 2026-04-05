// ============================
// 在线匹配状态管理 (Zustand Store)
// ============================
// 负责：WebSocket 连接、玩家登录、匹配队列
// ============================

import { create } from 'zustand';
import { wsManager } from '@/lib/websocket';
import type { Socket } from 'socket.io-client';

// ============================
// 类型定义
// ============================

export interface Player {
  id: string;
  displayName: string;
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
}

export interface MatchInfo {
  roomId: string;
  roomCode: string;
  players: Array<{
    playerId: string;
    displayName: string;
    isHost: boolean;
    playerNumber: number;
    position: number;
  }>;
  isHost: boolean;
}

export interface QueueGroup {
  playerCount: number;
  count: number;
}

export interface QueueStatus {
  inQueue: boolean;
  position?: number;
  estimatedTime?: number;
  totalInQueue?: number;
  groups?: QueueGroup[];
  timeElapsed?: number;
  phase?: 'searching' | 'expanding' | 'starting';
}

interface OnlineStore {
  // 连接状态
  socket: Socket | null;
  isConnected: boolean;
  isConnecting: boolean;

  // 玩家信息
  isLoggedIn: boolean;
  player: Player | null;

  // 匹配状态
  isInQueue: boolean;
  queueStatus: QueueStatus;
  matchInfo: MatchInfo | null;
  
  // 匹配偏好
  matchPlayerCount: number;
  isQuickMatch: boolean;

  // 错误
  error: string | null;

  // 连接操作
  connect: () => void;
  disconnect: () => void;

  // 玩家操作
  login: (displayName: string) => Promise<void>;
  logout: () => void;

  // 匹配操作
  joinQueue: (playerCount: number, quickMatch?: boolean) => void;
  cancelQueue: () => void;
  updateQueueStatus: () => void;
  setMatchPreferences: (playerCount: number, quickMatch?: boolean) => void;
  toggleQuickMatch: () => void;

  // 房间操作
  acceptMatch: () => void;
  declineMatch: () => void;

  // 清除错误
  clearError: () => void;
}

// ============================
// Store 实现
// ============================

export const useOnlineStore = create<OnlineStore>((set, get) => ({
  // 初始状态
  socket: null,
  isConnected: false,
  isConnecting: false,
  isLoggedIn: false,
  player: null,
  isInQueue: false,
  queueStatus: { inQueue: false },
  matchInfo: null,
  matchPlayerCount: 4,
  isQuickMatch: false,
  error: null,

  // 连接 WebSocket
  connect: () => {
    const { isConnected: currentlyConnected, isConnecting } = get();

    if (currentlyConnected || isConnecting) {
      console.log('[OnlineStore] 已有连接或正在连接中，跳过');
      return;
    }

    set({ isConnecting: true, error: null });

    // 使用统一的 WebSocket 管理器
    const socket = wsManager.connect();

    // 设置事件监听
    socket.on('connect', () => {
      set({ isConnected: true, isConnecting: false, error: null });
      console.log('[OnlineStore] 已连接到 WebSocket 服务器');

      // 如果已认证，自动登录
      const playerData = localStorage.getItem('player');
      if (playerData) {
        const player = JSON.parse(playerData);
        set({
          isLoggedIn: true,
          player: {
            id: player.id,
            displayName: player.displayName,
            wins: 0,
            losses: 0,
            draws: 0,
            totalMatches: 0,
          },
        });
      }
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
      console.log('[OnlineStore] 与 WebSocket 服务器断开连接');
    });

    socket.on('connect_error', (error: Error) => {
      set({
        isConnecting: false,
        isConnected: false,
        error: `连接失败：${error.message}`
      });
      console.error('[OnlineStore] 连接错误:', error);
    });

    socket.on('player:loginSuccess', (data: { playerId: string; displayName: string; playerInfo?: unknown }) => {
      set({
        isLoggedIn: true,
        player: {
          id: data.playerId,
          displayName: data.displayName,
          wins: 0,
          losses: 0,
          draws: 0,
          totalMatches: 0,
        },
      });
      console.log('[OnlineStore] 玩家登录成功:', data.displayName);
    });

    socket.on('player:loginError', (data: { message: string }) => {
      set({ error: data.message });
      console.error('[OnlineStore] 登录失败:', data.message);
    });

    socket.on('match:queueJoined', (data: { 
      mode: string; 
      playerCount: number; 
      position: number;
      totalInQueue?: number;
      groups?: QueueGroup[];
    }) => {
      set({
        isInQueue: true,
        queueStatus: {
          inQueue: true,
          position: data.position,
          estimatedTime: 30,
          totalInQueue: data.totalInQueue,
          groups: data.groups,
          timeElapsed: 0,
          phase: 'searching',
        },
      });
      console.log('[OnlineStore] 已加入匹配队列');
    });

    socket.on('match:queueCancelled', () => {
      set({
        isInQueue: false,
        queueStatus: { inQueue: false },
      });
      console.log('[OnlineStore] 已取消匹配队列');
    });

    socket.on('match:queueError', (data: { message: string }) => {
      set({ error: data.message });
      console.error('[OnlineStore] 匹配队列错误:', data.message);
    });

    socket.on('match:queueUpdate', (data: {
      position: number;
      totalInQueue?: number;
      groups?: QueueGroup[];
    }) => {
      set((state) => ({
        queueStatus: {
          ...state.queueStatus,
          position: data.position,
          totalInQueue: data.totalInQueue,
          groups: data.groups,
        },
      }));
      console.log('[OnlineStore] 队列状态更新:', data);
    });

    socket.on('match:found', (data: {
      roomId: string;
      roomCode: string;
      players: unknown[];
      isHost: boolean;
    }) => {
      set({
        isInQueue: false,
        queueStatus: { inQueue: false },
        matchInfo: {
          roomId: data.roomId,
          roomCode: data.roomCode,
          players: data.players as MatchInfo['players'],
          isHost: data.isHost,
        },
      });
      console.log('[OnlineStore] 匹配成功:', data.roomCode);
    });

    socket.on('error', (data: { message: string }) => {
      set({ error: data.message });
      console.error('[OnlineStore] 服务器错误:', data.message);
    });

    set({ socket });
  },

  // 断开连接
  disconnect: () => {
    wsManager.disconnect();
    set({ socket: null, isConnected: false, isLoggedIn: false, player: null });
  },

  // 玩家登录
  login: async (displayName: string) => {
    const { isConnected } = get();

    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    const socket = wsManager.getSocket();
    if (!socket) {
      set({ error: 'Socket 不存在' });
      return;
    }

    // 生成临时用户 ID（用于未认证连接）
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    socket.emit('player:login', { userId, displayName });
  },

  // 玩家登出
  logout: () => {
    set({ isLoggedIn: false, player: null, isInQueue: false, queueStatus: { inQueue: false } });
  },

  // 加入匹配队列
  joinQueue: (playerCount: number, quickMatch = false) => {
    const { isConnected } = get();

    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    const socket = wsManager.getSocket();
    if (!socket) return;

    socket.emit('match:joinQueue', { playerCount, quickMatch });

    // 更新本地偏好
    set({
      matchPlayerCount: playerCount,
      isQuickMatch: quickMatch,
    });
  },

  // 取消匹配队列
  cancelQueue: () => {
    const { isConnected } = get();

    if (!isConnected) return;

    const socket = wsManager.getSocket();
    if (!socket) return;

    // 立即更新本地状态
    set({
      isInQueue: false,
      queueStatus: { inQueue: false },
    });

    socket.emit('match:cancelQueue');
  },

  // 更新队列状态
  updateQueueStatus: () => {
    const { isConnected } = get();

    if (!isConnected) return;

    const socket = wsManager.getSocket();
    if (!socket) return;

    socket.emit('match:getStatus');
  },

  // 设置匹配偏好
  setMatchPreferences: (playerCount: number, quickMatch = false) => {
    set({
      matchPlayerCount: playerCount,
      isQuickMatch: quickMatch,
    });

    // 如果在队列中，重新加入
    const { isInQueue, isConnected } = get();
    if (isInQueue && isConnected) {
      const socket = wsManager.getSocket();
      if (socket) {
        socket.emit('match:cancelQueue');
        setTimeout(() => {
          socket.emit('match:joinQueue', { playerCount, quickMatch });
        }, 100);
      }
    }
  },

  // 切换快速匹配
  toggleQuickMatch: () => {
    const { isQuickMatch, matchPlayerCount } = get();
    get().setMatchPreferences(matchPlayerCount, !isQuickMatch);
  },

  // 接受匹配
  acceptMatch: () => {
    console.log('[OnlineStore] 接受匹配');
  },

  // 拒绝匹配
  declineMatch: () => {
    set({ matchInfo: null });
  },

  // 清除错误
  clearError: () => {
    set({ error: null });
  },
}));
