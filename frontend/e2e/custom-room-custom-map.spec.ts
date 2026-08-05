import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { gameTest as threePlayerTest, consumeInviteCode } from './fixtures';
import {
  loginOnlinePlayer,
  waitForGameStart,
  waitForGameOver,
  getGameState,
  startQuickMatch,
  disconnectWS,
  type E2EWindow,
} from './helpers/game';

/**
 * P3 E2E：自定义房间选用自定义地图
 *
 * 覆盖设计文档 Intent 列出的 2 个场景：
 *   1. 自定义房间使用 e2e-test-map 完成对局（4 人，mapId 由 globalSetup 注入）
 *   2. 快匹配仍用 classic-9（map_id 为 NULL 路径，基础烟雾测试）
 *
 * 固定测试地图 slug=e2e-test-map 由 globalSetup 上传/复用，
 * 其 id 通过 process.env.E2E_TEST_MAP_ID 传入测试。
 *
 * 验证策略：
 *   - 对局启动：4 个客户端均收到 game:fullSync（gameState 非 null）
 *   - 地图正确性：通过 GET /api/replay/list 拉取最近回放，
 *     检查 states[0].mapSnapshot.nodes 包含 e2e-test-map 独有坐标 (50,50)
 *   - 快匹配：3 人快速匹配开局，验证 gameState 非 null（classic-9 路径不回归）
 */

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  test.setTimeout(180_000);
});

// ===== 4 人 fixture（P3 自定义房间需要 4 人） =====

interface UniqueUser {
  displayName: string;
  password: string;
}

interface CustomRoomPlayer {
  page: Page;
  user: UniqueUser;
  token: string;
  playerId: string;
}

const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8080';
const CUSTOM_ROOM_PLAYER_COUNT = 4;

// consumeInviteCode 从 fixtures.ts 复用，与 game.spec.ts / determinism.spec.ts 等
// 共享同一 usedCodes Set，避免跨 spec 重复消费同一邀请码。

const fourPlayerTest = test.extend<{ players: CustomRoomPlayer[] }>({
  players: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];

    try {
      // 阶段 1：串行注册 4 个用户（避免 user_id 毫秒级时间戳并发冲突）
      const registrations: Array<{
        user: UniqueUser;
        token: string;
        playerId: string;
        player: { id: string; displayName: string; role: string };
      }> = [];

      for (let i = 0; i < CUSTOM_ROOM_PLAYER_COUNT; i++) {
        const inviteCode = consumeInviteCode();
        const user: UniqueUser = {
          displayName: `e2e_p3_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
          password: 'Pass' + Math.random().toString(36).slice(2, 10),
        };

        const resp = await fetch(`${E2E_BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: user.displayName,
            password: user.password,
            inviteCode,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`注册失败 [${resp.status}]: ${text}`);
        }
        const data = (await resp.json()) as {
          token: string;
          player: { id: string; displayName: string; role: string };
        };

        registrations.push({
          user,
          token: data.token,
          playerId: data.player.id,
          player: data.player,
        });
      }

      // 阶段 2：并行创建 BrowserContext + 页面导航 + WS 登录
      const setupPlayer = async (
        reg: typeof registrations[number],
      ): Promise<CustomRoomPlayer> => {
        const context = await browser.newContext();
        contexts.push(context);
        const page = await context.newPage();

        await context.addInitScript(
          (authData) => {
            localStorage.setItem('auth-storage', JSON.stringify({
              state: {
                token: authData.token,
                player: authData.player,
                isAuthenticated: true,
              },
              version: 0,
            }));
          },
          { token: reg.token, player: reg.player },
        );

        await page.goto(E2E_BASE_URL);
        await loginOnlinePlayer(page, reg.user.displayName);

        return {
          page,
          user: reg.user,
          token: reg.token,
          playerId: reg.playerId,
        };
      };

      const players = await Promise.all(registrations.map((reg) => setupPlayer(reg)));

      await use(players);
    } finally {
      for (const ctx of contexts) {
        await ctx.close().catch(() => {});
      }
    }
  },
});

// ===== WS 自定义队列 helpers =====

