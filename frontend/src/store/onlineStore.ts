import { create } from 'zustand';

interface QueueGroup {
  playerCount: number;
  count: number;
}

interface QueueStatus {
  inQueue: boolean;
  position?: number;
  totalInQueue?: number;
  groups?: QueueGroup[];
  timeElapsed?: number;
  phase?: 'searching' | 'expanding' | 'starting';
}

interface MatchInfo {
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

interface CustomQueueInfo {
  queueId: string;
  queueName: string;
  creatorId: string;
  creatorName: string;
  minPlayers: number;
  maxPlayers: number;
  /** 房主选择的基础游戏模式（classic / civilization_relics） */
  baseGameMode?: GameMode;
  /** 房主自定义的规则覆盖，非空时覆盖 baseGameMode 预设 */
  customRules?: ModeRules | null;
  status: 'waiting' | 'matching' | 'full' | 'started';
  players: Array<{
    playerId: string;
    displayName: string;
    isReady: boolean;
    joinedAt: Date;
  }>;
}

interface RoomInfo {
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

import { wsClient } from '../ws/client';
import { getToken, useAuthStore } from './authStore';
import { isTokenExpired } from '../lib/token';
import type { ModeRules } from '../lib/game/modeRules';
import type { GameMode } from '../lib/game/types';

interface OnlineStore {
  isConnected: boolean;
  isConnecting: boolean;
  isLoggedIn: boolean;
  isInQueue: boolean;
  queueStatus: QueueStatus;
  matchInfo: MatchInfo | null;
  currentQueue: CustomQueueInfo | null;
  currentRoom: RoomInfo | null;
  countdownEndsAt: number | null;
  hasRestoredQueue: boolean;
  error: string | null;

