import type { Page } from '@playwright/test';

/**
 * 游戏流程 E2E helpers
 *
 * 封装 UI 操作与 window.__e2e WS 注入，降低 spec 重复。
 * 选择器依据 QuickMatchmaking.tsx / MainMenu.tsx：
 *   - 主菜单「快速匹配」按钮：ONLINE_CARD.quickMatchBtn = '快速匹配'
 *   - 人数按钮：'{count}人'（如 '3人'）
 *   - 开始匹配按钮：'开始匹配 {count} 人局'
 */

// ===== window.__e2e 类型（e2e 目录独立声明，不依赖 src/types） =====

/**
 * 卡牌视图。字段对齐 backend/internal/game/view_state.go CreateViewState 输出，
 * 与 frontend/src/lib/game/viewState.ts 的 Card / PlayerView 保持形态一致。
 * 可选字段仅在特定卡牌类型或揭示阶段存在。
 */
export interface E2ECard {
  uid: string;
  defId: string;
  name: string;
  type: string;
  energy: number;
  description: string;
  range?: number;
  level?: number;
  speed?: number;
  effect?: string;
  subtype?: string;
  protectionLevel?: number;
  energyPerTurn?: number;
  ability?: string;
}

/**
 * 玩家视图。对齐 frontend/src/lib/game/viewState.ts PlayerView。
 * position 对本地玩家为真实值，对对手为 -1（黑暗森林核心机制）。
 * hand 仅本地玩家可见，对手为 undefined。
 */
export interface E2EPlayer {
  id: string;
  name: string;
  color: string;
  position: number;
  energy: number;
  handCount: number;
  hand?: E2ECard[];
  faceUpCards: E2ECard[];
  eliminated: boolean;
  penaltyTurn?: boolean;
}

/**
 * 待处理动作。对齐 backend pendingAction 形态。
 * 不同 type 携带不同字段集合，使用可选字段联合表达，调用方按 type 自行窄化。
 */
export interface E2EPendingAction {
  type: string;
  strikeUid?: string;
  strikeUids?: string[];
  targetSystem?: number;
  targetPlayerIds?: string[];
  validMoves?: number[];
  validTargets?: number[];
}

/**
 * 飞行打击视图。对齐 frontend/src/lib/game/viewState.ts FlyingStrikeView。
 * 隐逐跳模式下非拥有者的 position 为 -1，改由 distance 表达距离。
 */
export interface E2EFlyingStrike {
  uid: string;
  defId: string;
  ownerId: string;
  position: number;
  targetSystem: number;
  level: number;
  speed: number;
  remainingMoves: number;
  arrived: boolean;
  delayed?: boolean;
  retargetedThisTurn?: boolean;
  distance?: number;
}

export interface E2EGameState {
  phase: string;
  totalTurn: number;
  currentPlayerId: string;
  currentPlayerIndex: number;
  localPlayerId: string;
  turnPhase: string;
  pendingAction: E2EPendingAction | null;
  flyingStrikes: E2EFlyingStrike[];
  winner: string | null;
  players: E2EPlayer[];
}

interface E2EGameStoreState {
  gameState: E2EGameState | null;
  gameVersion: number;
  sendAction: (action: string, payload?: Record<string, unknown>) => void;
  disconnect: () => void;
}

interface E2EWSClient {
  send: (event: string, payload?: unknown) => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
  off: (event: string, handler: (payload: unknown) => void) => void;
  isConnected: () => boolean;
}

interface E2EWindow extends Window {
  __e2e?: {
    wsClient: E2EWSClient;
    gameStore: { getState: () => E2EGameStoreState };
  };
}

// ===== Helpers =====

/**
 * 通过 WS 发送 player:login 并等待服务端确认。
 *
 * 页面加载后 authStore 已有 token（localStorage 注入），WS 连接已认证，
 * 但 onlineStore.isLoggedIn 初始为 false，需手动触发 player:login。
 * 登录成功后 onlineStore.isLoggedIn 变为 true，主菜单「快速匹配」按钮可直接进入匹配。
 */
