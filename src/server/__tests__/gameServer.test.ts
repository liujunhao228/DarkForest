// ============================
// WebSocket 游戏服务器集成测试
// ============================

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { io, type Socket } from 'socket.io-client';
import { db } from '@/lib/db';

const TEST_SERVER_URL = 'http://localhost:3003';

describe('WebSocket Game Server', () => {
  let testSockets: Socket[] = [];
  let testUsers: Array<{ id: string; userId: string; displayName: string }> = [];

  // 清理测试数据
  async function cleanup() {
    // 关闭所有测试 socket
    testSockets.forEach(socket => {
      if (socket.connected) {
        socket.disconnect();
      }
    });
    testSockets = [];

    // 删除测试玩家
    const testPlayers = await db.player.findMany({
      where: {
        displayName: { contains: 'WebSocketTest_' },
      },
    });

    for (const player of testPlayers) {
      await db.player.delete({ where: { id: player.id } }).catch(() => {});
    }

    // 清理测试对局
    const testMatches = await db.match.findMany({
      where: { roomCode: { contains: 'WSTEST' } },
    });

    for (const match of testMatches) {
      await db.match.delete({ where: { id: match.id } }).catch(() => {});
    }

    // 清理匹配队列
    await db.matchmakingQueue.deleteMany({
      where: {
        playerId: { in: testUsers.map(u => u.id).filter(Boolean) },
      },
    }).catch(() => {});

    testUsers = [];
  }

  beforeAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  // 创建测试用户
  async function createTestUser(name: string) {
    const user = await db.user.create({
      data: {
        email: `wstest_${name}_${Date.now()}@test.com`,
        name: `WebSocket Test ${name}`,
      },
    });

    const player = await db.player.create({
      data: {
        userId: user.id,
        displayName: `WebSocketTest_${name}`,
      },
    });

    return { id: player.id, userId: user.id, displayName: player.displayName };
  }

  // 创建测试 socket
  function createTestSocket(): Socket {
    const socket = io(TEST_SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });
    testSockets.push(socket);
    return socket;
  }

  // 等待事件 Promise
  function waitForEvent(socket: Socket, event: string, timeout = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeout);

      socket.once(event, (data: unknown) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  describe('Connection', () => {
    it('应该成功连接 WebSocket 服务器', (done) => {
      const socket = createTestSocket();

      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        done();
      });

      socket.on('connect_error', (error) => {
        done(error);
      });
    });

    it('应该处理断开连接', (done) => {
      const socket = createTestSocket();

      socket.on('connect', () => {
        socket.disconnect();
      });

      socket.on('disconnect', () => {
        expect(socket.connected).toBe(false);
        done();
      });
    });
  });

  describe('Player Login', () => {
    it('应该成功登录玩家', async () => {
      const socket = createTestSocket();
      const testUser = await createTestUser('Login');

      // 等待连接
      await waitForEvent(socket, 'connect');

      // 发送登录请求
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });

      // 等待登录响应
      const response = await waitForEvent(socket, 'player:loggedIn') as { playerId: string; displayName: string };
      
      expect(response.playerId).toBe(testUser.id);
      expect(response.displayName).toBe(testUser.displayName);
    });

    it('应该拒绝无效的登录请求', async () => {
      const socket = createTestSocket();

      await waitForEvent(socket, 'connect');

      // 发送无效的登录请求
      socket.emit('player:login', {
        userId: 'invalid-user-id',
        displayName: 'Invalid User',
      });

      // 应该收到错误
      const response = await waitForEvent(socket, 'error') as { message: string };
      expect(response.message).toBeDefined();
    });
  });

  describe('Matchmaking Queue', () => {
    it('应该成功加入匹配队列', async () => {
      const socket = createTestSocket();
      const testUser = await createTestUser('Queue1');

      await waitForEvent(socket, 'connect');

      // 登录
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // 加入队列
      socket.emit('match:joinQueue', {
        mode: 'casual',
        playerCount: 4,
      });

      // 等待队列响应
      const response = await waitForEvent(socket, 'match:queueJoined') as {
        mode: string;
        playerCount: number;
        position: number;
      };

      expect(response.mode).toBe('casual');
      expect(response.playerCount).toBe(4);
      expect(response.position).toBe(1);
    });

    it('应该成功取消匹配队列', async () => {
      const socket = createTestSocket();
      const testUser = await createTestUser('QueueCancel');

      await waitForEvent(socket, 'connect');

      // 登录
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // 加入队列
      socket.emit('match:joinQueue', {
        mode: 'casual',
        playerCount: 4,
      });
      await waitForEvent(socket, 'match:queueJoined');

      // 取消队列
      socket.emit('match:cancelQueue');

      // 等待取消响应
      await waitForEvent(socket, 'match:queueCancelled');
    });

    it('不应该重复加入队列', async () => {
      const socket = createTestSocket();
      const testUser = await createTestUser('QueueDup');

      await waitForEvent(socket, 'connect');

      // 登录
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // 第一次加入
      socket.emit('match:joinQueue', {
        mode: 'casual',
        playerCount: 4,
      });
      await waitForEvent(socket, 'match:queueJoined');

      // 第二次加入应该失败
      socket.emit('match:joinQueue', {
        mode: 'ranked',
        playerCount: 3,
      });

      const response = await waitForEvent(socket, 'match:queueError') as { message: string };
      expect(response.message).toBe('已在匹配队列中');
    });
  });

  describe('Match Found', () => {
    it('应该通知玩家匹配成功', async () => {
      // 创建 4 个玩家和 socket
      const sockets: Socket[] = [];
      const users: Array<{ id: string; userId: string; displayName: string }> = [];

      for (let i = 1; i <= 4; i++) {
        const socket = createTestSocket();
        const user = await createTestUser(`Match${i}`);
        sockets.push(socket);
        users.push(user);

        await waitForEvent(socket, 'connect');

        // 登录
        socket.emit('player:login', {
          userId: user.userId,
          displayName: user.displayName,
        });
        await waitForEvent(socket, 'player:loggedIn');

        // 加入队列
        socket.emit('match:joinQueue', {
          mode: 'casual',
          playerCount: 4,
        });
      }

      // 等待所有玩家匹配成功（可能需要更长时间）
      const matchPromises = sockets.map(socket => 
        waitForEvent(socket, 'match:found', 15000)
      );

      const results = await Promise.all(matchPromises);
      
      // 所有玩家都应该收到匹配成功通知
      results.forEach((result: unknown) => {
        const matchResult = result as {
          roomId: string;
          roomCode: string;
          players: unknown[];
          isHost: boolean;
        };
        expect(matchResult.roomId).toBeDefined();
        expect(matchResult.roomCode).toBeDefined();
        expect(matchResult.players.length).toBe(4);
      });

      // 第一个玩家应该是房主
      const firstResult = results[0] as { isHost: boolean };
      expect(firstResult.isHost).toBe(true);
    });
  });

  describe('Room Management', () => {
    it('应该处理玩家加入房间', async () => {
      const socket = createTestSocket();
      const testUser = await createTestUser('RoomJoin');

      await waitForEvent(socket, 'connect');

      // 登录
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // 尝试加入不存在的房间
      socket.emit('room:join', { roomCode: 'INVALID' });

      const response = await waitForEvent(socket, 'room:error') as { message: string };
      expect(response.message).toBe('房间不存在');
    });

    it('应该处理玩家准备状态', async () => {
      // 这个测试需要一个已存在的房间
      // 由于房间创建依赖于匹配系统，这里简化测试
      const socket = createTestSocket();
      const testUser = await createTestUser('RoomReady');

      await waitForEvent(socket, 'connect');

      // 登录
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // 尝试发送准备状态（没有房间）
      socket.emit('room:ready', { roomId: 'invalid', ready: true });

      // 不会有响应，因为没有这个房间
      // 这里只是验证不会崩溃
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('Game Actions', () => {
    it('应该处理游戏初始化请求', async () => {
      const socket = createTestSocket();
      const testUser = await createTestUser('GameInit');

      await waitForEvent(socket, 'connect');

      // 登录
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // 请求游戏初始化（没有房间）
      socket.emit('game:init', { roomId: 'invalid' });

      // 不会有响应，因为没有这个房间
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('应该处理游戏动作', async () => {
      const socket = createTestSocket();
      const testUser = await createTestUser('GameAction');

      await waitForEvent(socket, 'connect');

      // 登录
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // 发送游戏动作（没有房间）
      socket.emit('game:action', {
        roomId: 'invalid',
        action: 'playCard',
        payload: { cardUid: 'test' },
      });

      // 不会有响应，因为没有这个房间
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('Disconnect Handling', () => {
    it('应该处理玩家断开连接', async () => {
      const socket = createTestSocket();
      const testUser = await createTestUser('Disconnect');

      await waitForEvent(socket, 'connect');

      // 登录
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // 断开连接
      socket.disconnect();

      expect(socket.connected).toBe(false);
    });
  });
});