/**
 * 点击主菜单「创建/加入房间」按钮，进入 Matchmaking 视图。
 *
 * 必要性：useMatchFoundTrigger hook 仅在 Matchmaking 组件挂载时才订阅
 * currentRoom.status === 'playing' 并触发 onMatchFound → setMode('online') →
 * gameConnect → game:requestSync → game:fullSync 链路。
 * 若玩家停留在 MainMenu（mode='menu'），即使后端推送了 match:found /
 * room:joined / room:gameStarted，前端 UI 也不会进入游戏视图，gameState
 * 永远为 null，waitForGameStart 会超时。
 *
 * 本 helper 通过 UI 点击进入 Matchmaking 视图，使 useMatchFoundTrigger
 * 挂载，后续 WS 直发的 match:createQueue / match:joinSpecificQueue 仍可
 * 绕过表单直接走 WS 通道（与现有 fixtures 风格一致）。
 */
async function enterMatchmakingScreen(page: Page): Promise<void> {
  const createJoinBtn = page.getByRole('button', { name: '创建/加入房间', exact: true });
  await createJoinBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await createJoinBtn.click();
  // 等待 Matchmaking 视图渲染完成（标题「创建/加入房间」变为 heading）
  await page.getByRole('heading', { name: '创建/加入房间', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * 通过 WS 创建自定义队列并等待 match:queueCreated 确认。
 * 返回 queueId 供其他玩家 joinSpecificQueue 使用。
 *
 * mapId 可选：传入时后端持久化到 custom_match_queues.map_id 并透传至房间。
 */
async function createCustomQueue(
  page: Page,
  queueName: string,
  mapId?: string,
  minPlayers = 3,
  maxPlayers = 4,
): Promise<string> {
  await page.waitForFunction(() => !!(window as unknown as E2EWindow).__e2e?.wsClient);

  return page.evaluate(
    ({ queueName, minPlayers, maxPlayers, mapId }) => {
      return new Promise<string>((resolve, reject) => {
        const ws = (window as unknown as E2EWindow).__e2e!.wsClient;
        const timeout = setTimeout(() => {
          ws.off('match:queueCreated', onCreated);
          ws.off('match:error', onError);
          reject(new Error('match:createQueue 超时（15s）'));
        }, 15_000);

        const onCreated = (payload: unknown) => {
          const data = payload as { queueId?: string };
          if (!data?.queueId) return;
          clearTimeout(timeout);
          ws.off('match:queueCreated', onCreated);
          ws.off('match:error', onError);
          resolve(data.queueId);
        };
        const onError = (err: unknown) => {
          clearTimeout(timeout);
          ws.off('match:queueCreated', onCreated);
          ws.off('match:error', onError);
          const msg = (err as { message?: string })?.message || 'match:createQueue 失败';
          reject(new Error(msg));
        };
        ws.on('match:queueCreated', onCreated);
        ws.on('match:error', onError);
        ws.send('match:createQueue', { queueName, minPlayers, maxPlayers, mapId });
      });
    },
    { queueName, minPlayers, maxPlayers, mapId },
  );
}

/**
 * 通过 WS 加入指定队列并等待 match:specificQueueJoined 确认。
 */
async function joinCustomQueue(page: Page, queueId: string): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as E2EWindow).__e2e?.wsClient);

  await page.evaluate(
    (qid) => {
      return new Promise<void>((resolve, reject) => {
        const ws = (window as unknown as E2EWindow).__e2e!.wsClient;
        const timeout = setTimeout(() => {
          ws.off('match:specificQueueJoined', onJoined);
          ws.off('match:error', onError);
          reject(new Error('match:joinSpecificQueue 超时（15s）'));
        }, 15_000);

        const onJoined = (payload: unknown) => {
          const data = payload as { success?: boolean; queueId?: string };
          if (data?.queueId !== qid) return;
          clearTimeout(timeout);
          ws.off('match:specificQueueJoined', onJoined);
          ws.off('match:error', onError);
          if (data.success === false) {
            reject(new Error('加入队列失败'));
          } else {
            resolve();
          }
        };
        const onError = (err: unknown) => {
          clearTimeout(timeout);
          ws.off('match:specificQueueJoined', onJoined);
          ws.off('match:error', onError);
          const msg = (err as { message?: string })?.message || 'match:joinSpecificQueue 失败';
          reject(new Error(msg));
        };
        ws.on('match:specificQueueJoined', onJoined);
        ws.on('match:error', onError);
        ws.send('match:joinSpecificQueue', { queueId: qid, playerCount: 4 });
      });
    },
    queueId,
  );
}

/**
 * 通过 GET /api/replay/list 拉取当前用户最近的回放列表。
 * 返回最新一条回放的 id（按 createdAt 降序）。
 */