export async function loginOnlinePlayer(page: Page, displayName: string): Promise<void> {
  // 等待 window.__e2e 注入完成（main.tsx 同步注入，页面加载后即有）
  await page.waitForFunction(() => !!(window as unknown as E2EWindow).__e2e?.wsClient);

  // 等待 WS 连接建立（MainMenu useEffect 触发 connect）
  await page.waitForFunction(
    () => (window as unknown as E2EWindow).__e2e?.wsClient?.isConnected() === true,
    { timeout: 15_000 },
  );

  // 发送 player:login 并等待 player:loginSuccess / player:loginError
  await page.evaluate((name) => {
    return new Promise<void>((resolve, reject) => {
      const ws = (window as unknown as E2EWindow).__e2e!.wsClient;
      const timeout = setTimeout(() => {
        ws.off('player:loginSuccess', onSuccess);
        ws.off('player:loginError', onError);
        reject(new Error('player:login 超时（10s）'));
      }, 10_000);

      const onSuccess = () => {
        clearTimeout(timeout);
        ws.off('player:loginSuccess', onSuccess);
        ws.off('player:loginError', onError);
        resolve();
      };
      const onError = (err: unknown) => {
        clearTimeout(timeout);
        ws.off('player:loginSuccess', onSuccess);
        ws.off('player:loginError', onError);
        const msg = (err as { message?: string })?.message || 'player:login 失败';
        reject(new Error(msg));
      };
      ws.on('player:loginSuccess', onSuccess);
      ws.on('player:loginError', onError);
      ws.send('player:login', { displayName: name });
    });
  }, displayName);
}

/**
 * UI 操作：点击「快速匹配」→ 选择 N 人 → 点击「开始匹配 N 人局」
 *
 * 前置条件：玩家已通过 loginOnlinePlayer 登录（onlineStore.isLoggedIn = true），
 * 此时点击「快速匹配」直接进入 QuickMatchmaking 视图。
 */
export async function startQuickMatch(page: Page, preferredCount: number): Promise<void> {
  // 等待主菜单「快速匹配」按钮可见且可用
  const quickMatchBtn = page.getByRole('button', { name: '快速匹配', exact: true });
  await quickMatchBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await quickMatchBtn.click();

  // 等待 QuickMatchmaking 视图加载完成（framer-motion 入场动画初始 opacity:0）
  // 先等「选择对战人数」标题可见，确保视图已渲染再查找按钮
  await page.getByText('选择对战人数', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });

  // 选择人数
  const countBtn = page.getByRole('button', { name: `${preferredCount}人`, exact: true });
  await countBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await countBtn.click();

  // 点击「开始匹配 N 人局」— 使用子串匹配避免空白字符差异
  const startBtn = page.getByRole('button', { name: `开始匹配 ${preferredCount}` });
  await startBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await startBtn.click();
}

/** 轮询 gameStore.getState().gameState 直到非 null（游戏已开始） */
export async function waitForGameStart(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState != null,
    { timeout: timeoutMs },
  );
}

/** 从 gameStore 读取 gameState */
export async function getGameState<T = E2EGameState>(page: Page): Promise<T | null> {
  return page.evaluate(() => {
    return (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState as T | null ?? null;
  });
}

/** 从 gameStore 读取 gameVersion */
export async function getGameVersion(page: Page): Promise<number> {
  return page.evaluate(() => {
    return (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameVersion ?? 0;
  });
}

/**
 * 通过 gameStore.sendAction 发送任意动作。
 * 用于 determinism.spec.ts 及后续完整对局测试统一调度 playCard / endTurn / strikeMove 等。
 */
export async function sendAction(
  page: Page,
  action: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ action, payload }) => {
      (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.sendAction(action, payload);
    },
    { action, payload: payload ?? {} },
  );
}

/** 通过 WS 注入 endTurn 动作（保留向后兼容 game.spec.ts；内部转调 sendAction） */
export async function sendEndTurn(page: Page): Promise<void> {
  await sendAction(page, 'endTurn', { discardCards: [], publicDiscard: false });
}

/** 断开 WS 连接（模拟玩家掉线） */
export async function disconnectWS(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.disconnect();
  });
}

/** 轮询 gameState 直到 phase === 'gameOver' */
export async function waitForGameOver(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const state = (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState;
      return state?.phase === 'gameOver';
    },
    { timeout: timeoutMs },
  );
}

// ===== 确定性测试专用 helper =====

/**
 * 读取本地玩家视图。按 state.localPlayerId 从 state.players 查找。
 * 找不到（未开局或异常）返回 null。
 */
