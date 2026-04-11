// ============================
// 黑暗森林 - 房间广播管理
// ============================
// 处理房间内消息广播和同步
// ============================

import { Server } from 'socket.io';
import type { Room } from '../protocol';
import type { RoomWithEngine } from '../RoomManager';

export class RoomBroadcast {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  /**
   * 广播消息给房间内所有玩家
   */
  broadcastToRoom(
    room: RoomWithEngine,
    event: string,
    data: unknown,
    excludeSocketId?: string
  ): void {
    for (const [playerId, player] of room.players.entries()) {
      if (!player.connected || !player.socketId) continue;
      if (player.socketId === excludeSocketId) continue;

      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket?.connected) {
        socket.emit(event, data);
      }
    }
  }

  /**
   * 获取房间玩家信息
   */
  getRoomPlayersInfo(room: Room): Array<{
    playerId: string;
    displayName: string;
    isHost: boolean;
    playerNumber: number;
    position: number;
    ready: boolean;
    connected: boolean;
  }> {
    return Array.from(room.players.values()).map(p => ({
      playerId: p.playerId,
      displayName: p.displayName,
      isHost: p.isHost,
      playerNumber: p.playerNumber,
      position: p.position,
      ready: p.ready,
      connected: p.connected,
    }));
  }
}