async function getLatestReplayId(page: Page, token: string): Promise<string | null> {
  const resp = await page.request.get(`${E2E_BASE_URL}/api/replay/list?limit=5&offset=0`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok()) return null;
  const data = (await resp.json()) as {
    replays: Array<{ id: string; createdAt: number }>;
  };
  if (!data.replays || data.replays.length === 0) return null;
  // 按 createdAt 降序取最新
  const sorted = [...data.replays].sort((a, b) => b.createdAt - a.createdAt);
  return sorted[0].id;
}

/**
 * 通过 GET /api/replay/{id} 拉取完整回放（含 states 快照）。
 * 返回 states[0]（初始 GameState），其 mapSnapshot 字段含地图布局。
 */
async function getReplayInitialState(page: Page, token: string, replayId: string): Promise<{
  mapSnapshot?: { nodes: Array<{ id: number; x: number; y: number; name: string }>; edges: Array<{ from: number; to: number }> } | null;
} | null> {
  const resp = await page.request.get(`${E2E_BASE_URL}/api/replay/${replayId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok()) return null;
  const data = (await resp.json()) as {
    states: Array<{
      mapSnapshot?: { nodes: Array<{ id: number; x: number; y: number; name: string }>; edges: Array<{ from: number; to: number }> } | null;
    }>;
  };
  if (!data.states || data.states.length === 0) return null;
  return data.states[0];
}

// ===== 测试用例 =====

// Test 1: 自定义房间使用 e2e-test-map 完成对局
fourPlayerTest('1. 自定义房间使用 e2e-test-map 完成对局', async ({ players }) => {
  const testMapId = process.env.E2E_TEST_MAP_ID;
  if (!testMapId) {
    throw new Error('E2E_TEST_MAP_ID 未设置（globalSetup 应上传 e2e-test-map 并写入此变量）');
  }

  // 关键前置：4 个玩家均点击「创建/加入房间」进入 Matchmaking 视图。
  // useMatchFoundTrigger hook 仅在 Matchmaking 组件挂载时才订阅
  // currentRoom.status === 'playing' 并触发 onMatchFound → setMode('online') →
  // gameConnect → game:requestSync → game:fullSync 链路。
  // 若停留在 MainMenu，后端推送的 room:gameStarted 不会触发 UI 转场，
  // gameState 永远为 null，waitForGameStart 必然超时。
  await Promise.all(players.map((p) => enterMatchmakingScreen(p.page)));

  // Player A（players[0]）创建自定义队列，指定 mapId = e2e-test-map
  const queueName = `p3-e2e-${Date.now()}`;
  const queueId = await createCustomQueue(players[0].page, queueName, testMapId, 3, 4);
  expect(queueId, 'queueId 不应为空').toBeTruthy();

  // Players B/C/D 加入队列（串行，避免并发 join 竞态：后端 JoinCustomQueue
  // 未在事务内读取 playerCount，并发 join 可能都看到 < MaxPlayers 的旧计数，
  // 导致 newStatus 永远不为 "full"，auto-start 不触发）
  await joinCustomQueue(players[1].page, queueId);
  await joinCustomQueue(players[2].page, queueId);
  await joinCustomQueue(players[3].page, queueId);

  // 等待 4 个客户端均收到 game:fullSync（gameState 非 null）
  await Promise.all(players.map((p) => waitForGameStart(p.page, 30_000)));

  // 验证每个页面的游戏状态
  const states = await Promise.all(players.map((p) => getGameState(p.page)));
  for (let i = 0; i < states.length; i++) {
    expect(states[i], `玩家 ${i} 的 gameState 不应为 null`).not.toBeNull();
    expect(states[i]!.phase, `玩家 ${i} 的 phase 应为 playing`).toBe('playing');
    expect(states[i]!.totalTurn, `玩家 ${i} 的 totalTurn 应为 1`).toBe(1);
    expect(states[i]!.players, `玩家 ${i} 的 players 应有 4 人`).toHaveLength(4);
  }

  // 验证 4 个页面看到的 currentPlayerId 一致（同一回合）
  const currentPlayerIds = states.map((s) => s!.currentPlayerId);
  expect(currentPlayerIds[0]).toBe(currentPlayerIds[1]);
  expect(currentPlayerIds[1]).toBe(currentPlayerIds[2]);
  expect(currentPlayerIds[2]).toBe(currentPlayerIds[3]);

  // 让对局结束以触发回放写入（回放仅在 GameState.Phase=GameOver 时保存）。
  // 断开 3 个玩家（B/C/D），仅剩 Player A；E2E_FALLBACK_TIMEOUT_MS=3000，
  // 3 秒后服务端判定 Player A 获胜并写入回放。
  // 与 game.spec.ts Test 2「完整对局 — 兜底超时产生赢家」同套路。
  await disconnectWS(players[1].page);
  await disconnectWS(players[2].page);
  await disconnectWS(players[3].page);

  // 等待 hub 处理断线 + 兜底超时触发 gameOver
  await waitForGameOver(players[0].page, 30_000);

  // 验证 Player A 的游戏已结束
  const finalState = await getGameState(players[0].page);
  expect(finalState, 'Player A 的 finalState 不应为 null').not.toBeNull();
  expect(finalState!.phase, 'Player A 的 phase 应为 gameOver').toBe('gameOver');

  // 通过回放验证地图正确性：拉取 Player A 最近回放的 states[0].mapSnapshot
  // 回放写入有延迟（异步写库），轮询最多 15s
  let replayId: string | null = null;
  for (let attempt = 0; attempt < 15 && !replayId; attempt++) {
    await players[0].page.waitForTimeout(1000);
    replayId = await getLatestReplayId(players[0].page, players[0].token);
  }
  expect(replayId, '应能拉取到回放 ID').toBeTruthy();

  const initialState = await getReplayInitialState(players[0].page, players[0].token, replayId);
  expect(initialState, '应能拉取到回放初始状态').not.toBeNull();

  // 验证 mapSnapshot 与 e2e-test-map 一致：
  //   - 9 节点 / 14 边（与 classic-9 相同数量，但坐标不同）
  //   - 节点 1 坐标 (50,50) 是 e2e-test-map 独有标记，classic-9 节点 1 在 (10,12)
  //   - 这证明引擎 GameState.Map 确实使用了所选自定义地图，而非默认 classic-9
  const mapSnapshot = initialState?.mapSnapshot ?? null;
  expect(mapSnapshot, '回放 states[0].mapSnapshot 不应为空').not.toBeNull();
  expect(mapSnapshot!.nodes, 'mapSnapshot 节点数应为 9').toHaveLength(9);
  expect(mapSnapshot!.edges, 'mapSnapshot 边数应为 14').toHaveLength(14);

  const centerNode = mapSnapshot!.nodes.find((n) => n.id === 1);
  expect(centerNode, '应存在 id=1 的节点').toBeDefined();
  expect(centerNode!.x, '节点 1 的 x 坐标应为 50（e2e-test-map 独有）').toBe(50);
  expect(centerNode!.y, '节点 1 的 y 坐标应为 50（e2e-test-map 独有）').toBe(50);
});

// ===== Test 2: 快匹配仍用 classic-9（NULL map_id 路径不回归） =====

/**
 * 快匹配路径不传 mapId（matchmaking_queues 不持久化 map_id），
 * 引擎 NewGame 在 config.Map=nil 时回落 DefaultMapState=classic-9。
 *
 * 本用例仅做烟雾测试：3 人快匹配开局，验证 gameState 非 null 且 phase=playing。
 * 不再深入校验 classic-9 节点坐标（P1/P2 E2E 已覆盖），
 * P3 仅需保证"快匹配路径未被自定义地图改造破坏"。
 */
threePlayerTest('2. 快匹配仍用 classic-9（NULL map_id 路径不回归）', async ({ players }) => {
  // 3 人并发快匹配
  await Promise.all(players.map((p) => startQuickMatch(p.page, 3)));

  // 等待 3 个客户端均收到 game:fullSync
  await Promise.all(players.map((p) => waitForGameStart(p.page, 30_000)));

  // 验证每个页面的游戏状态
  const states = await Promise.all(players.map((p) => getGameState(p.page)));
  for (let i = 0; i < states.length; i++) {
    expect(states[i], `玩家 ${i} 的 gameState 不应为 null`).not.toBeNull();
    expect(states[i]!.phase, `玩家 ${i} 的 phase 应为 playing`).toBe('playing');
    expect(states[i]!.totalTurn, `玩家 ${i} 的 totalTurn 应为 1`).toBe(1);
    expect(states[i]!.players, `玩家 ${i} 的 players 应有 3 人`).toHaveLength(3);
  }

  // 验证 3 个页面看到的 currentPlayerId 一致（同一回合）
  const currentPlayerIds = states.map((s) => s!.currentPlayerId);
  expect(currentPlayerIds[0]).toBe(currentPlayerIds[1]);
  expect(currentPlayerIds[1]).toBe(currentPlayerIds[2]);
});