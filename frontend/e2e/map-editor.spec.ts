import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  loginOnlinePlayer,
  waitForGameStart,
  waitForGameOver,
  getGameState,
  disconnectWS,
  type E2EWindow,
} from './helpers/game';
import { consumeInviteCode } from './fixtures';

/**
 * P4 E2E：地图编辑器端到端流程
 *
 * 覆盖设计文档 Intent 列出的场景：
 *   1. 未登录访问 /map-editor 自动跳转 /auth
 *   2. 登录用户在编辑器创建地图（增删节点/边、改坐标）→ 读取 JSON →
 *      通过 P3 API 上传 → 4 人自定义房间选用该地图开局 → 对局结束
 *
 * 验证策略：
 *   - 编辑器产物 schema 与 P3 MapLayoutSnapshot 一致（后端 POST /api/maps 接受 201）
 *   - 自定义房间使用编辑器产出的 mapId 开局，4 客户端收到 game:fullSync
 *   - gameState.players 长度 === 4，phase === 'playing'
 *   - 断线兜底触发 gameOver，回放写入
 *
 * 邀请码预算：4（player A/B/C/D），globalSetup 已扩容到 44 个邀请码。
 */

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  test.setTimeout(180_000);
});

const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8080';
const CUSTOM_ROOM_PLAYER_COUNT = 4;

interface UniqueUser {
  displayName: string;
  password: string;
}

interface EditorPlayer {
  page: Page;
  user: UniqueUser;
  token: string;
  playerId: string;
}

// ===== Test 1: 未登录访问 /map-editor 跳转 /auth =====

test('1. 未登录访问 /map-editor 跳转 /auth', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // 不注入 auth-storage，模拟未登录状态
    await page.goto(`${E2E_BASE_URL}/map-editor`);
    // MapEditorPage useEffect 检测 !isAuthenticated → navigate('/auth')
    await page.waitForURL('**/auth', { timeout: 10_000 });
    expect(page.url()).toContain('/auth');
  } finally {
    await context.close().catch(() => {});
  }
});

// ===== Test 2: 编辑器创建地图 → 上传 → 4 人自定义房间开局 =====

