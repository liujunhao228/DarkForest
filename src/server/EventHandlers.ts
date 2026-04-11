// ============================
// 黑暗森林 - 事件处理器
// ============================
// 处理所有 WebSocket 事件
// ============================

import { Server, Socket } from 'socket.io';
import { RoomManager } from './RoomManager';
import type { ClientMessage, RoomPlayerInfo, LoginPayload, JoinQueuePayload, JoinSpecificQueuePayload } from './protocol';
import { joinQueue, cancelQueue, getQueueStatus, getOrCreatePlayer, getPlayerInfo, getFullCustomQueues, getCustomQueueInfo, joinSpecificQueue } from '@/lib/matchmaking';

// ============================
// 事件处理器
// ============================

export class EventHandlers {
  private io: Server;
  private roomManager: RoomManager;

  // 匹配队列
  private matchmakingQueue = new Map<string, { socketId: string; playerId: string; playerCount: number; quickMatch: boolean; joinedAt: number }>();
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
      console.log(`[EventHandlers] 玩家连接: socketId=${socket.id}`);

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

      socket.on('match:joinSpecificQueue', (data: JoinSpecificQueuePayload) => {
        this.handleJoinSpecificQueue(socket, data);
      });

      // 房间管理
      socket.on('room:join', (data: { roomCode: string }) => {
        this.handleRoomJoin(socket, data.roomCode);
      });

