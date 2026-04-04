// ============================
// 黑暗森林 - 房间管理器
// ============================
// 管理所有游戏房间的生命周期
// ============================

import { Server, Socket } from 'socket.io';
import type { InitConfig } from '@/lib/game/types';
import { AuthoritativeGameEngine } from './AuthoritativeGameEngine';
import { StateSyncManager } from './StateSyncManager';
import type { Room, RoomPlayer, RoomPlayerInfo } from './protocol';
import { createMatchRoom, getMatchRoom, updateMatchStatus, cancelQueue } from '@/lib/matchmaking';

// ============================
// 扩展房间类型
// ============================

interface RoomWithEngine extends Room {
  engine: AuthoritativeGameEngine;
  syncManager: StateSyncManager;
}

// ============================
// 房间管理器
// ============================

export class RoomManager {
  private rooms: Map<string, RoomWithEngine>;
  private roomCodes: Map<string, string>;  // roomCode -> roomId
  private io: Server;
  private cleanupTimer: NodeJS.Timeout | null;

  // 房间超时时间 (ms)
  private static readonly ROOM_TIMEOUT = 300000;  // 5 分钟
  private static readonly CLEANUP_INTERVAL = 60000;  // 1 分钟清理一次

  constructor(io: Server) {
    this.rooms = new Map();
    this.roomCodes = new Map();
    this.io = io;
    this.cleanupTimer = null;

    // 启动清理定时器
    this.startCleanupTimer();

    // 服务器启动时清理旧房间
    this.cleanupStaleRooms();
  }

  // ============================
  // 房间生命周期
  // ============================

  /**
   * 创建房间
   */
  async createRoom(
    playerIds: string[],
    mode: 'casual' | 'ranked'
  ): Promise<{ roomId: string; roomCode: string; error?: string }> {
    try {
      // 调用数据库创建房间
      const result = await createMatchRoom(playerIds, mode);

      if (!result.success || !result.match) {
        return { roomId: '', roomCode: '', error: result.error ?? '创建房间失败' };
      }

      const { id: roomId, roomCode } = result.match;

      // 创建同步管理器
      const syncManager = new StateSyncManager(roomId, this.io);

      // 创建权威游戏引擎
      const config: InitConfig = {
        playerCount: result.match.players.length,
        humanName: result.match.players.find(p => p.isHost)?.displayName ?? '玩家',
      };

      const engine = new AuthoritativeGameEngine(roomId, config, syncManager);

      // 创建房间对象
      const room: RoomWithEngine = {
        id: roomId,
        roomCode,
        hostId: result.match.hostId,
        players: new Map(),
        status: 'waiting',
        mode,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        gameVersion: 0,
        engine,
        syncManager,
      };

      // 添加玩家
      for (const player of result.match.players) {
        room.players.set(player.playerId, {
          socketId: '',  // 将在玩家加入时设置
          playerId: player.playerId,
          displayName: player.displayName,
          isAI: player.isAI,
          isHost: player.isHost,
          playerNumber: player.playerNumber,
          position: player.position,
          ready: true,
          connected: !player.isAI,
          lastAckVersion: 0,
        });
      }

      // 保存房间
      this.rooms.set(roomId, room);
      this.roomCodes.set(roomCode, roomId);

      console.log(`[RoomManager] 创建房间: ${roomCode} (${playerIds.length} 玩家)`);

      return { roomId, roomCode };
    } catch (error) {
      console.error('[RoomManager] 创建房间失败:', error);
      return { roomId: '', roomCode: '', error: '服务器内部错误' };
    }
  }

