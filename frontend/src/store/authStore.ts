import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player } from '../api/auth';

interface AuthStore {
  token: string | null;
  player: Player | null;
  isAuthenticated: boolean;
  login: (token: string, player: Player) => void;
  logout: () => void;
  setPlayer: (player: Player) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      player: null,
      isAuthenticated: false,
      login: (token, player) => {
        set({ token, player, isAuthenticated: true });
      },
      logout: () => {
        set({ token: null, player: null, isAuthenticated: false });
      },
      setPlayer: (player) => {
        set({ player });
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);

export function getToken(): string | null {
  const store = useAuthStore.getState();
  return store.token;
}

export function isLoggedIn(): boolean {
  const store = useAuthStore.getState();
  return store.isAuthenticated && !!store.token;
}