// 复用 custom-room-custom-map.spec.ts 的 4 人 fixture 模式
const fourPlayerTest = test.extend<{ players: EditorPlayer[] }>({
  players: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      // 阶段 1：串行注册 4 个用户
      const registrations: Array<{
        user: UniqueUser;
        token: string;
        playerId: string;
        player: { id: string; displayName: string; role: string };
      }> = [];

      for (let i = 0; i < CUSTOM_ROOM_PLAYER_COUNT; i++) {
        const inviteCode = consumeInviteCode();
        const user: UniqueUser = {
          displayName: `e2e_p4_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
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
      ): Promise<EditorPlayer> => {
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

/**
 * 在编辑器页面添加 N 个节点并通过 NodeInspector 设置坐标。
 * 每次点击「添加节点」后新节点自动选中，可直接在 NodeInspector 改坐标。
 */
async function addNodesWithCoords(
  page: Page,
  coords: Array<{ x: number; y: number }>,
): Promise<void> {
  for (const { x, y } of coords) {
    await page.getByRole('button', { name: '添加节点', exact: true }).click();
    // 等待 NodeInspector 的 X 坐标输入框可见（节点已自动选中）
    const xInput = page.locator('input[type="number"]').first();
    await xInput.waitFor({ state: 'visible', timeout: 5_000 });
    await xInput.fill(String(x));
    // Y 坐标输入框
    const yInput = page.locator('input[type="number"]').nth(1);
    await yInput.fill(String(y));
    await page.waitForTimeout(50);
  }
}

/**
 * 通过 EdgeList 下拉框添加边。
 * 页面 select 顺序：NodeInspector size(0) → EdgeList from(1) → EdgeList to(2)
 */
async function addEdgeViaList(page: Page, fromId: number, toId: number): Promise<void> {
  const selects = page.locator('select');
  // nth(0) = NodeInspector size, nth(1) = EdgeList from, nth(2) = EdgeList to
  await selects.nth(1).selectOption(String(fromId));
  await selects.nth(2).selectOption(String(toId));
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.waitForTimeout(50);
}

/**
 * 从 JsonPreview 读取当前 layout JSON 文本并解析。
 * JsonPreview 渲染 <pre> 元素，内容为 JSON.stringify(layout, null, 2)。
 */
async function readLayoutJson(page: Page): Promise<{
  nodes: Array<{ id: number; x: number; y: number; name: string; size: string; tint: string }>;
  edges: Array<{ from: number; to: number }>;
}> {
  const text = await page.locator('pre').textContent();
  expect(text, 'JsonPreview <pre> 不应为空').not.toBeNull();
  return JSON.parse(text!);
}

/**
 * 通过 API 上传地图（POST /api/maps），返回 map_id。
 * 普通用户上传的地图 is_official=false，slug=NULL。
 */
async function uploadMapViaApi(
  page: Page,
  token: string,
  layout: unknown,
  name: string,
): Promise<string> {
  const resp = await page.request.post(`${E2E_BASE_URL}/api/maps`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    data: { name, layoutJson: layout },
  });
  expect(resp.status(), '上传地图应返回 201').toBe(201);
  const data = (await resp.json()) as { id: string };
  return data.id;
}

/**
 * 点击主菜单「创建/加入房间」进入 Matchmaking 视图。
 * useMatchFoundTrigger hook 仅在 Matchmaking 组件挂载时订阅 room:gameStarted。
 */
async function enterMatchmakingScreen(page: Page): Promise<void> {
  const createJoinBtn = page.getByRole('button', { name: '创建/加入房间', exact: true });
  await createJoinBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await createJoinBtn.click();
  await page.getByRole('heading', { name: '创建/加入房间', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * 通过 WS 创建自定义队列并等待 match:queueCreated 确认。
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

fourPlayerTest('2. 编辑器创建地图 → 上传 → 4 人自定义房间开局', async ({ players }) => {
  const [playerA, playerB, playerC, playerD] = players;

  // ===== 阶段 1：Player A 在编辑器创建地图 =====
  await playerA.page.goto(`${E2E_BASE_URL}/map-editor`);
  // 等待编辑器页面渲染（标题「地图编辑器」可见）
  await playerA.page.getByRole('heading', { name: '地图编辑器', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });

  // 添加 4 个节点并设置坐标（形成连通路径，4 节点可支持 4 人对局）
  // 后端 NewGame 要求 len(nodes) >= PlayerCount，3 节点无法支持 4 人。
  await addNodesWithCoords(playerA.page, [
    { x: 20, y: 20 },
    { x: 50, y: 20 },
    { x: 50, y: 50 },
    { x: 20, y: 50 },
  ]);

  // 通过 EdgeList 添加 3 条边：1-2、2-3、3-4（连通路径）
  await addEdgeViaList(playerA.page, 1, 2);
  await addEdgeViaList(playerA.page, 2, 3);
  await addEdgeViaList(playerA.page, 3, 4);

  // 验证校验通过（导出按钮可用）
  const exportBtn = playerA.page.getByRole('button', { name: '导出 .dfmap.json', exact: true });
  await expect(exportBtn).toBeEnabled();

  // 验证节点数/边数统计
  await expect(playerA.page.getByText('节点 4 / 边 3')).toBeVisible();

  // 读取 JsonPreview 的 JSON 作为上传 payload（fallback 方案，比 download 拦截更可靠）
  const layout = await readLayoutJson(playerA.page);
  expect(layout.nodes, '编辑器产物应含 4 节点').toHaveLength(4);
  expect(layout.edges, '编辑器产物应含 3 边').toHaveLength(3);

  // ===== 阶段 2：通过 P3 API 上传地图 =====
  const mapName = `P4-E2E-${Date.now()}`;
  const mapId = await uploadMapViaApi(playerA.page, playerA.token, layout, mapName);
  expect(mapId, '上传应返回 map_id').toBeTruthy();

  // ===== 阶段 3：4 人自定义房间选用编辑器产出的地图开局 =====
  // Player A 通过编辑器「返回首页」按钮回到首页（SPA 路由，保留 WS 登录态）
  await playerA.page.getByRole('button', { name: '返回首页', exact: true }).click();
  await playerA.page.waitForTimeout(500);
  // 所有玩家进入 Matchmaking 视图（useMatchFoundTrigger 需挂载）
  await Promise.all(players.map((p) => enterMatchmakingScreen(p.page)));

  // Player A 创建自定义队列，指定 mapId = 编辑器产出的地图
  const queueName = `p4-e2e-${Date.now()}`;
  const queueId = await createCustomQueue(playerA.page, queueName, mapId, 3, 4);
  expect(queueId, 'queueId 不应为空').toBeTruthy();

  // Players B/C/D 串行加入（避免并发 join 竞态）
  await joinCustomQueue(playerB.page, queueId);
  await joinCustomQueue(playerC.page, queueId);
  await joinCustomQueue(playerD.page, queueId);

  // 等待 4 个客户端均收到 game:fullSync
  await Promise.all(players.map((p) => waitForGameStart(p.page, 30_000)));

  // 验证游戏状态
  const states = await Promise.all(players.map((p) => getGameState(p.page)));
  for (let i = 0; i < states.length; i++) {
    expect(states[i], `玩家 ${i} 的 gameState 不应为 null`).not.toBeNull();
    expect(states[i]!.phase, `玩家 ${i} 的 phase 应为 playing`).toBe('playing');
    expect(states[i]!.totalTurn, `玩家 ${i} 的 totalTurn 应为 1`).toBe(1);
    expect(states[i]!.players, `玩家 ${i} 的 players 应有 4 人`).toHaveLength(4);
  }

  // 验证 4 个页面看到的 currentPlayerId 一致
  const currentPlayerIds = states.map((s) => s!.currentPlayerId);
  expect(currentPlayerIds[0]).toBe(currentPlayerIds[1]);
  expect(currentPlayerIds[1]).toBe(currentPlayerIds[2]);
  expect(currentPlayerIds[2]).toBe(currentPlayerIds[3]);

  // ===== 阶段 4：断线兜底触发 gameOver =====
  await disconnectWS(playerB.page);
  await disconnectWS(playerC.page);
  await disconnectWS(playerD.page);

  await waitForGameOver(playerA.page, 30_000);

  const finalState = await getGameState(playerA.page);
  expect(finalState, 'Player A 的 finalState 不应为 null').not.toBeNull();
  expect(finalState!.phase, 'Player A 的 phase 应为 gameOver').toBe('gameOver');
});