  /**
   * 加入房间
   */
  joinRoom(roomCode: string, playerId: string, socketId: string): { success: boolean; error?: string } {
    const roomId = this.roomCodes.get(roomCode);
    if (!roomId) {
      return { success: false, error: '房间不存在' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    // 检查房间状态
    if (room.status !== 'waiting') {
      return { success: false, error: '游戏已开始' };
    }

    // 检查玩家是否已在房间
    const existingPlayer = room.players.get(playerId);
    if (existingPlayer) {
      existingPlayer.socketId = socketId;
      existingPlayer.connected = true;
      return { success: true };
    }

    // 检查房间是否已满
    const humanPlayers = Array.from(room.players.values()).filter(p => !p.isAI);
    const maxPlayers = room.players.size + 4;  // 假设最多 4 个真人玩家
    if (humanPlayers.length >= maxPlayers) {
      return { success: false, error: '房间已满' };
    }

    // 添加玩家
    const playerNumber = humanPlayers.length;
    room.players.set(playerId, {
      socketId,
      playerId,
      displayName: '',  // 需要从数据库获取
      isAI: false,
      isHost: false,
      playerNumber,
      position: 0,
      ready: false,
      connected: true,
      lastAckVersion: 0,
    });

    room.lastActivity = Date.now();

    // 通知所有玩家
    this.broadcastToRoom(roomId, 'room:playerJoined', {
      roomId,
      players: this.getRoomPlayersInfo(room),
    });

    console.log(`[RoomManager] 玩家 ${playerId} 加入房间 ${roomCode}`);

    return { success: true };
  }

  /**
   * 离开房间
   */
  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(playerId);
    if (!player) return;

    // 标记为断开连接
    player.connected = false;
    player.socketId = '';

    room.lastActivity = Date.now();

    // 通知所有玩家
    this.broadcastToRoom(roomId, 'room:playerLeft', {
      roomId,
      players: this.getRoomPlayersInfo(room),
    });

    // 如果是房主，转移房主
    if (player.isHost) {
      const newHost = Array.from(room.players.values()).find(p => p.connected && !p.isAI);
      if (newHost) {
        newHost.isHost = true;
        room.hostId = newHost.playerId;

        this.broadcastToRoom(roomId, 'room:hostChanged', {
          roomId,
          newHostId: newHost.playerId,
        });
      }
    }

    console.log(`[RoomManager] 玩家 ${playerId} 离开房间 ${room.roomCode}`);
  }

  /**
   * 准备/取消准备
   */
  async toggleReady(roomId: string, playerId: string, ready: boolean): Promise<{ success: boolean; error?: string }> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    const player = room.players.get(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    player.ready = ready;
    room.lastActivity = Date.now();

    // 通知所有玩家
    this.broadcastToRoom(roomId, 'room:playerReady', {
      roomId,
      players: this.getRoomPlayersInfo(room),
    });

    // 检查是否所有玩家都准备好
    const allReady = Array.from(room.players.values()).every(p => p.ready || p.isAI);
    if (allReady && room.status === 'waiting') {
      return await this.startGame(roomId);
    }

    return { success: true };
  }

  /**
   * 开始游戏
   */
  async startGame(roomId: string): Promise<{ success: boolean; error?: string }> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    console.log(`[RoomManager] 尝试开始游戏: ${room.roomCode}, 当前状态: ${room.status}`);

    if (room.status !== 'waiting') {
      console.warn(`[RoomManager] 游戏已开始: ${room.roomCode}, 状态: ${room.status}`);
      return { success: false, error: '游戏已开始' };
    }

    // 检查是否所有玩家都准备好
    const allReady = Array.from(room.players.values()).every(p => p.ready || p.isAI);
    console.log(`[RoomManager] 玩家准备状态:`, Array.from(room.players.values()).map(p => ({
      id: p.playerId,
      name: p.displayName,
      isAI: p.isAI,
      ready: p.ready,
      connected: p.connected,
    })));
    
    if (!allReady) {
      return { success: false, error: '不是所有玩家都准备好' };
    }

    // 更新房间状态
    room.status = 'playing';
    room.lastActivity = Date.now();

    // 更新数据库
    await updateMatchStatus(roomId, 'playing');

    // 清理匹配队列
    for (const [playerId, player] of room.players.entries()) {
      if (!player.isAI) {
        await cancelQueue(playerId);
      }
    }

    // 获取游戏状态
    const engine = room.engine;
    if (!engine) {
      return { success: false, error: '游戏引擎不存在' };
    }

    // 注入真实玩家信息到游戏状态
    this.injectPlayerInfoToGameState(engine, room);

    const gameState = engine.getState();
    console.log(`[RoomManager] 游戏状态获取成功，准备广播 room:gameStarting`);

    // 通知所有玩家
    this.broadcastToRoom(roomId, 'room:gameStarting', {
      roomId,
      gameState,
    });

    // 初始化同步管理器的客户端
    const syncManager = room.syncManager;
    for (const [playerId, player] of room.players.entries()) {
      if (player.connected && player.socketId) {
        syncManager.addClient(player.socketId);
      }
    }

    console.log(`[RoomManager] 游戏开始成功: ${room.roomCode}`);

    return { success: true };
  }

