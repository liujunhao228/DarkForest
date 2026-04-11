'use client';

import { useMemo } from 'react';

// 模块级缓存，避免频繁的 localStorage IO
let cachedPlayerId: string | null = null;
let lastReadTime = 0;
const CACHE_DURATION = 1000; // 1秒缓存

/**
 * 获取当前本地玩家 ID（从 localStorage 缓存读取）
 * 避免多个组件重复读取 localStorage
 */
export function useLocalPlayerId(): string | null {
  return useMemo(() => {
    const now = Date.now();
    
    // 如果缓存有效，直接返回
    if (cachedPlayerId && now - lastReadTime < CACHE_DURATION) {
      return cachedPlayerId;
    }
    
    // 读取 localStorage
    try {
      const playerData = localStorage.getItem('player');
      if (playerData) {
        const parsed = JSON.parse(playerData);
        cachedPlayerId = parsed.id ?? null;
        lastReadTime = now;
        return cachedPlayerId;
      }
    } catch (e) {
      // localStorage 数据格式异常，返回 null
      console.warn('Failed to parse player data from localStorage:', e);
      cachedPlayerId = null;
    }
    
    return null;
  }, []);
}

/**
 * 清除玩家 ID 缓存（用于登出或切换账号时）
 */
export function clearLocalPlayerId(): void {
  cachedPlayerId = null;
  lastReadTime = 0;
  localStorage.removeItem('player');
}
