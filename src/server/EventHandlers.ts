// ============================
// 黑暗森林 - 事件处理器
// ============================
// 处理所有 WebSocket 事件（委托给子处理器）
// ============================

import { Server, Socket } from 'socket.io';
import { RoomManager } from './RoomManager';
import type { ActionType } from './protocol';
import { ClientEvents, ServerEvents } from './protocol';
import { AuthHandler } from './handlers/AuthHandler';
import { MatchmakingHandler } from './handlers/MatchmakingHandler';
import { RoomHandler } from './handlers/RoomHandler';
import { GameActionHandler } from './handlers/GameActionHandler';
import { replayStorageService } from './ReplayStorageService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('EventHandlers');

// 请求频率限制配置
const RATE_LIMIT = {
  windowMs: 60000, // 1分钟
  maxRequests: 60, // 最大请求数
  replayLoadLimit: 10 // 回放加载限制
};

// 请求记录接口
interface RequestRecord {
  count: number;
  replayLoadCount: number;
  lastReset: number;
}

// 请求记录存储
const requestRecords = new Map<string, RequestRecord>();

// ============================
// 工具函数
// ============================

/**
 * 检查请求频率限制
 */
function checkRateLimit(socketId: string, isReplayLoad: boolean = false): boolean {
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

/**
 * 验证回放 ID 格式
 */
function validateReplayId(replayId: string): boolean {
  // 简单的格式验证
  return typeof replayId === 'string' && replayId.length > 0 && /^[a-zA-Z0-9-_]+$/.test(replayId);
}

// ============================
// 事件处理器
// ============================

export class EventHandlers {
  private io: Server;
  private roomManager: RoomManager;

  // 子处理器
  private authHandler: AuthHandler;
  private matchmakingHandler: MatchmakingHandler;
  private roomHandler: RoomHandler;
  private gameActionHandler: GameActionHandler;

  constructor(io: Server, roomManager: RoomManager) {
    this.io = io;
    this.roomManager = roomManager;

    // 初始化子处理器
    this.authHandler = new AuthHandler(io);
    this.matchmakingHandler = new MatchmakingHandler(io, roomManager);
    this.roomHandler = new RoomHandler(roomManager);
    this.gameActionHandler = new GameActionHandler(io, roomManager);

    // 注入队列回调到 AuthHandler
    this.authHandler.setQueueCallbacks(
      (playerId) => this.matchmakingHandler.isInQueue(playerId),
      (playerId, data) => this.matchmakingHandler.addToQueue(playerId, data)
    );
  }

  // ============================
  // 注册所有事件
  // ============================

  registerEvents(): void {
    this.io.on('connection', (socket: Socket) => {
      logger.debug(`玩家连接: socketId=${socket.id}`);

      // 玩家登录
      socket.on(ClientEvents.PLAYER_LOGIN, (data) => {
        this.authHandler.handlePlayerLogin(socket, data);
      });

      // 匹配队列
      socket.on(ClientEvents.MATCH_JOIN_QUEUE, (data) => {
        this.matchmakingHandler.handleJoinQueue(socket, data);
      });

      socket.on(ClientEvents.MATCH_CANCEL_QUEUE, () => {
        this.matchmakingHandler.handleCancelQueue(socket);
      });

      socket.on(ClientEvents.MATCH_GET_STATUS, () => {
        this.matchmakingHandler.handleGetQueueStatus(socket);
      });

      socket.on(ClientEvents.MATCH_JOIN_SPECIFIC_QUEUE, (data) => {
        this.matchmakingHandler.handleJoinSpecificQueue(socket, data);
      });

      socket.on(ClientEvents.MATCH_CREATE_QUEUE, (data) => {
        this.matchmakingHandler.handleCreateQueue(socket, data);
      });

      socket.on(ClientEvents.MATCH_LEAVE_SPECIFIC_QUEUE, (data) => {
        this.matchmakingHandler.handleLeaveSpecificQueue(socket, data);
      });

      socket.on(ClientEvents.MATCH_GET_QUEUE_INFO, (data) => {
        this.matchmakingHandler.handleGetQueueInfo(socket, data);
      });

      socket.on(ClientEvents.MATCH_GET_MY_QUEUES, (data) => {
        this.matchmakingHandler.handleGetMyQueues(socket, data);
      });

      // 房间管理
      socket.on(ClientEvents.ROOM_JOIN, (data: { roomCode: string }) => {
        this.roomHandler.handleRoomJoin(socket, data.roomCode);
      });

      socket.on(ClientEvents.ROOM_LEAVE, () => {
        this.roomHandler.handleRoomLeave(socket);
      });

      // 游戏操作
      socket.on(ClientEvents.GAME_ACTION, (data: { roomId: string; action: ActionType; payload?: Record<string, unknown> }) => {
        this.gameActionHandler.handleGameAction(socket, data.roomId, data.action, data.payload);
      });

      socket.on(ClientEvents.GAME_REQUEST_SYNC, (data: { roomId: string }) => {
        this.gameActionHandler.handleRequestSync(socket, data.roomId);
      });

      socket.on(ClientEvents.GAME_ACK_STATE, (data: { roomId: string; version: number }) => {
        this.gameActionHandler.handleAckState(socket, data.roomId, data.version);
      });

      // 回放相关事件
      socket.on('replay:list', async () => {
        try {
          // 检查请求频率
          if (!checkRateLimit(socket.id)) {
            socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
            return;
          }
          
          const playerId = socket.data.playerId;
          if (!playerId) {
            socket.emit('replay:error', { error: '请先登录' });
            return;
          }
          
          const replays = replayStorageService.getAccessibleReplays(playerId);
          socket.emit(ServerEvents.REPLAY_LIST, { replays });
        } catch (error) {
          logger.error('获取回放列表失败:', error);
          socket.emit('replay:error', { error: '获取回放列表失败' });
        }
      });

      socket.on('replay:load', async (data: { replayId: string }) => {
        try {
          // 检查请求频率
          if (!checkRateLimit(socket.id, true)) {
            socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
            return;
          }
          
          // 验证回放 ID
          if (!validateReplayId(data.replayId)) {
            socket.emit('replay:error', { error: '无效的回放 ID' });
            return;
          }
          
          const playerId = socket.data.playerId;
          if (!playerId) {
            socket.emit('replay:error', { error: '请先登录' });
            return;
          }
          
          // 检查权限
          if (!replayStorageService.hasAccess(data.replayId, playerId)) {
            socket.emit('replay:error', { error: '无权访问此回放' });
            return;
          }
          
          const replayData = await replayStorageService.loadReplay(data.replayId);
          socket.emit(ServerEvents.REPLAY_DATA, {
            replayId: data.replayId,
            metadata: replayData.metadata,
            snapshots: replayData.snapshots,
            deltas: replayData.deltas,
            checkpoints: replayData.checkpoints
          });
        } catch (error) {
          logger.error(`加载回放失败 ${data.replayId}:`, error);
          socket.emit('replay:error', { error: '加载回放失败' });
        }
      });

      // 加载回放元数据（分块传输）
      socket.on('replay:loadMetadata', async (data: { replayId: string }) => {
        try {
          // 检查请求频率
          if (!checkRateLimit(socket.id, true)) {
            socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
            return;
          }
          
          // 验证回放 ID
          if (!validateReplayId(data.replayId)) {
            socket.emit('replay:error', { error: '无效的回放 ID' });
            return;
          }
          
          const playerId = socket.data.playerId;
          if (!playerId) {
            socket.emit('replay:error', { error: '请先登录' });
            return;
          }
          
          // 检查权限
          if (!replayStorageService.hasAccess(data.replayId, playerId)) {
            socket.emit('replay:error', { error: '无权访问此回放' });
            return;
          }
          
          const metadata = await replayStorageService.loadReplayMetadata(data.replayId);
          socket.emit('replay:metadata', {
            replayId: data.replayId,
            metadata
          });
        } catch (error) {
          logger.error(`加载回放元数据失败 ${data.replayId}:`, error);
          socket.emit('replay:error', { error: '加载回放元数据失败' });
        }
      });

      // 加载回放快照（分块传输）
      socket.on('replay:loadSnapshots', async (data: { replayId: string; startIndex: number; count: number }) => {
        try {
          // 检查请求频率
          if (!checkRateLimit(socket.id, true)) {
            socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
            return;
          }
          
          // 验证回放 ID
          if (!validateReplayId(data.replayId)) {
            socket.emit('replay:error', { error: '无效的回放 ID' });
            return;
          }
          
          // 验证参数
          const startIndex = Math.max(0, data.startIndex || 0);
          const count = Math.min(50, Math.max(1, data.count || 10)); // 限制每次加载的数量
          
          const playerId = socket.data.playerId;
          if (!playerId) {
            socket.emit('replay:error', { error: '请先登录' });
            return;
          }
          
          // 检查权限
          if (!replayStorageService.hasAccess(data.replayId, playerId)) {
            socket.emit('replay:error', { error: '无权访问此回放' });
            return;
          }
          
          const snapshots = await replayStorageService.loadReplaySnapshots(
            data.replayId,
            startIndex,
            count
          );
          socket.emit('replay:snapshots', {
            replayId: data.replayId,
            snapshots,
            startIndex,
            count: snapshots.length
          });
        } catch (error) {
          logger.error(`加载回放快照失败 ${data.replayId}:`, error);
          socket.emit('replay:error', { error: '加载回放快照失败' });
        }
      });

      // 加载回放增量数据（分块传输）
      socket.on('replay:loadDeltas', async (data: { replayId: string; startVersion: number; endVersion: number }) => {
        try {
          // 检查请求频率
          if (!checkRateLimit(socket.id, true)) {
            socket.emit('replay:error', { error: '请求过于频繁，请稍后再试' });
            return;
          }
          
          // 验证回放 ID
          if (!validateReplayId(data.replayId)) {
            socket.emit('replay:error', { error: '无效的回放 ID' });
            return;
          }
          
          // 验证版本参数
          if (typeof data.startVersion !== 'number' || typeof data.endVersion !== 'number') {
            socket.emit('replay:error', { error: '无效的版本参数' });
            return;
          }
          
          if (data.startVersion < 1 || data.endVersion < data.startVersion) {
            socket.emit('replay:error', { error: '版本参数无效' });
            return;
          }
          
          const playerId = socket.data.playerId;
          if (!playerId) {
            socket.emit('replay:error', { error: '请先登录' });
            return;
          }
          
          // 检查权限
          if (!replayStorageService.hasAccess(data.replayId, playerId)) {
            socket.emit('replay:error', { error: '无权访问此回放' });
            return;
          }
          
          const deltas = await replayStorageService.loadReplayDeltas(
            data.replayId,
            data.startVersion,
            data.endVersion
          );
          socket.emit('replay:deltas', {
            replayId: data.replayId,
            deltas,
            startVersion: data.startVersion,
            endVersion: data.endVersion
          });
        } catch (error) {
          logger.error(`加载回放增量数据失败 ${data.replayId}:`, error);
          socket.emit('replay:error', { error: '加载回放增量数据失败' });
        }
      });

      // 断开连接
      socket.on('disconnect', () => {
        // 从匹配队列移除
        const playerId = socket.data.playerId;
        if (playerId) {
          this.matchmakingHandler.removeFromQueue(playerId);
        }
        this.gameActionHandler.handleDisconnect(socket);
      });

      socket.on('connect_error', (error: Error) => {
        logger.error(`连接错误 (${socket.id}):`, error);
      });
    });
  }

  // ============================
  // 公开方法（供外部调用）
  // ============================

  /**
   * 尝试匹配指定自定义队列（供外部触发）
   */
  async tryMatchCustomQueue(queueId: string): Promise<void> {
    await this.matchmakingHandler.tryMatchCustomQueue(queueId);
  }

  // ============================
  // 内部辅助
  // ============================

  /**
   * 销毁事件处理器
   */
  destroy(): void {
    this.matchmakingHandler.destroy();
  }
}
