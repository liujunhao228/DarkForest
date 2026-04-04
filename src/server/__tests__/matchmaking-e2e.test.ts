// ============================
// 匹配系统端到端测试
// ============================
// 测试完整的匹配流程：队列加入、实时更新、匹配成功
// ============================

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { io as ioClient, type Socket } from 'socket.io-client';
import { db } from '@/lib/db';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { RoomManager } from '../RoomManager';
import { EventHandlers } from '../EventHandlers';

const TEST_SERVER_URL = 'http://localhost:3004';
const TEST_SERVER_PORT = 3004;
const DEFAULT_TIMEOUT = 8000;
const MATCH_TIMEOUT = 15000;
const LONG_TIMEOUT = 10000;

// ============================
// 测试隔离策略
// ============================

/**
 * 测试运行标识符 - 确保每次测试运行的数据都是唯一的
 * 避免测试间的外键约束冲突
 */
const TEST_RUN_ID = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * 生成唯一的测试用户 ID
 */
function generateTestUserId(name: string): string {
  return `matchE2E_${TEST_RUN_ID}_${name}`;
}

/**
 * 生成唯一的测试玩家显示名称
 */
function generateTestPlayerName(name: string): string {
  return `MatchE2E_${TEST_RUN_ID}_${name}`;
}

// ============================
// 测试辅助类
// ============================

class TestPlayer {
  socket: Socket;
  player: { id: string; userId: string; displayName: string };

  constructor(socket: Socket, player: { id: string; userId: string; displayName: string }) {
    this.socket = socket;
    this.player = player;
  }

  async waitForEvent(event: string, timeout = DEFAULT_TIMEOUT): Promise<unknown> {
    return waitForEvent(this.socket, event, timeout);
  }

  joinQueue(mode: 'casual' | 'ranked' = 'casual', playerCount: number, quickMatch = false) {
    this.socket.emit('match:joinQueue', { mode, playerCount, quickMatch });
  }

  cancelQueue() {
    this.socket.emit('match:cancelQueue');
  }

  disconnect() {
    if (this.socket.connected) {
      this.socket.disconnect();
    }
  }
}

// ============================
// 测试套件
// ============================

