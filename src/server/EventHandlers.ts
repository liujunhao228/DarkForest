// ============================
// 黑暗森林 - 事件处理器
// ============================
// 处理所有 WebSocket 事件（委托给子处理器）
// ============================

import { Server, Socket } from 'socket.io';
import { RoomManager } from './RoomManager';
import type { ClientMessage, ActionType } from './protocol';
import { AuthHandler } from './handlers/AuthHandler';
import { MatchmakingHandler } from './handlers/MatchmakingHandler';
import { RoomHandler } from './handlers/RoomHandler';
import { GameActionHandler } from './handlers/GameActionHandler';

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
      console.log(`[EventHandlers] 玩家连接: socketId=${socket.id}`);

      // 玩家登录
      socket.on('player:login', (data) => {
        this.authHandler.handlePlayerLogin(socket, data);
      });

      // 匹配队列
      socket.on('match:joinQueue', (data) => {
        this.matchmakingHandler.handleJoinQueue(socket, data);
      });

      socket.on('match:cancelQueue', () => {
        this.matchmakingHandler.handleCancelQueue(socket);
      });

      socket.on('match:getStatus', () => {
        this.matchmakingHandler.handleGetQueueStatus(socket);
      });

      socket.on('match:joinSpecificQueue', (data) => {
        this.matchmakingHandler.handleJoinSpecificQueue(socket, data);
      });

      socket.on('match:createQueue', (data) => {
        this.matchmakingHandler.handleCreateQueue(socket, data);
      });

      socket.on('match:leaveSpecificQueue', (data) => {
        this.matchmakingHandler.handleLeaveSpecificQueue(socket, data);
      });

      socket.on('match:getQueueInfo', (data) => {
        this.matchmakingHandler.handleGetQueueInfo(socket, data);
      });

      socket.on('match:getMyQueues', (data) => {
        this.matchmakingHandler.handleGetMyQueues(socket, data);
      });

      // 房间管理
      socket.on('room:join', (data: { roomCode: string }) => {
        this.roomHandler.handleRoomJoin(socket, data.roomCode);
      });

      socket.on('room:leave', () => {
        this.roomHandler.handleRoomLeave(socket);
      });

      // 游戏操作
      socket.on('game:action', (data: { roomId: string; action: ActionType; payload?: Record<string, unknown> }) => {
        this.gameActionHandler.handleGameAction(socket, data.roomId, data.action, data.payload);
      });

      socket.on('game:requestSync', (data: { roomId: string }) => {
        this.gameActionHandler.handleRequestSync(socket, data.roomId);
      });

      socket.on('game:ackState', (data: { roomId: string; version: number }) => {
        this.gameActionHandler.handleAckState(socket, data.roomId, data.version);
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
        console.error(`[EventHandlers] 连接错误 (${socket.id}):`, error);
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
