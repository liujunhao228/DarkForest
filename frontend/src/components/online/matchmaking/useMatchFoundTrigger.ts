import { useEffect, useRef } from 'react';
import type { RoomInfo } from './types';

/**
 * 触发 onMatchFound 的 Hook：监听 currentRoom.status === 'playing'，仅触发一次。
 *
 * 设计要点：
 * - 用 ref 锁防止重复触发（避免 React 18 StrictMode 双调用或状态竞争）
 * - currentRoom 变为 null / 离开队列后，通过 reset 重置 ref，下次可再次触发
 * - 由调用方在 leaveQueue / leaveRoom 时主动调用 reset
 *
 * @param currentRoom 当前房间（可能为 null）
 * @param onMatchFound 匹配成功回调
 * @returns `{ reset }` — 重置触发锁，允许下一次触发
 */
export function useMatchFoundTrigger(
  currentRoom: RoomInfo | null,
  onMatchFound: (roomId: string, roomCode: string, players: unknown[]) => void,
): { reset: () => void } {
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (currentRoom && currentRoom.status === 'playing' && !hasTriggered.current) {
      hasTriggered.current = true;
      onMatchFound(currentRoom.id, currentRoom.roomCode, currentRoom.players);
    }
  }, [currentRoom, onMatchFound]);

  const reset = () => {
    hasTriggered.current = false;
  };

  return { reset };
}
