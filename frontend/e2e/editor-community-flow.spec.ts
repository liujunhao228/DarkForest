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
 * 社区创作生态 E2E：编辑器上传 → 覆盖 → 按 ID 加载 → 自定义房间 ID 开局
 *
 * 覆盖设计文档 Intent 中的社区流：
 *   1. 编辑器内「保存到 DB」另存为新图（POST 201）→「我的地图」读取 map ID
 *   2. 编辑后「覆盖当前图」（PUT 200，仅 source=mine 时可见）
 *   3. 「按 ID 加载」粘贴 map ID → 预览 → 加载到画布，验证覆盖生效
 *   4. 自定义房间用该 map ID 开局（WS 直发 createCustomQueue）→ 4 人开局 → 断线兜底
 *
 * 确定性：playwright.config.ts 已在后端注入 E2E_RAND_SEED=42 / E2E_DETERMINISTIC_UID=1，
 * 使 NewGame RNG 与卡牌 UID 跨运行可复现。
 *
 * 邀请码预算：4（Player A/B/C/D），globalSetup 预生成 44 个，余量充足。
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

// ===== 4 人 fixture（复用 map-editor.spec.ts 模式） =====

const fourPlayerTest = test.extend<{ players: EditorPlayer[] }>({
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
          displayName: `e2e_community_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
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

// ===== 编辑器操作 helpers（复用 map-editor.spec.ts 模式） =====

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
 * 选中指定 id 的节点（点击画布上对应的 SVG circle）。
 * 节点按 id 顺序渲染为 <g key="node-{id}"><circle/></g>，
 * circle 在每个 g 内是唯一可点击元素，按 .nth(id-1) 定位。
 */
async function selectNodeById(page: Page, nodeId: number): Promise<void> {
  await page.locator('svg g circle').nth(nodeId - 1).click();
  await page.waitForTimeout(80);
}

/** 修改当前选中节点的 X/Y 坐标。 */
async function setSelectedNodeCoords(page: Page, x: number, y: number): Promise<void> {
  await page.locator('input[type="number"]').first().fill(String(x));
  await page.locator('input[type="number"]').nth(1).fill(String(y));
  await page.waitForTimeout(50);
}

/**
 * 关闭指定标题的弹窗（点击 header 内的 X 按钮）。
 * 所有编辑器弹窗 header 均为 div.flex.items-center.justify-between.mb-4，内含 h2 + button(X)。
 */
async function closeModalByTitle(page: Page, title: string): Promise<void> {
  await page
    .locator('div.flex.items-center.justify-between.mb-4')
    .filter({ hasText: title })
    .locator('button')
    .click();
}

// ===== 自定义队列 helpers（WS 直发，复用 map-editor.spec.ts 模式） =====

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

// ===== 测试用例 =====

fourPlayerTest('编辑器社区流：上传→覆盖→按 ID 加载→自定义房间 ID 开局', async ({ players }) => {
  const [playerA, playerB, playerC, playerD] = players;

  // ===== 阶段 1：Player A 在编辑器创建 4 节点 3 边地图 =====
  await playerA.page.goto(`${E2E_BASE_URL}/map-editor`);
  await playerA.page.getByRole('heading', { name: '地图编辑器', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });

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

  // 校验通过：导出按钮可用 + 节点/边统计
  await expect(playerA.page.getByRole('button', { name: '导出本地备份', exact: true })).toBeEnabled();
  await expect(playerA.page.getByText('节点 4 / 边 3')).toBeVisible();

  // ===== 阶段 2：「保存到 DB」另存为新图（POST 201） =====
  const mapName = `E2E-社区-${Date.now()}`;
  await playerA.page.getByRole('button', { name: '保存到 DB', exact: true }).click();
  await playerA.page.getByRole('heading', { name: '保存到 DB', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });

  await playerA.page.getByPlaceholder('地图名称').fill(mapName);
  await playerA.page.getByRole('button', { name: '另存为新图', exact: true }).click();

  // 期望 toast「已保存」+ 弹窗关闭
  await expect(playerA.page.getByText(/已保存.*map ID/)).toBeVisible({ timeout: 10_000 });
  await playerA.page.getByRole('heading', { name: '保存到 DB', exact: true }).waitFor({ state: 'detached', timeout: 10_000 });

  // ===== 阶段 3：「我的地图」读取 map ID =====
  await playerA.page.getByRole('button', { name: '我的地图', exact: true }).click();
  await playerA.page.getByRole('heading', { name: '我的地图', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  // 等待列表加载完成（<code> 出现）
  const mapIdEl = playerA.page.locator('code').first();
  await mapIdEl.waitFor({ state: 'visible', timeout: 10_000 });
  const mapId = await mapIdEl.getAttribute('title');
  expect(mapId, '应从「我的地图」读取到 map ID').toBeTruthy();
  expect(mapId!, 'map ID 应为 UUID 格式').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  // 关闭「我的地图」弹窗（点击 header 内 X 按钮）
  await closeModalByTitle(playerA.page, '我的地图');

  // ===== 阶段 4：改节点 1 坐标为 (30,30) →「覆盖当前图」(PUT 200) =====
  // 当前 source=mine（阶段 2 另存后），「覆盖当前图」按钮应可见
  await selectNodeById(playerA.page, 1);
  // 确认节点 1 已选中：Y 输入框应为 20（节点 1 初始 Y=20；节点 4 Y=50，可区分）
  await expect(playerA.page.locator('input[type="number"]').nth(1)).toHaveValue('20');
  await setSelectedNodeCoords(playerA.page, 30, 30);

  await playerA.page.getByRole('button', { name: '保存到 DB', exact: true }).click();
  await playerA.page.getByRole('heading', { name: '保存到 DB', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  // source=mine 时「覆盖当前图」按钮应存在
  const overwriteBtn = playerA.page.getByRole('button', { name: '覆盖当前图', exact: true });
  await expect(overwriteBtn).toBeVisible();
  await overwriteBtn.click();
  await expect(playerA.page.getByText(/已覆盖 map/)).toBeVisible({ timeout: 10_000 });
  await playerA.page.getByRole('heading', { name: '保存到 DB', exact: true }).waitFor({ state: 'detached', timeout: 10_000 });

  // ===== 阶段 5：「按 ID 加载」→ 预览 → 加载，验证覆盖生效 =====
  // 先把节点 1 改回 (20,20)，使后续加载 (30,30) 的结果可观测（证明真正从 DB 加载而非画布残留）
  await selectNodeById(playerA.page, 1);
  await setSelectedNodeCoords(playerA.page, 20, 20);

  await playerA.page.getByRole('button', { name: '按 ID 加载', exact: true }).click();
  await playerA.page.getByRole('heading', { name: '按地图 ID 加载', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await playerA.page.getByPlaceholder('粘贴地图 ID').fill(mapId!);
  // 期望预览「✓ {name}（4 节点）」+「来源：我自己」
  await expect(playerA.page.getByText(/✓.*4 节点/)).toBeVisible({ timeout: 10_000 });
  await expect(playerA.page.getByText('来源：我自己')).toBeVisible();
  await playerA.page.getByRole('button', { name: '加载', exact: true }).click();

  // 加载后画布 JsonPreview 含 4 节点，且节点 1 坐标为 (30,30)（覆盖生效）
  await playerA.page.getByRole('heading', { name: '按地图 ID 加载', exact: true }).waitFor({ state: 'detached', timeout: 10_000 });
  const loaded = await readLayoutJson(playerA.page);
  expect(loaded.nodes, '加载后画布应含 4 节点').toHaveLength(4);
  const node1 = loaded.nodes.find((n) => n.id === 1);
  expect(node1, '应存在 id=1 的节点').toBeDefined();
  expect(node1!.x, '节点 1 X 应为覆盖后的 30').toBe(30);
  expect(node1!.y, '节点 1 Y 应为覆盖后的 30').toBe(30);

  // ===== 阶段 6：Player A 返回首页 → 4 人自定义房间用 map ID 开局 =====
  await playerA.page.getByRole('button', { name: '返回首页', exact: true }).click();
  await playerA.page.waitForTimeout(500);
  // 所有玩家进入 Matchmaking 视图（useMatchFoundTrigger 需挂载）
  await Promise.all(players.map((p) => enterMatchmakingScreen(p.page)));

  const queueName = `community-e2e-${Date.now()}`;
  const queueId = await createCustomQueue(playerA.page, queueName, mapId!, 3, 4);
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
    expect(states[i]!.players, `玩家 ${i} 的 players 应有 4 人`).toHaveLength(4);
  }

  // ===== 阶段 7：断线 B/C/D → A 获胜（兜底超时触发 gameOver） =====
  await disconnectWS(playerB.page);
  await disconnectWS(playerC.page);
  await disconnectWS(playerD.page);

  await waitForGameOver(playerA.page, 30_000);

  const finalState = await getGameState(playerA.page);
  expect(finalState, 'Player A 的 finalState 不应为 null').not.toBeNull();
  expect(finalState!.phase, 'Player A 的 phase 应为 gameOver').toBe('gameOver');
});
