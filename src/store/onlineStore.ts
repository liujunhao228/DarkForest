// ============================
// 在线匹配状态管理 (Zustand Store)
// ============================
// 负责：WebSocket 连接、玩家登录、匹配队列
// ============================

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

// ============================
// 类型定义
// ============================

export interface Player {
  id: string;
  displayName: string;
  level: number;
  experience: number;
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  rating: number;
}

export interface MatchInfo {
  roomId: string;
  roomCode: string;
  players: Array<{
    playerId: string;
    displayName: string;
    isAI: boolean;
    isHost: boolean;
    playerNumber: number;
    position: number;
  }>;
  isHost: boolean;
}

export interface QueueStatus {
  inQueue: boolean;
  position?: number;
  estimatedTime?: number;
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

  // 错误
  error: string | null;

  // 连接操作
  connect: () => void;
  disconnect: () => void;

  // 玩家操作
  login: (displayName: string) => Promise<void>;
  logout: () => void;

  // 匹配操作
  joinQueue: (mode: 'casual' | 'ranked', playerCount: number) => void;
  cancelQueue: () => void;
  updateQueueStatus: () => void;

  // 房间操作
  acceptMatch: () => void;
  declineMatch: () => void;

  // 清除错误
  clearError: () => void;
}

// ============================
// WebSocket URL
// ============================

const getWebSocketUrl = () => {
  // 开发环境使用固定端口
  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:${process.env.NEXT_PUBLIC_WEBSOCKET_PORT || '3003'}?XTransformPort=${process.env.NEXT_PUBLIC_WEBSOCKET_PORT || '3003'}`;
  }
  // 生产环境使用当前域名
  return `/?XTransformPort=${process.env.NEXT_PUBLIC_WEBSOCKET_PORT || '3003'}`;
};

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
  error: null,

  // 连接 WebSocket
  connect: () => {
    const { socket, isConnected, isConnecting } = get();
    
    if (socket || isConnecting || isConnected) return;

    set({ isConnecting: true, error: null });

    const newSocket = io(getWebSocketUrl(), {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    newSocket.on('connect', () => {
      set({ isConnected: true, isConnecting: false, error: null });
      console.log('[OnlineStore] 已连接到 WebSocket 服务器');
    });

    newSocket.on('disconnect', () => {
      set({ isConnected: false });
      console.log('[OnlineStore] 与 WebSocket 服务器断开连接');
    });

    newSocket.on('connect_error', (error: Error) => {
      set({ 
        isConnecting: false, 
        isConnected: false, 
        error: `连接失败：${error.message}` 
      });
      console.error('[OnlineStore] 连接错误:', error);
    });

    // 玩家登录响应
    newSocket.on('player:loggedIn', (data: { playerId: string; displayName: string }) => {
      set({
        isLoggedIn: true,
        player: {
          id: data.playerId,
          displayName: data.displayName,
          level: 1,
          experience: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          totalMatches: 0,
          rating: 1000,
        },
      });
      console.log('[OnlineStore] 玩家登录成功:', data.displayName);
    });

    // 匹配队列响应
    newSocket.on('match:queueJoined', (data: { mode: string; playerCount: number; position: number }) => {
      set({
        isInQueue: true,
        queueStatus: {
          inQueue: true,
          position: data.position,
          estimatedTime: 30,
        },
      });
      console.log('[OnlineStore] 已加入匹配队列');
    });

    newSocket.on('match:queueCancelled', () => {
      set({
        isInQueue: false,
        queueStatus: { inQueue: false },
      });
      console.log('[OnlineStore] 已取消匹配队列');
    });

    newSocket.on('match:queueError', (data: { message: string }) => {
      set({ error: data.message });
      console.error('[OnlineStore] 匹配队列错误:', data.message);
    });

    // 匹配成功
    newSocket.on('match:found', (data: {
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

    // 错误处理
    newSocket.on('error', (data: { message: string }) => {
      set({ error: data.message });
      console.error('[OnlineStore] 服务器错误:', data.message);
    });

    set({ socket: newSocket });
  },

  // 断开连接
  disconnect: () => {
    const { socket } = get();
    
    if (socket) {
      socket.disconnect();
      set({ socket: null, isConnected: false, isLoggedIn: false, player: null });
    }
  },

  // 玩家登录
  login: async (displayName: string) => {
    const { socket, isConnected } = get();

    if (!socket || !isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    // 生成临时用户 ID（实际应该使用认证系统）
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    socket.emit('player:login', { userId, displayName });
  },

  // 玩家登出
  logout: () => {
    set({ isLoggedIn: false, player: null, isInQueue: false, queueStatus: { inQueue: false } });
  },

  // 加入匹配队列
  joinQueue: (mode: 'casual' | 'ranked', playerCount: number) => {
    const { socket, isConnected } = get();

    if (!socket || !isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    socket.emit('match:joinQueue', { mode, playerCount });
  },

  // 取消匹配队列
  cancelQueue: () => {
    const { socket, isConnected } = get();

    if (!socket || !isConnected) return;

    socket.emit('match:cancelQueue');
  },

  // 更新队列状态
  updateQueueStatus: () => {
    const { socket, isConnected } = get();

    if (!socket || !isConnected) return;

    socket.emit('match:getStatus');
  },

  // 接受匹配
  acceptMatch: () => {
    // 预留：用于需要确认的匹配
    console.log('[OnlineStore] 接受匹配');
  },

  // 拒绝匹配
  declineMatch: () => {
    const { socket } = get();
    if (socket) {
      socket.emit('match:decline');
    }
    set({ matchInfo: null });
  },

  // 清除错误
  clearError: () => {
    set({ error: null });
  },
}));