  /**
   * 结束游戏
   */
  endGame(roomId: string, winnerId: string | null, winnerType: 'human' | 'ai' | 'draw'): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.status = 'finished';
    room.lastActivity = Date.now();

    // 更新数据库
    const engine = this.getEngine(roomId);
    if (engine) {
      const state = engine.getState();
      updateMatchStatus(roomId, 'finished', {
        winnerId: winnerId ?? undefined,
        winnerType: winnerType === 'draw' ? undefined : winnerType,
        totalTurns: state.totalTurn,
        duration: Math.floor((Date.now() - room.createdAt) / 1000),
      });
    }

    // 通知所有玩家
    this.broadcastToRoom(roomId, 'game:gameOver', {
      roomId,
      winnerId,
      winnerType,
      rankings: this.getPlayerRankings(room),
      totalTurns: engine?.getState().totalTurn ?? 0,
      duration: Math.floor((Date.now() - room.createdAt) / 1000),
    });

    console.log(`[RoomManager] 游戏结束: ${room.roomCode}, 胜利者: ${winnerId ?? '平局'}`);
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
      room: this.getRoomPlayersInfo(room),
    };
  }

  /**
   * 获取房间
   */
  getRoom(roomId: string): Room | undefined {
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

  /**
   * 获取连接的 socket
   */
  private getConnectedSockets(roomId: string): Array<[string, RoomPlayer]> {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.players.entries())
      .filter(([_, player]) => player.connected && player.socketId);
  }

  // ============================
  // 广播
  // ============================

  /**
   * 广播消息给房间内所有玩家
   */
  broadcastToRoom(roomId: string, event: string, data: unknown, excludeSocketId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const [playerId, player] of room.players.entries()) {
      if (!player.connected || !player.socketId) continue;
      if (player.socketId === excludeSocketId) continue;

      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket?.connected) {
        socket.emit(event, data);
      }
    }
  }

  // ============================
  // 内部辅助
  // ============================

  /**
   * 获取房间玩家信息
   */
  private getRoomPlayersInfo(room: Room): RoomPlayerInfo[] {
    return Array.from(room.players.values()).map(p => ({
      playerId: p.playerId,
      displayName: p.displayName,
      isAI: p.isAI,
      isHost: p.isHost,
      playerNumber: p.playerNumber,
      position: p.position,
      ready: p.ready,
      connected: p.connected,
    }));
  }

  /**
   * 获取玩家排名
   */
  private getPlayerRankings(room: Room): Array<{ playerId: string; displayName: string; rank: number; isAI: boolean; eliminated: boolean; eliminatedTurn?: number }> {
    // 简化实现，实际应该根据游戏状态计算
    return Array.from(room.players.values()).map(p => ({
      playerId: p.playerId,
      displayName: p.displayName,
      rank: p.playerNumber + 1,
      isAI: p.isAI,
      eliminated: false,
    }));
  }

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
  private cleanupTimeoutRooms(): void {
    const now = Date.now();

    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.lastActivity > RoomManager.ROOM_TIMEOUT) {
        if (room.status === 'playing') {
          // 结束游戏
          this.endGame(roomId, null, 'draw');
        }

        // 删除房间
        this.rooms.delete(roomId);
        this.roomCodes.delete(room.roomCode);

        console.log(`[RoomManager] 清理超时房间: ${room.roomCode}`);
      }
    }
  }

  /**
   * 销毁房间管理器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 清理所有房间
    for (const [roomId] of this.rooms.entries()) {
      this.endGame(roomId, null, 'draw');
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
   * 解决游戏引擎使用虚拟 ID (player_0, player_1...) 而房间系统使用真实 ID 的不匹配问题
   */
  private injectPlayerInfoToGameState(engine: AuthoritativeGameEngine, room: RoomWithEngine): void {
    const gameState = engine.getState();
    const roomPlayers = Array.from(room.players.values());

    console.log(`[RoomManager] 开始注入玩家信息:`);
    console.log(`  - 游戏状态中的玩家数量: ${gameState.players.length}`);
    console.log(`  - 房间中的玩家数量: ${roomPlayers.length}`);
    console.log(`  - 房间玩家详情:`, roomPlayers.map(p => ({
      id: p.playerId,
      name: p.displayName,
      isAI: p.isAI,
      number: p.playerNumber,
    })));

    // 按 playerNumber 排序，确保顺序一致
    roomPlayers.sort((a, b) => a.playerNumber - b.playerNumber);

    // 映射虚拟索引到真实玩家
    for (let i = 0; i < gameState.players.length && i < roomPlayers.length; i++) {
      const gamePlayer = gameState.players[i];
      const roomPlayer = roomPlayers[i];

      if (!gamePlayer || !roomPlayer) {
        console.warn(`[RoomManager] 跳过索引 ${i}: gamePlayer=${!!gamePlayer}, roomPlayer=${!!roomPlayer}`);
        continue;
      }

      console.log(`[RoomManager] 映射玩家 [${i}]:`);
      console.log(`  - 原始: id=${gamePlayer.id}, name=${gamePlayer.name}, isAI=${gamePlayer.isAI}`);
      console.log(`  - 新: id=${roomPlayer.playerId}, name=${roomPlayer.displayName}, isAI=${roomPlayer.isAI}`);

      // 更新玩家 ID 和名称
      gamePlayer.id = roomPlayer.playerId;
      gamePlayer.name = roomPlayer.displayName;
      gamePlayer.isAI = roomPlayer.isAI;
      gamePlayer.position = roomPlayer.position;

      // 如果是房主（第一个玩家），设置为人类玩家
      if (roomPlayer.isHost) {
        gameState.humanPlayerId = roomPlayer.playerId;
        console.log(`[RoomManager] 设置 humanPlayerId = ${roomPlayer.playerId}`);
      }
    }

    console.log(`[RoomManager] 玩家信息注入完成`);
    console.log(`  - 最终游戏状态玩家:`, gameState.players.map(p => ({
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      position: p.position,
      hand: p.hand.length,
    })));
    console.log(`[RoomManager] humanPlayerId: ${gameState.humanPlayerId}`);
  }

  // ============================
  // 服务器启动清理
  // ============================

  /**
   * 清理服务器重启前的旧房间
   * 将所有 status 为 'waiting' 或 'playing' 的房间标记为 'finished'
   */
  private async cleanupStaleRooms(): Promise<void> {
    try {
      console.log('[RoomManager] 开始清理服务器重启前的旧房间...');

      // 直接查询数据库中的所有未完成的房间
      const { db } = await import('@/lib/db');

      const staleMatches = await db.match.findMany({
        where: {
          status: {
            in: ['waiting', 'playing'],
          },
        },
        include: {
          players: true,
        },
      });

      if (staleMatches.length === 0) {
        console.log('[RoomManager] 没有需要清理的旧房间');
        return;
      }

      console.log(`[RoomManager] 发现 ${staleMatches.length} 个需要清理的房间`);

      // 将所有旧房间标记为 finished
      for (const match of staleMatches) {
        await db.match.update({
          where: { id: match.id },
          data: {
            status: 'finished',
            finishedAt: new Date(),
          },
        });

        console.log(`[RoomManager] 已清理旧房间: ${match.roomCode} (原状态: ${match.status})`);
      }

      console.log(`[RoomManager] 旧房间清理完成，共清理 ${staleMatches.length} 个房间`);
    } catch (error) {
      console.error('[RoomManager] 清理旧房间时出错:', error);
    }
  }
}