describe('Matchmaking E2E', () => {
  let testSockets: Socket[] = [];
  let testPlayers: TestPlayer[] = [];

  // 测试服务器实例
  let httpServer: ReturnType<typeof createServer>;
  let ioServer: Server;
  let roomManager: RoomManager;
  let eventHandlers: EventHandlers;

  // ============================
  // 服务器生命周期
  // ============================

  async function startTestServer() {
    httpServer = createServer();
    ioServer = new Server(httpServer, {
      cors: { origin: '*' },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    roomManager = new RoomManager(ioServer);
    eventHandlers = new EventHandlers(ioServer, roomManager);
    eventHandlers.registerEvents();

    await new Promise<void>((resolve) => {
      httpServer.listen(TEST_SERVER_PORT, () => resolve());
    });
  }

  async function stopTestServer() {
    eventHandlers.destroy();
    roomManager.destroy();

    await new Promise<void>((resolve) => {
      ioServer.close(() => {
        httpServer.close(() => resolve());
      });
    });
  }

  // ============================
  // 数据清理
  // ============================

  /**
   * 清理策略：
   * 1. 使用 TEST_RUN_ID 确保每次测试运行只清理自己的数据
   * 2. 使用 deleteMany 批量删除，避免循环删除的性能问题
   * 3. 利用数据库的 CASCADE 删除自动处理关联记录
   */
  async function cleanup() {
    // 关闭所有测试 socket
    testSockets.forEach(socket => {
      if (socket.connected) {
        socket.disconnect();
      }
    });
    testSockets = [];
    testPlayers = [];

    // 只清理队列（匹配和玩家保留到测试运行结束）
    try {
      await cleanupMatchmakingQueue();
    } catch (error) {
      console.warn('清理匹配队列时出错:', error);
    }
  }

  async function cleanupMatchmakingQueue() {
    const deletedQueues = await db.matchmakingQueue.deleteMany({
      where: {
        playerId: { contains: `matchE2E_${TEST_RUN_ID}` },
      },
    });

    if (deletedQueues.count > 0) {
      console.log(`清理了 ${deletedQueues.count} 个测试队列`);
    }
  }

  /**
   * 清理当前测试运行创建的所有数据
   * 利用 CASCADE 删除自动处理关联记录
   * 
   * 清理顺序：
   * 1. 删除队列（CASCADE 无依赖）
   * 2. 删除匹配（CASCADE 自动删除 MatchPlayer）
   * 3. 删除玩家（CASCADE 自动删除关联记录）
   */
  async function cleanupAllTestData() {
    console.log('清理所有测试数据...');

    try {
      // 1. 先删除队列（无外键依赖）
      await cleanupMatchmakingQueue();
    } catch (error) {
      console.warn('清理队列时出错:', error);
    }

    try {
      // 2. 删除所有测试玩家的匹配记录
      // 通过 MatchPlayer 关联来找到并删除
      const testPlayers = await db.player.findMany({
        where: {
          userId: { contains: `matchE2E_${TEST_RUN_ID}` },
        },
        select: { id: true },
      });

      if (testPlayers.length > 0) {
        const playerIds = testPlayers.map(p => p.id);

        // 找到这些玩家参与的匹配
        const matchPlayers = await db.matchPlayer.findMany({
          where: {
            playerId: { in: playerIds },
          },
          select: { matchId: true },
        });

        const matchIds = [...new Set(matchPlayers.map(mp => mp.matchId))];

        if (matchIds.length > 0) {
          // 批量删除匹配（CASCADE 会自动删除 MatchPlayer）
          const deletedMatches = await db.match.deleteMany({
            where: {
              id: { in: matchIds },
            },
          });
          console.log(`清理了 ${deletedMatches.count} 个测试匹配`);
        }
      }
    } catch (error) {
      console.warn('清理匹配记录时出错:', error);
    }

    try {
      // 3. 最后删除玩家
      const deletedPlayers = await db.player.deleteMany({
        where: {
          userId: { contains: `matchE2E_${TEST_RUN_ID}` },
        },
      });

      if (deletedPlayers.count > 0) {
        console.log(`清理了 ${deletedPlayers.count} 个测试玩家`);
      }
    } catch (error) {
      console.warn('清理玩家记录时出错:', error);
    }
  }

  /**
   * 清理旧测试数据（不包含当前 TEST_RUN_ID）
   * 只在测试启动时运行一次
   * @deprecated 不再使用，统一使用 TEST_RUN_ID 隔离测试数据
   */
  async function _cleanupOldTestData() {
    console.log('清理旧的测试数据...');

    // 清理旧的玩家（及其关联的匹配和队列）
    try {
      const deletedPlayers = await db.player.deleteMany({
        where: {
          AND: [
            {
              OR: [
                { userId: { startsWith: 'matchE2E_' } },
                { displayName: { startsWith: 'MatchE2E_' } },
              ],
            },
            { userId: { not: { contains: TEST_RUN_ID } } },
          ],
        },
      });
      if (deletedPlayers.count > 0) {
        console.log(`清理了 ${deletedPlayers.count} 个旧测试玩家`);
      }
    } catch (error) {
      console.warn('清理旧玩家记录时出错:', error);
    }
  }

  // ============================
  // 测试夹具
  // ============================

  beforeAll(async () => {
    await startTestServer();
  });

  // 每个测试后清理当前测试运行的数据
  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    // 最后清理所有当前测试运行的数据
    await cleanupAllTestData();
    await stopTestServer();
  });

  // ============================
  // 测试工厂函数
  // ============================

  async function createTestPlayer(name: string): Promise<TestPlayer> {
    const userId = generateTestUserId(name);
    const displayName = generateTestPlayerName(name);

    const player = await db.player.create({
      data: { userId, displayName },
    });

    const socket = createTestSocket();
    const testPlayer = new TestPlayer(socket, {
      id: player.id,
      userId,
      displayName: player.displayName,
    });
    testPlayers.push(testPlayer);

    return testPlayer;
  }

  function createTestSocket(): Socket {
    const socket = ioClient(TEST_SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
      timeout: DEFAULT_TIMEOUT,
    });
    testSockets.push(socket);
    return socket;
  }

  async function loginPlayer(testPlayer: TestPlayer): Promise<{ playerId: string; displayName: string }> {
    if (!testPlayer.socket.connected) {
      await waitForEvent(testPlayer.socket, 'connect');
    }

    testPlayer.socket.emit('player:login', {
      userId: testPlayer.player.userId,
      displayName: testPlayer.player.displayName,
    });

    const response = await waitForEvent(testPlayer.socket, 'player:loginSuccess') as {
      playerId: string;
      displayName: string;
    };

    return response;
  }

  async function createAndLoginPlayers(count: number, namePrefix: string): Promise<TestPlayer[]> {
    const players = await Promise.all(
      Array.from({ length: count }, (_, i) => createTestPlayer(`${namePrefix}_${i + 1}`))
    );

    await Promise.all(players.map(loginPlayer));
    return players;
  }

  // ============================
  // 测试用例
  // ============================

  describe('队列实时更新', () => {
    it('应该在新玩家加入时向队列中的其他玩家广播更新', async () => {
      const [player1, player2] = await createAndLoginPlayers(2, 'Realtime');

      // 玩家1 加入队列
      player1.joinQueue('casual', 4);
      const joined1 = await player1.waitForEvent('match:queueJoined') as { position: number; totalInQueue: number };
      expect(joined1.position).toBe(1);
      expect(joined1.totalInQueue).toBe(1);

      // 先设置监听器，再加入队列（避免竞态条件）
      const queueUpdatePromise = player1.waitForEvent('match:queueUpdate', DEFAULT_TIMEOUT);

      // 玩家2 加入队列
      player2.joinQueue('casual', 4);
      const joined2 = await player2.waitForEvent('match:queueJoined') as { totalInQueue: number };
      expect(joined2.totalInQueue).toBe(2);

      // 玩家1 应该收到队列更新
      const queueUpdate = await queueUpdatePromise as { totalInQueue: number };
      expect(queueUpdate.totalInQueue).toBe(2);
    });

    it('应该在玩家取消时向队列中的其他玩家广播更新', async () => {
      const [player1, player2, player3] = await createAndLoginPlayers(3, 'Cancel');

      // 所有玩家加入队列
      player1.joinQueue('casual', 4);
      player2.joinQueue('casual', 4);
      player3.joinQueue('casual', 4);

      await Promise.all([
        player1.waitForEvent('match:queueJoined'),
        player2.waitForEvent('match:queueJoined'),
        player3.waitForEvent('match:queueJoined'),
      ]);

      // 监听玩家1是否收到队列更新
      const queueUpdatePromise = player1.waitForEvent('match:queueUpdate');

      // 玩家2 取消队列
      player2.cancelQueue();
      await player2.waitForEvent('match:queueCancelled');

      // 玩家1 应该收到队列更新
      const queueUpdate = await queueUpdatePromise as { totalInQueue: number };
      expect(queueUpdate.totalInQueue).toBe(2);
    });
  });

  describe('匹配人数要求验证', () => {
    it('应该等待满足所有玩家的人数要求后才开始匹配', async () => {
      const [player1, player2, player3] = await createAndLoginPlayers(3, 'WaitCount');

      // 所有玩家加入 4 人队列
      player1.joinQueue('casual', 4);
      player2.joinQueue('casual', 4);
      player3.joinQueue('casual', 4);

      await Promise.all([
        player1.waitForEvent('match:queueJoined'),
        player2.waitForEvent('match:queueJoined'),
        player3.waitForEvent('match:queueJoined'),
      ]);

      // 设置监听器（在等待之前）
      let matchFound = false;
      player1.socket.once('match:found', () => { matchFound = true; });

      // 只有 3 个玩家，但都想要 4 人局，不应该立即匹配
      // 等待 7 秒（超过匹配检查间隔 5 秒 + 缓冲）
      await sleep(LONG_TIMEOUT);

      // 不应该匹配成功，因为人数不足
      expect(matchFound).toBe(false);
    });

    it('当第 4 个玩家加入时，应该立即匹配成功', async () => {
      const [player1, player2, player3] = await createAndLoginPlayers(3, 'FullGame');
      const player4 = await createTestPlayer('FullGame_4');
      await loginPlayer(player4);

      // 前 3 个玩家加入 4 人队列
      player1.joinQueue('casual', 4);
      player2.joinQueue('casual', 4);
      player3.joinQueue('casual', 4);

      await Promise.all([
        player1.waitForEvent('match:queueJoined'),
        player2.waitForEvent('match:queueJoined'),
        player3.waitForEvent('match:queueJoined'),
      ]);

      // 设置监听器
      const matchFoundPromises = [
        player1.waitForEvent('match:found', MATCH_TIMEOUT),
        player2.waitForEvent('match:found', MATCH_TIMEOUT),
        player3.waitForEvent('match:found', MATCH_TIMEOUT),
        player4.waitForEvent('match:found', MATCH_TIMEOUT),
      ];

      // 第 4 个玩家加入 4 人队列
      player4.joinQueue('casual', 4);
      await player4.waitForEvent('match:queueJoined');

      // 所有玩家应该收到匹配成功通知
      const results = await Promise.all(matchFoundPromises);

      // 验证匹配结果
      results.forEach((result: unknown) => {
        const matchResult = result as {
          roomId: string;
          roomCode: string;
          players: Array<{ playerId: string; displayName: string; isAI: boolean }>;
          isHost: boolean;
        };
        expect(matchResult.roomId).toBeDefined();
        expect(matchResult.roomCode).toBeDefined();
        expect(matchResult.players).toHaveLength(4);
      });

      // 第一个玩家应该是房主
      const firstResult = results[0] as { isHost: boolean };
      expect(firstResult.isHost).toBe(true);
    });

    it('应该正确混合匹配不同人数偏好的玩家', async () => {
      const [player1, player2, player3, player4] = await createAndLoginPlayers(4, 'Mixed');

      // 设置监听器
      const matchFoundPromises = [
        player1.waitForEvent('match:found', MATCH_TIMEOUT),
        player2.waitForEvent('match:found', MATCH_TIMEOUT),
        player3.waitForEvent('match:found', MATCH_TIMEOUT),
        player4.waitForEvent('match:found', MATCH_TIMEOUT),
      ];

      // 玩家加入不同人数的队列
      player1.joinQueue('casual', 3);
      player2.joinQueue('casual', 3);
      player3.joinQueue('casual', 4);
      player4.joinQueue('casual', 5);

      await Promise.all([
        player1.waitForEvent('match:queueJoined'),
        player2.waitForEvent('match:queueJoined'),
        player3.waitForEvent('match:queueJoined'),
        player4.waitForEvent('match:queueJoined'),
      ]);

      // 所有玩家应该收到匹配成功通知
      const results = await Promise.all(matchFoundPromises);

      // 验证匹配成功
      expect(results).toHaveLength(4);

      results.forEach((result: unknown) => {
        const matchResult = result as {
          roomId: string;
          roomCode: string;
          players: Array<{ playerId: string }>;
        };
        expect(matchResult.roomId).toBeDefined();
        expect(matchResult.roomCode).toBeDefined();
        expect(matchResult.players).toHaveLength(4);
      });
    });

    it('快速匹配应该优先匹配任意人数', async () => {
      const [player1, player2, player3] = await createAndLoginPlayers(3, 'Quick');

      // 设置监听器
      const matchFoundPromises = [
        player1.waitForEvent('match:found', MATCH_TIMEOUT),
        player2.waitForEvent('match:found', MATCH_TIMEOUT),
        player3.waitForEvent('match:found', MATCH_TIMEOUT),
      ];

      // 快速匹配玩家加入队列
      player1.joinQueue('casual', 4, true);
      player2.joinQueue('casual', 4, true);
      player3.joinQueue('casual', 4, true);

      await Promise.all([
        player1.waitForEvent('match:queueJoined'),
        player2.waitForEvent('match:queueJoined'),
        player3.waitForEvent('match:queueJoined'),
      ]);

      // 所有玩家应该收到匹配成功通知
      const results = await Promise.all(matchFoundPromises);

      // 验证匹配成功（3 人局）
      expect(results).toHaveLength(3);

      const firstResult = results[0] as {
        players: Array<{ playerId: string }>;
      };
      expect(firstResult.players).toHaveLength(3);
    });
  });

  describe('边界情况', () => {
    it('不应该匹配人数不足的队列', async () => {
      const [player1, player2] = await createAndLoginPlayers(2, 'NotEnough');

      // 加入队列
      player1.joinQueue('casual', 3);
      player2.joinQueue('casual', 3);

      await Promise.all([
        player1.waitForEvent('match:queueJoined'),
        player2.waitForEvent('match:queueJoined'),
      ]);

      // 设置监听器（在等待之前）
      let matchFound = false;
      player1.socket.once('match:found', () => { matchFound = true; });

      // 等待 8 秒（超过匹配检查间隔）
      await sleep(LONG_TIMEOUT);

      expect(matchFound).toBe(false);
    });

    it('应该正确处理玩家断开连接', async () => {
      const [player1, player2, player3, player4] = await createAndLoginPlayers(4, 'Disconnect');

      // 所有玩家加入队列
      player1.joinQueue('casual', 4);
      player2.joinQueue('casual', 4);
      player3.joinQueue('casual', 4);
      player4.joinQueue('casual', 4);

      await Promise.all([
        player1.waitForEvent('match:queueJoined'),
        player2.waitForEvent('match:queueJoined'),
        player3.waitForEvent('match:queueJoined'),
        player4.waitForEvent('match:queueJoined'),
      ]);

      // 等待匹配成功
      await player1.waitForEvent('match:found', MATCH_TIMEOUT);

      // 断开玩家2的连接
      player2.disconnect();

      // 等待一段时间
      await sleep(2000);

      // 验证其他玩家仍然在游戏中
      expect(player1.socket.connected).toBe(true);
      expect(player3.socket.connected).toBe(true);
      expect(player4.socket.connected).toBe(true);
    });
  });

  describe('完整游戏流程', () => {
    it('应该完成从匹配到游戏开始的完整流程', async () => {
      const [player1, player2, player3, player4] = await createAndLoginPlayers(4, 'FullFlow');

      // 所有玩家加入队列
      player1.joinQueue('casual', 4);
      player2.joinQueue('casual', 4);
      player3.joinQueue('casual', 4);
      player4.joinQueue('casual', 4);

      // 等待所有玩家收到 queueJoined
      await Promise.all([
        player1.waitForEvent('match:queueJoined'),
        player2.waitForEvent('match:queueJoined'),
        player3.waitForEvent('match:queueJoined'),
        player4.waitForEvent('match:queueJoined'),
      ]);

      // 设置匹配成功监听
      const matchFoundPromises = [
        player1.waitForEvent('match:found', MATCH_TIMEOUT),
        player2.waitForEvent('match:found', MATCH_TIMEOUT),
        player3.waitForEvent('match:found', MATCH_TIMEOUT),
        player4.waitForEvent('match:found', MATCH_TIMEOUT),
      ];

      // 等待匹配成功
      const results = await Promise.all(matchFoundPromises);

      // 获取房间信息
      const firstResult = results[0] as {
        roomId: string;
        roomCode: string;
        players: Array<{ playerId: string }>;
      };

      expect(firstResult.roomId).toBeDefined();
      expect(firstResult.roomCode).toBeDefined();
      expect(firstResult.players).toHaveLength(4);

      // 验证数据库中创建了对局记录
      const match = await db.match.findUnique({
        where: { id: firstResult.roomId },
        include: { players: true },
      });

      expect(match).not.toBeNull();
      expect(match?.status).toBe('waiting');
      expect(match?.players).toHaveLength(4);
      expect(match?.players.filter(p => p.isAI)).toHaveLength(0);
    });
  });
});

// ============================
// 全局辅助函数
// ============================

function waitForEvent(socket: Socket, event: string, timeout = DEFAULT_TIMEOUT): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`超时等待事件: ${event} (超时: ${timeout}ms)`));
    }, timeout);

    socket.once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
