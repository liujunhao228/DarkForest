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

/**
 * 回放存储服务
 */
export class ReplayStorageService {
  private index: ReplayIndex;

  constructor() {
    this.index = this.loadIndex();
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
      const filePath = path.join(REPLAY_DIR, `${replayId}.json.gz`);

      // 压缩数据
      const compressedData = await this.compressData(replayData);

      // 写入文件
      fs.writeFileSync(filePath, compressedData);

      // 获取文件大小
      const fileSize = fs.statSync(filePath).size;

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
}

// 导出单例实例
export const replayStorageService = new ReplayStorageService();
export default replayStorageService;