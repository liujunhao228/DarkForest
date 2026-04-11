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

// 自定义队列信息
export interface CustomQueueInfo {
  queueId: string;
  queueName: string;
  creatorId: string;
  creatorName: string;
  minPlayers: number;
  maxPlayers: number;
  status: 'waiting' | 'matching' | 'full' | 'started';
  players: Array<{
    playerId: string;
    displayName: string;
    isReady: boolean;
    joinedAt: Date;
  }>;
}

// 房间信息
export interface RoomInfo {
  id: string;
  roomCode: string;
  hostId: string;
  status: 'waiting' | 'playing' | 'finished';
  playerCount: number;
  players: Array<{
    playerId: string;
    displayName: string;
    isHost: boolean;
    playerNumber: number;
    position: number;
  }>;
}

interface OnlineStore {
  // 连接状态
  socket: Socket | null;
  isConnected: boolean;
  isConnecting: boolean;

  // 玩家信息
  isLoggedIn: boolean;
  player: Player | null;

  // 匹配状态 (旧版 - 快速匹配)
  isInQueue: boolean;
  queueStatus: QueueStatus;
  matchInfo: MatchInfo | null;

  // 匹配偏好 (旧版)
  matchPlayerCount: number;
  isQuickMatch: boolean;

  // 自定义队列状态 (新版)
  currentQueue: CustomQueueInfo | null;
  currentRoom: RoomInfo | null;

  // 队列恢复状态
  hasRestoredQueue: boolean;

  // 错误
  error: string | null;

  // 连接操作
  connect: () => void;
  disconnect: () => void;

  // 玩家操作
  login: (displayName: string) => Promise<void>;
  logout: () => void;

  // 匹配操作 (旧版 - 快速匹配)
  /** @deprecated 使用 createCustomQueue 替代 */
  joinQueue: (playerCount: number, quickMatch?: boolean) => void;
  /** @deprecated 使用 leaveSpecificQueue 替代 */
  cancelQueue: () => void;
  /** @deprecated */
  updateQueueStatus: () => void;
  /** @deprecated */
  setMatchPreferences: (playerCount: number, quickMatch?: boolean) => void;
  /** @deprecated */
  toggleQuickMatch: () => void;

  // 自定义队列操作 (新版)
  createCustomQueue: (queueName: string, minPlayers?: number, maxPlayers?: number) => Promise<void>;
  joinSpecificQueue: (queueId: string) => Promise<void>;
  leaveSpecificQueue: (queueId: string) => Promise<void>;
  getQueueInfo: (queueId: string) => Promise<void>;
  checkMyQueue: () => Promise<boolean>;

  // 房间操作 (新版)
  joinRoomByCode: (roomCode: string) => Promise<void>;
  leaveRoom: () => void;

  // 房间操作 (旧版)
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
  currentQueue: null,
  currentRoom: null,
  hasRestoredQueue: false,
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

        // 自动登录后检查是否在队列中
        get().checkMyQueue();
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

  // ============================
  // 新版自定义队列操作
  // ============================

