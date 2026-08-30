import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setPathValue, handleDeltaSync, isViewPathAllowed } from '@/store/onlineGameStore/sync';
import type { OnlineGameStore } from '@/store/onlineGameStore/types';
import type { ViewState, PlayerView, BroadcastStateView } from '@/lib/game/viewState';
import type { StarEffect } from '@/lib/game/types';

describe('setPathValue', () => {
  it('should set a simple top-level property', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'name', 'test');
    expect(obj.name).toBe('test');
  });

  it('should set a nested property', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'user.name', 'Alice');
    expect((obj.user as Record<string, unknown>).name).toBe('Alice');
  });

  it('should set deeply nested properties', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'a.b.c.d', 42);
    expect(((obj.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<string, unknown>).toHaveProperty('d', 42);
  });

  it('should set array index property', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'items[0].name', 'first');
    expect(Array.isArray(obj.items)).toBe(true);
    expect((obj.items as Record<string, unknown>[])[0].name).toBe('first');
  });

  it('should set array index with nested property', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'players[0].name', 'Alice');
    expect(Array.isArray(obj.players)).toBe(true);
    expect((obj.players as Record<string, unknown>[])[0].name).toBe('Alice');
  });

  it('should set multiple array items', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'items[0].id', 1);
    setPathValue(obj, 'items[1].id', 2);
    expect((obj.items as Record<string, unknown>[]).length).toBeGreaterThanOrEqual(2);
    expect((obj.items as Record<string, unknown>[])[0].id).toBe(1);
    expect((obj.items as Record<string, unknown>[])[1].id).toBe(2);
  });

  it('should overwrite existing values', () => {
    const obj: Record<string, unknown> = { name: 'old' };
    setPathValue(obj, 'name', 'new');
    expect(obj.name).toBe('new');
  });

  it('should preserve existing sibling properties', () => {
    const obj: Record<string, unknown> = { a: 1, b: 2 };
    setPathValue(obj, 'c', 3);
    expect(obj.a).toBe(1);
    expect(obj.b).toBe(2);
    expect(obj.c).toBe(3);
  });

  it('should handle null values', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'value', null);
    expect(obj.value).toBeNull();
  });

  it('should handle false boolean values', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'active', false);
    expect(obj.active).toBe(false);
  });

  // 回归测试：后端 DiffViewStates 对数组新增元素产出 'arrayName[N]' 形式的路径（无子字段），
  // setPathValue 必须正确写入数组元素而非创建字面量属性 'arrayName[N]'。
  // 复现场景：降维打击触发时 AddStarEffect 向 state.StarEffects 追加元素，
  // deltaSync 发送 {path: 'starEffects[0]', value: {...}, type: 'set'}，
  // 若 setPathValue 不处理此路径格式，starEffects 数组不会更新，降维锁定视觉状态丢失。
  it('should set a whole array element when path is pure array index (e.g., starEffects[0])', () => {
    const obj: Record<string, unknown> = { starEffects: [] };
    const effect = { systemId: 2, type: 'dimensionalLock', appliedAtTurn: 1, duration: -1 };
    setPathValue(obj, 'starEffects[0]', effect);
    expect(Array.isArray(obj.starEffects)).toBe(true);
    expect((obj.starEffects as unknown[]).length).toBe(1);
    expect((obj.starEffects as unknown[])[0]).toEqual(effect);
    // 不应创建字面量属性 'starEffects[0]'
    expect(obj['starEffects[0]']).toBeUndefined();
  });

  it('should append to existing array via starEffects[N] path', () => {
    const existing = { systemId: 1, type: 'annihilationStun', appliedAtTurn: 0, duration: 5 };
    const obj: Record<string, unknown> = { starEffects: [existing] };
    const newEffect = { systemId: 2, type: 'dimensionalLock', appliedAtTurn: 1, duration: -1 };
    setPathValue(obj, 'starEffects[1]', newEffect);
    expect((obj.starEffects as unknown[]).length).toBe(2);
    expect((obj.starEffects as unknown[])[0]).toBe(existing);
    expect((obj.starEffects as unknown[])[1]).toEqual(newEffect);
  });

  it('should set whole array element for logs[N] path', () => {
    const obj: Record<string, unknown> = { logs: [] };
    const log = { id: 'log-1', turn: 1, message: 'test', type: 'info' };
    setPathValue(obj, 'logs[0]', log);
    expect(Array.isArray(obj.logs)).toBe(true);
    expect((obj.logs as unknown[])[0]).toEqual(log);
    expect(obj['logs[0]']).toBeUndefined();
  });

  it('should set whole array element for destroyedStars[N] path (scalar array)', () => {
    const obj: Record<string, unknown> = { destroyedStars: [] };
    setPathValue(obj, 'destroyedStars[0]', 5);
    expect(Array.isArray(obj.destroyedStars)).toBe(true);
    expect((obj.destroyedStars as unknown[])[0]).toBe(5);
    expect(obj['destroyedStars[0]']).toBeUndefined();
  });
});

