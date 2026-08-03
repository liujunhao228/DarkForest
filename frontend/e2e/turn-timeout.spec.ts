import { gameTest as test, expect } from './fixtures';
import {
  createTestGame,
  joinTestGame,
  requestGameSync,
  waitForGameSyncBroadcast,
  type E2ETestGameRequest,
  type E2ETestCard,
} from './helpers/game';

/**
 * 回合空闲超时淘汰 E2E 测试
 *
 * 验证流程：
 *   1. 用 gameTest fixture 获取 3 个已登录玩家
 *   2. 构造注入式 GameState，ModeRules.TurnTimeoutSeconds = 5（5 秒超时，加速测试）
 *   3. 调用 createTestGame 创建注入对局（后端 SetGameState 启动 turnTimer）
 *   4. 3 玩家并发 joinTestGame + requestGameSync，验证初始状态
 *   5. 当前玩家（A）不做任何操作，等待 turnTimer 触发
 *   6. A 和 B 都应收到 game:fullSync 广播，显示 A 被淘汰、回合切换到下一玩家
 *
 * 关键设计决策：
 *   - 使用 ModeRules.TurnTimeoutSeconds 而非全局 E2E_TURN_TIMEOUT_MS 环境变量，
 *     避免污染其他 E2E 测试（其他测试的玩家可能不会在 3s 内操作）。
 *   - 使用 3 玩家而非 2 玩家：2 玩家时淘汰 A 后游戏立即结束（GameOver），
 *     无法验证"回合切换到 B"；3 玩家时淘汰 A 后游戏继续，B 成为当前玩家。
 *   - ModeRules 注入完整的 classic 预设值 + turnTimeoutSeconds=5，
 *     避免零值 ModeRules 覆盖 classic 默认规则导致游戏逻辑异常。
 */

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  test.setTimeout(60_000);
});

