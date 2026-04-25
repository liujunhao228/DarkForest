// ============================
// 黑暗森林 - 房间管理器
// ============================
// 管理所有游戏房间的生命周期（协调中心）
// ============================

import { Server } from 'socket.io';
import { AuthoritativeGameEngine } from './AuthoritativeGameEngine';
import { StateSyncManager } from './StateSyncManager';
import { createViewState } from './ViewManager';
import { RoomLifecycle } from './room/RoomLifecycle';
import { RoomBroadcast } from './room/RoomBroadcast';
import type { Room, RoomPlayerInfo } from './protocol';
import { ServerEvents } from './protocol';
import { replayStorageService } from './ReplayStorageService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RoomManager');

// ============================
// 扩展房间类型
// ============================

export interface RoomWithEngine extends Room {
  engine: AuthoritativeGameEngine;
  syncManager: StateSyncManager;
}

// ============================
// 房间管理器
// ============================

export class RoomManager {
  private rooms: Map<string, RoomWithEngine>;
  private roomCodes: Map<string, string>;
  private io: Server;
  private cleanupTimer: NodeJS.Timeout | null;

  // 子模块
  private roomLifecycle: RoomLifecycle;
  private roomBroadcast: RoomBroadcast;

  // 房间超时时间 (ms)
  private static readonly ROOM_TIMEOUT = 300000;  // 5 分钟
  private static readonly CLEANUP_INTERVAL = 60000;  // 1 分钟清理一次

  constructor(io: Server) {
    this.rooms = new Map();
    this.roomCodes = new Map();
    this.io = io;
    this.cleanupTimer = null;

    // 初始化子模块
    this.roomLifecycle = new RoomLifecycle(io);
    this.roomBroadcast = new RoomBroadcast(io);

    // 启动清理定时器
    this.startCleanupTimer();

    // 服务器启动时清理旧数据
    this.cleanupOnStartup();
  }

  // ============================
  // 房间生命周期（委托给 RoomLifecycle）
  // ============================

  /**
   * 创建房间
   */
  async createRoom(playerIds: string[]): Promise<{ roomId: string; roomCode: string; error?: string }> {
    const result = await this.roomLifecycle.createRoom(playerIds);

    if (result.error || !result.room) {
      return { roomId: '', roomCode: '', error: result.error };
    }

    const room = result.room;

    // 保存房间
    this.rooms.set(room.id, room);
    this.roomCodes.set(room.roomCode, room.id);

    return { roomId: room.id, roomCode: room.roomCode };
  }