// ============================================================================
// 测试辅助：构造最小 ViewState
// ============================================================================

function createMockViewState(overrides: Partial<ViewState> = {}): ViewState {
  const players: PlayerView[] = [
    {
      id: 'p1',
      name: 'P1',
      color: 'red',
      position: 0,
      energy: 0,
      handCount: 0,
      faceUpCards: [],
      eliminated: false,
      eliminatedTurn: 0,
      destroyedStarCount: 0,
      strikeCount: 0,
      broadcastSuccessCount: 0,
      broadcastHistory: [],
    },
    {
      id: 'p2',
      name: 'P2',
      color: 'blue',
      position: 5,
      energy: 0,
      handCount: 0,
      faceUpCards: [],
      eliminated: false,
      eliminatedTurn: 0,
      destroyedStarCount: 0,
      strikeCount: 0,
      broadcastSuccessCount: 0,
      broadcastHistory: [],
    },
  ];
  return {
    kind: 'view',
    phase: 'playing',
    totalTurn: 1,
    playerCount: 2,
    players,
    currentPlayerIndex: 0,
    currentPlayerId: 'p1',
    localPlayerId: 'p1',
    flyingStrikes: [],
    broadcast: null,
    turnPhase: 'actionPhase',
    pendingAction: null,
    logs: [],
    destroyedStars: [],
    starEffects: [],
    winner: null,
    isProcessing: false,
    _viewMeta: { role: 'PLAYER', viewerId: 'p1', timestamp: 0 },
    ...overrides,
  };
}

// ============================================================================
// handleDeltaSync
// ============================================================================

