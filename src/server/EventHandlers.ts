// ============================
// 黑暗森林 - 事件处理器
// ============================
// 处理所有 WebSocket 事件
// ============================

import { Server, Socket } from 'socket.io';
import { RoomManager } from './RoomManager';
import type { ClientMessage, RoomPlayerInfo, LoginPayload, JoinQueuePayload } from './protocol';
import { joinQueue, cancelQueue, getQueueStatus, getOrCreatePlayer, getPlayerInfo } from '@/lib/matchmaking';

// ============================
// 事件处理器
// ============================

export class EventHandlers {
  private io: Server;
  private roomManager: RoomManager;

  // 匹配队列
  private matchmakingQueue = new Map<string, { socketId: string; playerId: string; mode: 'casual' | 'ranked'; playerCount: number; quickMatch: boolean; joinedAt: number }>();
  private matchCheckTimer: NodeJS.Timeout | null;

  constructor(io: Server, roomManager: RoomManager) {
    this.io = io;
    this.roomManager = roomManager;
    this.matchCheckTimer = null;
    
    // 启动定时匹配检查
    this.startMatchCheckTimer();
  }

  // ============================
  // 注册所有事件
  // ============================

  registerEvents(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`[EventHandlers] 玩家连接: ${socket.id}`);

      // 玩家登录
      socket.on('player:login', (data: LoginPayload) => {
        this.handlePlayerLogin(socket, data);
      });

      // 匹配队列
      socket.on('match:joinQueue', (data: JoinQueuePayload) => {
        this.handleJoinQueue(socket, data);
      });

      socket.on('match:cancelQueue', () => {
        this.handleCancelQueue(socket);
      });

      socket.on('match:getStatus', () => {
        this.handleGetQueueStatus(socket);
      });

      // 房间管理
      socket.on('room:join', (data: { roomCode: string }) => {
        this.handleRoomJoin(socket, data.roomCode);
      });

      socket.on('room:leave', () => {
        this.handleRoomLeave(socket);
      });

      socket.on('room:ready', (data: { roomId: string; ready: boolean }) => {
        this.handleRoomReady(socket, data.roomId, data.ready);
      });

      socket.on('room:start', (data: { roomId: string }) => {
        this.handleRoomStart(socket, data.roomId);
      });

      // 游戏操作
      socket.on('game:action', (data: { roomId: string; action: string; payload?: Record<string, unknown> }) => {
        this.handleGameAction(socket, data.roomId, data.action, data.payload);
      });

      socket.on('game:requestSync', (data: { roomId: string }) => {
        this.handleRequestSync(socket, data.roomId);
      });

      socket.on('game:ackState', (data: { roomId: string; version: number }) => {
        this.handleAckState(socket, data.roomId, data.version);
      });