export async function getLocalPlayer(page: Page): Promise<E2EPlayer | null> {
  return page.evaluate(() => {
    const state = (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState;
    if (!state) return null;
    return state.players.find((p) => p.id === state.localPlayerId) ?? null;
  });
}

/**
 * 读取本地玩家手牌。调用方通常配合 expect(hand.length).toBe(4) 等断言验证确定性。
 * 未开局或本地玩家无手牌时返回 []。
 */
export async function getLocalHand(page: Page): Promise<E2ECard[]> {
  const player = await getLocalPlayer(page);
  return player?.hand ?? [];
}

/** 读取当前 pendingAction（null 表示无待处理动作）。 */
export async function getPendingAction(page: Page): Promise<E2EPendingAction | null> {
  return page.evaluate(() => {
    return (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState?.pendingAction ?? null;
  });
}

/** 读取当前 turnPhase（空字符串表示未开局）。 */
export async function getTurnPhase(page: Page): Promise<string> {
  return page.evaluate(() => {
    return (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState?.turnPhase ?? '';
  });
}

/** 读取飞行打击列表（未开局返回 []）。 */
export async function getFlyingStrikes(page: Page): Promise<E2EFlyingStrike[]> {
  return page.evaluate(() => {
    return (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState?.flyingStrikes ?? [];
  });
}

/**
 * 轮询 gameState 直到 turnPhase === phase。
 * 用于完整对局测试中按阶段推进：turnBegin / draw / main / endTurn 等。
 */
export async function waitForTurnPhase(
  page: Page,
  phase: string,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const state = (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState;
      return state?.turnPhase === target;
    },
    phase,
    { timeout: timeoutMs },
  );
}

/**
 * 轮询 gameState 直到 pendingAction?.type === type。
 * 用于广播、打击移动等需要服务端推送待处理动作的场景。
 */
export async function waitForPendingAction(
  page: Page,
  type: string,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const state = (window as unknown as E2EWindow).__e2e?.gameStore?.getState()?.gameState;
      return state?.pendingAction?.type === target;
    },
    type,
    { timeout: timeoutMs },
  );
}

// ===== 测试游戏注入 API 类型 =====

/**
 * 完整卡牌形态。对齐 backend/internal/game/types.go Card 结构。
 * 用于构造注入式 GameState 请求体中的卡牌实例。
 */
export interface E2ETestCard {
  uid: string;
  defId: string;
  name: string;
  type: string;
  energy: number;
  description: string;
  image?: string;
  subtype?: string;
  range?: number;
  level?: number;
  speed?: number;
  effect?: string;
  protectionLevel?: number;
  energyPerTurn?: number;
  ability?: string;
}

/**
 * 完整玩家形态。对齐 backend/internal/game/types.go Player 结构。
 * 用于构造注入式 GameState 请求体中的玩家实例。
 */
export interface E2ETestPlayer {
  id: string;
  name: string;
  color: string;
  position: number;
  energy: number;
  hand: E2ETestCard[];
  faceUpCards: E2ETestCard[];
  eliminated: boolean;
  eliminatedTurn: number;
  destroyedStarCount: number;
  broadcastHistory: Array<{ systemId: number; turn: number }>;
  broadcastSuccessCount: number;
  strikeCount: number;
  penaltyTurn: boolean;
}

/**
 * ModeRules 测试注入形态。对齐 backend/internal/game/mode_rules.go ModeRules 结构。
 * 枚举字段（lightspeedUsage/strikeOrigin/strikeMissBehavior）使用前端约定的字符串值，
 * 由后端 UnmarshalJSON 转换为 int 枚举。
 * 所有字段可选：未提供时后端按 GameMode 预设回退（classicModeRules/relicsModeRules）。
 */
export interface E2ETestModeRules {
  lightspeedUsage?: string;
  lightspeedCombinedActionCost?: number;
  lightspeedDeployCost?: number;
  lightspeedJumpCost?: number;
  lightspeedCarryCap?: number;
  lightspeedMessageEnabled?: boolean;
  relicDistributionEnabled?: boolean;
  strikeOrigin?: string;
  strikeMissBehavior?: string;
  strikeCanDestroyRelic?: boolean;
  /** 当前玩家回合的空闲超时秒数；0/undefined = 使用服务端默认值（3min） */
  turnTimeoutSeconds?: number;
}

/**
 * 完整 GameState 请求体。对齐 backend/internal/game/types.go GameState 结构。
 * 测试构造此对象传入 createTestGame，后端直接注入为对局初始状态。
 */
export interface E2ETestGameRequest {
  gameState: {
    phase: string;
    totalTurn: number;
    playerCount: number;
    players: E2ETestPlayer[];
    currentPlayerIndex: number;
    currentPlayerId: string;
    localPlayerId: string;
    drawPile: E2ETestCard[];
    discardPile: E2ETestCard[];
    flyingStrikes: unknown[];
    turnPhase: string;
    pendingAction: unknown | null;
    logs: unknown[];
    destroyedStars: number[];
    leftovers: unknown[];
    starEffects: unknown[];
    winner: string | null;
    isProcessing: boolean;
    version?: number | null;
    gameMode?: string;
    /** 自定义房间规则覆盖；nil=回退 GameMode 预设 */
    modeRules?: E2ETestModeRules;
  };
}

export interface E2ETestGameResponse {
  success: boolean;
  roomId: string;
  gameId: string;
}

// ===== 测试游戏注入 API helpers =====

/**
 * 从 process.env.E2E_ADMIN_TOKEN 读取 admin token。
 * globalSetup 在启动时将 admin token 写入此环境变量。
 */
export function getAdminToken(): string {
  const token = process.env.E2E_ADMIN_TOKEN;
  if (!token) {
    throw new Error('E2E_ADMIN_TOKEN 未设置（globalSetup 应写入此变量）');
  }
  return token;
}

/**
 * 调用 POST /api/test/game 创建注入式对局。
 * 需要后端设置 E2E_TEST_API=1 + admin token 鉴权。
 * 返回 { roomId, gameId } 供后续 joinTestGame 使用。
 */
export async function createTestGame(
  page: Page,
  request: E2ETestGameRequest,
): Promise<E2ETestGameResponse> {
  const token = getAdminToken();
  const response = await page.request.post('/api/test/game', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: request,
  });
  if (!response.ok()) {
    const text = await response.text().catch(() => '');
    throw new Error(`createTestGame 失败 [${response.status()}]: ${text}`);
  }
  return (await response.json()) as E2ETestGameResponse;
}

