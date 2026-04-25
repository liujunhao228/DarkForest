// ============================
// 黑暗森林 - 回放模块
// ============================
// 管理回放数据的存储、加载和访问
// ============================

import { ReplayStorageService } from '@/server/ReplayStorageService';
import type { ReplayData, ReplayMetadata, ReplayStateNode, ReplayDelta } from '@/lib/game/types';

// 导出回放存储服务
export { ReplayStorageService, replayStorageService } from '@/server/ReplayStorageService';

// 导出回放相关类型
export type {
  ReplayData,
  ReplayMetadata,
  ReplayStateNode,
  ReplayDelta
} from '@/lib/game/types';

// 回放模块工具函数
export const replayUtils = {
  /**
   * 格式化回放时间
   */
  formatReplayTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  /**
   * 格式化回放时长
   */
  formatReplayDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
  }
};
