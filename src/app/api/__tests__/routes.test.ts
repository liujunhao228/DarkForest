// ============================
// API 路由测试
// ============================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '@/lib/db';

const API_BASE = 'http://localhost:3000/api';

// 清理测试数据
async function cleanup() {
  try {
    // 按正确顺序清理数据，避免外键约束问题
    
    // 1. 先清理所有自定义队列玩家记录（通过队列关联）
    await db.customMatchQueuePlayer.deleteMany({
      where: {
        queue: {
          creator: {
            displayName: { contains: 'APITest_' },
          },
        },
      },
    }).catch((e) => console.log('Cleanup customMatchQueuePlayer via queue:', e.message));

    // 2. 也清理所有通过玩家关联的队列玩家记录
    await db.customMatchQueuePlayer.deleteMany({
      where: {
        player: {
          displayName: { contains: 'APITest_' },
        },
      },
    }).catch((e) => console.log('Cleanup customMatchQueuePlayer via player:', e.message));

    // 3. 清理自定义队列
    await db.customMatchQueue.deleteMany({
      where: {
        creator: {
          displayName: { contains: 'APITest_' },
        },
      },
    }).catch((e) => console.log('Cleanup customMatchQueue:', e.message));

    // 4. 清理匹配玩家记录
    await db.matchPlayer.deleteMany({
      where: {
        player: {
          displayName: { contains: 'APITest_' },
        },
      },
    }).catch((e) => console.log('Cleanup matchPlayer:', e.message));

    // 5. 清理匹配记录（通过房间码或关联玩家）
    await db.match.deleteMany({
      where: { 
        roomCode: { contains: 'APITEST' },
      },
    }).catch((e) => console.log('Cleanup match:', e.message));

    // 6. 清理匹配队列
    await db.matchmakingQueue.deleteMany({
      where: {
        player: {
          displayName: { contains: 'APITest_' },
        },
      },
    }).catch((e) => console.log('Cleanup matchmakingQueue:', e.message));

    // 7. 最后清理玩家
    await db.player.deleteMany({
      where: {
        displayName: { contains: 'APITest_' },
      },
    }).catch((e) => console.log('Cleanup player:', e.message));
    
  } catch (error) {
    console.error('Cleanup error:', error);
  }
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

describe('Custom Queue API', () => {
  let testPlayerId: string;

  beforeEach(async () => {
    await cleanup();

    // 创建测试玩家
    const loginResponse = await fetch(`${API_BASE}/player/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: `test_user_${Date.now()}`,
        displayName: 'APITest_CustomQueue',
      }),
    });

    const data = await loginResponse.json();
    testPlayerId = data.player.id;
  });

  afterEach(cleanup);

  describe('POST /api/match/queue/create', () => {
    it('应该成功创建自定义队列', async () => {
      // 验证玩家确实存在
      const playerCheck = await db.player.findUnique({
        where: { id: testPlayerId },
      });
      console.log('[TEST] 创建队列前玩家检查:', playerCheck);
      
      const response = await fetch(`${API_BASE}/match/queue/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: testPlayerId,
          queueName: '测试房间',
          minPlayers: 3,
          maxPlayers: 4,
        }),
      });

      const responseData = await response.json();
      console.log('Create queue response:', responseData);
      console.log('Response status:', response.status);

      expect(response.status).toBe(200);

      const data = responseData;
      expect(data.success).toBe(true);
      expect(data.queueId).toBeDefined();
    });

    it('应该拒绝缺少 creatorId 的请求', async () => {
      const response = await fetch(`${API_BASE}/match/queue/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueName: '测试房间',
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('缺少必要参数：creatorId 和 queueName');
    });

    it('应该拒绝无效的玩家数', async () => {
      const response = await fetch(`${API_BASE}/match/queue/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: testPlayerId,
          queueName: '测试房间',
          minPlayers: 2, // 小于 3
          maxPlayers: 4,
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('最小玩家数必须在 3-5 之间');
    });
  });

  describe('POST /api/match/queue/join-specific', () => {
    let queueId: string;

    beforeEach(async () => {
      // 创建队列
      const createResponse = await fetch(`${API_BASE}/match/queue/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: testPlayerId,
          queueName: '测试房间',
          minPlayers: 3,
          maxPlayers: 4,
        }),
      });

      const data = await createResponse.json();
      queueId = data.queueId;
    });

    it('应该成功加入指定队列', async () => {
      // 创建第二个玩家
      const player2Response = await fetch(`${API_BASE}/player/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: `test_user_2_${Date.now()}`,
          displayName: 'Player2',
        }),
      });

      const player2Data = await player2Response.json();

      const response = await fetch(`${API_BASE}/match/queue/join-specific`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: player2Data.player.id,
          queueId,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.queueId).toBe(queueId);
    });

    it('应该拒绝不存在的队列', async () => {
      const response = await fetch(`${API_BASE}/match/queue/join-specific`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: testPlayerId,
          queueId: 'NONEXISTENT',
        }),
      });

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('队列不存在');
    });
  });

  describe('GET /api/match/queue/info', () => {
    let queueId: string;

    beforeEach(async () => {
      // 创建队列
      const createResponse = await fetch(`${API_BASE}/match/queue/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: testPlayerId,
          queueName: '测试房间',
          minPlayers: 3,
          maxPlayers: 4,
        }),
      });

      const data = await createResponse.json();
      queueId = data.queueId;
    });

    it('应该返回队列信息', async () => {
      const response = await fetch(`${API_BASE}/match/queue/info?queueId=${queueId}`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.queue.queueId).toBe(queueId);
      expect(data.queue.queueName).toBe('测试房间');
    });

    it('应该拒绝不存在的队列', async () => {
      const response = await fetch(`${API_BASE}/match/queue/info?queueId=NONEXISTENT`);

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('队列不存在');
    });
  });

  describe('POST /api/match/queue/leave', () => {
    let queueId: string;
    let player2Id: string;

    beforeEach(async () => {
      // 创建队列
      const createResponse = await fetch(`${API_BASE}/match/queue/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: testPlayerId,
          queueName: '测试房间',
          minPlayers: 3,
          maxPlayers: 4,
        }),
      });

      const data = await createResponse.json();
      queueId = data.queueId;

      // 创建并加入第二个玩家
      const player2Response = await fetch(`${API_BASE}/player/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: `test_user_2_${Date.now()}`,
          displayName: 'Player2',
        }),
      });

      const player2Data = await player2Response.json();
      player2Id = player2Data.player.id;

      await fetch(`${API_BASE}/match/queue/join-specific`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: player2Id,
          queueId,
        }),
      });
    });

    it('应该成功离开队列', async () => {
      const response = await fetch(`${API_BASE}/match/queue/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: player2Id,
          queueId,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });
});

describe('Room Start API', () => {
  let testPlayerId: string;
  let roomCode: string;

  beforeEach(async () => {
    await cleanup();

    // 创建测试玩家
    const loginResponse = await fetch(`${API_BASE}/player/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: `test_user_${Date.now()}`,
        displayName: 'APITest_RoomStart',
      }),
    });

    const data = await loginResponse.json();
    testPlayerId = data.player.id;

    // 创建队列（会自动创建房间）
    const createResponse = await fetch(`${API_BASE}/match/queue/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creatorId: testPlayerId,
        queueName: '测试房间',
        minPlayers: 3,
        maxPlayers: 3,
      }),
    });

    // 注意：当前实现中，创建队列不会自动创建房间
    // 这里只是设置测试结构，实际房间创建需要额外逻辑
  });

  afterEach(cleanup);

  describe('POST /api/match/room/start', () => {
    it('应该拒绝不存在的房间', async () => {
      const response = await fetch(`${API_BASE}/match/room/start`, {
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
      const response = await fetch(`${API_BASE}/match/room/start`, {
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