  // 创建自定义队列
  createCustomQueue: async (queueName: string, minPlayers = 3, maxPlayers = 4) => {
    const { player, isConnected, socket } = get();

    if (!player) {
      set({ error: '请先登录' });
      return;
    }

    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      const response = await fetch('/api/match/queue/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          creatorId: player.id,
          queueName,
          minPlayers,
          maxPlayers,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        set({ error: result.error });
        return;
      }

      // 等待短暂时间确保数据库事务完成
      await new Promise(resolve => setTimeout(resolve, 200));

      // 发送 WebSocket 事件将创建者添加到内存队列
      if (socket && result.queueId) {
        socket.emit('match:joinSpecificQueue', {
          queueId: result.queueId,
          playerCount: maxPlayers,
        });
      }

      // 获取队列信息
      await get().getQueueInfo(result.queueId);

      console.log('[OnlineStore] 创建自定义队列成功:', result.queueId);
    } catch (error) {
      console.error('[OnlineStore] 创建队列失败:', error);
      set({ error: '创建队列失败' });
    }
  },

  // 加入指定的匹配队列
  joinSpecificQueue: async (queueId: string) => {
    const { player, isConnected, socket } = get();

    if (!player) {
      set({ error: '请先登录' });
      return;
    }

    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      const response = await fetch('/api/match/queue/join-specific', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          playerId: player.id,
          queueId,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        set({ error: result.error });
        return;
      }

      // 等待短暂时间确保数据库事务完成
      await new Promise(resolve => setTimeout(resolve, 200));

      // 重要：发送 WebSocket 事件通知服务器更新内存队列
      // 这样 tryMatchCustomQueueInternal 才能正确检查玩家在线状态
      if (socket) {
        socket.emit('match:joinSpecificQueue', {
          queueId,
          playerCount: 4,
        });
      }

      // 获取队列信息
      await get().getQueueInfo(queueId);

      console.log('[OnlineStore] 加入自定义队列成功:', queueId);
    } catch (error) {
      console.error('[OnlineStore] 加入队列失败:', error);
      set({ error: '加入队列失败' });
    }
  },

  // 离开指定的匹配队列
  leaveSpecificQueue: async (queueId: string) => {
    const { player } = get();

    if (!player) {
      set({ error: '请先登录' });
      return;
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      const response = await fetch('/api/match/queue/leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          playerId: player.id,
          queueId,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        set({ error: result.error });
        return;
      }

      // 清除本地队列信息
      set({ currentQueue: null });

      console.log('[OnlineStore] 离开自定义队列成功:', queueId);
    } catch (error) {
      console.error('[OnlineStore] 离开队列失败:', error);
      set({ error: '离开队列失败' });
    }
  },

  // 获取指定队列信息
  getQueueInfo: async (queueId: string) => {
    try {
      const response = await fetch(`/api/match/queue/info?queueId=${queueId}`);
      const result = await response.json();

      if (!result.success) {
        set({ error: result.error });
        return;
      }

      set({ currentQueue: result.queue });
    } catch (error) {
      console.error('[OnlineStore] 获取队列信息失败:', error);
      set({ error: '获取队列信息失败' });
    }
  },

  // 检查当前玩家是否在队列中（用于客户端重启后恢复状态）
  checkMyQueue: async () => {
    const { player } = get();

    if (!player) {
      return false;
    }

    try {
      const response = await fetch(`/api/match/my-queue?playerId=${player.id}`);
      const result = await response.json();

      if (result.success && result.inQueue && result.queue) {
        set({
          currentQueue: result.queue,
          hasRestoredQueue: true,
        });
        console.log('[OnlineStore] 恢复队列状态成功:', result.queue.queueId);
        return true;
      }

      set({ hasRestoredQueue: false });
      return false;
    } catch (error) {
      console.error('[OnlineStore] 检查玩家队列失败:', error);
      set({ hasRestoredQueue: false });
      return false;
    }
  },

  // ============================
  // 新版房间操作
  // ============================

  // 通过房号加入房间
  joinRoomByCode: async (roomCode: string) => {
    const { player, isConnected } = get();

    if (!player) {
      set({ error: '请先登录' });
      return;
    }

    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      const response = await fetch('/api/match/room/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          roomCode,
          playerId: player.id,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        set({ error: result.error });
        return;
      }

      set({
        currentRoom: result.match,
        error: null,
      });

      console.log('[OnlineStore] 加入房间成功:', roomCode);
    } catch (error) {
      console.error('[OnlineStore] 加入房间失败:', error);
      set({ error: '加入房间失败' });
    }
  },

  // 离开房间
  leaveRoom: () => {
    set({
      currentRoom: null,
      error: null,
    });
    console.log('[OnlineStore] 离开房间');
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
