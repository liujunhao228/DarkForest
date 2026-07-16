/**
 * 敏感词表 API - 由后端统一下发，前端启动时拉取并缓存。
 * 后端接口：GET /api/sensitive-words，返回 string[]（无需鉴权）。
 */

import { get } from './http';

// 模块级缓存：仅本次会话内有效，刷新页面后重新拉取
let cached: string[] | null = null;

/**
 * 从后端拉取当前敏感词表，并写入内存缓存。
 * 若已缓存则直接返回缓存值，避免重复请求。
 * @returns 敏感词字符串数组
 */
export async function fetchSensitiveWords(): Promise<string[]> {
  if (cached !== null) {
    return cached;
  }
  const words = await get<string[]>('/api/sensitive-words');
  cached = words;
  return words;
}

/**
 * 同步获取已缓存的敏感词表。
 * @returns 已缓存的敏感词数组；若尚未加载完成则返回 null
 */
export function getCachedSensitiveWords(): string[] | null {
  return cached;
}