  /**
   * 加入房间
   */
  async joinRoom(roomCode: string, playerId: string, socketId: string, options?: { suppressBroadcast?: boolean }): Promise<{ success: boolean; error?: string; autoStarted?: boolean }> {
    const roomId = this.roomCodes.get(roomCode);
    if (!roomId) {
      return { success: false, error: '房间不存在' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    const joinResult = await this.roomLifecycle.joinRoom(room, playerId, socketId, options);

    if (!joinResult.success) {
      return joinResult;
    }

    // 广播玩家加入（匹配批量 join 时抑制，由调用者统一广播）
    if (!options?.suppressBroadcast) {
      this.roomBroadcast.broadcastToRoom(room, ServerEvents.ROOM_PLAYER_JOINED, {
        roomId,
        players: this.roomBroadcast.getRoomPlayersInfo(room),
      });
    }

    // 统一自动开始检查逻辑：
    // - isFirstJoin: 匹配后首次自动 join，需要检查所有玩家是否都已连接
    // - wasReconnect: 断线重连，需要检查所有玩家是否都已连接
    const shouldCheckAllConnected = joinResult.isFirstJoin === true || joinResult.wasReconnect === true;

    if (shouldCheckAllConnected) {
      const allConnected = this.areAllPlayersConnected(room);
      if (allConnected) {
        logger.debug(`所有玩家已连接，自动开始游戏: ${roomCode}`);
        const startResult = await this.startGame(roomId);
        if (startResult.success) {
          return { success: true, autoStarted: true };
        } else {
          logger.warn(`自动开始游戏失败: ${startResult.error}`);
        }
      }
    }

    return { success: true, autoStarted: false };
  }

  /**
   * 检查所有玩家是否都已连接并准备好
   */
  private areAllPlayersConnected(room: RoomWithEngine): boolean {
    const players = Array.from(room.players.values());
    const allConnected = players.every(p => p.connected && p.socketId);
    
    // 增强调试日志：显示所有玩家的详细状态
    const playerDetails = players.map(p => 
      `[${p.displayName}] (连接:${p.connected ? '是' : '否'}, SocketId:${p.socketId ? '有' : '无'}, 准备:${p.ready ? '是' : '否'}, 房主:${p.isHost ? '是' : '否'})`
    ).join(', ');
    
    logger.debug(`检查所有玩家连接状态: ${players.length} 玩家, 全部连接: ${allConnected} | 详情: ${playerDetails}`);
    return allConnected;
  }

  /**
   * 离开房间
   */
  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const leaveResult = this.roomLifecycle.leaveRoom(room, playerId);

    if (!leaveResult.shouldNotify) return;

    // 广播玩家离开
    this.roomBroadcast.broadcastToRoom(room, ServerEvents.ROOM_PLAYER_LEFT, {
      roomId,
      players: this.roomBroadcast.getRoomPlayersInfo(room),
    });

    // 如果房主变更，广播通知
    if (leaveResult.newHostId) {
      this.roomBroadcast.broadcastToRoom(room, ServerEvents.ROOM_HOST_CHANGED, {
        roomId,
        newHostId: leaveResult.newHostId,
      });
    }
  }

  /**
   * 玩家断线
   */
  playerDisconnected(
    roomId: string,
    playerId: string,
    reason: 'timeout' | 'network_error' | 'client_closed' = 'network_error'
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const disconnectResult = this.roomLifecycle.playerDisconnected(room, playerId, reason);

    // 广播断线通知
    this.roomBroadcast.broadcastToRoom(room, 'room:playerDisconnected', {
      roomId,
      disconnectedPlayerId: disconnectResult.disconnectedPlayer.playerId,
      disconnectedPlayerName: disconnectResult.disconnectedPlayer.displayName,
      players: this.roomBroadcast.getRoomPlayersInfo(room),
      reason,
      canReconnect: room.status === 'waiting' || room.status === 'playing',
      reconnectTimeout: room.status === 'playing' ? 120000 : undefined,
    });

    // 如果房主变更，广播通知
    if (disconnectResult.newHostId) {
      this.roomBroadcast.broadcastToRoom(room, 'room:hostChanged', {
        roomId,
        newHostId: disconnectResult.newHostId,
      });
    }

    // 如果游戏中断线，检查是否需要结束游戏
    if (room.status === 'playing') {
      const continueResult = this.roomLifecycle.checkGameContinuation(room);
      if (continueResult.shouldEnd) {
        this.endGame(roomId, continueResult.winnerId ?? null, continueResult.winnerType ?? 'draw');
      }
    }
  }

  /**
   * 开始游戏
   */
  async startGame(roomId: string): Promise<{ success: boolean; error?: string }> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    const startResult = await this.roomLifecycle.startGame(room, (engine, room) => {
      this.injectPlayerInfoToGameState(engine, room);
    });

    if (!startResult.success || !startResult.gameState) {
      return { success: false, error: startResult.error };
    }

    const gameState = startResult.gameState;

    // 通知所有玩家 - 使用视图过滤，每个玩家收到不同的 ViewState
    for (const [playerId, player] of room.players.entries()) {
      if (!player.connected || !player.socketId) continue;

      const socket = this.io.sockets.sockets.get(player.socketId);
      if (!socket?.connected) continue;

      // 为每个玩家生成过滤后的 ViewState
      const viewState = createViewState(gameState as any, {
        role: 'PLAYER',
        playerId,
      });

      socket.emit(ServerEvents.ROOM_GAME_STARTING, {
        roomId,
        gameState: viewState,
      });
    }

    // 更新同步管理器中的客户端角色
    const syncManager = room.syncManager;
    for (const [playerId, player] of room.players.entries()) {
      if (player.connected && player.socketId) {
        syncManager.removeClient(player.socketId);
        syncManager.addClient(player.socketId, playerId, 'PLAYER');
      }
    }

    logger.debug(`游戏开始成功: ${room.roomCode}`);

    return { success: true };
  }

