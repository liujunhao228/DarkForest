// ============================
// 匹配系统单元测试
// ============================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { 
  joinQueue, 
  cancelQueue, 
  getQueueStatus,
  findMatches,
  createMatchRoom,
  getMatchRoom,
  updateMatchStatus,
  updatePlayerStats,
  getPlayerInfo,
  getOrCreatePlayer,
} from '@/lib/matchmaking';
import { db } from '@/lib/db';

describe('Matchmaking System', () => {
  // 测试用的玩家 ID
  let testPlayer1Id: string;
  let testPlayer2Id: string;
  let testPlayer3Id: string;
  let testPlayer4Id: string;

  // 清理函数
  async function cleanup() {
    // 删除测试玩家
    const testPlayers = await db.player.findMany({
      where: {
        displayName: { contains: 'TestPlayer_' },
      },
    });

    for (const player of testPlayers) {
      await db.player.delete({ where: { id: player.id } }).catch(() => {});
    }

    // 清理匹配队列
    await db.matchmakingQueue.deleteMany({
      where: {
        playerId: { in: [testPlayer1Id, testPlayer2Id, testPlayer3Id, testPlayer4Id].filter(Boolean) },
      },
    }).catch(() => {});

    // 清理测试对局
    const testMatches = await db.match.findMany({
      where: { roomCode: { contains: 'TEST' } },
    });

    for (const match of testMatches) {
      await db.match.delete({ where: { id: match.id } }).catch(() => {});
    }
  }

  beforeEach(async () => {
    await cleanup();

    // 额外清理队列，确保测试之间没有残留
    await db.matchmakingQueue.deleteMany({}).catch(() => {});

    // 创建测试玩家（直接使用 userId，不创建 User）
    const player1 = await db.player.create({
      data: { userId: `test_user_1_${Date.now()}`, displayName: 'TestPlayer_1' },
    });
    const player2 = await db.player.create({
      data: { userId: `test_user_2_${Date.now()}`, displayName: 'TestPlayer_2' },
    });
    const player3 = await db.player.create({
      data: { userId: `test_user_3_${Date.now()}`, displayName: 'TestPlayer_3' },
    });
    const player4 = await db.player.create({
      data: { userId: `test_user_4_${Date.now()}`, displayName: 'TestPlayer_4' },
    });

    testPlayer1Id = player1.id;
    testPlayer2Id = player2.id;
    testPlayer3Id = player3.id;
    testPlayer4Id = player4.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('getOrCreatePlayer', () => {
    it('应该创建新玩家', async () => {
      const userId = `newuser_${Date.now()}`;

      const result = await getOrCreatePlayer(userId, 'NewPlayer');

      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('NewPlayer');

      // 验证数据库中已创建
      const player = await db.player.findUnique({
        where: { id: result!.id },
      });
      expect(player).not.toBeNull();
    });

    it('应该返回已存在的玩家', async () => {
      const userId = `existing_${Date.now()}`;

      // 第一次创建
      const first = await getOrCreatePlayer(userId, 'ExistingPlayer');
      expect(first).not.toBeNull();

      // 第二次获取（应该返回同一个玩家）
      const second = await getOrCreatePlayer(userId, 'DifferentName');
      expect(second).not.toBeNull();
      expect(second?.id).toBe(first?.id);
      expect(second?.displayName).toBe('ExistingPlayer'); // 不应该改变
    });
  });

  describe('joinQueue / cancelQueue', () => {
    it('应该成功加入匹配队列', async () => {
      const result = await joinQueue({
        playerId: testPlayer1Id,
        mode: 'casual',
        playerCount: 4,
      });

      expect(result.success).toBe(true);

      // 验证数据库中已创建队列记录
      const queue = await db.matchmakingQueue.findUnique({
        where: { playerId: testPlayer1Id },
      });
      expect(queue).not.toBeNull();
      expect(queue?.preferredMode).toBe('casual');
      expect(queue?.preferredCount).toBe(4);
    });

    it('不应该重复加入队列', async () => {
      // 第一次加入
      await joinQueue({
        playerId: testPlayer1Id,
        mode: 'casual',
        playerCount: 4,
      });

      // 第二次加入应该失败
      const result = await joinQueue({
        playerId: testPlayer1Id,
        mode: 'ranked',
        playerCount: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('已在匹配队列中');
    });

    it('应该成功取消匹配队列', async () => {
      // 先加入
      await joinQueue({
        playerId: testPlayer1Id,
        mode: 'casual',
        playerCount: 4,
      });

      // 取消
      const result = await cancelQueue(testPlayer1Id);
      expect(result.success).toBe(true);

      // 验证数据库中已删除
      const queue = await db.matchmakingQueue.findUnique({
        where: { playerId: testPlayer1Id },
      });
      expect(queue).toBeNull();
    });

    it('取消不存在的队列应该失败', async () => {
      const result = await cancelQueue(testPlayer1Id);
      expect(result.success).toBe(false);
    });
  });

  describe('getQueueStatus', () => {
    it('应该返回队列状态', async () => {
      // 先清理所有队列确保干净状态
      await db.matchmakingQueue.deleteMany({}).catch(() => {});

      // 先加入队列
      await joinQueue({
        playerId: testPlayer1Id,
        mode: 'casual',
        playerCount: 4,
      });

      const status = await getQueueStatus(testPlayer1Id);
      expect(status).not.toBeNull();
      expect(status?.inQueue).toBe(true);
      expect(status?.position).toBeGreaterThanOrEqual(1);
    });

    it('不在队列中应该返回 false', async () => {
      const status = await getQueueStatus(testPlayer1Id);
      expect(status).not.toBeNull();
      expect(status?.inQueue).toBe(false);
    });
  });

  describe('findMatches', () => {
    it('应该找到匹配的玩家', async () => {
      // 4 个玩家都加入 4 人队列
      await joinQueue({ playerId: testPlayer1Id, mode: 'casual', playerCount: 4 });
      await joinQueue({ playerId: testPlayer2Id, mode: 'casual', playerCount: 4 });
      await joinQueue({ playerId: testPlayer3Id, mode: 'casual', playerCount: 4 });
      await joinQueue({ playerId: testPlayer4Id, mode: 'casual', playerCount: 4 });

      const result = await findMatches();
      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThan(0);
      expect(result!.matches[0].length).toBe(4);
    });

    it('玩家不足时应该返回空数组', async () => {
      // 先清理所有队列确保干净状态
      await db.matchmakingQueue.deleteMany({}).catch(() => {});

      // 只有 2 个玩家
      await joinQueue({ playerId: testPlayer1Id, mode: 'casual', playerCount: 4 });
      await joinQueue({ playerId: testPlayer2Id, mode: 'casual', playerCount: 4 });

      const result = await findMatches();
      expect(result).not.toBeNull();
      expect(result?.matches.length).toBe(0);
    });

    it('应该按期望玩家数分组匹配', async () => {
      // 3 个玩家想玩 3 人局
      await joinQueue({ playerId: testPlayer1Id, mode: 'casual', playerCount: 3 });
      await joinQueue({ playerId: testPlayer2Id, mode: 'casual', playerCount: 3 });
      await joinQueue({ playerId: testPlayer3Id, mode: 'casual', playerCount: 3 });

      // 4 个玩家想玩 4 人局
      await joinQueue({ playerId: testPlayer4Id, mode: 'casual', playerCount: 4 });

      const result = await findMatches();
      expect(result).not.toBeNull();
      // 应该优先匹配 3 人局
      expect(result?.matches.some(m => m.length === 3)).toBe(true);
    });
  });

  describe('createMatchRoom', () => {
    it('应该成功创建房间', async () => {
      const result = await createMatchRoom(
        [testPlayer1Id, testPlayer2Id, testPlayer3Id],
        'casual',
        1 // 1 个 AI
      );

      expect(result.success).toBe(true);
      expect(result.match).not.toBeNull();
      expect(result.match?.roomCode).toHaveLength(6);
      expect(result.match?.players.length).toBe(4); // 3 真人 + 1 AI
      expect(result.match?.players.filter(p => p.isAI).length).toBe(1);
    });

    it('房主应该是第一个玩家', async () => {
      const result = await createMatchRoom(
        [testPlayer1Id, testPlayer2Id],
        'casual',
        0
      );

      expect(result.success).toBe(true);
      expect(result.match?.players.find(p => p.isHost)?.playerId).toBe(testPlayer1Id);
    });

    it('应该正确添加 AI 玩家', async () => {
      const result = await createMatchRoom(
        [testPlayer1Id],
        'casual',
        3 // 3 个 AI
      );

      expect(result.success).toBe(true);
      expect(result.match?.players.length).toBe(4);
      expect(result.match?.players.filter(p => p.isAI).length).toBe(3);
      
      // AI 应该有名称
      const aiPlayers = result.match?.players.filter(p => p.isAI);
      aiPlayers?.forEach(ai => {
        expect(ai.displayName).not.toBe('');
      });
    });
  });

  describe('getMatchRoom', () => {
    it('应该获取房间信息', async () => {
      // 先创建房间
      await createMatchRoom(
        [testPlayer1Id, testPlayer2Id],
        'casual',
        0
      );

      const match = await db.match.findFirst({
        where: { hostId: testPlayer1Id },
      });

      expect(match).not.toBeNull();

      const result = await getMatchRoom(match!.roomCode);
      expect(result).not.toBeNull();
      expect(result?.match.roomCode).toBe(match!.roomCode);
      expect(result?.match.players.length).toBe(2);
    });

    it('不存在的房间应该返回 null', async () => {
      const result = await getMatchRoom('INVALID');
      expect(result).toBeNull();
    });
  });

  describe('updateMatchStatus', () => {
    it('应该更新对局状态', async () => {
      // 先创建房间
      await createMatchRoom(
        [testPlayer1Id],
        'casual',
        0
      );

      const match = await db.match.findFirst({
        where: { hostId: testPlayer1Id },
      });

      expect(match).not.toBeNull();
      expect(match?.status).toBe('playing');

      // 更新为 finished
      const success = await updateMatchStatus(match!.id, 'finished', {
        winnerId: testPlayer1Id,
        winnerType: 'human',
        totalTurns: 10,
        duration: 600,
      });

      expect(success).toBe(true);

      const updatedMatch = await db.match.findUnique({
        where: { id: match!.id },
      });

      expect(updatedMatch?.status).toBe('finished');
      expect(updatedMatch?.winnerId).toBe(testPlayer1Id);
      expect(updatedMatch?.totalTurns).toBe(10);
    });
  });

  describe('updatePlayerStats', () => {
    it('应该更新玩家胜利统计', async () => {
      const initialStats = await getPlayerInfo(testPlayer1Id);
      expect(initialStats).not.toBeNull();

      const initialWins = initialStats!.wins;
      const initialRating = initialStats!.rating;

      const success = await updatePlayerStats(testPlayer1Id, 'win');
      expect(success).toBe(true);

      const updatedStats = await getPlayerInfo(testPlayer1Id);
      expect(updatedStats?.wins).toBe(initialWins + 1);
      expect(updatedStats?.rating).toBe(initialRating + 25);
    });

    it('应该更新玩家失败统计', async () => {
      const initialStats = await getPlayerInfo(testPlayer1Id);
      expect(initialStats).not.toBeNull();

      const initialLosses = initialStats!.losses;
      const initialRating = initialStats!.rating;

      const success = await updatePlayerStats(testPlayer1Id, 'loss');
      expect(success).toBe(true);

      const updatedStats = await getPlayerInfo(testPlayer1Id);
      expect(updatedStats?.losses).toBe(initialLosses + 1);
      expect(updatedStats?.rating).toBe(Math.max(0, initialRating - 15));
    });

    it('应该更新玩家平局统计', async () => {
      const initialStats = await getPlayerInfo(testPlayer1Id);
      expect(initialStats).not.toBeNull();

      const initialDraws = initialStats!.draws;

      const success = await updatePlayerStats(testPlayer1Id, 'draw');
      expect(success).toBe(true);

      const updatedStats = await getPlayerInfo(testPlayer1Id);
      expect(updatedStats?.draws).toBe(initialDraws + 1);
    });
  });

  describe('getPlayerInfo', () => {
    it('应该获取玩家信息', async () => {
      const info = await getPlayerInfo(testPlayer1Id);
      expect(info).not.toBeNull();
      expect(info?.displayName).toBe('TestPlayer_1');
      expect(info?.level).toBe(1);
      expect(info?.rating).toBe(1000);
    });

    it('不存在的玩家应该返回 null', async () => {
      const info = await getPlayerInfo('invalid-id');
      expect(info).toBeNull();
    });
  });
});
