'use client';

import { useMemo, useEffect, useRef } from 'react';

// 模块级缓存，避免频繁的 localStorage IO
// 玩家 ID 在会话期间不会改变，使用持久缓存
let cachedPlayerId: string | null = null;

/**
 * 获取当前本地玩家 ID（从 localStorage 缓存读取）
 * 避免多个组件重复读取 localStorage
 * 优化：玩家 ID 在会话期间不变，使用持久缓存
 */
export function useLocalPlayerId(): string | null {
  const hasSetCache = useRef(false);

  const playerId = useMemo(() => {
    // 如果已有缓存，直接返回
    if (cachedPlayerId) {
      return cachedPlayerId;
    }

    // 读取 localStorage
    try {
      const playerData = localStorage.getItem('player');
      if (playerData) {
        const parsed = JSON.parse(playerData);
        return parsed.id ?? null;
      }
    } catch (e) {
      // localStorage 数据格式异常，返回 null
      console.warn('Failed to parse player data from localStorage:', e);
    }

    return null;
  }, []);

  // 在 effect 中设置模块级缓存（不在渲染期间执行副作用）
  useEffect(() => {
    if (playerId && !hasSetCache.current) {
      cachedPlayerId = playerId;
      hasSetCache.current = true;
    }
  }, [playerId]);

  return playerId;
}

/**
 * 清除玩家 ID 缓存（用于登出或切换账号时）
 */
export function clearLocalPlayerId(): void {
  cachedPlayerId = null;
  localStorage.removeItem('player');
}
