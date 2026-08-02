import { gameTest as test, expect } from './fixtures';
import {
  createTestGame,
  joinTestGame,
  requestGameSync,
  type E2ETestGameRequest,
  type E2ETestCard,
} from './helpers/game';

/**
 * 注入式测试基座自验证测试
 *
 * 验证流程：
 *   1. 用 gameTest fixture 获取 3 个已登录玩家
 *   2. 构造 E2ETestGameRequest：3 玩家各自指定不同起手手牌
 *   3. 调用 createTestGame 创建注入对局
 *   4. 3 玩家并发 joinTestGame + requestGameSync
 *   5. 读取各玩家本地手牌，断言与请求体指定一致（defId + uid 集合）
 *
 * 不实现具体游戏动作，仅验证注入基座生效。
 */

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  test.setTimeout(120_000);
});

test('注入式基座 — API 创建特定手牌对局后各玩家本地手牌一致', async ({ players }) => {
  // 1. 构造 3 张不同类型的卡牌（defId 来自 backend/internal/game/cards.go 真实定义）
  const strikeCard = (uid: string): E2ETestCard => ({
    uid,
    defId: 'strike_thermal',
    name: '热核打击',
    type: 'strike',
    energy: 4,
    description: '打击无特殊效果，可被掩体星环防御',
    level: 1,
    speed: 1,
  });
  const facilityCard = (uid: string): E2ETestCard => ({
    uid,
    defId: 'facility_solar_array',
    name: '太阳能阵列',
    type: 'facility',
    energy: 2,
    description: '每回合获得 1 点能量产出',
    energyPerTurn: 1,
  });
  const broadcastCard = (uid: string): E2ETestCard => ({
    uid,
    defId: 'broadcast_star_cooperation',
    name: '恒星广播',
    type: 'broadcast',
    energy: 0,
    description: '向距离 1 以内的星系发送广播信号',
    subtype: 'cooperation',
    range: 1,
  });

  // 2. 构造注入式 GameState
  const colors = ['red', 'blue', 'green'];
  const expectedHands: E2ETestCard[][] = [
    [strikeCard('e2e_card_1'), strikeCard('e2e_card_2'), strikeCard('e2e_card_3'), strikeCard('e2e_card_4')],
    [facilityCard('e2e_card_5'), facilityCard('e2e_card_6'), facilityCard('e2e_card_7'), facilityCard('e2e_card_8')],
    [broadcastCard('e2e_card_9'), broadcastCard('e2e_card_10'), broadcastCard('e2e_card_11'), broadcastCard('e2e_card_12')],
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
    },
  };

  // 3. 调用 createTestGame 创建注入对局（用 players[0] 的 page 发 HTTP 请求）
  const result = await createTestGame(players[0].page, request);
  expect(result.success).toBe(true);
  expect(result.roomId).toBeTruthy();

  // 4. 3 玩家并发 joinTestGame + requestGameSync
  // requestGameSync 直接从 WS 捕获 game:fullSync payload 并返回 ViewState，
  // 不依赖前端 gameStore 是否已初始化（注入式测试不经过 matchmaking 流程，UI 仍在主菜单）。
  const viewStates = await Promise.all(
    players.map(async (p) => {
      await joinTestGame(p.page, result.roomId);
      return requestGameSync(p.page);
    }),
  );

  // 5. 从各玩家的 ViewState 中提取本地玩家手牌并验证
  for (let i = 0; i < viewStates.length; i++) {
    const viewState = viewStates[i];
    const localPlayer = viewState.players.find((p) => p.id === viewState.localPlayerId);
    expect(localPlayer, `player[${i}] 应在 fullSync 中找到本地玩家`).toBeTruthy();

    const actual = localPlayer?.hand ?? [];
    const expected = expectedHands[i];

    // 手牌数量一致
    expect(actual.length, `player[${i}] 手牌数量应为 ${expected.length}`).toBe(expected.length);

    // defId 集合一致（排序后比较）
    const actualDefIds = actual.map((c) => c.defId).sort();
    const expectedDefIds = expected.map((c) => c.defId).sort();
    expect(actualDefIds, `player[${i}] 手牌 defId 集合应与注入一致`).toEqual(expectedDefIds);

    // uid 集合一致（验证卡牌实例未被重新生成）
    const actualUids = actual.map((c) => c.uid).sort();
    const expectedUids = expected.map((c) => c.uid).sort();
    expect(actualUids, `player[${i}] 手牌 uid 集合应与注入一致`).toEqual(expectedUids);
  }
});