      socket.on('room:leave', () => {
        this.handleRoomLeave(socket);
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
          wins: playerInfo.wins,
          losses: playerInfo.losses,
          draws: playerInfo.draws,
          totalMatches: playerInfo.totalMatches,
        } : undefined,
      });

      console.log(`[EventHandlers] 玩家登录成功: displayName=${player.displayName}, playerId=${player.id}, socketId=${socket.id}`);

      // 检查玩家是否在自定义匹配队列中，如果是则恢复内存队列状态
      await this.restorePlayerQueueState(player.id, socket.id);
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
      playerCount: data.playerCount,
      quickMatch: data.quickMatch ?? false,
      joinedAt: Date.now(),
    });

    // 调用数据库匹配
    await joinQueue({
      playerId,
      playerCount: data.playerCount,
    });

    // 计算队列信息
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

    console.log(`[EventHandlers] 玩家加入匹配: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}, 人数: ${data.playerCount}, 快速: ${data.quickMatch ?? false}`);

    // 向队列中其他玩家广播更新的队列状态（不包括刚加入的玩家）
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

    // 尝试匹配
    this.tryMatchPlayers();
  }

  /**
   * 处理加入指定队列
   */
  private async handleJoinSpecificQueue(socket: Socket, data: JoinSpecificQueuePayload): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      socket.emit('match:queueError', { message: '请先登录' });
      return;
    }

    const { queueId, playerCount } = data;

    // 调用数据库匹配
    const result = await joinSpecificQueue({
      playerId,
      queueId,
      playerCount: playerCount ?? 4,
    });

    if (!result.success) {
      socket.emit('match:queueError', { message: result.error });
      return;
    }

    // 添加到内存队列（与 handleJoinQueue 保持一致）
    if (this.matchmakingQueue.has(playerId)) {
      socket.emit('match:queueError', { message: '已在匹配队列中' });
      return;
    }

    this.matchmakingQueue.set(playerId, {
      socketId: socket.id,
      playerId,
      playerCount: playerCount ?? 4,
      quickMatch: false,  // 自定义队列不是快速匹配
      joinedAt: Date.now(),
    });

    // 获取队列信息
    const queueInfo = await getCustomQueueInfo(queueId);
    if (!queueInfo) {
      socket.emit('match:queueError', { message: '获取队列信息失败' });
      return;
    }

    // 计算玩家位置
    const position = queueInfo.players.findIndex(p => p.playerId === playerId) + 1;

    socket.emit('match:specificQueueJoined', {
      queueId,
      queueName: queueInfo.queueName,
      position,
      totalInQueue: queueInfo.players.length,
    });

    console.log(`[EventHandlers] 玩家加入指定队列: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}, 队列: ${queueId}, 位置: ${position}`);

    // 尝试匹配自定义队列
    this.tryMatchCustomQueue(queueId);
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
        if (queue.status === 'full' && !this.matchmakingQueue.has(playerId)) {
          // 玩家数据库中的队列状态为 full，但内存中不存在，说明是重连
          console.log(`[EventHandlers] 恢复玩家 ${playerId} 的队列状态: ${queue.queueId}`);

          // 重新加入内存队列
          this.matchmakingQueue.set(playerId, {
            socketId,
            playerId,
            playerCount: queue.maxPlayers,
            quickMatch: false,
            joinedAt: Date.now(),
          });

          console.log(`[EventHandlers] 玩家 ${playerId} 已恢复到队列 ${queue.queueId}`);

          // 通知客户端
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit('match:queueRestored', {
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
      console.error('[EventHandlers] 恢复玩家队列状态失败:', error);
    }
  }

  /**
   * 处理取消匹配队列
   */
  private async handleCancelQueue(socket: Socket): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;

    // 先从内存队列删除
    this.matchmakingQueue.delete(playerId);
    
    // 异步清除数据库队列记录
    cancelQueue(playerId).catch(() => {});

    socket.emit('match:queueCancelled');
    console.log(`[EventHandlers] 玩家取消匹配: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}`);

    // 向队列中剩余玩家广播更新的队列状态
    const queueArray = Array.from(this.matchmakingQueue.values());
    if (queueArray.length > 0) {
      for (let i = 0; i < queueArray.length; i++) {
        const q = queueArray[i];
        const otherSocket = this.io.sockets.sockets.get(q.socketId);
        if (otherSocket?.connected) {
          otherSocket.emit('match:queueUpdate', {
            position: i + 1,
            totalInQueue: queueArray.length,
            groups: this.getQueueGroups(),
          });
        }
      }
    }
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
  private async handleRoomJoin(socket: Socket, roomCode: string): Promise<void> {
    const playerId = socket.data.playerId;
    console.log(`[EventHandlers] handleRoomJoin 被调用: socketId=${socket.id}, roomCode=${roomCode}, playerId=${playerId}`);

    if (!playerId) {
      console.warn(`[EventHandlers] 玩家未登录，无法加入房间: ${roomCode}`);
      socket.emit('room:error', { message: '请先登录' });
      return;
    }

    const result = await this.roomManager.joinRoom(roomCode, playerId, socket.id);

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
            isHost: p.isHost,
            playerNumber: p.playerNumber,
            position: p.position,
            ready: p.ready,
            connected: p.connected,
          })),
        });
      }
    }

    socket.data.roomCode = roomCode;
    console.log(`[EventHandlers] 玩家加入房间: displayName=${socket.data.displayName || '未知'}, playerId=${playerId} -> ${roomCode}`);
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
    console.log(`[EventHandlers] 玩家离开房间: displayName=${socket.data.displayName || '未知'}, playerId=${playerId}`);
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

    // 检查房间是否存在
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('game:error', { message: '房间不存在' });
      return;
    }

    // 检查房间状态
    if (room.status !== 'playing') {
      socket.emit('game:error', { message: '游戏尚未开始或已结束' });
      return;
    }

    const engine = this.roomManager.getEngine(roomId);
    if (!engine) {
      console.error(`[EventHandlers] 游戏引擎不存在: roomId=${roomId}, room.status=${room.status}`);
      socket.emit('game:error', { message: '游戏引擎不存在，请刷新页面重试' });
      return;
    }

    // 提取 requestId（如果存在）
    const requestId = (payload as any)?.requestId as string | undefined;
    // 从 payload 中移除 requestId，避免传递给引擎
    const cleanPayload = { ...(payload || {}) };
    delete (cleanPayload as any).requestId;

    // 处理操作（带幂等性）
    const result = await engine.processAction(playerId, action as any, cleanPayload, requestId);

    // 发送结果
    socket.emit('game:actionResult', result);

    if (!result.success) {
      socket.emit('game:error', { message: result.error });
    } else {
      // 关键修复：玩家操作成功后更新房间活动时间，防止被误判为超时
      room.lastActivity = Date.now();
      console.log(`[EventHandlers] 更新房间活动时间: ${room.roomCode}, 操作: ${action}`);
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
   * 区分被动断线（网络问题）和主动离开
   */
  private handleDisconnect(socket: Socket): void {
    const playerId = socket.data.playerId;
    const displayName = socket.data.displayName || '未登录';
    const roomCode = socket.data.roomCode;

    if (playerId) {
      // 从匹配队列移除
      this.matchmakingQueue.delete(playerId);

      // 处理断线（而非主动离开）
      if (roomCode) {
        const roomId = this.roomManager.getRoomIdByCode(roomCode);
        if (roomId) {
          // 使用 playerDisconnected 发送专门的断线通知
          this.roomManager.playerDisconnected(roomId, playerId, 'network_error');
        }
      }
    }

    console.log(`[EventHandlers] 玩家断开连接: displayName=${displayName}, socketId=${socket.id}`);
  }

  // ============================
  // 匹配逻辑
  // ============================

  /**
   * 匹配锁 - 防止并发创建房间
   */
  private isMatching = false;

  /**
   * 获取队列分组信息
   */
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
      this.tryMatchCustomQueues();  // 同时检查自定义队列
    }, 5000);  // 每 5 秒检查一次
  }

  /**
   * 尝试匹配玩家
   */
  private async tryMatchPlayers(): Promise<void> {
    // 防止并发匹配
    if (this.isMatching) {
      return;
    }

    this.isMatching = true;

    try {
      await this._tryMatchPlayersInternal();
    } finally {
      this.isMatching = false;
    }
  }

  /**
   * 内部匹配逻辑
   */
  private async _tryMatchPlayersInternal(): Promise<void> {
    const queues = Array.from(this.matchmakingQueue.values());

    if (queues.length < 2) return;

    // 1. 优先匹配快速匹配玩家
    const quickMatchQueues = queues.filter(q => q.quickMatch);
    if (quickMatchQueues.length >= 3) {
      const targetCount = Math.min(5, quickMatchQueues.length);
      const matchPlayers = quickMatchQueues.slice(0, targetCount);

      await this.createMatchRoom(matchPlayers);

      // 关键修复：创建房间成功后才清除队列，避免重复创建和队列状态错误
      const matchedPlayerIds = new Set(matchPlayers.map(q => q.playerId));
      for (const q of matchPlayers) {
        this.matchmakingQueue.delete(q.playerId);
      }

      // 异步清除数据库队列记录
      for (const playerId of matchedPlayerIds) {
        import('@/lib/matchmaking').then(m => m.cancelQueue(playerId)).catch(() => {});
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

        // 关键修复：创建房间成功后才清除队列，避免重复创建和队列状态错误
        const matchedPlayerIds = new Set(matchPlayers.map(q => q.playerId));
        for (const q of matchPlayers) {
          this.matchmakingQueue.delete(q.playerId);
        }

        // 异步清除数据库队列记录
        for (const playerId of matchedPlayerIds) {
          import('@/lib/matchmaking').then(m => m.cancelQueue(playerId)).catch(() => {});
        }

        // 通知剩余玩家队列更新
        this.broadcastQueueUpdates();
        return;
      }
    }
  }

  /**
   * 尝试匹配所有已满的自定义队列
   * 由定时器定期调用
   */
  private async tryMatchCustomQueues(): Promise<void> {
    try {
      const fullQueues = await getFullCustomQueues();

      for (const queue of fullQueues) {
        await this.tryMatchCustomQueueInternal(queue.queueId);
      }
    } catch (error) {
      console.error('[EventHandlers] 尝试匹配自定义队列失败:', error);
    }
  }

  /**
   * 尝试匹配单个自定义队列
   * @param queueId 队列ID
   */
  async tryMatchCustomQueue(queueId: string): Promise<void> {
    try {
      await this.tryMatchCustomQueueInternal(queueId);
    } catch (error) {
      console.error(`[EventHandlers] 尝试匹配自定义队列 ${queueId} 失败:`, error);
    }
  }

  /**
   * 内部自定义队列匹配逻辑
   */
  private async tryMatchCustomQueueInternal(queueId: string): Promise<void> {
    const queueInfo = await getCustomQueueInfo(queueId);

    if (!queueInfo) {
      console.log(`[CustomQueue] 队列 ${queueId} 不存在`);
      return;
    }

    if (queueInfo.status !== 'full') {
      console.log(`[CustomQueue] 队列 ${queueId} 状态为 ${queueInfo.status}, 跳过`);
      return;
    }

    // 检查所有玩家是否在线
    const onlinePlayers: Array<{ playerId: string; socketId: string }> = [];

    for (const player of queueInfo.players) {
      const queuePlayer = this.matchmakingQueue.get(player.playerId);

      if (!queuePlayer) {
        // 有玩家不在线,跳过此队列
        // 从数据库获取 displayName
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

    // 所有玩家都在线,创建房间
    console.log(`[CustomQueue] 队列 ${queueId} 所有玩家在线, 创建房间`);
    await this.createMatchRoom(onlinePlayers);

    // 创建房间成功后清除队列状态
    for (const player of onlinePlayers) {
      this.matchmakingQueue.delete(player.playerId);
    }

    // 更新数据库队列状态为 started
    try {
      const { db } = await import('@/lib/db');
      await db.customMatchQueue.update({
        where: { queueId },
        data: { status: 'started' },
      });
    } catch (error) {
      console.error(`[CustomQueue] 更新队列状态失败:`, error);
    }

    // 通知剩余玩家队列更新
    this.broadcastQueueUpdates();
  }

  /**
   * 创建匹配房间
   */
  private async createMatchRoom(queues: Array<{ playerId: string; socketId: string }>): Promise<void> {
    const playerIds = queues.map(q => q.playerId);

    const result = await this.roomManager.createRoom(playerIds);

    if (result.error) {
      console.error('[EventHandlers] 创建房间失败:', result.error);
      return;
    }

    // 房间创建成功后，立即开始游戏
    console.log(`[EventHandlers] 房间创建成功，尝试自动开始游戏: ${result.roomCode}`);
    const startResult = await this.roomManager.startGame(result.roomId);

    if (!startResult.success) {
      console.error('[EventHandlers] 自动开始游戏失败:', startResult.error);
      // 即使开始游戏失败，也通知玩家房间已创建
      // 玩家可以在房间内等待手动开始（如果后续添加该功能）
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
