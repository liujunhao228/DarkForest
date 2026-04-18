// ============================
// 黑暗森林 - 游戏操作处理器
// ============================
// 处理游戏操作、同步请求和断线逻辑
// ============================

import { Server, Socket } from 'socket.io';
import type { ActionType } from '../protocol';
import { ServerEvents } from '../protocol';
import type { RoomManager } from '../RoomManager';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GameActionHandler');

export class GameActionHandler {
  private io: Server;
  private roomManager: RoomManager;

  constructor(io: Server, roomManager: RoomManager) {
    this.io = io;
    this.roomManager = roomManager;
  }

  /**
   * 处理游戏操作
   */
  async handleGameAction(
    socket: Socket,
    roomId: string,
    action: ActionType,
    payload?: Record<string, unknown>
  ): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;

    // 检查房间是否存在
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      socket.emit(ServerEvents.GAME_ERROR, { message: '房间不存在' });
      return;
    }

    // 检查房间状态
    if (room.status !== 'playing') {
      socket.emit(ServerEvents.GAME_ERROR, { message: '游戏尚未开始或已结束' });
      return;
    }

    const engine = this.roomManager.getEngine(roomId);
    if (!engine) {
      logger.error(`游戏引擎不存在: roomId=${roomId}, room.status=${room.status}`);
      socket.emit(ServerEvents.GAME_ERROR, { message: '游戏引擎不存在，请刷新页面重试' });
      return;
    }

    // 提取 requestId（如果存在）
    const payloadRecord = payload as Record<string, unknown>;
    const requestId = payloadRecord?.requestId as string | undefined;
    // 从 payload 中移除 requestId，避免传递给引擎
    const cleanPayload = { ...(payload || {}) };
    delete cleanPayload.requestId;

    // 处理操作（带幂等性）
    const result = await engine.processAction(playerId, action, cleanPayload, requestId);

    // 发送结果
    socket.emit(ServerEvents.GAME_ACTION_RESULT, result);

    if (!result.success) {
      socket.emit(ServerEvents.GAME_ERROR, { message: result.error });
    } else {
      // 玩家操作成功后更新房间活动时间，防止被误判为超时
      room.lastActivity = Date.now();
      logger.debug(`更新房间活动时间: ${room.roomCode}, 操作: ${action}`);
    }
  }

  /**
   * 处理请求同步
   */
  handleRequestSync(socket: Socket, roomId: string): void {
    logger.debug(`handleRequestSync: socketId=${socket.id}, roomId=${roomId}`);
    const syncManager = this.roomManager.getSyncManager(roomId);
    if (syncManager) {
      syncManager.requestFullSync(socket.id);
    } else {
      logger.warn(`SyncManager 不存在: roomId=${roomId}`);
    }
  }

  /**
   * 处理确认状态
   */
  handleAckState(socket: Socket, roomId: string, version: number): void {
    const syncManager = this.roomManager.getSyncManager(roomId);
    if (syncManager) {
      syncManager.ackState(socket.id, version);
    }
  }

  /**
   * 处理断开连接
   * 区分被动断线（网络问题）和主动离开
   */
  handleDisconnect(socket: Socket): void {
    const playerId = socket.data.playerId;
    const displayName = socket.data.displayName || '未登录';
    const roomCode = socket.data.roomCode;

    if (playerId) {
      // 处理断线（而非主动离开）
      if (roomCode) {
        const roomId = this.roomManager.getRoomIdByCode(roomCode);
        if (roomId) {
          // 发送专门的断线通知
          this.roomManager.playerDisconnected(roomId, playerId, 'network_error');
        }
      }
    }

    logger.debug(`玩家断开连接: displayName=${displayName}, socketId=${socket.id}`);
  }
}
