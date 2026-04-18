// ============================
// 黑暗森林 - 认证处理器
// ============================
// 处理玩家登录相关逻辑
// ============================

import { Server, Socket } from 'socket.io';
import type { LoginPayload } from '../protocol';
import { ServerEvents } from '../protocol';
import { getOrCreatePlayer, getPlayerInfo } from '@/lib/matchmaking';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AuthHandler');

export class AuthHandler {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  /**
   * 处理玩家登录
   */
  async handlePlayerLogin(socket: Socket, data: LoginPayload): Promise<void> {
    try {
      const { userId, displayName } = data;

      // 创建或获取玩家
      const player = await getOrCreatePlayer(userId, displayName);
      if (!player) {
        socket.emit(ServerEvents.PLAYER_LOGIN_ERROR, { message: '创建玩家失败' });
        return;
      }

      // 获取玩家信息
      const playerInfo = await getPlayerInfo(player.id);

      // 存储玩家信息到 socket
      socket.data.playerId = player.id;
      socket.data.displayName = player.displayName;

      // 发送成功响应
      socket.emit(ServerEvents.PLAYER_LOGIN_SUCCESS, {
        playerId: player.id,
        displayName: player.displayName,
        playerInfo: playerInfo ? {
          id: playerInfo.id,
          displayName: playerInfo.displayName,
          wins: playerInfo.wins,
          losses: playerInfo.losses,
          draws: playerInfo.draws,
          totalMatches: playerInfo.totalMatches,
        } : undefined,
      });

      logger.debug(`玩家登录成功: displayName=${player.displayName}, playerId=${player.id}, socketId=${socket.id}`);

      // 检查玩家是否在自定义匹配队列中，如果是则恢复内存队列状态
      await this.restorePlayerQueueState(player.id, socket.id);
    } catch (error) {
      logger.error('玩家登录失败:', error);
      socket.emit(ServerEvents.PLAYER_LOGIN_ERROR, { message: '服务器内部错误' });
    }
  }

  /**
   * 恢复玩家的匹配队列状态
   * 当玩家重新连接时，如果发现自己之前在自定义队列中，自动恢复内存队列状态
   */
  private async restorePlayerQueueState(playerId: string, socketId: string): Promise<void> {
    try {
      const { getPlayerQueues } = await import('@/lib/matchmaking');
      const playerQueues = await getPlayerQueues(playerId);

      if (!playerQueues || playerQueues.length === 0) {
        return;
      }

      // 检查玩家是否在已满的队列中
      for (const queue of playerQueues) {
        // 检查队列是否已满
        // 由于队列对象可能没有 createdAt 属性，简化判断逻辑
        const isStaleFullQueue = queue.status === 'full';

        if (isStaleFullQueue && !this.matchmakingQueueHasPlayer(playerId)) {
          // 玩家数据库中的队列状态为 full，但内存中不存在，说明是重连
          logger.debug(`恢复玩家 ${playerId} 的队列状态: ${queue.queueId}`);

          // 重新加入内存队列
          this.setPlayerInQueue(playerId, {
            socketId,
            playerId,
            playerCount: queue.maxPlayers,
            quickMatch: false,
            joinedAt: Date.now(),
          });

          logger.debug(`玩家 ${playerId} 已恢复到队列 ${queue.queueId}`);

          // 通知客户端
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit(ServerEvents.MATCH_QUEUE_RESTORED, {
              queueId: queue.queueId,
              queueName: queue.queueName,
              playerCount: queue.players.length,
              maxPlayers: queue.maxPlayers,
            });
          }

          // 玩家只可能在一个队列中，找到后就可以退出循环
          break;
        }
      }
    } catch (error) {
      logger.error('恢复玩家队列状态失败:', error);
    }
  }

  // 以下方法需要与 MatchmakingHandler 交互，通过回调或共享状态实现
  private matchmakingQueueHasPlayer(_playerId: string): boolean {
    // 此方法将由 EventHandlers 注入实现
    return false;
  }

  private setPlayerInQueue(_playerId: string, _data: { socketId: string; playerId: string; playerCount: number; quickMatch: boolean; joinedAt: number }): void {
    // 此方法将由 EventHandlers 注入实现
  }

  /**
   * 设置队列检查回调（由 EventHandlers 注入）
   */
  setQueueCallbacks(
    hasPlayer: (playerId: string) => boolean,
    setPlayer: (playerId: string, data: { socketId: string; playerId: string; playerCount: number; quickMatch: boolean; joinedAt: number }) => void
  ): void {
    this.matchmakingQueueHasPlayer = hasPlayer;
    this.setPlayerInQueue = setPlayer;
  }
}
