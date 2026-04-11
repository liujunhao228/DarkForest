// ============================
// 黑暗森林 - 匹配处理器
// ============================
// 处理所有匹配队列和房间创建逻辑
// ============================

import { Server, Socket } from 'socket.io';
import type { JoinQueuePayload, JoinSpecificQueuePayload, CreateQueuePayload, LeaveSpecificQueuePayload, GetQueueInfoPayload, GetMyQueuesPayload } from '../protocol';
import {
  joinQueue, cancelQueue, getQueueStatus, getPlayerInfo,
  getFullCustomQueues, getCustomQueueInfo, joinSpecificQueue,
  createCustomQueue, leaveSpecificQueue, getPlayerQueues, getSpecificQueueInfo,
} from '@/lib/matchmaking';
import type { RoomManager } from '../RoomManager';

interface QueueEntry {
  socketId: string;
  playerId: string;
  playerCount: number;
  quickMatch: boolean;
  joinedAt: number;
}

export class MatchmakingHandler {
  private io: Server;
  private roomManager: RoomManager;
  private matchmakingQueue = new Map<string, QueueEntry>();
  private matchCheckTimer: NodeJS.Timeout | null;
  private isMatching = false;
  private matchingQueues = new Set<string>();

  constructor(io: Server, roomManager: RoomManager) {
    this.io = io;
    this.roomManager = roomManager;
    this.matchCheckTimer = null;
    this.startMatchCheckTimer();
  }

  // ============================
  // 匹配队列操作
  // ============================

