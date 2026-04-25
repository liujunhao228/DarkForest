// ============================
// 黑暗森林 - 回放存储服务
// ============================
// 管理回放数据的存储、压缩和索引
// ============================

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { ReplayData, ReplayMetadata } from '@/lib/game/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ReplayStorageService');

// 存储目录
const REPLAY_DIR = path.join(process.cwd(), 'replays');

// 确保存储目录存在
if (!fs.existsSync(REPLAY_DIR)) {
  fs.mkdirSync(REPLAY_DIR, { recursive: true });
}

// 回放索引文件
const INDEX_FILE = path.join(REPLAY_DIR, 'index.json');

// 索引结构
interface ReplayIndex {
  replays: Array<{
    id: string;
    gameId: string;
    startTime: number;
    duration: number;
    playerCount: number;
    players: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    winner: string | null;
    filePath: string;
    fileSize: number;
  }>;
  version: string;
}

// 存储配置接口
interface StorageConfig {
  maxAgeDays: number;       // 回放最大保留天数
  maxStorageSizeMB: number;  // 最大存储容量（MB）
  cleanupIntervalHours: number; // 自动清理间隔（小时）
}

/**
 * 回放存储服务
 */
export class ReplayStorageService {
  private index: ReplayIndex;
  private config: StorageConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<StorageConfig>) {
    this.index = this.loadIndex();
    this.config = {
      maxAgeDays: config?.maxAgeDays ?? 30,
      maxStorageSizeMB: config?.maxStorageSizeMB ?? 500,
      cleanupIntervalHours: config?.cleanupIntervalHours ?? 24
    };
    
    // 启动自动清理定时器
    this.startAutoCleanup();
  }

  /**
   * 加载回放索引
   */
  private loadIndex(): ReplayIndex {
    try {
      if (fs.existsSync(INDEX_FILE)) {
        const data = fs.readFileSync(INDEX_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.error('Failed to load replay index:', error);
    }

    // 返回默认索引
    return {
      replays: [],
      version: '1.0.0'
    };
  }

  /**
   * 保存回放索引
   */
  private saveIndex(): void {
    try {
      fs.writeFileSync(INDEX_FILE, JSON.stringify(this.index, null, 2));
    } catch (error) {
      logger.error('Failed to save replay index:', error);
    }
  }

  /**
   * 保存回放数据
   */
  async saveReplay(replayData: ReplayData): Promise<string> {
    try {
      const replayId = replayData.metadata.id;
      const tempFilePath = path.join(REPLAY_DIR, `${replayId}.json.gz.tmp`);
      const finalFilePath = path.join(REPLAY_DIR, `${replayId}.json.gz`);

      // 压缩数据
      const compressedData = await this.compressData(replayData);

      // 写入临时文件
      fs.writeFileSync(tempFilePath, compressedData);

      // 原子重命名为正式文件
      fs.renameSync(tempFilePath, finalFilePath);

      // 获取文件大小
      const fileSize = fs.statSync(finalFilePath).size;

      // 更新索引
      this.index.replays.push({
        id: replayId,
        gameId: replayData.metadata.gameId,
        startTime: replayData.metadata.startTime,
        duration: replayData.metadata.duration,
        playerCount: replayData.metadata.playerCount,
        players: replayData.metadata.players,
        winner: replayData.metadata.winner,
        filePath: `${replayId}.json.gz`,
        fileSize
      });

      // 保存索引
      this.saveIndex();

      logger.info(`Saved replay ${replayId}, size: ${(fileSize / 1024).toFixed(2)}KB`);
      return replayId;
    } catch (error) {
      logger.error('Failed to save replay:', error);
      throw error;
    }
  }

  /**
   * 加载回放数据
   */
  async loadReplay(replayId: string): Promise<ReplayData> {
    try {
      // 查找索引
      const replayInfo = this.index.replays.find(r => r.id === replayId);
      if (!replayInfo) {
        throw new Error(`Replay ${replayId} not found`);
      }

      const filePath = path.join(REPLAY_DIR, replayInfo.filePath);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Replay file ${replayInfo.filePath} not found`);
      }

      // 读取并解压数据
      const compressedData = fs.readFileSync(filePath);
      const replayData = await this.decompressData<ReplayData>(compressedData);

      logger.info(`Loaded replay ${replayId}`);
      return replayData;
    } catch (error) {
      logger.error(`Failed to load replay ${replayId}:`, error);
      throw error;
    }
  }

  /**
   * 加载回放元数据
   */
  async loadReplayMetadata(replayId: string): Promise<ReplayMetadata> {
    try {
      const replayData = await this.loadReplay(replayId);
      return replayData.metadata;
    } catch (error) {
      logger.error(`Failed to load replay metadata ${replayId}:`, error);
      throw error;
    }
  }

  /**
   * 加载回放快照
   */
  async loadReplaySnapshots(replayId: string, startIndex: number = 0, count: number = 10): Promise<ReplayStateNode[]> {
    try {
      const replayData = await this.loadReplay(replayId);
      const endIndex = Math.min(startIndex + count, replayData.snapshots.length);
      return replayData.snapshots.slice(startIndex, endIndex);
    } catch (error) {
      logger.error(`Failed to load replay snapshots ${replayId}:`, error);
      throw error;
    }
  }

  /**
   * 加载回放增量数据
   */
  async loadReplayDeltas(replayId: string, startVersion: number, endVersion: number): Promise<ReplayDelta[]> {
    try {
      const replayData = await this.loadReplay(replayId);
      return replayData.deltas.filter(delta => delta.version >= startVersion && delta.version <= endVersion);
    } catch (error) {
      logger.error(`Failed to load replay deltas ${replayId}:`, error);
      throw error;
    }
  }

  /**
   * 获取回放列表
   */
  getReplayList(): Array<{
    id: string;
    gameId: string;
    startTime: number;
    duration: number;
    playerCount: number;
    players: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    winner: string | null;
  }> {
    // 按时间倒序排序
    return [...this.index.replays].sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * 删除回放
   */
  deleteReplay(replayId: string): boolean {
    try {
      // 查找索引
      const index = this.index.replays.findIndex(r => r.id === replayId);
      if (index === -1) {
        return false;
      }

      const replayInfo = this.index.replays[index];
      const filePath = path.join(REPLAY_DIR, replayInfo.filePath);

      // 删除文件
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // 从索引中删除
      this.index.replays.splice(index, 1);
      this.saveIndex();

      logger.info(`Deleted replay ${replayId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete replay ${replayId}:`, error);
      return false;
    }
  }

  /**
   * 清理旧回放
   */
  cleanupOldReplays(maxAgeDays: number = 30): number {
    try {
      const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
      let deletedCount = 0;

      for (let i = this.index.replays.length - 1; i >= 0; i--) {
        const replay = this.index.replays[i];
        if (replay.startTime < cutoffTime) {
          this.deleteReplay(replay.id);
          deletedCount++;
        }
      }

      logger.info(`Cleaned up ${deletedCount} old replays`);
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old replays:', error);
      return 0;
    }
  }

  /**
   * 压缩数据
   */
  private async compressData(data: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const jsonString = JSON.stringify(data);
      zlib.gzip(jsonString, (err, buffer) => {
        if (err) {
          reject(err);
        } else {
          resolve(buffer);
        }
      });
    });
  }

  /**
   * 解压数据
   */
  private async decompressData<T>(buffer: Buffer): Promise<T> {
    return new Promise((resolve, reject) => {
      zlib.gunzip(buffer, (err, buffer) => {
        if (err) {
          reject(err);
        } else {
          try {
            const data = JSON.parse(buffer.toString());
            resolve(data);
          } catch (parseError) {
            reject(parseError);
          }
        }
      });
    });
  }

  /**
   * 获取存储统计信息
   */
  getStorageStats(): {
    totalReplays: number;
    totalSize: number;
    oldestReplay: number | null;
    newestReplay: number | null;
  } {
    let totalSize = 0;
    let oldestReplay: number | null = null;
    let newestReplay: number | null = null;

    for (const replay of this.index.replays) {
      totalSize += replay.fileSize;
      
      if (!oldestReplay || replay.startTime < oldestReplay) {
        oldestReplay = replay.startTime;
      }
      
      if (!newestReplay || replay.startTime > newestReplay) {
        newestReplay = replay.startTime;
      }
    }

    return {
      totalReplays: this.index.replays.length,
      totalSize,
      oldestReplay,
      newestReplay
    };
  }

  /**
   * 检查玩家是否有权限访问回放
   */
  hasAccess(replayId: string, playerId: string): boolean {
    try {
      const replayInfo = this.index.replays.find(r => r.id === replayId);
      if (!replayInfo) {
        return false;
      }

      // 检查玩家是否在回放的玩家列表中
      return replayInfo.players.some(player => player.id === playerId);
    } catch (error) {
      logger.error(`Failed to check access for replay ${replayId}:`, error);
      return false;
    }
  }

  /**
   * 获取玩家可访问的回放列表
   */
  getAccessibleReplays(playerId: string): Array<{
    id: string;
    gameId: string;
    startTime: number;
    duration: number;
    playerCount: number;
    players: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    winner: string | null;
  }> {
    try {
      // 过滤出玩家参与的回放
      return this.index.replays
        .filter(replay => replay.players.some(player => player.id === playerId))
        .sort((a, b) => b.startTime - a.startTime);
    } catch (error) {
      logger.error(`Failed to get accessible replays for player ${playerId}:`, error);
      return [];
    }
  }

  /**
   * 启动自动清理定时器
   */
  private startAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    const intervalMs = this.config.cleanupIntervalHours * 60 * 60 * 1000;
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, intervalMs);

    logger.info(`自动清理已启动，间隔: ${this.config.cleanupIntervalHours}小时`);
  }

  /**
   * 执行清理操作
   */
  private performCleanup(): void {
    logger.info('开始执行自动清理...');
    
    // 清理过期回放
    const oldReplaysDeleted = this.cleanupOldReplays(this.config.maxAgeDays);
    
    // 检查存储容量并清理
    const sizeReplaysDeleted = this.cleanupBySize();
    
    logger.info(`自动清理完成: 删除过期回放 ${oldReplaysDeleted} 个, 删除超限回放 ${sizeReplaysDeleted} 个`);
  }

  /**
   * 根据存储容量清理回放
   */
  private cleanupBySize(): number {
    try {
      const stats = this.getStorageStats();
      const maxSizeBytes = this.config.maxStorageSizeMB * 1024 * 1024;
      
      if (stats.totalSize <= maxSizeBytes) {
        return 0;
      }
      
      // 按时间排序（ oldest first ）
      const sortedReplays = [...this.index.replays].sort((a, b) => a.startTime - b.startTime);
      let deletedCount = 0;
      let currentSize = stats.totalSize;
      
      for (const replay of sortedReplays) {
        if (currentSize <= maxSizeBytes) {
          break;
        }
        
        if (this.deleteReplay(replay.id)) {
          currentSize -= replay.fileSize;
          deletedCount++;
        }
      }
      
      return deletedCount;
    } catch (error) {
      logger.error('按容量清理回放失败:', error);
      return 0;
    }
  }

  /**
   * 设置存储配置
   */
  setConfig(config: Partial<StorageConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    // 重启自动清理定时器
    this.startAutoCleanup();
    
    logger.info('存储配置已更新:', this.config);
  }

  /**
   * 获取当前存储配置
   */
  getConfig(): StorageConfig {
    return { ...this.config };
  }

  /**
   * 手动触发清理
   */
  manualCleanup(): {
    oldReplaysDeleted: number;
    sizeReplaysDeleted: number;
  } {
    const oldReplaysDeleted = this.cleanupOldReplays(this.config.maxAgeDays);
    const sizeReplaysDeleted = this.cleanupBySize();
    
    return {
      oldReplaysDeleted,
      sizeReplaysDeleted
    };
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// 导出单例实例
export const replayStorageService = new ReplayStorageService();
export default replayStorageService;