/**
 * 通过 WS 发送 room:join 加入测试房间，等待 room:joined 确认。
 * 前置条件：玩家已通过 loginOnlinePlayer 登录。
 */
export async function joinTestGame(page: Page, roomId: string): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as E2EWindow).__e2e?.wsClient);
  await page.evaluate((rid) => {
    return new Promise<void>((resolve, reject) => {
      const ws = (window as unknown as E2EWindow).__e2e!.wsClient;
      const timeout = setTimeout(() => {
        ws.off('room:joined', onJoined);
        reject(new Error('room:join 超时（10s）'));
      }, 10_000);
      const onJoined = () => {
        clearTimeout(timeout);
        ws.off('room:joined', onJoined);
        resolve();
      };
      ws.on('room:joined', onJoined);
      ws.send('room:join', { roomId: rid });
    });
  }, roomId);
}

/**
 * 通过 WS 发送 game:requestSync，等待 game:fullSync 推送，返回 ViewState。
 * 前置条件：玩家已通过 joinTestGame 加入房间。
 *
 * 直接从 WS 事件捕获 payload 并提取 state 字段（ViewState），不依赖 gameStore 是否已初始化。
 * 注入式测试场景下，前端 UI 可能未进入游戏视图（gameStore 未 connect），
 * 但后端仍会通过 WS 推送 game:fullSync，本 helper 捕获该推送并返回 ViewState。
 *
 * payload 形态：{ state: ViewState, version: number, stateHash?: string }
 * 返回 payload.state（已是 ViewState，包含 localPlayerId 和本地玩家手牌）。
 */
export async function requestGameSync(
  page: Page,
  timeoutMs = 15_000,
): Promise<E2EGameState> {
  const payload = await page.evaluate((timeout) => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = (window as unknown as E2EWindow).__e2e!.wsClient;
      const timer = setTimeout(() => {
        ws.off('game:fullSync', onSync);
        reject(new Error('game:requestSync 超时'));
      }, timeout);
      const onSync = (payload: unknown) => {
        clearTimeout(timer);
        ws.off('game:fullSync', onSync);
        resolve(payload as Record<string, unknown>);
      };
      ws.on('game:fullSync', onSync);
      ws.send('game:requestSync');
    });
  }, timeoutMs);
  return payload.state as E2EGameState;
}

/**
 * 等待下一次服务端主动推送的 game:fullSync 广播（非 requestSync 触发）。
 *
 * 用于注入式测试中监听服务端状态变更广播（如回合超时淘汰、其他玩家动作等）。
 * 与 requestGameSync 不同：不发送 game:requestSync，仅被动等待广播。
 *
 * 前置条件：玩家已通过 joinTestGame 加入房间，WS 连接存活。
 * 返回广播 payload 中的 state（ViewState）。
 */
export async function waitForGameSyncBroadcast(
  page: Page,
  timeoutMs = 15_000,
): Promise<E2EGameState> {
  const payload = await page.evaluate((timeout) => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = (window as unknown as E2EWindow).__e2e!.wsClient;
      const timer = setTimeout(() => {
        ws.off('game:fullSync', onSync);
        reject(new Error('等待 game:fullSync 广播超时'));
      }, timeout);
      const onSync = (payload: unknown) => {
        clearTimeout(timer);
        ws.off('game:fullSync', onSync);
        resolve(payload as Record<string, unknown>);
      };
      ws.on('game:fullSync', onSync);
    });
  }, timeoutMs);
  return payload.state as E2EGameState;
}