  connect: () => void;
  disconnect: () => void;
  login: (displayName: string) => Promise<void>;
  logout: () => void;
  joinQueue: (preferredCount: number, gameMode?: 'classic' | 'civilization_relics') => Promise<void>;
  cancelQueue: () => Promise<void>;
  createCustomQueue: (queueName: string, minPlayers?: number, maxPlayers?: number, baseGameMode?: GameMode, customRules?: ModeRules | null) => Promise<void>;
  joinSpecificQueue: (queueId: string) => Promise<void>;
  leaveSpecificQueue: (queueId: string) => Promise<void>;
  getQueueInfo: (queueId: string) => Promise<void>;
  checkMyQueue: () => Promise<boolean>;
  joinRoomByCode: (roomCode: string) => Promise<void>;
  leaveRoom: () => void;
  clearError: () => void;
}

let onlineStoreUnsubs: Array<() => void> = [];

function registerOnlineEventListeners(
  set: (partial: Partial<OnlineStore> | ((state: OnlineStore) => Partial<OnlineStore>)) => void,
  get: () => OnlineStore
): Array<() => void> {
  const unsubs: Array<() => void> = [];

  const onConnect = () => {
    set({ isConnected: true, isConnecting: false, error: null });
    // 重连场景：用户已登录时，重发 player:login 触发服务端房间重连
    const { isLoggedIn } = get();
    if (isLoggedIn) {
      const player = useAuthStore.getState().player;
      if (player) {
        wsClient.send('player:login', { displayName: player.displayName });
      }
    }
  };
  wsClient.on('connect', onConnect);
  unsubs.push(() => wsClient.off('connect', onConnect));

  const onDisconnect = () => {
    set({ isConnected: false });
  };
  wsClient.on('disconnect', onDisconnect);
  unsubs.push(() => wsClient.off('disconnect', onDisconnect));

  const onConnectError = (payload: unknown) => {
    const error = payload as Error;
    const token = getToken();
    let message = `连接失败：${error.message}`;
    if (token && isTokenExpired(token)) {
      message = '登录已过期，请重新登录';
    }
    set({ isConnecting: false, isConnected: false, error: message });
  };
  wsClient.on('connect_error', onConnectError);
  unsubs.push(() => wsClient.off('connect_error', onConnectError));

  const onPlayerLoginSuccess = (payload: unknown) => {
    void payload;
    // 仅更新 store 状态，玩家信息由 authStore 持久化（HTTP 登录流程已写入）
    set({ isLoggedIn: true, error: null });
    get().checkMyQueue();
  };
  wsClient.on('player:loginSuccess', onPlayerLoginSuccess);
  unsubs.push(() => wsClient.off('player:loginSuccess', onPlayerLoginSuccess));

  const onPlayerLoginError = (payload: unknown) => {
    const data = payload as { message: string };
    set({ error: data.message, isLoggedIn: false });
  };
  wsClient.on('player:loginError', onPlayerLoginError);
  unsubs.push(() => wsClient.off('player:loginError', onPlayerLoginError));

  const onMatchQueueJoined = (payload: unknown) => {
    const data = payload as Record<string, unknown>;
    set({
      isInQueue: true,
      queueStatus: {
        inQueue: true,
        position: data.position as number,
        totalInQueue: data.totalInQueue as number,
        groups: data.groups as QueueGroup[],
        timeElapsed: 0,
        phase: 'searching' as const,
      },
    });
  };
  wsClient.on('match:queueJoined', onMatchQueueJoined);
  unsubs.push(() => wsClient.off('match:queueJoined', onMatchQueueJoined));

  const onMatchQueueCancelled = () => {
    set({ isInQueue: false, queueStatus: { inQueue: false } });
  };
  wsClient.on('match:queueCancelled', onMatchQueueCancelled);
  unsubs.push(() => wsClient.off('match:queueCancelled', onMatchQueueCancelled));

  const onMatchQueueError = (payload: unknown) => {
    const data = payload as { message: string };
    set({ error: data.message });
  };
  wsClient.on('match:queueError', onMatchQueueError);
  unsubs.push(() => wsClient.off('match:queueError', onMatchQueueError));

  const onMatchQueueCreated = (payload: unknown) => {
    const data = payload as Record<string, unknown>;
    const rawPlayers = (data.players as Array<Record<string, unknown>>) || [];
    const players = rawPlayers.map((p) => ({
      playerId: p.playerId as string,
      displayName: p.displayName as string,
      isReady: (p.isReady as boolean) ?? true,
      joinedAt: new Date((p.joinedAt as number) * 1000),
    }));
    set({
      currentQueue: {
        queueId: data.queueId as string,
        queueName: data.queueName as string,
        creatorId: data.creatorId as string,
        creatorName: data.creatorName as string,
        minPlayers: data.minPlayers as number,
        maxPlayers: data.maxPlayers as number,
        baseGameMode: data.baseGameMode as GameMode | undefined,
        customRules: data.customRules as ModeRules | null | undefined,
        status: 'waiting',
        players,
      },
      error: null,
    });
  };
  wsClient.on('match:queueCreated', onMatchQueueCreated);
  unsubs.push(() => wsClient.off('match:queueCreated', onMatchQueueCreated));

  const onMatchQueueUpdate = (payload: unknown) => {
    const data = payload as Record<string, unknown>;
    set((state) => ({
      queueStatus: { ...state.queueStatus, position: data.position as number, totalInQueue: data.totalInQueue as number, groups: data.groups as QueueGroup[] },
    }));
  };
  wsClient.on('match:queueUpdate', onMatchQueueUpdate);
  unsubs.push(() => wsClient.off('match:queueUpdate', onMatchQueueUpdate));

  const onMatchFound = (payload: unknown) => {
    const data = payload as Record<string, unknown>;
    set({
      isInQueue: false,
      queueStatus: { inQueue: false },
      matchInfo: { roomId: data.roomId as string, roomCode: data.roomCode as string, players: data.players as MatchInfo['players'], isHost: data.isHost as boolean },
    });
  };
  wsClient.on('match:found', onMatchFound);
  unsubs.push(() => wsClient.off('match:found', onMatchFound));

  const onRoomJoined = (payload: unknown) => {
    const data = payload as Record<string, unknown>;
    set({
      currentRoom: {
        id: data.roomId as string,
        roomCode: data.roomCode as string,
        hostId: data.hostId as string,
        status: data.status as RoomInfo['status'],
        playerCount: data.playerCount as number,
        players: data.players as RoomInfo['players'],
      },
      error: null,
    });
  };
  wsClient.on('room:joined', onRoomJoined);
  unsubs.push(() => wsClient.off('room:joined', onRoomJoined));

  const onRoomGameStarting = (payload: unknown) => {
    const data = payload as { countdownSeconds?: number } | null;
    const { currentRoom } = get();
    if (currentRoom && data?.countdownSeconds) {
      set({
        countdownEndsAt: Date.now() + data.countdownSeconds * 1000,
      });
    }
  };
  wsClient.on('room:gameStarting', onRoomGameStarting);
  unsubs.push(() => wsClient.off('room:gameStarting', onRoomGameStarting));

  const onRoomGameStarted = () => {
    const { currentRoom } = get();
    if (currentRoom) {
      set({
        currentRoom: { ...currentRoom, status: 'playing' },
        countdownEndsAt: null,
      });
    }
  };
  wsClient.on('room:gameStarted', onRoomGameStarted);
  unsubs.push(() => wsClient.off('room:gameStarted', onRoomGameStarted));

  const onMatchError = (payload: unknown) => {
    const data = payload as { message: string };
    set({ error: data.message, currentRoom: null });
  };
  wsClient.on('match:error', onMatchError);
  unsubs.push(() => wsClient.off('match:error', onMatchError));

  const onMatchQueueStatus = (payload: unknown) => {
    const data = payload as { inQueue: boolean; position?: number; totalInQueue?: number };
    set({
      isInQueue: data.inQueue,
      queueStatus: {
        inQueue: data.inQueue,
        position: data.position,
        totalInQueue: data.totalInQueue,
      },
    });
  };
  wsClient.on('match:queueStatus', onMatchQueueStatus);
  unsubs.push(() => wsClient.off('match:queueStatus', onMatchQueueStatus));

  const onMatchSpecificQueueJoined = (payload: unknown) => {
    const data = payload as { success: boolean; queueId?: string; message?: string };
    if (data.success && data.queueId) {
      get().getQueueInfo(data.queueId);
      set({ error: null });
    }
  };
  wsClient.on('match:specificQueueJoined', onMatchSpecificQueueJoined);
  unsubs.push(() => wsClient.off('match:specificQueueJoined', onMatchSpecificQueueJoined));

  const onMatchSpecificQueueLeft = () => {
    set({ currentQueue: null, isInQueue: false, queueStatus: { inQueue: false } });
  };
  wsClient.on('match:specificQueueLeft', onMatchSpecificQueueLeft);
  unsubs.push(() => wsClient.off('match:specificQueueLeft', onMatchSpecificQueueLeft));

  const onMatchQueueInfoResponse = (payload: unknown) => {
    const data = payload as Record<string, unknown>;
    const rawPlayers = (data.players as Array<Record<string, unknown>>) || [];
    const players = rawPlayers.map((p) => ({
      playerId: p.playerId as string,
      displayName: p.displayName as string,
      isReady: (p.isReady as boolean) ?? true,
      joinedAt: new Date((p.joinedAt as number) * 1000),
    }));
    set({
      currentQueue: {
        queueId: data.queueId as string,
        queueName: data.queueName as string,
        creatorId: data.creatorId as string,
        creatorName: data.creatorName as string,
        minPlayers: (data.minPlayers as number) ?? 0,
        maxPlayers: (data.maxPlayers as number) ?? 0,
        baseGameMode: data.baseGameMode as GameMode | undefined,
        customRules: data.customRules as ModeRules | null | undefined,
        status: (data.status as CustomQueueInfo['status']) ?? 'waiting',
        players,
      },
      error: null,
    });
  };
  wsClient.on('match:queueInfoResponse', onMatchQueueInfoResponse);
  unsubs.push(() => wsClient.off('match:queueInfoResponse', onMatchQueueInfoResponse));

  const onMatchMyQueuesResponse = (payload: unknown) => {
    const data = payload as { queues: Array<Record<string, unknown>> };
    if (data.queues && data.queues.length > 0) {
      const q = data.queues[0];
      set({
        isInQueue: true,
        hasRestoredQueue: true,
        currentQueue: {
          queueId: q.queueId as string,
          queueName: q.queueName as string,
          creatorId: q.creatorId as string,
          creatorName: q.creatorName as string,
          minPlayers: (q.minPlayers as number) ?? 0,
          maxPlayers: (q.maxPlayers as number) ?? 0,
          baseGameMode: q.baseGameMode as GameMode | undefined,
          customRules: q.customRules as ModeRules | null | undefined,
          status: 'waiting',
          players: (q.players as CustomQueueInfo['players']) ?? [],
        },
      });
    } else {
      set({ hasRestoredQueue: true });
    }
  };
  wsClient.on('match:myQueuesResponse', onMatchMyQueuesResponse);
  unsubs.push(() => wsClient.off('match:myQueuesResponse', onMatchMyQueuesResponse));

  const onRoomHostChanged = (payload: unknown) => {
    const data = payload as { newHostId: string; players: RoomInfo['players'] };
    const { currentRoom } = get();
    if (currentRoom) {
      set({
        currentRoom: {
          ...currentRoom,
          hostId: data.newHostId,
          players: data.players ?? currentRoom.players,
        },
      });
    }
  };
  wsClient.on('room:hostChanged', onRoomHostChanged);
  unsubs.push(() => wsClient.off('room:hostChanged', onRoomHostChanged));

  return unsubs;
}

export const useOnlineStore = create<OnlineStore>((set, get) => ({
  isConnected: false,
  isConnecting: false,
  isLoggedIn: false,
  isInQueue: false,
  queueStatus: { inQueue: false },
  matchInfo: null,
  currentQueue: null,
  currentRoom: null,
  countdownEndsAt: null,
  hasRestoredQueue: false,
  error: null,

  connect: () => {
    const { isConnected, isConnecting } = get();
    if (isConnected || isConnecting) return;
    set({ isConnecting: true, error: null });

    wsClient.connect();

    if (onlineStoreUnsubs.length === 0) {
      onlineStoreUnsubs = registerOnlineEventListeners(set, get);
    }
  },

  disconnect: () => {
    onlineStoreUnsubs.forEach((off) => off());
    onlineStoreUnsubs = [];
    wsClient.disconnect();
    set({ isConnected: false, isConnecting: false, isLoggedIn: false });
  },

  login: async (displayName: string) => {
    const { isConnected } = get();
    if (!isConnected) {
      set({ error: '未连接到服务器' });
      return;
    }
    wsClient.send('player:login', { displayName });
  },

  logout: () => {
    set({ isLoggedIn: false, isInQueue: false, queueStatus: { inQueue: false } });
  },

  joinQueue: async (preferredCount: number, gameMode?: 'classic' | 'civilization_relics') => {
    const { isConnected } = get();
    if (!isConnected) { set({ error: '未连接到服务器' }); return; }
    wsClient.send('match:joinQueue', { preferredCount, gameMode });
  },

  cancelQueue: async () => {
    const { isConnected } = get();
    if (!isConnected) { return; }
    wsClient.send('match:cancelQueue', {});
  },

  createCustomQueue: async (queueName: string, minPlayers = 3, maxPlayers = 4, baseGameMode?: GameMode, customRules?: ModeRules | null) => {
    const { isConnected } = get();
    if (!isConnected) { set({ error: '未连接到服务器' }); return; }
    wsClient.send('match:createQueue', { queueName, minPlayers, maxPlayers, baseGameMode, customRules });
  },

  joinSpecificQueue: async (queueId: string) => {
    const { isConnected } = get();
    if (!isConnected) { set({ error: '未连接到服务器' }); return; }
    wsClient.send('match:joinSpecificQueue', { queueId, playerCount: 4 });
  },

  leaveSpecificQueue: async (queueId: string) => {
    const { isConnected } = get();
    if (!isConnected) { set({ error: '未连接到服务器' }); return; }
    wsClient.send('match:leaveSpecificQueue', { queueId });
  },

  getQueueInfo: async (queueId: string) => {
    const { isConnected } = get();
    if (!isConnected) { set({ error: '未连接到服务器' }); return; }
    wsClient.send('match:getQueueInfo', { queueId });
  },

  checkMyQueue: async () => {
    const { isConnected } = get();
    if (!isConnected) { set({ hasRestoredQueue: false }); return false; }
    wsClient.send('match:getMyQueues', {});
    return true;
  },

  joinRoomByCode: async (roomCode: string) => {
    const { isConnected } = get();
    if (!isConnected) { set({ error: '未连接到服务器' }); return; }
    wsClient.send('room:join', { roomId: roomCode });
  },

  leaveRoom: () => {
    const { isConnected } = get();
    if (isConnected) {
      wsClient.send('room:leave');
    }
    set({ currentRoom: null, error: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));