describe('handleDeltaSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('(a) version 连续时正确应用 changes', () => {
    const initialGameState = createMockViewState({ totalTurn: 1 });
    const set = vi.fn();
    const requestSync = vi.fn();
    const get = vi.fn(() => ({
      gameVersion: 1,
      gameState: initialGameState,
      requestSync,
    } as unknown as OnlineGameStore));

    handleDeltaSync([{ path: 'totalTurn', value: 5, type: 'set' }], 2, set, get);

    expect(set).toHaveBeenCalledTimes(1);
    const setArg = set.mock.calls[0][0] as Partial<OnlineGameStore>;
    expect(setArg.gameVersion).toBe(2);
    expect((setArg.gameState as ViewState).totalTurn).toBe(5);
    // requestSync 不应被调用
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('(b) version 不连续时调用 requestSync 且不修改 gameState', () => {
    const initialGameState = createMockViewState({ totalTurn: 1 });
    const set = vi.fn();
    const requestSync = vi.fn();
    const get = vi.fn(() => ({
      gameVersion: 1,
      gameState: initialGameState,
      requestSync,
    } as unknown as OnlineGameStore));

    // version 5 !== gameVersion + 1 = 2
    handleDeltaSync([{ path: 'totalTurn', value: 5, type: 'set' }], 5, set, get);

    // 触发 setTimeout 中的 requestSync
    vi.advanceTimersByTime(100);

    expect(requestSync).toHaveBeenCalledTimes(1);
    // set 不应被调用，gameState 未被修改
    expect(set).not.toHaveBeenCalled();
    expect(initialGameState.totalTurn).toBe(1);
  });

  // 回归测试：降维打击触发时，后端 AddStarEffect 向 state.StarEffects 追加元素，
  // DiffViewStates 产出 {path: 'starEffects[0]', value: {...}, type: 'set'}，
  // deltaSync 必须正确写入 starEffects 数组，否则前端 isDimLocked 恒为 false。
  it('(降维) deltaSync 添加 starEffects[0] 后 gameState.starEffects 正确更新', () => {
    const initialGameState = createMockViewState({ starEffects: [] });
    const set = vi.fn();
    const requestSync = vi.fn();
    const get = vi.fn(() => ({
      gameVersion: 1,
      gameState: initialGameState,
      requestSync,
    } as unknown as OnlineGameStore));

    const dimLockEffect = {
      systemId: 2,
      type: 'dimensionalLock',
      appliedAtTurn: 1,
      duration: -1,
    };
    handleDeltaSync(
      [{ path: 'starEffects[0]', value: dimLockEffect, type: 'set' }],
      2,
      set,
      get
    );

    expect(set).toHaveBeenCalledTimes(1);
    const setArg = set.mock.calls[0][0] as Partial<OnlineGameStore>;
    const newState = setArg.gameState as ViewState;
    expect(newState.starEffects).toHaveLength(1);
    expect(newState.starEffects[0]).toEqual(dimLockEffect);
    // 不应创建字面量属性 'starEffects[0]'
    expect((newState as unknown as Record<string, unknown>)['starEffects[0]']).toBeUndefined();
  });

  // 回归测试：PurgeExpiredStarEffects 清理过期 annihilationStun 后，
  // DiffViewStates 产出 delete change，deltaSync 必须正确缩短数组。
  it('(delete) deltaSync 删除 starEffects[1] 后数组长度减少', () => {
    const effect1: StarEffect = { systemId: 1, type: 'dimensionalLock', appliedAtTurn: 0, duration: -1 };
    const effect2: StarEffect = { systemId: 2, type: 'annihilationStun', appliedAtTurn: 0, duration: 5 };
    const initialGameState = createMockViewState({
      starEffects: [effect1, effect2],
    });
    const set = vi.fn();
    const requestSync = vi.fn();
    const get = vi.fn(() => ({
      gameVersion: 1,
      gameState: initialGameState,
      requestSync,
    } as unknown as OnlineGameStore));

    // 后端 diff 产出：set starEffects[0]=effect1（shift 后位置不变），delete starEffects[1]
    handleDeltaSync(
      [
        { path: 'starEffects[0]', value: effect1, type: 'set' },
        { path: 'starEffects[1]', value: undefined, type: 'delete' },
      ],
      2,
      set,
      get
    );

    const setArg = set.mock.calls[0][0] as Partial<OnlineGameStore>;
    const newState = setArg.gameState as ViewState;
    expect(newState.starEffects).toHaveLength(1);
    expect(newState.starEffects[0]).toEqual(effect1);
  });

  // 回归测试：多个 delete 按降序处理，避免 splice 索引偏移
  it('(delete) 多个 delete 同数组时按降序处理', () => {
    const e1: StarEffect = { systemId: 1, type: 'dimensionalLock', appliedAtTurn: 0, duration: -1 };
    const e2: StarEffect = { systemId: 2, type: 'annihilationStun', appliedAtTurn: 0, duration: 5 };
    const e3: StarEffect = { systemId: 3, type: 'annihilationStun', appliedAtTurn: 0, duration: 5 };
    const initialGameState = createMockViewState({
      starEffects: [e1, e2, e3],
    });
    const set = vi.fn();
    const requestSync = vi.fn();
    const get = vi.fn(() => ({
      gameVersion: 1,
      gameState: initialGameState,
      requestSync,
    } as unknown as OnlineGameStore));

    // 后端 diff：保留 e1，删除 e2 和 e3
    // shift 后：starEffects[0]=e1（无变化），delete starEffects[1]，delete starEffects[2]
    handleDeltaSync(
      [
        { path: 'starEffects[1]', value: undefined, type: 'delete' },
        { path: 'starEffects[2]', value: undefined, type: 'delete' },
      ],
      2,
      set,
      get
    );

    const setArg = set.mock.calls[0][0] as Partial<OnlineGameStore>;
    const newState = setArg.gameState as ViewState;
    expect(newState.starEffects).toHaveLength(1);
    expect(newState.starEffects[0]).toEqual(e1);
  });

  // 回归测试：delete 对象属性（如 broadcast nil→非 nil → nil）
  it('(delete) deltaSync 删除 broadcast 对象属性时置为 null', () => {
    const initialGameState = createMockViewState({
      broadcast: {
        broadcasterId: 'p1',
        cardUid: 'card-1',
        targetSystem: 1,
        range: 1,
        responses: [],
        phase: 'reveal',
      },
    });
    const set = vi.fn();
    const requestSync = vi.fn();
    const get = vi.fn(() => ({
      gameVersion: 1,
      gameState: initialGameState,
      requestSync,
    } as unknown as OnlineGameStore));

    handleDeltaSync(
      [{ path: 'broadcast', value: undefined, type: 'delete' }],
      2,
      set,
      get
    );

    const setArg = set.mock.calls[0][0] as Partial<OnlineGameStore>;
    const newState = setArg.gameState as ViewState;
    expect(newState.broadcast).toBeNull();
  });
});

// ============================================================================
// isViewPathAllowed
// ============================================================================

describe('isViewPathAllowed', () => {
  // 后端 DiffViewStates 产出方括号格式（players[N].field），
  // isViewPathAllowed 内部归一化为点号格式后匹配正则。
  it('(c) 对手 position 路径（方括号格式）返回 false', () => {
    // players[1].id ('p2') !== localPlayerId ('p1')
    const state = createMockViewState();
    const result = isViewPathAllowed('players[1].position', state, false);
    expect(result).toBe(false);
  });

  it('(c2) 对手 position 路径（点号格式）也返回 false', () => {
    const state = createMockViewState();
    const result = isViewPathAllowed('players.1.position', state, false);
    expect(result).toBe(false);
  });

  it('(d) 自己手牌路径（方括号格式）返回 true', () => {
    // players[0].id ('p1') === localPlayerId ('p1')
    const state = createMockViewState();
    const result = isViewPathAllowed('players[0].hand', state, false);
    expect(result).toBe(true);
  });

  it('(e) 未揭示的 broadcast.card 在非广播者时返回 false', () => {
    const broadcast: BroadcastStateView = {
      broadcasterId: 'p2', // 非广播者（localPlayerId = 'p1'）
      cardUid: 'uid-1',
      targetSystem: 0,
      range: 1,
      responses: [],
      phase: 'select', // 非揭示阶段
    };
    const state = createMockViewState({ broadcast });
    const result = isViewPathAllowed('broadcast.card', state, false);
    expect(result).toBe(false);
  });
});