  /**
   * 结束游戏
   */
  async endGame(roomId: string, winnerId: string | null, winnerType: 'human' | 'ai' | 'draw'): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const { gameOverData } = this.roomLifecycle.endGame(room, winnerId, winnerType);

    // 广播游戏结束
    this.roomBroadcast.broadcastToRoom(room, 'game:gameOver', gameOverData);

    // 保存回放数据
    try {
      const syncManager = room.syncManager;
      const replayData = syncManager.exportReplayData(roomId);
      await replayStorageService.saveReplay(replayData);
      logger.info(`保存回放数据成功: ${replayData.metadata.id}`);
    } catch (error) {
      logger.error('保存回放数据失败:', error);
    }
  }

  /**
   * 广播房间玩家列表（用于匹配完成后统一通知）
   */
  broadcastRoomPlayers(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.roomBroadcast.broadcastToRoom(room, ServerEvents.ROOM_PLAYER_JOINED, {
      roomId,
      players: this.roomBroadcast.getRoomPlayersInfo(room),
    });
  }

  // ============================
  // 房间查询
  // ============================

  /**
   * 获取房间信息
   */
  getRoomInfo(roomCode: string): { success: boolean; room?: RoomPlayerInfo[]; error?: string } {
    const roomId = this.roomCodes.get(roomCode);
    if (!roomId) {
      return { success: false, error: '房间不存在' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    return {
      success: true,
      room: this.roomBroadcast.getRoomPlayersInfo(room),
    };
  }

  /**
   * 获取房间
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * 获取包含引擎的房间（用于访问 syncManager）
   */
  getRoomWithEngine(roomId: string): RoomWithEngine | undefined {
    return this.rooms.get(roomId);
  }

  // ============================
  // 同步管理
  // ============================

  /**
   * 获取游戏引擎
   */
  getEngine(roomId: string): AuthoritativeGameEngine | undefined {
    const room = this.rooms.get(roomId);
    return room?.engine;
  }

  /**
   * 获取同步管理器
   */
  getSyncManager(roomId: string): StateSyncManager | undefined {
    const room = this.rooms.get(roomId);
    return room?.syncManager;
  }

  // ============================
  // 内部辅助
  // ============================

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupTimeoutRooms();
    }, RoomManager.CLEANUP_INTERVAL);
  }

  /**
   * 清理超时房间
   */
  private async cleanupTimeoutRooms(): Promise<void> {
    const now = Date.now();

    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.lastActivity > RoomManager.ROOM_TIMEOUT) {
        if (room.status === 'playing') {
          await this.endGame(roomId, null, 'draw');
        }

        this.rooms.delete(roomId);
        this.roomCodes.delete(room.roomCode);

        logger.debug(`清理超时房间: ${room.roomCode}`);
      }
    }
  }

  /**
   * 销毁房间管理器
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [roomId] of this.rooms.entries()) {
      await this.endGame(roomId, null, 'draw');
    }

    this.rooms.clear();
    this.roomCodes.clear();
  }

  /**
   * 通过房间代码获取房间 ID
   */
  getRoomIdByCode(roomCode: string): string | undefined {
    return this.roomCodes.get(roomCode);
  }

  /**
   * 将真实玩家信息注入到游戏状态中
   */
  private injectPlayerInfoToGameState(engine: AuthoritativeGameEngine, room: RoomWithEngine): void {
    const gameState = engine.getState();
    const roomPlayers = Array.from(room.players.values());

    logger.debug(`开始注入玩家信息:`);
    logger.debug(`  - 游戏状态中的玩家数量: ${gameState.players.length}`);
    logger.debug(`  - 房间中的玩家数量: ${roomPlayers.length}`);
    logger.debug(`  - 房间玩家详情:`, roomPlayers.map(p => ({
      id: p.playerId,
      name: p.displayName,
      number: p.playerNumber,
    })));

    roomPlayers.sort((a, b) => a.playerNumber - b.playerNumber);

    for (let i = 0; i < gameState.players.length && i < roomPlayers.length; i++) {
      const gamePlayer = gameState.players[i];
      const roomPlayer = roomPlayers[i];

      if (!gamePlayer || !roomPlayer) {
        logger.warn(`跳过索引 ${i}: gamePlayer=${!!gamePlayer}, roomPlayer=${!!roomPlayer}`);
        continue;
      }

      logger.debug(`映射玩家 [${i}]:`);
      logger.debug(`  - 原始: id=${gamePlayer.id}, name=${gamePlayer.name}`);
      logger.debug(`  - 新: id=${roomPlayer.playerId}, name=${roomPlayer.displayName}`);

      gamePlayer.id = roomPlayer.playerId;
      gamePlayer.name = roomPlayer.displayName;
      gamePlayer.position = roomPlayer.position;

      if (roomPlayer.isHost) {
        gameState.localPlayerId = roomPlayer.playerId;
        logger.debug(`设置 localPlayerId = ${roomPlayer.playerId}`);
      }
    }

    logger.debug(`玩家信息注入完成`);

    // 关键修复：注入完成后，必须更新 StateSyncManager 的 stateHistory
    // 否则 getCurrentState() 返回的是注入前的旧状态
    room.syncManager.updateState(gameState);
    logger.debug(`已同步状态到 StateSyncManager`);
  }

  // ============================
  // 服务器启动清理
  // ============================

  /**
   * 服务器启动时统一清理旧数据
   */
  async cleanupOnStartup(): Promise<void> {
    try {
      logger.info('开始清理服务器重启前的旧数据...');

      const [roomResult, matchmakingResult, customResult] = await Promise.allSettled([
        this.cleanupStaleRooms(),
        this.cleanupStaleMatchmakingQueues(),
        this.cleanupStaleCustomQueues(),
      ]);

      if (roomResult.status === 'fulfilled') {
        logger.info(`旧房间清理完成，共清理 ${roomResult.value} 个房间`);
      } else {
        logger.error('旧房间清理失败:', roomResult.reason);
      }

      if (matchmakingResult.status === 'fulfilled') {
        logger.info(`旧快速匹配队列清理完成，共清理 ${matchmakingResult.value} 条记录`);
      } else {
        logger.error('旧快速匹配队列清理失败:', matchmakingResult.reason);
      }

      if (customResult.status === 'fulfilled') {
        logger.info(`旧自定义等待队列清理完成，共清理 ${customResult.value} 条记录`);
      } else {
        logger.error('旧自定义等待队列清理失败:', customResult.reason);
      }

      logger.info('服务器重启前旧数据清理完成');
    } catch (error) {
      logger.error('清理旧数据时出错:', error);
    }
  }

  /**
   * 清理旧房间
   */
  private async cleanupStaleRooms(): Promise<number> {
    const { db } = await import('@/lib/db');

    const { count } = await db.match.updateMany({
      where: {
        status: {
          in: ['waiting', 'playing'],
        },
      },
      data: {
        status: 'finished',
        finishedAt: new Date(),
      },
    });

    return count;
  }

  /**
   * 清理旧快速匹配队列
   */
  private async cleanupStaleMatchmakingQueues(): Promise<number> {
    const { db } = await import('@/lib/db');

    const { count } = await db.matchmakingQueue.deleteMany({});
    return count;
  }

  /**
   * 清理旧自定义等待队列
   */
  private async cleanupStaleCustomQueues(): Promise<number> {
    const { db } = await import('@/lib/db');

    const { count } = await db.customMatchQueue.deleteMany({
      where: {
        status: {
          in: ['waiting', 'matching'],
        },
      },
    });

    return count;
  }
}
