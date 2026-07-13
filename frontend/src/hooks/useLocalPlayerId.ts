import { useMemo } from 'react';
import { useAuthStore } from '../store/authStore';

export function useLocalPlayerId(): string | null {
  const player = useAuthStore((s) => s.player);
  return useMemo(() => player?.id ?? null, [player?.id]);
}
