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
import { ReplayHandler } from './handlers/ReplayHandler';
import { replayStorageService } from './ReplayStorageService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('EventHandlers');



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
  private replayHandler: ReplayHandler;

  constructor(io: Server, roomManager: RoomManager) {
    this.io = io;
    this.roomManager = roomManager;

    // 初始化子处理器
    this.authHandler = new AuthHandler(io);
    this.matchmakingHandler = new MatchmakingHandler(io, roomManager);
    this.roomHandler = new RoomHandler(roomManager);
    this.gameActionHandler = new GameActionHandler(io, roomManager);
    this.replayHandler = new ReplayHandler(io);

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
        await this.replayHandler.handleReplayList(socket);
      });

      socket.on('replay:load', async (data: { replayId: string }) => {
        await this.replayHandler.handleReplayLoad(socket, data.replayId);
      });

      // 加载回放元数据（分块传输）
      socket.on('replay:loadMetadata', async (data: { replayId: string }) => {
        await this.replayHandler.handleReplayLoadMetadata(socket, data.replayId);
      });

      // 加载回放快照（分块传输）
      socket.on('replay:loadSnapshots', async (data: { replayId: string; startIndex: number; count: number }) => {
        await this.replayHandler.handleReplayLoadSnapshots(
          socket,
          data.replayId,
          data.startIndex,
          data.count
        );
      });

      // 加载回放增量数据（分块传输）
      socket.on('replay:loadDeltas', async (data: { replayId: string; startVersion: number; endVersion: number }) => {
        await this.replayHandler.handleReplayLoadDeltas(
          socket,
          data.replayId,
          data.startVersion,
          data.endVersion
        );
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
