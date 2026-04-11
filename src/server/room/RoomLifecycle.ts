// ============================
// 黑暗森林 - 房间生命周期管理
// ============================
// 处理房间的创建、加入、离开、开始、结束和清理
// ============================

import { Server } from 'socket.io';
import type { InitConfig } from '@/lib/game/types';
import { AuthoritativeGameEngine } from '../AuthoritativeGameEngine';
import { StateSyncManager } from '../StateSyncManager';
import { createMatchRoom, updateMatchStatus, cancelQueue } from '@/lib/matchmaking';
import type { Room, RoomPlayerInfo } from '../protocol';

interface RoomWithEngine extends Room {
  engine: AuthoritativeGameEngine;
  syncManager: StateSyncManager;
}

export class RoomLifecycle {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  /**
   * 创建房间
   */
  async createRoom(
    playerIds: string[]
  ): Promise<{ roomId: string; roomCode: string; room?: RoomWithEngine; error?: string }> {
    try {
      const result = await createMatchRoom(playerIds);

      if (!result.success || !result.match) {
        return { roomId: '', roomCode: '', error: result.error ?? '创建房间失败' };
      }

      const { id: roomId, roomCode } = result.match;

      const syncManager = new StateSyncManager(roomId, this.io);

      const config: InitConfig = {
        playerCount: result.match.players.length,
        humanName: result.match.players.find(p => p.isHost)?.displayName ?? '玩家',
      };

      const engine = new AuthoritativeGameEngine(roomId, config, syncManager);

      const room: RoomWithEngine = {
        id: roomId,
        roomCode,
        hostId: result.match.hostId,
        players: new Map(),
        status: 'waiting',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        gameVersion: 0,
        engine,
        syncManager,
      };

      for (const player of result.match.players) {
        room.players.set(player.playerId, {
          socketId: '',
          playerId: player.playerId,
          displayName: player.displayName,
          isHost: player.isHost,
          playerNumber: player.playerNumber,
          position: player.position,
          ready: true,
          connected: true,
          lastAckVersion: 0,
        });
      }

      console.log(`[RoomLifecycle] 创建房间: ${roomCode} (${playerIds.length} 玩家)`);

      return { roomId, roomCode, room };
    } catch (error) {
      console.error('[RoomLifecycle] 创建房间失败:', error);
      return { roomId: '', roomCode: '', error: '服务器内部错误' };
    }
  }

  /**
   * 加入房间 - 核心逻辑
   */
  async joinRoom(
    room: RoomWithEngine,
    playerId: string,
    socketId: string
  ): Promise<{ success: boolean; error?: string; autoStarted?: boolean }> {
    if (room.status !== 'waiting') {
      return { success: false, error: '游戏已开始' };
    }

    // 检查玩家是否已在房间
    const existingPlayer = room.players.get(playerId);
    if (existingPlayer) {
      const oldSocketId = existingPlayer.socketId;
      existingPlayer.socketId = socketId;
      existingPlayer.connected = true;

      if (oldSocketId) {
        room.syncManager.removeClient(oldSocketId);
      }
      room.syncManager.addClient(socketId, playerId, 'PLAYER');

      return { success: true };
    }

    const currentPlayers = Array.from(room.players.values());
    const maxPlayers = 5;
    if (currentPlayers.length >= maxPlayers) {
      return { success: false, error: '房间已满' };
    }

    const playerNumber = currentPlayers.length;
    room.players.set(playerId, {
      socketId,
      playerId,
      displayName: '',
      isHost: false,
      playerNumber,
      position: 0,
      ready: true,
      connected: true,
      lastAckVersion: 0,
    });

    room.syncManager.addClient(socketId, playerId, 'PLAYER');
    room.lastActivity = Date.now();

    console.log(`[RoomLifecycle] 玩家 ${playerId} 加入房间 ${room.roomCode}`);

    return { success: true, autoStarted: false };
  }

  /**
   * 离开房间 - 核心逻辑
   */
  leaveRoom(
    room: RoomWithEngine,
    playerId: string
  ): { shouldNotify: boolean; newHostId?: string } {
    const player = room.players.get(playerId);
    if (!player) return { shouldNotify: false };

    player.connected = false;
    player.socketId = '';
    room.lastActivity = Date.now();

    let newHostId: string | undefined;
    if (player.isHost) {
      const newHost = Array.from(room.players.values()).find(p => p.connected);
      if (newHost) {
        newHost.isHost = true;
        room.hostId = newHost.playerId;
        newHostId = newHost.playerId;
      }
    }

    console.log(`[RoomLifecycle] 玩家 ${playerId} 离开房间 ${room.roomCode}`);

    return { shouldNotify: true, newHostId };
  }

