// ============================
// 黑暗森林 - 频率限制工具
// ============================
// 管理请求频率限制，防止滥用
// ============================

import { createLogger } from '@/lib/logger';

const logger = createLogger('RateLimit');

// 请求频率限制配置
export const RATE_LIMIT = {
  windowMs: 60000, // 1分钟
  maxRequests: 60, // 最大请求数
  replayLoadLimit: 10 // 回放加载限制
};

// 请求记录接口
export interface RequestRecord {
  count: number;
  replayLoadCount: number;
  lastReset: number;
}

// 请求记录存储
const requestRecords = new Map<string, RequestRecord>();

/**
 * 检查请求频率限制
 * @param socketId 客户端 socket ID
 * @param isReplayLoad 是否为回放加载请求
 * @returns 是否通过频率限制
 */
export function checkRateLimit(socketId: string, isReplayLoad: boolean = false): boolean {
  const now = Date.now();
  let record = requestRecords.get(socketId);

  // 初始化或重置记录
  if (!record || now - record.lastReset > RATE_LIMIT.windowMs) {
    record = {
      count: 0,
      replayLoadCount: 0,
      lastReset: now
    };
  }

  // 增加计数
  record.count++;
  if (isReplayLoad) {
    record.replayLoadCount++;
  }

  // 检查限制
  const overLimit = record.count > RATE_LIMIT.maxRequests || 
    (isReplayLoad && record.replayLoadCount > RATE_LIMIT.replayLoadLimit);

  // 更新记录
  requestRecords.set(socketId, record);

  if (overLimit) {
    logger.warn(`请求频率超限: socketId=${socketId}, count=${record.count}, replayLoadCount=${record.replayLoadCount}`);
  }

  return !overLimit;
}
