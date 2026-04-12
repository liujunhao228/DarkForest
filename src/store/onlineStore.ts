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

  // 匹配状态
  isInQueue: boolean;
  queueStatus: QueueStatus;
  matchInfo: MatchInfo | null;

  // 自定义队列状态
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

  // 自定义队列操作
  createCustomQueue: (queueName: string, minPlayers?: number, maxPlayers?: number) => Promise<void>;
  joinSpecificQueue: (queueId: string) => Promise<void>;
  leaveSpecificQueue: (queueId: string) => Promise<void>;
  getQueueInfo: (queueId: string) => Promise<void>;
  checkMyQueue: () => Promise<boolean>;

  // 房间操作
  joinRoomByCode: (roomCode: string) => Promise<void>;
  leaveRoom: () => void;

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

    // 新版自定义队列事件
    socket.on('match:queueCreated', (data: {
      queueId: string;
      queueName: string;
      minPlayers: number;
      maxPlayers: number;
      players: Array<{ playerId: string; displayName: string }>;
    }) => {
      set({
        currentQueue: {
          queueId: data.queueId,
          queueName: data.queueName,
          creatorId: '', // 创建者即为当前玩家
          creatorName: '',
          minPlayers: data.minPlayers,
          maxPlayers: data.maxPlayers,
          status: 'waiting',
          players: data.players.map(p => ({
            playerId: p.playerId,
            displayName: p.displayName,
            isReady: true,
            joinedAt: new Date(),
          })),
        },
        error: null,
      });
      console.log('[OnlineStore] 队列创建成功:', data.queueId);
    });

    socket.on('match:specificQueueJoined', (data: {
      queueId: string;
      queueName: string;
      position: number;
      totalInQueue: number;
    }) => {
      // 触发队列信息刷新
      const { getQueueInfo } = get();
      getQueueInfo(data.queueId);
      console.log('[OnlineStore] 加入指定队列成功:', data.queueId);
    });

    socket.on('match:specificQueueLeft', (data: { queueId: string }) => {
      set({
        currentQueue: null,
        isInQueue: false,
        queueStatus: { inQueue: false },
        error: null,
      });
      console.log('[OnlineStore] 离开队列成功:', data.queueId);
    });

    socket.on('match:queueInfoResponse', (data: { queue: CustomQueueInfo }) => {
      set({ currentQueue: data.queue, error: null });
      console.log('[OnlineStore] 收到队列信息:', data.queue.queueId);
    });

    socket.on('match:myQueuesResponse', (data: { queues: Array<{ queueId: string; queueName: string; status: string; minPlayers: number; maxPlayers: number; players: Array<{ playerId: string; displayName: string }>; }> }) => {
      if (data.queues.length > 0) {
        const firstQueue = data.queues[0];
        set({
          currentQueue: {
            queueId: firstQueue.queueId,
            queueName: firstQueue.queueName,
            creatorId: '',
            creatorName: '',
            minPlayers: firstQueue.minPlayers,
            maxPlayers: firstQueue.maxPlayers,
            status: firstQueue.status as CustomQueueInfo['status'],
            players: firstQueue.players.map(p => ({
              playerId: p.playerId,
              displayName: p.displayName,
              isReady: true,
              joinedAt: new Date(),
            })),
          },
          hasRestoredQueue: true,
        });
        console.log('[OnlineStore] 恢复队列状态:', firstQueue.queueId);
      } else {
        set({
          currentQueue: null,
          hasRestoredQueue: false,
        });
      }
    });

    socket.on('match:error', (data: { message: string }) => {
      set({ error: data.message });
      console.error('[OnlineStore] 匹配错误:', data.message);
    });

    socket.on('room:joined', (data: {
      roomId: string;
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
        ready: boolean;
        connected: boolean;
      }>;
    }) => {
      console.log('[OnlineStore] room:joined 事件触发:', {
        roomId: data.roomId,
        roomCode: data.roomCode,
        status: data.status,
        playerCount: data.playerCount,
      });
      
      set({
        currentRoom: {
          id: data.roomId,
          roomCode: data.roomCode,
          hostId: data.hostId,
          status: data.status,
          playerCount: data.playerCount,
          players: data.players,
        },
        error: null,
      });
      console.log('[OnlineStore] 加入房间成功:', data.roomCode, 'status:', data.status);
      
      // 如果加入的房间已经在游戏中，确保状态正确
      // 这样 Matchmaking 组件的 useEffect 能检测到 status='playing' 并触发跳转
      if (data.status === 'playing') {
        console.log('[OnlineStore] 加入的是已开始游戏房间，客户端应自动跳转到游戏界面');
      }
    });

    socket.on('room:gameStarting', (data: { roomId: string; roomCode?: string }) => {
      const { currentRoom } = get();
      console.log('[OnlineStore] room:gameStarting 事件触发:', data, '当前 currentRoom:', currentRoom);
      
      if (currentRoom) {
        set({
          currentRoom: {
            ...currentRoom,
            status: 'playing',
          },
        });
        console.log('[OnlineStore] 房间游戏开始:', data.roomId, 'currentRoom 已更新为 playing');
      } else {
        // 如果 currentRoom 还不存在，可能是加入已开始的游戏房间
        // 等待 room:joined 事件设置 currentRoom
        console.warn('[OnlineStore] room:gameStarting 触发时 currentRoom 不存在，等待 room:joined 事件');
      }
    });

    socket.on('room:playerJoined', (data: { roomId: string; players: RoomInfo['players'] }) => {
      const { currentRoom } = get();
      if (currentRoom && currentRoom.id === data.roomId) {
        set({
          currentRoom: {
            ...currentRoom,
            players: data.players,
            playerCount: data.players.length,
          },
        });
      }
    });

    socket.on('room:playerLeft', (data: { roomId: string; players: RoomInfo['players'] }) => {
      const { currentRoom } = get();
      if (currentRoom && currentRoom.id === data.roomId) {
        set({
          currentRoom: {
            ...currentRoom,
            players: data.players,
            playerCount: data.players.length,
          },
        });
      }
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

      // 注意：服务器端已自动将所有玩家 join 到房间（方案 A）
      // 不再需要客户端主动调用 room:join
      // 客户端只需等待 room:joined / room:gameStarting 事件即可
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

  // ============================
  // 自定义队列操作
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

    if (!socket) {
      set({ error: 'Socket 不存在' });
      return;
    }

    // 发送 WebSocket 事件创建队列
    socket.emit('match:createQueue', {
      queueName,
      minPlayers,
      maxPlayers,
    });

    console.log('[OnlineStore] 请求创建自定义队列:', queueName);
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

    if (!socket) {
      set({ error: 'Socket 不存在' });
      return;
    }

    // 发送 WebSocket 事件加入队列
    socket.emit('match:joinSpecificQueue', {
      queueId,
      playerCount: 4,
    });

    console.log('[OnlineStore] 请求加入指定队列:', queueId);
  },

  // 离开指定的匹配队列
  leaveSpecificQueue: async (queueId: string) => {
    const { player, isConnected, socket } = get();

    if (!player) {
      set({ error: '请先登录' });
      return;
    }

    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    if (!socket) {
      set({ error: 'Socket 不存在' });
      return;
    }

    // 发送 WebSocket 事件离开队列
    socket.emit('match:leaveSpecificQueue', {
      queueId,
    });

    console.log('[OnlineStore] 请求离开队列:', queueId);
  },

  // 获取指定队列信息
  getQueueInfo: async (queueId: string) => {
    const { isConnected, socket } = get();

    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    if (!socket) {
      set({ error: 'Socket 不存在' });
      return;
    }

    // 发送 WebSocket 事件请求队列信息
    socket.emit('match:getQueueInfo', {
      queueId,
    });
  },

  // 检查当前玩家是否在队列中（用于客户端重启后恢复状态）
  checkMyQueue: async () => {
    const { player, isConnected, socket } = get();

    if (!player) {
      return false;
    }

    if (!isConnected || !socket) {
      set({ hasRestoredQueue: false });
      return false;
    }

    // 发送 WebSocket 事件请求玩家队列
    socket.emit('match:getMyQueues', {});
    return true;
  },

  // ============================
  // 新版房间操作
  // ============================

  // 通过房号加入房间
  joinRoomByCode: async (roomCode: string) => {
    const { player, isConnected, socket } = get();

    if (!player) {
      set({ error: '请先登录' });
      return;
    }

    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }

    if (!socket) {
      set({ error: 'Socket 不存在' });
      return;
    }

    // 发送 WebSocket 事件加入房间
    socket.emit('room:join', { roomCode });

    console.log('[OnlineStore] 请求加入房间:', roomCode);
  },

  // 离开房间
  leaveRoom: () => {
    const { socket, isConnected, currentRoom } = get();
    if (isConnected && socket && currentRoom) {
      socket.emit('room:leave');
    }
    set({
      currentRoom: null,
      error: null,
    });
    console.log('[OnlineStore] 离开房间');
  },

  // 清除错误
  clearError: () => {
    set({ error: null });
  },
}));
