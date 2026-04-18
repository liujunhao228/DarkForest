// ============================
// 黑暗森林 - 房间处理器
// ============================
// 处理房间加入/离开逻辑
// ============================

import { Socket } from 'socket.io';
import type { RoomManager } from '../RoomManager';
import { ServerEvents } from '../protocol';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RoomHandler');

export class RoomHandler {
  private roomManager: RoomManager;

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
  }

  /**
   * 处理加入房间
   */
  async handleRoomJoin(socket: Socket, roomCode: string): Promise<void> {
    const playerId = socket.data.playerId;
    logger.debug(`handleRoomJoin 被调用: socketId=${socket.id}, roomCode=${roomCode}, playerId=${playerId}`);

    if (!playerId) {
      logger.warn(`玩家未登录，无法加入房间: ${roomCode}`);
      socket.emit(ServerEvents.ROOM_ERROR, { message: '请先登录' });
      return;
    }

    const result = await this.roomManager.joinRoom(roomCode, playerId, socket.id);

    if (!result.success) {
      socket.emit(ServerEvents.ROOM_ERROR, { message: result.error });
      return;
    }

    // 获取房间信息
    const roomId = this.roomManager.getRoomIdByCode(roomCode);
    if (roomId) {
      const room = this.roomManager.getRoom(roomId);
      if (room) {
        socket.emit(ServerEvents.ROOM_JOINED, {
          roomId,
          roomCode,
          hostId: room.hostId,
          status: room.status,
          playerCount: room.players.size,
          players: Array.from(room.players.values()).map(p => ({
            playerId: p.playerId,
            displayName: p.displayName,
            isHost: p.isHost,
            playerNumber: p.playerNumber,
            position: p.position,
            ready: p.ready,
            connected: p.connected,
          })),
        });

        if (room.status === 'playing') {
          socket.data.roomCode = roomCode;
          socket.emit(ServerEvents.ROOM_GAME_STARTING, {
            roomId,
            roomCode,
          });
        }
      }
    }

    socket.data.roomCode = roomCode;
    logger.debug(`玩家加入房间: displayName=${socket.data.displayName || '未知'}, playerId=${playerId} -> ${roomCode}`);
  }

  /**
   * 处理离开房间
   */
  handleRoomLeave(socket: Socket): void {
    const playerId = socket.data.playerId;
    const roomCode = socket.data.roomCode;

    if (!playerId || !roomCode) return;

    const roomId = this.roomManager.getRoomIdByCode(roomCode);
    if (roomId) {
      const room = this.roomManager.getRoomWithEngine(roomId);
      if (room) {
        room.syncManager.removeClient(socket.id);
      }

      this.roomManager.leaveRoom(roomId, playerId);
    }

    socket.data.roomCode = null;
    logger.debug(`玩家离开房间: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}`);
  }
}
