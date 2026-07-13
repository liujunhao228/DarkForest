import { create } from 'zustand';
import { wsClient } from '@/ws/client';
import { initialState } from './types';
import type { OnlineGameStore } from './types';
import { handleFullSync as handleFullSyncImpl, handleDeltaSync as handleDeltaSyncImpl } from './sync';
import { sendAction as sendActionImpl, handleGameEvent as handleGameEventImpl, clearActionTimeout } from './events';
import { registerGameEventListeners } from './eventListeners';

let gameEventUnsubs: Array<() => void> = [];

export const useOnlineGameStore = create<OnlineGameStore>((set, get) => ({
  ...initialState,

  connect: (roomId: string, roomCode: string) => {
    const { isConnected: currentlyConnected, hasInitializedListeners } = get();

    if (currentlyConnected) {
      set({ roomId, roomCode, error: null });

      if (!hasInitializedListeners) {
        set({ hasInitializedListeners: true });
        gameEventUnsubs = registerGameEventListeners(set, get);
      }

      wsClient.send('game:requestSync', { roomId });
      return;
    }

    set({ roomId, roomCode, error: null });

    wsClient.connect();

    if (!hasInitializedListeners) {
      set({ hasInitializedListeners: true });
      gameEventUnsubs = registerGameEventListeners(set, get);
    }

    // wsClient 已是 OPEN 时 connect() 是 no-op，不会再 emit('connect')
    // 此刻注册的 onConnect 监听器收不到历史事件，需手动同步 store 状态
    if (wsClient.isConnected()) {
      set({ isConnected: true, error: null });
      wsClient.send('game:requestSync', { roomId });
    }
  },

  disconnect: () => {
    clearActionTimeout(get, set);
    gameEventUnsubs.forEach((off) => off());
    gameEventUnsubs = [];
    wsClient.disconnect();
    set({
      ...initialState,
    });
  },

  sendAction: (action, payload?) => {
    sendActionImpl(action, payload, get, set);
  },

  requestSync: () => {
    const { isConnected, roomId } = get();
    if (!isConnected || !roomId) return;
    wsClient.send('game:requestSync', { roomId });
  },

  ackState: (version: number) => {
    const { isConnected, roomId } = get();
    if (!isConnected || !roomId) return;
    wsClient.send('game:ackState', { roomId, version });
  },

  handleFullSync: async (state, version, stateHash?) => {
    await handleFullSyncImpl(state, version, stateHash, set, get);
  },

  handleDeltaSync: (changes, version) => {
    handleDeltaSyncImpl(changes, version, set, get);
  },

  handleGameEvent: (event, payload) => {
    handleGameEventImpl(event, payload, get, set);
  },

  handleError: (message: string) => {
    clearActionTimeout(get, set);
    set({ error: message, pendingAction: null, isProcessing: false });
  },

  clearError: () => {
    set({ error: null });
  },
}));

export type { OnlineGameStore, DisconnectedPlayer } from './types';