test('回合空闲超时 — 5s 内无操作，当前玩家被淘汰并推进回合', async ({ players }) => {
  // ===== 1. 构造注入式 GameState =====

  // ModeRules：完整的 classic 预设 + turnTimeoutSeconds=5（加速测试）
  // 未设置全部字段会导致 StateRules 返回零值 ModeRules，覆盖 classic 默认规则，破坏游戏逻辑。
  const classicModeRules = {
    lightspeedUsage: 'oneTime',
    lightspeedCombinedActionCost: 10,
    lightspeedDeployCost: 0,
    lightspeedJumpCost: 0,
    lightspeedCarryCap: 0,
    lightspeedMessageEnabled: false,
    relicDistributionEnabled: false,
    strikeOrigin: 'direct',
    strikeMissBehavior: 'discard',
    strikeCanDestroyRelic: false,
    turnTimeoutSeconds: 5,
  };

  // 3 张简单卡牌（defId 来自 backend/internal/game/cards.go 真实定义）
  const makeCard = (uid: string): E2ETestCard => ({
    uid,
    defId: 'facility_solar_array',
    name: '太阳能阵列',
    type: 'facility',
    energy: 2,
    description: '每回合获得 1 点能量产出',
    energyPerTurn: 1,
  });

  const colors = ['red', 'blue', 'green'];
  const expectedHands: E2ETestCard[][] = [
    [makeCard('e2e_card_1'), makeCard('e2e_card_2')],
    [makeCard('e2e_card_3'), makeCard('e2e_card_4')],
    [makeCard('e2e_card_5'), makeCard('e2e_card_6')],
  ];

  const request: E2ETestGameRequest = {
    gameState: {
      phase: 'playing',
      totalTurn: 1,
      playerCount: 3,
      players: players.map((p, i) => ({
        id: p.playerId,
        name: p.user.displayName,
        color: colors[i],
        position: i + 1,
        energy: 10,
        hand: expectedHands[i],
        faceUpCards: [],
        eliminated: false,
        eliminatedTurn: 0,
        destroyedStarCount: 0,
        broadcastHistory: [],
        broadcastSuccessCount: 0,
        strikeCount: 0,
        penaltyTurn: false,
      })),
      currentPlayerIndex: 0,
      currentPlayerId: players[0].playerId,
      localPlayerId: '',
      drawPile: [],
      discardPile: [],
      flyingStrikes: [],
      turnPhase: 'actionPhase',
      pendingAction: null,
      logs: [],
      destroyedStars: [],
      leftovers: [],
      starEffects: [],
      winner: null,
      isProcessing: false,
      gameMode: 'classic',
      modeRules: classicModeRules,
    },
  };

  // ===== 2. 创建注入对局（后端 SetGameState 启动 turnTimer，5s 倒计时开始）=====

  const result = await createTestGame(players[0].page, request);
  expect(result.success).toBe(true);
  expect(result.roomId).toBeTruthy();

  // ===== 3. 3 玩家并发 joinTestGame + requestGameSync =====

  const initialStates = await Promise.all(
    players.map(async (p) => {
      await joinTestGame(p.page, result.roomId);
      return requestGameSync(p.page);
    }),
  );

  // ===== 4. 验证初始状态 =====

  const playerA = players[0]; // 当前玩家
  const playerB = players[1];

  // A 视角：A 是当前玩家，未淘汰，有手牌
  const stateA0 = initialStates[0];
  expect(stateA0.currentPlayerId).toBe(playerA.playerId);
  const localA0 = stateA0.players.find((p) => p.id === playerA.playerId);
  expect(localA0, 'A 应在初始 fullSync 中找到自己').toBeTruthy();
  expect(localA0?.eliminated).toBe(false);
  expect(localA0?.handCount).toBe(2);

  // ===== 5. 设置广播监听器（在超时触发前）=====

  // A 和 B 并发等待 game:fullSync 广播（turnTimer 5s 后触发淘汰广播）
  const broadcastPromiseA = waitForGameSyncBroadcast(players[0].page, 15_000);
  const broadcastPromiseB = waitForGameSyncBroadcast(players[1].page, 15_000);

  // ===== 6. 等待超时广播 =====

  // turnTimer 在 SetGameState 时启动（5s 倒计时）。
  // 创建对局 + join + requestSync 约耗时 1-2s，此时距超时还有 ~3-4s。
  // waitForGameSyncBroadcast 会在广播到达时立即 resolve。
  const [stateA1, stateB1] = await Promise.all([broadcastPromiseA, broadcastPromiseB]);

  // ===== 7. 验证超时淘汰后的状态 =====

  // 7.1 A 被淘汰
  const localA1 = stateA1.players.find((p) => p.id === playerA.playerId);
  expect(localA1, 'A 应在超时广播中找到自己').toBeTruthy();
  expect(localA1?.eliminated, 'A 应已被淘汰').toBe(true);

  // 7.2 A 的手牌已清空（卡牌入弃牌堆）
  expect(localA1?.handCount, 'A 淘汰后手牌数应为 0').toBe(0);
  expect(localA1?.hand?.length ?? 0, 'A 淘汰后手牌应为空数组').toBe(0);

  // 7.3 回合已切换到下一存活玩家（B 或 C），不是 A
  expect(stateA1.currentPlayerId, '当前玩家不应仍是 A').not.toBe(playerA.playerId);
  expect(stateA1.phase, '游戏应仍在进行中（3 玩家淘汰 1 人后不结束）').toBe('playing');

  // 7.4 B 视角验证：B 看到 A 被淘汰，当前玩家是 B（或 C）
  const playerAFromB = stateB1.players.find((p) => p.id === playerA.playerId);
  expect(playerAFromB?.eliminated, 'B 应看到 A 已被淘汰').toBe(true);
  expect(stateB1.currentPlayerId, 'B 视角的当前玩家应与 A 视角一致').toBe(stateA1.currentPlayerId);

  // 7.5 当前玩家是 B 或 C（下一存活玩家）
  const nextPlayerId = stateA1.currentPlayerId;
  const isPlayerB = nextPlayerId === playerB.playerId;
  const isPlayerC = nextPlayerId === players[2].playerId;
  expect(isPlayerB || isPlayerC, '下一玩家应为 B 或 C').toBe(true);
});