  /**
   * 玩家断线
   */
  playerDisconnected(
    room: RoomWithEngine,
    playerId: string,
    reason: 'timeout' | 'network_error' | 'client_closed' = 'network_error'
  ): { disconnectedPlayer: { playerId: string; displayName: string }; newHostId?: string } {
    const player = room.players.get(playerId);
    if (!player) {
      return { disconnectedPlayer: { playerId: '', displayName: '' } };
    }

    console.log(`[RoomLifecycle] 玩家 ${playerId} (${player.displayName}) 断线: ${reason}`);

    const disconnectedPlayerInfo = {
      playerId: player.playerId,
      displayName: player.displayName,
    };

    player.connected = false;
    player.socketId = '';
    room.lastActivity = Date.now();

    let newHostId: string | undefined;
    if (player.isHost) {
      const newHost = Array.from(room.players.values()).find(p => p.connected);
      if (newHost) {
        newHost.isHost = true;
        room.hostId = newHost.playerId;
        newHostId = newHost.playerId;
      }
    }

    return { disconnectedPlayer: disconnectedPlayerInfo, newHostId };
  }

  /**
   * 检查游戏是否可以继续进行
   */
  checkGameContinuation(room: RoomWithEngine): { shouldEnd: boolean; winnerId?: string | null; winnerType?: 'human' | 'draw' } {
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
    const totalPlayers = room.players.size;

    console.log(`[RoomLifecycle] 检查游戏继续: ${connectedPlayers.length}/${totalPlayers} 玩家在线`);

    if (connectedPlayers.length === 0) {
      console.log(`[RoomLifecycle] 所有玩家都断线，结束游戏`);
      return { shouldEnd: true, winnerId: null, winnerType: 'draw' };
    }

    if (connectedPlayers.length === 1) {
      const winner = connectedPlayers[0];
      console.log(`[RoomLifecycle] 只剩一个玩家 ${winner.playerId}，宣布胜利`);
      return { shouldEnd: true, winnerId: winner.playerId, winnerType: 'human' };
    }

    console.log(`[RoomLifecycle] 游戏继续进行，剩余 ${connectedPlayers.length} 名玩家`);
    return { shouldEnd: false };
  }

  /**
   * 开始游戏 - 核心逻辑
   */
  async startGame(
    room: RoomWithEngine,
    injectPlayerInfoToGameState: (engine: AuthoritativeGameEngine, room: RoomWithEngine) => void
  ): Promise<{ success: boolean; error?: string; gameState?: unknown }> {
    console.log(`[RoomLifecycle] 尝试开始游戏: ${room.roomCode}, 当前状态: ${room.status}`);

    if (room.status !== 'waiting') {
      console.warn(`[RoomLifecycle] 游戏已开始: ${room.roomCode}, 状态: ${room.status}`);
      return { success: false, error: '游戏已开始' };
    }

    const allReady = Array.from(room.players.values()).every(p => p.ready);
    console.log(`[RoomLifecycle] 玩家准备状态:`, Array.from(room.players.values()).map(p => ({
      id: p.playerId,
      name: p.displayName,
      ready: p.ready,
      connected: p.connected,
    })));

    if (!allReady) {
      return { success: false, error: '不是所有玩家都准备好' };
    }

    room.status = 'playing';
    room.lastActivity = Date.now();

    await updateMatchStatus(room.id, 'playing');

    for (const [playerId] of room.players.entries()) {
      await cancelQueue(playerId);
    }

    const engine = room.engine;
    if (!engine) {
      return { success: false, error: '游戏引擎不存在' };
    }

    injectPlayerInfoToGameState(engine, room);

    const gameState = engine.getState();
    console.log(`[RoomLifecycle] 游戏状态获取成功，准备广播 room:gameStarting`);

    return { success: true, gameState };
  }

  /**
   * 结束游戏
   */
  endGame(
    room: RoomWithEngine,
    winnerId: string | null,
    winnerType: 'human' | 'ai' | 'draw'
  ): { gameOverData: Record<string, unknown> } {
    room.status = 'finished';
    room.lastActivity = Date.now();

    const engine = room.engine;
    if (engine) {
      const state = engine.getState();
      updateMatchStatus(room.id, 'finished', {
        winnerId: winnerId ?? undefined,
        winnerType: winnerType === 'draw' ? undefined : winnerType,
        totalTurns: state.totalTurn,
        duration: Math.floor((Date.now() - room.createdAt) / 1000),
      });
    }

    const gameOverData = {
      roomId: room.id,
      winnerId,
      winnerType,
      rankings: this.getPlayerRankings(room),
      totalTurns: engine?.getState().totalTurn ?? 0,
      duration: Math.floor((Date.now() - room.createdAt) / 1000),
    };

    console.log(`[RoomLifecycle] 游戏结束: ${room.roomCode}, 胜利者: ${winnerId ?? '平局'}`);

    return { gameOverData };
  }

  /**
   * 获取玩家排名
   */
  private getPlayerRankings(room: Room): Array<{ playerId: string; displayName: string; rank: number; eliminated: boolean; eliminatedTurn?: number }> {
    return Array.from(room.players.values()).map(p => ({
      playerId: p.playerId,
      displayName: p.displayName,
      rank: p.playerNumber + 1,
      eliminated: false,
    }));
  }
}