      // 断开连接
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      socket.on('connect_error', (error: Error) => {
        console.error(`[EventHandlers] 连接错误 (${socket.id}):`, error);
      });
    });
  }

  // ============================
  // 事件处理
  // ============================

  /**
   * 处理玩家登录
   */
  private async handlePlayerLogin(socket: Socket, data: LoginPayload): Promise<void> {
    try {
      const { userId, displayName } = data;

      // 创建或获取玩家
      const player = await getOrCreatePlayer(userId, displayName);
      if (!player) {
        socket.emit('player:loginError', { message: '创建玩家失败' });
        return;
      }

      // 获取玩家信息
      const playerInfo = await getPlayerInfo(player.id);

      // 存储玩家信息到 socket
      socket.data.playerId = player.id;
      socket.data.displayName = player.displayName;

      // 发送成功响应
      socket.emit('player:loginSuccess', {
        playerId: player.id,
        displayName: player.displayName,
        playerInfo: playerInfo ? {
          id: playerInfo.id,
          displayName: playerInfo.displayName,
          level: playerInfo.level,
          rating: playerInfo.rating,
          wins: playerInfo.wins,
          losses: playerInfo.losses,
          draws: playerInfo.draws,
          totalMatches: playerInfo.totalMatches,
        } : undefined,
      });

      console.log(`[EventHandlers] 玩家登录: ${player.displayName} (${player.id})`);
    } catch (error) {
      console.error('[EventHandlers] 玩家登录失败:', error);
      socket.emit('player:loginError', { message: '服务器内部错误' });
    }
  }

  /**
   * 处理加入匹配队列
   */
  private async handleJoinQueue(socket: Socket, data: JoinQueuePayload): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      socket.emit('match:queueError', { message: '请先登录' });
      return;
    }

    // 检查是否已在队列中
    if (this.matchmakingQueue.has(playerId)) {
      socket.emit('match:queueError', { message: '已在匹配队列中' });
      return;
    }

    // 先加入内存队列
    this.matchmakingQueue.set(playerId, {
      socketId: socket.id,
      playerId,
      mode: data.mode,
      playerCount: data.playerCount,
      quickMatch: data.quickMatch ?? false,
      joinedAt: Date.now(),
    });

    // 调用数据库匹配
    await joinQueue({
      playerId,
      mode: data.mode,
      playerCount: data.playerCount,
    });

    // 计算队列信息
    const queueArray = Array.from(this.matchmakingQueue.values());
    const position = queueArray.findIndex(q => q.playerId === playerId) + 1;
    const groups = this.getQueueGroups();

    socket.emit('match:queueJoined', {
      mode: data.mode,
      playerCount: data.playerCount,
      position,
      totalInQueue: queueArray.length,
      groups,
      quickMatch: data.quickMatch ?? false,
    });

    console.log(`[EventHandlers] 玩家加入匹配: ${playerId}, 模式: ${data.mode}, 人数: ${data.playerCount}, 快速: ${data.quickMatch ?? false}`);

    // 向队列中所有玩家广播更新的队列状态（不包括刚加入的玩家）
    this.broadcastQueueUpdates();

    // 尝试匹配
    this.tryMatchPlayers();
  }

  /**
   * 处理取消匹配队列
   */
  private async handleCancelQueue(socket: Socket): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;

    this.matchmakingQueue.delete(playerId);
    await cancelQueue(playerId);

    socket.emit('match:queueCancelled');
    console.log(`[EventHandlers] 玩家取消匹配: ${playerId}`);

    // 向队列中剩余玩家广播更新的队列状态
    this.broadcastQueueUpdates();
  }

  /**
   * 处理获取队列状态
   */
  private async handleGetQueueStatus(socket: Socket): Promise<void> {
    // 注意：这里有个笔误，应该使用 this
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

  /**
   * 处理加入房间
   */
  private handleRoomJoin(socket: Socket, roomCode: string): void {
    const playerId = socket.data.playerId;
    console.log(`[EventHandlers] handleRoomJoin 被调用: socketId=${socket.id}, roomCode=${roomCode}, playerId=${playerId}`);
    
    if (!playerId) {
      console.warn(`[EventHandlers] 玩家未登录，无法加入房间: ${roomCode}`);
      socket.emit('room:error', { message: '请先登录' });
      return;
    }

    const result = this.roomManager.joinRoom(roomCode, playerId, socket.id);
    
    if (!result.success) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    // 获取房间信息
    const roomId = this.roomManager.getRoomIdByCode(roomCode);
    if (roomId) {
      const room = this.roomManager.getRoom(roomId);
      if (room) {
        socket.emit('room:joined', {
          roomId,
          roomCode,
          players: Array.from(room.players.values()).map(p => ({
            playerId: p.playerId,
            displayName: p.displayName,
            isAI: p.isAI,
            isHost: p.isHost,
            playerNumber: p.playerNumber,
            position: p.position,
            ready: p.ready,
            connected: p.connected,
          })),
        });

        // 检查是否所有玩家都已连接且准备好，如果是则自动开始游戏
        const allReady = Array.from(room.players.values()).every(p => p.ready || p.isAI);
        const allConnected = Array.from(room.players.values()).every(p => !p.connected || p.socketId !== '');
        
        console.log(`[EventHandlers] 玩家 ${playerId} 加入房间 ${roomCode}，检查开始条件:`, {
          allReady,
          allConnected,
          status: room.status,
          players: Array.from(room.players.values()).map(p => ({
            id: p.playerId,
            name: p.displayName,
            isAI: p.isAI,
            ready: p.ready,
            connected: p.connected,
            hasSocketId: !!p.socketId,
          })),
        });
        
        if (allReady && allConnected && room.status === 'waiting') {
          console.log(`[EventHandlers] 满足开始条件，尝试开始游戏`);
          // 异步开始游戏，不阻塞当前响应
          this.roomManager.startGame(roomId).then(result => {
            if (!result.success) {
              console.warn(`[EventHandlers] 自动开始游戏失败: ${result.error}`);
            }
          });
        }
      }
    }

    socket.data.roomCode = roomCode;
    console.log(`[EventHandlers] 玩家加入房间: ${playerId} -> ${roomCode}`);
  }

  /**
   * 处理离开房间
   */
  private handleRoomLeave(socket: Socket): void {
    const playerId = socket.data.playerId;
    const roomCode = socket.data.roomCode;
    
    if (!playerId || !roomCode) return;

    const roomId = this.roomManager.getRoomIdByCode(roomCode);
    if (roomId) {
      this.roomManager.leaveRoom(roomId, playerId);
    }

    socket.data.roomCode = null;
    console.log(`[EventHandlers] 玩家离开房间: ${playerId}`);
  }

  /**
   * 处理准备状态
   */
  private async handleRoomReady(socket: Socket, roomId: string, ready: boolean): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;

    const result = await this.roomManager.toggleReady(roomId, playerId, ready);
    
    if (!result.success) {
      socket.emit('room:error', { message: result.error });
    }
  }

  /**
   * 处理开始游戏
   */
  private async handleRoomStart(socket: Socket, roomId: string): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;

    // 只有房主可以开始游戏
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('room:error', { message: '房间不存在' });
      return;
    }

    const player = room.players.get(playerId);
    if (!player || !player.isHost) {
      socket.emit('room:error', { message: '只有房主可以开始游戏' });
      return;
    }

    const result = await this.roomManager.startGame(roomId);
    
    if (!result.success) {
      socket.emit('room:error', { message: result.error });
    }
  }

  /**
   * 处理游戏操作
   */
  private async handleGameAction(
    socket: Socket, 
    roomId: string, 
    action: string, 
    payload?: Record<string, unknown>
  ): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;

    const engine = this.roomManager.getEngine(roomId);
    if (!engine) {
      socket.emit('game:error', { message: '游戏引擎不存在' });
      return;
    }

    // 处理操作
    const result = await engine.processAction(playerId, action as any, payload);

    // 发送结果
    socket.emit('game:actionResult', result);

    if (!result.success) {
      socket.emit('game:error', { message: result.error });
    }
  }

  /**
   * 处理请求同步
   */
  private handleRequestSync(socket: Socket, roomId: string): void {
    console.log(`[EventHandlers] handleRequestSync: socketId=${socket.id}, roomId=${roomId}`);
    const syncManager = this.roomManager.getSyncManager(roomId);
    if (syncManager) {
      syncManager.requestFullSync(socket.id);
    } else {
      console.warn(`[EventHandlers] SyncManager 不存在: roomId=${roomId}`);
    }
  }

  /**
   * 处理确认状态
   */
  private handleAckState(socket: Socket, roomId: string, version: number): void {
    const syncManager = this.roomManager.getSyncManager(roomId);
    if (syncManager) {
      syncManager.ackState(socket.id, version);
    }
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(socket: Socket): void {
    const playerId = socket.data.playerId;
    const roomCode = socket.data.roomCode;

    if (playerId) {
      // 从匹配队列移除
      this.matchmakingQueue.delete(playerId);

      // 离开房间
      if (roomCode) {
        const roomId = this.roomManager.getRoomIdByCode(roomCode);
        if (roomId) {
          this.roomManager.leaveRoom(roomId, playerId);
        }
      }
    }

    console.log(`[EventHandlers] 玩家断开连接: ${socket.id}`);
  }

  // ============================
  // 匹配逻辑
  // ============================

  /**
   * 获取队列分组信息
   */
  private getQueueGroups(): Array<{ mode: 'casual' | 'ranked'; playerCount: number; count: number }> {
    const groups = new Map<string, { mode: 'casual' | 'ranked'; playerCount: number; count: number }>();

    for (const q of this.matchmakingQueue.values()) {
      const key = `${q.mode}-${q.playerCount}`;
      if (!groups.has(key)) {
        groups.set(key, { mode: q.mode, playerCount: q.playerCount, count: 0 });
      }
      groups.get(key)!.count++;
    }

    return Array.from(groups.values());
  }

  /**
   * 向队列中所有玩家广播更新的队列状态
   */
  private broadcastQueueUpdates(): void {
    const queueArray = Array.from(this.matchmakingQueue.values());
    const totalInQueue = queueArray.length;
    const groups = this.getQueueGroups();

    // 为每个玩家计算他们的位置
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

  /**
   * 启动定时匹配检查
   */
  private startMatchCheckTimer(): void {
    this.matchCheckTimer = setInterval(() => {
      this.tryMatchPlayers();
    }, 5000);  // 每 5 秒检查一次
  }

  /**
   * 尝试匹配玩家
   */
  private async tryMatchPlayers(): Promise<void> {
    const queues = Array.from(this.matchmakingQueue.values());

    if (queues.length < 2) return;

    // 1. 优先匹配快速匹配玩家
    const quickMatchQueues = queues.filter(q => q.quickMatch);
    if (quickMatchQueues.length >= 3) {
      const targetCount = Math.min(5, quickMatchQueues.length);
      const matchPlayers = quickMatchQueues.slice(0, targetCount);
      await this.createMatchRoom(matchPlayers);

      for (const q of matchPlayers) {
        this.matchmakingQueue.delete(q.playerId);
        import('@/lib/matchmaking').then(m => m.cancelQueue(q.playerId));
      }

      // 通知剩余玩家队列更新
      this.broadcastQueueUpdates();
      return;
    }

    // 2. 按玩家数分组，尝试匹配相同人数偏好的玩家
    const byCount = new Map<number, typeof queues>();
    for (const q of queues) {
      if (!q.quickMatch) {
        if (!byCount.has(q.playerCount)) {
          byCount.set(q.playerCount, []);
        }
        byCount.get(q.playerCount)!.push(q);
      }
    }

    // 尝试匹配相同人数偏好
    for (const [count, queueList] of byCount.entries()) {
      if (queueList.length >= count) {
        const matchPlayers = queueList.slice(0, count);
        await this.createMatchRoom(matchPlayers);

        for (const q of matchPlayers) {
          this.matchmakingQueue.delete(q.playerId);
          import('@/lib/matchmaking').then(m => m.cancelQueue(q.playerId));
        }

        // 通知剩余玩家队列更新
        this.broadcastQueueUpdates();
        return;
      }
    }

    // 3. 尝试混合不同玩家数（3-5人）- 仅限非快速匹配
    // 关键修复：需要确保混合后的玩家数量满足所有参与玩家的期望
    const remainingQueues = queues.filter(q => !q.quickMatch);
    if (remainingQueues.length >= 3) {
      // 尝试找出一个合理的玩家数量，使得所有参与玩家都能接受
      for (const targetCount of [3, 4, 5]) {
        if (remainingQueues.length >= targetCount) {
          // 检查前 targetCount 个玩家是否都能接受 targetCount 人数
          const candidatePlayers = remainingQueues.slice(0, targetCount);

          // 检查是否所有候选玩家都能接受这个人数
          // （他们的 playerCount 必须 <= targetCount，或者他们是灵活玩家）
          const allAccept = candidatePlayers.every(q => q.playerCount <= targetCount);

          if (allAccept) {
            await this.createMatchRoom(candidatePlayers);

            for (const q of candidatePlayers) {
              this.matchmakingQueue.delete(q.playerId);
              import('@/lib/matchmaking').then(m => m.cancelQueue(q.playerId));
            }

            // 通知剩余玩家队列更新
            this.broadcastQueueUpdates();
            return;
          }
        }
      }
    }
  }

  /**
   * 创建匹配房间
   */
  private async createMatchRoom(queues: Array<{ playerId: string; socketId: string; mode: 'casual' | 'ranked' }>): Promise<void> {
    const playerIds = queues.map(q => q.playerId);
    const mode = queues[0].mode;
    const aiCount = Math.max(0, 4 - playerIds.length);  // 默认 4 人局

    const result = await this.roomManager.createRoom(playerIds, mode, aiCount);

    if (result.error) {
      console.error('[EventHandlers] 创建房间失败:', result.error);
      return;
    }

    // 通知所有玩家
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
            isAI: p.isAI,
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

    console.log(`[EventHandlers] 创建匹配房间: ${result.roomCode}`);
  }

  // ============================
  // 内部辅助
  // ============================

  /**
   * 销毁事件处理器
   */
  destroy(): void {
    if (this.matchCheckTimer) {
      clearInterval(this.matchCheckTimer);
      this.matchCheckTimer = null;
    }
  }
}
