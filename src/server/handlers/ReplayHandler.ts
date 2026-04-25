// ============================
// 黑暗森林 - 回放处理器
// ============================
// 处理所有回放相关的事件
// ============================

import { Server, Socket } from 'socket.io';
import { replayStorageService } from '../ReplayStorageService';
import { createLogger } from '@/lib/logger';
import { checkRateLimit } from '../utils/rateLimit';

const logger = createLogger('ReplayHandler');

export class ReplayHandler {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  /**
   * 处理获取回放列表
   */
  async handleReplayList(socket: Socket): Promise<void> {
    try {
      // 检查请求频率
      if (!this.checkRateLimit(socket.id)) {
        socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
        return;
      }
      
      const playerId = socket.data.playerId;
      if (!playerId) {
        socket.emit('replay:error', { error: '请先登录' });
        return;
      }
      
      const replays = replayStorageService.getAccessibleReplays(playerId);
      socket.emit('replay:list', { replays });

      logger.debug(`获取回放列表成功: playerId=${playerId}, count=${replays.length}`);
    } catch (error) {
      logger.error('获取回放列表失败:', error);
      socket.emit('replay:error', { error: '获取回放列表失败' });
    }
  }

  /**
   * 处理加载回放
   */
  async handleReplayLoad(socket: Socket, replayId: string): Promise<void> {
    try {
      // 检查请求频率
      if (!this.checkRateLimit(socket.id, true)) {
        socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
        return;
      }
      
      // 验证回放 ID
      if (!this.validateReplayId(replayId)) {
        socket.emit('replay:error', { error: '无效的回放 ID' });
        return;
      }
      
      const playerId = socket.data.playerId;
      if (!playerId) {
        socket.emit('replay:error', { error: '请先登录' });
        return;
      }
      
      // 检查权限
      if (!replayStorageService.hasAccess(replayId, playerId)) {
        socket.emit('replay:error', { error: '无权访问此回放' });
        return;
      }
      
      const replayData = await replayStorageService.loadReplay(replayId);
      socket.emit('replay:data', {
        replayId: replayId,
        metadata: replayData.metadata,
        snapshots: replayData.snapshots,
        deltas: replayData.deltas,
        checkpoints: replayData.checkpoints
      });

      logger.debug(`加载回放成功: replayId=${replayId}, playerId=${playerId}`);
    } catch (error) {
      logger.error(`加载回放失败 ${replayId}:`, error);
      socket.emit('replay:error', { error: '加载回放失败' });
    }
  }

  /**
   * 处理加载回放元数据
   */
  async handleReplayLoadMetadata(socket: Socket, replayId: string): Promise<void> {
    try {
      // 检查请求频率
      if (!this.checkRateLimit(socket.id, true)) {
        socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
        return;
      }
      
      // 验证回放 ID
      if (!this.validateReplayId(replayId)) {
        socket.emit('replay:error', { error: '无效的回放 ID' });
        return;
      }
      
      const playerId = socket.data.playerId;
      if (!playerId) {
        socket.emit('replay:error', { error: '请先登录' });
        return;
      }
      
      // 检查权限
      if (!replayStorageService.hasAccess(replayId, playerId)) {
        socket.emit('replay:error', { error: '无权访问此回放' });
        return;
      }
      
      const metadata = await replayStorageService.loadReplayMetadata(replayId);
      socket.emit('replay:metadata', {
        replayId: replayId,
        metadata
      });

      logger.debug(`加载回放元数据成功: replayId=${replayId}, playerId=${playerId}`);
    } catch (error) {
      logger.error(`加载回放元数据失败 ${replayId}:`, error);
      socket.emit('replay:error', { error: '加载回放元数据失败' });
    }
  }

  /**
   * 处理加载回放快照
   */
  async handleReplayLoadSnapshots(socket: Socket, replayId: string, startIndex: number, count: number): Promise<void> {
    try {
      // 检查请求频率
      if (!this.checkRateLimit(socket.id, true)) {
        socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
        return;
      }
      
      // 验证回放 ID
      if (!this.validateReplayId(replayId)) {
        socket.emit('replay:error', { error: '无效的回放 ID' });
        return;
      }
      
      // 验证参数
      const validatedStartIndex = Math.max(0, startIndex || 0);
      const validatedCount = Math.min(50, Math.max(1, count || 10)); // 限制每次加载的数量
      
      const playerId = socket.data.playerId;
      if (!playerId) {
        socket.emit('replay:error', { error: '请先登录' });
        return;
      }
      
      // 检查权限
      if (!replayStorageService.hasAccess(replayId, playerId)) {
        socket.emit('replay:error', { error: '无权访问此回放' });
        return;
      }
      
      const snapshots = await replayStorageService.loadReplaySnapshots(
        replayId,
        validatedStartIndex,
        validatedCount
      );
      socket.emit('replay:snapshots', {
        replayId: replayId,
        snapshots,
        startIndex: validatedStartIndex,
        count: snapshots.length
      });

      logger.debug(`加载回放快照成功: replayId=${replayId}, playerId=${playerId}, count=${snapshots.length}`);
    } catch (error) {
      logger.error(`加载回放快照失败 ${replayId}:`, error);
      socket.emit('replay:error', { error: '加载回放快照失败' });
    }
  }

  /**
   * 处理加载回放增量数据
   */
  async handleReplayLoadDeltas(socket: Socket, replayId: string, startVersion: number, endVersion: number): Promise<void> {
    try {
      // 检查请求频率
      if (!this.checkRateLimit(socket.id, true)) {
        socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
        return;
      }
      
      // 验证回放 ID
      if (!this.validateReplayId(replayId)) {
        socket.emit('replay:error', { error: '无效的回放 ID' });
        return;
      }
      
      // 验证版本参数
      if (typeof startVersion !== 'number' || typeof endVersion !== 'number') {
        socket.emit('replay:error', { error: '无效的版本参数' });
        return;
      }
      
      if (startVersion < 1 || endVersion < startVersion) {
        socket.emit('replay:error', { error: '版本参数无效' });
        return;
      }
      
      const playerId = socket.data.playerId;
      if (!playerId) {
        socket.emit('replay:error', { error: '请先登录' });
        return;
      }
      
      // 检查权限
      if (!replayStorageService.hasAccess(replayId, playerId)) {
        socket.emit('replay:error', { error: '无权访问此回放' });
        return;
      }
      
      const deltas = await replayStorageService.loadReplayDeltas(
        replayId,
        startVersion,
        endVersion
      );
      socket.emit('replay:deltas', {
        replayId: replayId,
        deltas,
        startVersion: startVersion,
        endVersion: endVersion
      });

      logger.debug(`加载回放增量数据成功: replayId=${replayId}, playerId=${playerId}, count=${deltas.length}`);
    } catch (error) {
      logger.error(`加载回放增量数据失败 ${replayId}:`, error);
      socket.emit('replay:error', { error: '加载回放增量数据失败' });
    }
  }

  // ============================
  // 辅助方法
  // ============================

  /**
   * 检查请求频率限制
   */
  private checkRateLimit(socketId: string, isReplayLoad: boolean = false): boolean {
    return checkRateLimit(socketId, isReplayLoad);
  }

  /**
   * 验证回放 ID 格式
   */
  private validateReplayId(replayId: string): boolean {
    // 简单的格式验证
    return typeof replayId === 'string' && replayId.length > 0 && /^[a-zA-Z0-9-_]+$/.test(replayId);
  }
}