  async handleJoinQueue(socket: Socket, data: JoinQueuePayload): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      socket.emit('match:queueError', { message: '请先登录' });
      return;
    }

    if (this.matchmakingQueue.has(playerId)) {
      socket.emit('match:queueError', { message: '已在匹配队列中' });
      return;
    }

    this.matchmakingQueue.set(playerId, {
      socketId: socket.id,
      playerId,
      playerCount: data.playerCount,
      quickMatch: data.quickMatch ?? false,
      joinedAt: Date.now(),
    });

    await joinQueue({ playerId, playerCount: data.playerCount });

    const queueArray = Array.from(this.matchmakingQueue.values());
    const position = queueArray.findIndex(q => q.playerId === playerId) + 1;
    const groups = this.getQueueGroups();

    socket.emit('match:queueJoined', {
      playerCount: data.playerCount,
      position,
      totalInQueue: queueArray.length,
      groups,
      quickMatch: data.quickMatch ?? false,
    });

    console.log(`[MatchmakingHandler] 玩家加入匹配: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}, 人数: ${data.playerCount}, 快速: ${data.quickMatch ?? false}`);

    // 向队列中其他玩家广播更新的队列状态
    const otherPlayers = queueArray.filter(q => q.playerId !== playerId);
    for (let i = 0; i < otherPlayers.length; i++) {
      const q = otherPlayers[i];
      const otherSocket = this.io.sockets.sockets.get(q.socketId);
      if (otherSocket?.connected) {
        otherSocket.emit('match:queueUpdate', {
          position: i + 1,
          totalInQueue: queueArray.length,
          groups: this.getQueueGroups(),
        });
      }
    }

    this.tryMatchPlayers();
  }

  async handleJoinSpecificQueue(socket: Socket, data: JoinSpecificQueuePayload): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      socket.emit('match:queueError', { message: '请先登录' });
      return;
    }

    const { queueId, playerCount } = data;

    if (this.matchmakingQueue.has(playerId)) {
      socket.emit('match:queueError', { message: '已在匹配队列中' });
      return;
    }

    const result = await joinSpecificQueue({ playerId, queueId, playerCount: playerCount ?? 4 });

    if (!result.success) {
      socket.emit('match:queueError', { message: result.error });
      return;
    }

    this.matchmakingQueue.set(playerId, {
      socketId: socket.id,
      playerId,
      playerCount: playerCount ?? 4,
      quickMatch: false,
      joinedAt: Date.now(),
    });

    const queueInfo = await getCustomQueueInfo(queueId);
    if (!queueInfo) {
      socket.emit('match:queueError', { message: '获取队列信息失败' });
      return;
    }

    const position = queueInfo.players.findIndex(p => p.playerId === playerId) + 1;

    socket.emit('match:specificQueueJoined', {
      queueId,
      queueName: queueInfo.queueName,
      position,
      totalInQueue: queueInfo.players.length,
    });

    console.log(`[MatchmakingHandler] 玩家加入指定队列: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}, 队列: ${queueId}, 位置: ${position}`);

    this.tryMatchCustomQueue(queueId);
  }

  async handleCancelQueue(socket: Socket): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;

    this.matchmakingQueue.delete(playerId);

    cancelQueue(playerId).catch((err) => {
      console.error(`[MatchmakingHandler] 清除队列记录失败: playerId=${playerId}`, err);
    });

    socket.emit('match:queueCancelled');
    console.log(`[MatchmakingHandler] 玩家取消匹配: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}`);

    this.broadcastQueueUpdates();
  }

  async handleGetQueueStatus(socket: Socket): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;

    const status = await getQueueStatus(playerId);
    const queuePlayer = this.matchmakingQueue.get(playerId);

    socket.emit('match:queueStatus', {
      inQueue: !!queuePlayer,
      position: status?.position,
      estimatedTime: status?.estimatedTime,
    });
  }

  async handleCreateQueue(socket: Socket, data: CreateQueuePayload): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      socket.emit('match:error', { message: '请先登录' });
      return;
    }

    const { queueName, minPlayers, maxPlayers } = data;

    if (!queueName || queueName.trim().length === 0) {
      socket.emit('match:error', { message: '队列名称不能为空' });
      return;
    }

    const result = await createCustomQueue(playerId, queueName, {
      minPlayers: minPlayers ?? 3,
      maxPlayers: maxPlayers ?? 4,
    });

    if (!result.success) {
      socket.emit('match:error', { message: result.error });
      return;
    }

    this.matchmakingQueue.set(playerId, {
      socketId: socket.id,
      playerId,
      playerCount: maxPlayers ?? 4,
      quickMatch: false,
      joinedAt: Date.now(),
    });

    const queueInfo = await getCustomQueueInfo(result.queueId!);
    if (queueInfo) {
      socket.emit('match:queueCreated', {
        queueId: result.queueId,
        queueName,
        minPlayers: minPlayers ?? 3,
        maxPlayers: maxPlayers ?? 4,
        players: queueInfo.players,
      });
    } else {
      socket.emit('match:queueCreated', {
        queueId: result.queueId,
        queueName,
        minPlayers: minPlayers ?? 3,
        maxPlayers: maxPlayers ?? 4,
        players: [{ playerId, displayName: socket.data.displayName || '未知' }],
      });
    }

    console.log(`[MatchmakingHandler] 玩家创建自定义队列: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}, 队列: ${result.queueId}`);
  }

  async handleLeaveSpecificQueue(socket: Socket, data: LeaveSpecificQueuePayload): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      socket.emit('match:error', { message: '请先登录' });
      return;
    }

    const { queueId } = data;

    const result = await leaveSpecificQueue(playerId, queueId);

    if (!result.success) {
      socket.emit('match:error', { message: result.error });
      return;
    }

    this.matchmakingQueue.delete(playerId);

    socket.emit('match:specificQueueLeft', { queueId });

    console.log(`[MatchmakingHandler] 玩家离开指定队列: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}, 队列: ${queueId}`);
  }

  async handleGetQueueInfo(socket: Socket, data: GetQueueInfoPayload): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      socket.emit('match:error', { message: '请先登录' });
      return;
    }

    const { queueId } = data;

    const result = await getSpecificQueueInfo(queueId);

    if (!result.success) {
      socket.emit('match:error', { message: result.error });
      return;
    }

    socket.emit('match:queueInfoResponse', { queue: result.queue });
  }

  async handleGetMyQueues(socket: Socket, _data: GetMyQueuesPayload): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      socket.emit('match:error', { message: '请先登录' });
      return;
    }

    const queues = await getPlayerQueues(playerId);

    socket.emit('match:myQueuesResponse', { queues });
  }

  // ============================
  // 队列管理方法
  // ============================

  removeFromQueue(playerId: string): void {
    this.matchmakingQueue.delete(playerId);
  }

  addToQueue(playerId: string, data: QueueEntry): void {
    this.matchmakingQueue.set(playerId, data);
  }

  isInQueue(playerId: string): boolean {
    return this.matchmakingQueue.has(playerId);
  }

  // ============================
  // 匹配逻辑
  // ============================

  private startMatchCheckTimer(): void {
    this.matchCheckTimer = setInterval(() => {
      this.tryMatchPlayers();
      this.tryMatchCustomQueues();
    }, 5000);
  }

  private async tryMatchPlayers(): Promise<void> {
    if (this.isMatching) return;
    this.isMatching = true;

    try {
      await this._tryMatchPlayersInternal();
    } finally {
      this.isMatching = false;
    }
  }

  private async _tryMatchPlayersInternal(): Promise<void> {
    const queues = Array.from(this.matchmakingQueue.values());

    if (queues.length < 2) return;

    // 1. 优先匹配快速匹配玩家
    const quickMatchQueues = queues.filter(q => q.quickMatch);
    if (quickMatchQueues.length >= 3) {
      const targetCount = Math.min(5, quickMatchQueues.length);
      const matchPlayers = quickMatchQueues.slice(0, targetCount);

      await this.createMatchRoom(matchPlayers);

      const matchedPlayerIds = new Set(matchPlayers.map(q => q.playerId));
      for (const q of matchPlayers) {
        this.matchmakingQueue.delete(q.playerId);
      }

      for (const playerId of matchedPlayerIds) {
        import('@/lib/matchmaking').then(m => m.cancelQueue(playerId)).catch((err) => {
          console.error(`[MatchmakingHandler] 清除队列记录失败: playerId=${playerId}`, err);
        });
      }

      this.broadcastQueueUpdates();
      return;
    }

    // 2. 按玩家数分组匹配
    const byCount = new Map<number, typeof queues>();
    for (const q of queues) {
      if (!q.quickMatch) {
        if (!byCount.has(q.playerCount)) {
          byCount.set(q.playerCount, []);
        }
        byCount.get(q.playerCount)!.push(q);
      }
    }

    for (const [count, queueList] of byCount.entries()) {
      if (queueList.length >= count) {
        const matchPlayers = queueList.slice(0, count);

        await this.createMatchRoom(matchPlayers);

        const matchedPlayerIds = new Set(matchPlayers.map(q => q.playerId));
        for (const q of matchPlayers) {
          this.matchmakingQueue.delete(q.playerId);
        }

        for (const playerId of matchedPlayerIds) {
          import('@/lib/matchmaking').then(m => m.cancelQueue(playerId)).catch((err) => {
            console.error(`[MatchmakingHandler] 清除队列记录失败: playerId=${playerId}`, err);
          });
        }

        this.broadcastQueueUpdates();
        return;
      }
    }
  }

  private async tryMatchCustomQueues(): Promise<void> {
    try {
      const fullQueues = await getFullCustomQueues();

      for (const queue of fullQueues) {
        await this.tryMatchCustomQueueInternal(queue.queueId);
      }
    } catch (error) {
      console.error('[MatchmakingHandler] 尝试匹配自定义队列失败:', error);
    }
  }

  async tryMatchCustomQueue(queueId: string): Promise<void> {
    try {
      await this.tryMatchCustomQueueInternal(queueId);
    } catch (error) {
      console.error(`[MatchmakingHandler] 尝试匹配自定义队列 ${queueId} 失败:`, error);
    }
  }

  private async tryMatchCustomQueueInternal(queueId: string): Promise<void> {
    if (this.matchingQueues.has(queueId)) return;
    this.matchingQueues.add(queueId);

    try {
      const queueInfo = await getCustomQueueInfo(queueId);

      if (!queueInfo) {
        console.log(`[CustomQueue] 队列 ${queueId} 不存在`);
        return;
      }

      if (queueInfo.status !== 'full') {
        console.log(`[CustomQueue] 队列 ${queueId} 状态为 ${queueInfo.status}, 跳过`);
        return;
      }

      const onlinePlayers: Array<{ playerId: string; socketId: string }> = [];

      for (const player of queueInfo.players) {
        const queuePlayer = this.matchmakingQueue.get(player.playerId);

        if (!queuePlayer) {
          const playerInfo = await getPlayerInfo(player.playerId);
          const displayName = playerInfo?.displayName || player.playerId;
          console.log(`[CustomQueue] 玩家 ${displayName} (${player.playerId}) 不在线, 跳过队列 ${queueId}`);
          return;
        }

        onlinePlayers.push({
          playerId: queuePlayer.playerId,
          socketId: queuePlayer.socketId,
        });
      }

      console.log(`[CustomQueue] 队列 ${queueId} 所有玩家在线, 创建房间`);
      await this.createMatchRoom(onlinePlayers);

      for (const player of onlinePlayers) {
        this.matchmakingQueue.delete(player.playerId);
      }

      try {
        const { db } = await import('@/lib/db');
        await db.customMatchQueue.update({
          where: { queueId },
          data: { status: 'started' },
        });
      } catch (error) {
        console.error(`[CustomQueue] 更新队列状态失败:`, error);
      }

      this.broadcastQueueUpdates();
    } finally {
      this.matchingQueues.delete(queueId);
    }
  }

  // ============================
  // 辅助方法
  // ============================

  private getQueueGroups(): Array<{ playerCount: number; count: number }> {
    const groups = new Map<number, { playerCount: number; count: number }>();

    for (const q of this.matchmakingQueue.values()) {
      if (!groups.has(q.playerCount)) {
        groups.set(q.playerCount, { playerCount: q.playerCount, count: 0 });
      }
      groups.get(q.playerCount)!.count++;
    }

    return Array.from(groups.values());
  }

  private broadcastQueueUpdates(): void {
    const queueArray = Array.from(this.matchmakingQueue.values());
    const totalInQueue = queueArray.length;
    const groups = this.getQueueGroups();

    for (let i = 0; i < queueArray.length; i++) {
      const q = queueArray[i];
      const socket = this.io.sockets.sockets.get(q.socketId);
      if (socket?.connected) {
        socket.emit('match:queueUpdate', {
          position: i + 1,
          totalInQueue,
          groups,
        });
      }
    }
  }

  private async createMatchRoom(queues: Array<{ playerId: string; socketId: string }>): Promise<void> {
    const playerIds = queues.map(q => q.playerId);

    const result = await this.roomManager.createRoom(playerIds);

    if (result.error) {
      console.error('[MatchmakingHandler] 创建房间失败:', result.error);
      return;
    }

    console.log(`[MatchmakingHandler] 房间创建成功，尝试自动开始游戏: ${result.roomCode}`);
    const startResult = await this.roomManager.startGame(result.roomId);

    if (!startResult.success) {
      console.error('[MatchmakingHandler] 自动开始游戏失败:', startResult.error);
    }

    for (const q of queues) {
      const socket = this.io.sockets.sockets.get(q.socketId);
      if (socket) {
        const room = this.roomManager.getRoom(result.roomId);
        socket.emit('match:found', {
          roomId: result.roomId,
          roomCode: result.roomCode,
          hostId: room?.hostId,
          players: room ? Array.from(room.players.values()).map(p => ({
            playerId: p.playerId,
            displayName: p.displayName,
            isHost: p.isHost,
            playerNumber: p.playerNumber,
            position: p.position,
            ready: p.ready,
            connected: p.connected,
          })) : [],
          isHost: room?.hostId === q.playerId,
        });
      }
    }

    console.log(`[MatchmakingHandler] 匹配房间创建完成: ${result.roomCode} (${playerIds.length} 玩家)`);
  }

  destroy(): void {
    if (this.matchCheckTimer) {
      clearInterval(this.matchCheckTimer);
      this.matchCheckTimer = null;
    }
  }
}
