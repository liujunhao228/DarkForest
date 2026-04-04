// ============================
// API 路由测试
// ============================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '@/lib/db';

const API_BASE = 'http://localhost:3000/api';

// 清理测试数据
async function cleanup() {
  const testPlayers = await db.player.findMany({
    where: {
      displayName: { contains: 'APITest_' },
    },
  });

  for (const player of testPlayers) {
    await db.player.delete({ where: { id: player.id } }).catch(() => {});
  }

  const testMatches = await db.match.findMany({
    where: { roomCode: { contains: 'APITEST' } },
  });

  for (const match of testMatches) {
    await db.match.delete({ where: { id: match.id } }).catch(() => {});
  }

  await db.matchmakingQueue.deleteMany({
    where: {
      playerId: { contains: 'test' },
    },
  }).catch(() => {});
}

describe('Player API', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  describe('POST /api/player/login', () => {
    it('应该成功创建/登录玩家', async () => {
      const response = await fetch(`${API_BASE}/player/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: `test_user_${Date.now()}`,
          displayName: 'APITest_Player',
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.player.id).toBeDefined();
      expect(data.player.displayName).toBe('APITest_Player');
    });

    it('应该拒绝缺少 userId 的请求', async () => {
      const response = await fetch(`${API_BASE}/player/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'APITest_Player',
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('应该拒绝缺少 displayName 的请求', async () => {
      const response = await fetch(`${API_BASE}/player/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'test_user',
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('GET /api/player/[id]', () => {
    it('应该获取玩家信息', async () => {
      // 先创建玩家
      const loginResponse = await fetch(`${API_BASE}/player/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: `test_user_${Date.now()}`,
          displayName: 'APITest_GetPlayer',
        }),
      });

      const loginData = await loginResponse.json();
      const playerId = loginData.player.id;

      // 获取玩家信息
      const response = await fetch(`${API_BASE}/player/${playerId}`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.player.id).toBe(playerId);
      expect(data.player.displayName).toBe('APITest_GetPlayer');
    });

    it('应该返回 404 对于不存在的玩家', async () => {
      const response = await fetch(`${API_BASE}/player/non-existent-id`);

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('玩家不存在');
    });
  });
});

describe('Match Queue API', () => {
  let testPlayerId: string;

  beforeEach(async () => {
    await cleanup();

    // 创建测试玩家
    const loginResponse = await fetch(`${API_BASE}/player/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: `test_user_${Date.now()}`,
        displayName: 'APITest_QueuePlayer',
      }),
    });

    const data = await loginResponse.json();
    testPlayerId = data.player.id;
  });

  afterEach(cleanup);

  describe('POST /api/match/queue/join', () => {
    it('应该成功加入匹配队列', async () => {
      const response = await fetch(`${API_BASE}/match/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: testPlayerId,
          mode: 'casual',
          playerCount: 4,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('应该拒绝缺少 playerId 的请求', async () => {
      const response = await fetch(`${API_BASE}/match/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'casual',
          playerCount: 4,
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('缺少必要参数');
    });

    it('应该拒绝无效的 playerCount', async () => {
      const response = await fetch(`${API_BASE}/match/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: testPlayerId,
          mode: 'casual',
          playerCount: 2, // 小于 3
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('玩家数必须在 3-5 之间');
    });

    it('应该拒绝 playerCount 大于 5', async () => {
      const response = await fetch(`${API_BASE}/match/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: testPlayerId,
          mode: 'casual',
          playerCount: 6, // 大于 5
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('玩家数必须在 3-5 之间');
    });
  });

  describe('POST /api/match/queue/cancel', () => {
    it('应该成功取消匹配队列', async () => {
      // 先加入队列
      await fetch(`${API_BASE}/match/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: testPlayerId,
          mode: 'casual',
          playerCount: 4,
        }),
      });

      // 取消队列
      const response = await fetch(`${API_BASE}/match/queue/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: testPlayerId,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('应该拒绝缺少 playerId 的请求', async () => {
      const response = await fetch(`${API_BASE}/match/queue/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('缺少 playerId');
    });
  });

  describe('GET /api/match/queue/status', () => {
    it('应该获取匹配队列状态', async () => {
      // 先加入队列
      await fetch(`${API_BASE}/match/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: testPlayerId,
          mode: 'casual',
          playerCount: 4,
        }),
      });

      // 获取状态
      const response = await fetch(`${API_BASE}/match/queue/status?playerId=${testPlayerId}`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.inQueue).toBe(true);
    });

    it('应该返回不在队列中', async () => {
      const response = await fetch(`${API_BASE}/match/queue/status?playerId=${testPlayerId}`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.inQueue).toBe(false);
    });

    it('应该拒绝缺少 playerId 的请求', async () => {
      const response = await fetch(`${API_BASE}/match/queue/status`);

      expect(response.status).toBe(400);
    });
  });
});

describe('Match Room API', () => {
  let testPlayerId: string;

  beforeEach(async () => {
    await cleanup();

    // 创建测试玩家
    const loginResponse = await fetch(`${API_BASE}/player/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: `test_user_${Date.now()}`,
        displayName: 'APITest_RoomPlayer',
      }),
    });

    const data = await loginResponse.json();
    testPlayerId = data.player.id;
  });

  afterEach(cleanup);

  describe('GET /api/match/room/[roomCode]', () => {
    it('应该返回 404 对于不存在的房间', async () => {
      const response = await fetch(`${API_BASE}/match/room/INVALID`);

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('房间不存在');
    });
  });

  describe('POST /api/match/room/join', () => {
    it('应该拒绝不存在的房间', async () => {
      const response = await fetch(`${API_BASE}/match/room/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: 'INVALID',
          playerId: testPlayerId,
        }),
      });

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('房间不存在');
    });

    it('应该拒绝缺少参数的请求', async () => {
      const response = await fetch(`${API_BASE}/match/room/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('缺少 roomCode 或 playerId');
    });
  });
});
