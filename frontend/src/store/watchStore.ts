import { create } from 'zustand';
import type { ViewState } from '@/lib/game/viewState';

interface WatchStore {
  /** 当前正在观察的 agent sid */
  sid: string | null;
  /** 被观察玩家的最新私有 ViewState */
  viewState: ViewState | null;
  connected: boolean;
  error: string | null;

  setViewState: (view: ViewState) => void;
  setConnected: (connected: boolean) => void;
  setError: (message: string | null) => void;
  setSid: (sid: string) => void;
  reset: () => void;
}

const initialState = {
  sid: null,
  viewState: null,
  connected: false,
  error: null,
};

export const useWatchStore = create<WatchStore>((set) => ({
  ...initialState,

  setViewState: (view) => set({ viewState: view }),
  setConnected: (connected) => set({ connected }),
  setError: (message) => set({ error: message }),
  setSid: (sid) => set({ sid }),
  reset: () => set({ ...initialState }),
}));