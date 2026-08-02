import { gameTest as test, expect } from './fixtures';
import {
  startQuickMatch,
  waitForGameStart,
  getGameState,
  getGameVersion,
  sendEndTurn,
  disconnectWS,
  waitForGameOver,
} from './helpers/game';

/**
 * 游戏流程 E2E 测试
 *
 * 覆盖设计文档 Intent 列出的 3 个场景：
 *   1. 3 人快速匹配 → 游戏开始 → fullSync 验证
 *   2. 完整对局 — 兜底超时产生赢家
 *   3. 回合轮转 — endTurn 驱动回合切换
 *
 * 每个测试使用 gameTest fixture 获取 3 个独立 BrowserContext 的已登录玩家。
 * 测试间不共享状态（test-scoped fixture），每个测试独立匹配开局。
 */

test.describe.configure({ mode: 'serial' });

// 游戏流程测试需要较长超时：fixture 创建 3 个用户 + WS 登录 + 匹配 + 游戏开始
test.beforeEach(async () => {
  test.setTimeout(120_000);
});

// ===== Test 1: 3 人快速匹配 → 游戏开始 → fullSync 验证 =====

test('1. 3 人快速匹配 → 游戏开始 → fullSync 验证', async ({ players }) => {
  // 并发启动 3 人匹配
  await Promise.all(players.map((p) => startQuickMatch(p.page, 3)));

  // 等待 3 个页面都收到 fullSync（gameState 非 null）
  await Promise.all(players.map((p) => waitForGameStart(p.page, 30_000)));

  // 验证每个页面的游戏状态
  const states = await Promise.all(players.map((p) => getGameState(p.page)));

  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    expect(state, `玩家 ${i} 的 gameState 不应为 null`).not.toBeNull();
    expect(state!.phase, `玩家 ${i} 的 phase 应为 playing`).toBe('playing');
    expect(state!.totalTurn, `玩家 ${i} 的 totalTurn 应为 1`).toBe(1);
    expect(state!.players, `玩家 ${i} 的 players 应有 3 人`).toHaveLength(3);
  }

  // 验证 3 个页面看到的 currentPlayerId 一致（同一回合）
  const currentPlayerIds = states.map((s) => s!.currentPlayerId);
  expect(currentPlayerIds[0]).toBe(currentPlayerIds[1]);
  expect(currentPlayerIds[1]).toBe(currentPlayerIds[2]);
});

// ===== Test 2: 完整对局 — 兜底超时产生赢家 =====

test('2. 完整对局 — 兜底超时产生赢家', async ({ players }) => {
  // 匹配开局
  await Promise.all(players.map((p) => startQuickMatch(p.page, 3)));
  await Promise.all(players.map((p) => waitForGameStart(p.page, 30_000)));

  // 前 2 个玩家断线，仅剩玩家 2
  await disconnectWS(players[0].page);
  await disconnectWS(players[1].page);

  // 等待 hub 处理断线
  await players[2].page.waitForTimeout(1000);

  // 等待兜底超时触发（E2E 环境配置 3 秒）
  await waitForGameOver(players[2].page, 20_000);

  // 验证游戏结束状态
  const state = await getGameState(players[2].page);
  expect(state, '玩家 2 的 gameState 不应为 null').not.toBeNull();
  expect(state!.phase, 'phase 应为 gameOver').toBe('gameOver');
  expect(state!.winner, '赢家应为玩家 2').toBe(players[2].playerId);
});

// ===== Test 3: 回合轮转 — endTurn 驱动回合切换 =====

test('3. 回合轮转 — endTurn 驱动回合切换', async ({ players }) => {
  // 匹配开局
  await Promise.all(players.map((p) => startQuickMatch(p.page, 3)));
  await Promise.all(players.map((p) => waitForGameStart(p.page, 30_000)));

  // 获取初始状态
  const initialState = await getGameState(players[0].page);
  expect(initialState, '初始 gameState 不应为 null').not.toBeNull();
  const initialTurn = initialState!.totalTurn;

  // 完成一整轮：3 个玩家依次 endTurn。
  // TotalTurn 是轮次计数器，仅在回绕（最后一个玩家 → 第一个玩家）时 +1。
  // 见 backend/internal/game/turn.go AdvanceToNextPlayer: if nextIndex <= CurrentPlayerIndex { TotalTurn++ }
  // 后端 EndTurn 用 GetCurrentPlayer(state) 取当前玩家，不校验动作发送者身份，
  // 故统一从 players[0].page 发送 endTurn 即可推进回合。
  const seenPlayerIds = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const stateBefore = await getGameState(players[0].page);
    const currentPlayerId = stateBefore!.currentPlayerId;
    seenPlayerIds.add(currentPlayerId);

    const versionBefore = await getGameVersion(players[0].page);
    await sendEndTurn(players[0].page);

    // 等待 gameVersion 递增（服务端已广播新状态）
    await players[0].page.waitForFunction(
      (expectedVersion) => {
        const e2e = (window as unknown as { __e2e?: { gameStore: { getState: () => { gameVersion: number } } } }).__e2e;
        return e2e?.gameStore?.getState()?.gameVersion != null &&
               e2e.gameStore.getState().gameVersion > expectedVersion;
      },
      versionBefore,
      { timeout: 10_000 },
    );

    // 每次 endTurn 后 currentPlayerId 都应改变
    const stateAfter = await getGameState(players[0].page);
    expect(stateAfter!.currentPlayerId, `第 ${i + 1} 次 endTurn 后 currentPlayerId 应改变`).not.toBe(currentPlayerId);
  }

  // 一整轮中 3 个玩家应各出场一次
  expect(seenPlayerIds.size, '一整轮应轮转 3 个不同玩家').toBe(3);

  // 回绕后 totalTurn 应递增
  const finalState = await getGameState(players[0].page);
  expect(finalState!.totalTurn, '完成一整轮后 totalTurn 应递增').toBe(initialTurn + 1);
});
