import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import {
  EMPTY_DESTROYED_STARS,
  EMPTY_EFFECTS,
  EMPTY_LOGS,
  EMPTY_PLAYERS,
  EMPTY_STRIKES,
  useBroadcast,
  useCurrentPlayerId,
  useCurrentPlayerIndex,
  useDestroyedStars,
  useFlyingStrikes,
  useGamePhase,
  useIsProcessing,
  useLastRelicDiscovery,
  useLocalPlayerId,
  useLogs,
  usePendingAction,
  usePlayers,
  useStarEffects,
  useTotalTurn,
  useTurnPhase,
  useWinner,
} from '@/store/onlineGameStore/selectors';
import type { BroadcastStateView, FlyingStrikeView, PlayerView, ViewState } from '@/lib/game/viewState';
import type { LogEntry, PendingAction, RelicDiscovery, StarEffect } from '@/lib/game/types';

// ============================================================================
// Mock 数据
// ============================================================================

const mockPlayers: PlayerView[] = [
  {
    id: 'p1',
    name: 'Alice',
    color: 'red',
    position: 0,
    energy: 5,
    handCount: 3,
    faceUpCards: [],
    eliminated: false,
    broadcastHistory: [],
  },
];

const mockStrikes: FlyingStrikeView[] = [
  {
    uid: 's1',
    defId: 'strike-1',
    ownerId: 'p1',
    position: 0,
    targetSystem: 1,
    level: 1,
    speed: 2,
    remainingMoves: 1,
    strikeName: 'Thermal',
    arrived: false,
  },
];

const mockLogs: LogEntry[] = [
  { id: 'log1', turn: 1, phase: 'actionPhase', message: 'Test log', type: 'info' },
];

const mockEffects: StarEffect[] = [
  { systemId: 1, type: 'annihilationStun', appliedAtTurn: 1, duration: 2 },
];

const mockDestroyedStars: number[] = [5, 6];

const mockPendingAction: PendingAction = {
  type: 'strikeMove',
  strikeUid: 's1',
  validMoves: [1, 2],
};

const mockBroadcast: BroadcastStateView = {
  broadcasterId: 'p1',
  cardUid: 'card-1',
  targetSystem: 1,
  range: 2,
  responses: [],
  phase: 'waiting',
};

const mockRelicDiscovery: RelicDiscovery = {
  playerId: 'p1',
  systemId: 1,
  isRelic: true,
  name: 'Ancient Relic',
  lore: 'A mysterious artifact from a forgotten era.',
  energy: 3,
  facilityNames: ['Observatory', 'Shield Generator'],
  message: 'You have inherited an ancient relic.',
};

function createMockViewState(overrides: Partial<ViewState> = {}): ViewState {
  return {
    kind: 'view',
    phase: 'playing',
    totalTurn: 3,
    playerCount: 2,
    players: mockPlayers,
    currentPlayerIndex: 0,
    currentPlayerId: 'p1',
    localPlayerId: 'p1',
    flyingStrikes: mockStrikes,
    broadcast: null,
    turnPhase: 'actionPhase',
    pendingAction: null,
    logs: mockLogs,
    destroyedStars: mockDestroyedStars,
    starEffects: mockEffects,
    winner: null,
    isProcessing: true,
    _viewMeta: { role: 'PLAYER', viewerId: 'p1', timestamp: 0 },
    ...overrides,
  };
}

// ============================================================================
// 测试
// ============================================================================

describe('onlineGameStore selectors', () => {
  beforeEach(() => {
    useOnlineGameStore.setState({ gameState: null });
  });

  afterEach(() => {
    cleanup();
  });

  // --------------------------------------------------------------------------
  // 测试组 1：gameState = null 时返回兜底值
  // --------------------------------------------------------------------------

  describe('gameState = null 时返回兜底值', () => {
    it('usePlayers 返回 EMPTY_PLAYERS（引用相等）', () => {
      const { result } = renderHook(() => usePlayers());
      expect(result.current).toBe(EMPTY_PLAYERS);
    });

    it('useFlyingStrikes 返回 EMPTY_STRIKES', () => {
      const { result } = renderHook(() => useFlyingStrikes());
      expect(result.current).toBe(EMPTY_STRIKES);
    });

    it('useLogs 返回 EMPTY_LOGS', () => {
      const { result } = renderHook(() => useLogs());
      expect(result.current).toBe(EMPTY_LOGS);
    });

    it('useStarEffects 返回 EMPTY_EFFECTS', () => {
      const { result } = renderHook(() => useStarEffects());
      expect(result.current).toBe(EMPTY_EFFECTS);
    });

    it('useDestroyedStars 返回 EMPTY_DESTROYED_STARS', () => {
      const { result } = renderHook(() => useDestroyedStars());
      expect(result.current).toBe(EMPTY_DESTROYED_STARS);
    });

    it('usePendingAction 返回 null', () => {
      const { result } = renderHook(() => usePendingAction());
      expect(result.current).toBeNull();
    });

    it('useIsProcessing 返回 false', () => {
      const { result } = renderHook(() => useIsProcessing());
      expect(result.current).toBe(false);
    });

    it('useTurnPhase 返回 undefined', () => {
      const { result } = renderHook(() => useTurnPhase());
      expect(result.current).toBeUndefined();
    });

    it('useGamePhase 返回 undefined', () => {
      const { result } = renderHook(() => useGamePhase());
      expect(result.current).toBeUndefined();
    });

    it('useTotalTurn 返回 undefined', () => {
      const { result } = renderHook(() => useTotalTurn());
      expect(result.current).toBeUndefined();
    });

    it('useCurrentPlayerIndex 返回 undefined', () => {
      const { result } = renderHook(() => useCurrentPlayerIndex());
      expect(result.current).toBeUndefined();
    });

    it('useCurrentPlayerId 返回 undefined', () => {
      const { result } = renderHook(() => useCurrentPlayerId());
      expect(result.current).toBeUndefined();
    });

    it('useLocalPlayerId 返回 undefined', () => {
      const { result } = renderHook(() => useLocalPlayerId());
      expect(result.current).toBeUndefined();
    });

    it('useWinner 返回 undefined', () => {
      const { result } = renderHook(() => useWinner());
      expect(result.current).toBeUndefined();
    });

    it('useBroadcast 返回 null', () => {
      const { result } = renderHook(() => useBroadcast());
      expect(result.current).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 2：gameState 非 null 时返回对应字段
  // --------------------------------------------------------------------------

  describe('gameState 非 null 时返回对应字段', () => {
    beforeEach(() => {
      act(() => {
        useOnlineGameStore.setState({ gameState: createMockViewState() });
      });
    });

    it('usePlayers 返回 mock players', () => {
      const { result } = renderHook(() => usePlayers());
      expect(result.current).toBe(mockPlayers);
    });

    it('useFlyingStrikes 返回 mock strikes', () => {
      const { result } = renderHook(() => useFlyingStrikes());
      expect(result.current).toBe(mockStrikes);
    });

    it('useLogs 返回 mock logs', () => {
      const { result } = renderHook(() => useLogs());
      expect(result.current).toBe(mockLogs);
    });

    it('useStarEffects 返回 mock effects', () => {
      const { result } = renderHook(() => useStarEffects());
      expect(result.current).toBe(mockEffects);
    });

    it('useDestroyedStars 返回 mock destroyedStars', () => {
      const { result } = renderHook(() => useDestroyedStars());
      expect(result.current).toBe(mockDestroyedStars);
    });

    it('useTurnPhase 返回 mock turnPhase', () => {
      const { result } = renderHook(() => useTurnPhase());
      expect(result.current).toBe('actionPhase');
    });

    it('useGamePhase 返回 mock phase', () => {
      const { result } = renderHook(() => useGamePhase());
      expect(result.current).toBe('playing');
    });

    it('useTotalTurn 返回 mock totalTurn', () => {
      const { result } = renderHook(() => useTotalTurn());
      expect(result.current).toBe(3);
    });

    it('useCurrentPlayerIndex 返回 mock currentPlayerIndex', () => {
      const { result } = renderHook(() => useCurrentPlayerIndex());
      expect(result.current).toBe(0);
    });

    it('useCurrentPlayerId 返回 mock currentPlayerId', () => {
      const { result } = renderHook(() => useCurrentPlayerId());
      expect(result.current).toBe('p1');
    });

    it('useLocalPlayerId 返回 mock localPlayerId', () => {
      const { result } = renderHook(() => useLocalPlayerId());
      expect(result.current).toBe('p1');
    });

    it('useWinner 返回 mock winner（null）', () => {
      const { result } = renderHook(() => useWinner());
      expect(result.current).toBeNull();
    });

    it('useWinner 返回非 null winner', () => {
      act(() => {
        useOnlineGameStore.setState({
          gameState: createMockViewState({ winner: 'p1' }),
        });
      });
      const { result } = renderHook(() => useWinner());
      expect(result.current).toBe('p1');
    });

    it('useIsProcessing 返回 mock isProcessing', () => {
      const { result } = renderHook(() => useIsProcessing());
      expect(result.current).toBe(true);
    });

    it('usePendingAction 返回 mock pendingAction', () => {
      act(() => {
        useOnlineGameStore.setState({
          gameState: createMockViewState({ pendingAction: mockPendingAction }),
        });
      });
      const { result } = renderHook(() => usePendingAction());
      expect(result.current).toBe(mockPendingAction);
    });

    it('useBroadcast 返回 mock broadcast', () => {
      act(() => {
        useOnlineGameStore.setState({
          gameState: createMockViewState({ broadcast: mockBroadcast }),
        });
      });
      const { result } = renderHook(() => useBroadcast());
      expect(result.current).toBe(mockBroadcast);
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 3：引用稳定性
  // --------------------------------------------------------------------------

  describe('引用稳定性', () => {
    it('同一 gameState 引用下 rerender，数组 selector 返回值 === 前一次', () => {
      const mockViewState = createMockViewState();
      act(() => {
        useOnlineGameStore.setState({ gameState: mockViewState });
      });

      const { result: playersResult, rerender: rerenderPlayers } = renderHook(() => usePlayers());
      const { result: strikesResult, rerender: rerenderStrikes } = renderHook(() => useFlyingStrikes());
      const { result: logsResult, rerender: rerenderLogs } = renderHook(() => useLogs());
      const { result: effectsResult, rerender: rerenderEffects } = renderHook(() => useStarEffects());
      const { result: destroyedResult, rerender: rerenderDestroyed } = renderHook(() => useDestroyedStars());

      const playersFirst = playersResult.current;
      const strikesFirst = strikesResult.current;
      const logsFirst = logsResult.current;
      const effectsFirst = effectsResult.current;
      const destroyedFirst = destroyedResult.current;

      rerenderPlayers();
      rerenderStrikes();
      rerenderLogs();
      rerenderEffects();
      rerenderDestroyed();

      expect(playersResult.current).toBe(playersFirst);
      expect(strikesResult.current).toBe(strikesFirst);
      expect(logsResult.current).toBe(logsFirst);
      expect(effectsResult.current).toBe(effectsFirst);
      expect(destroyedResult.current).toBe(destroyedFirst);
    });

    it('gameState 引用变化但字段引用未变时，对应 selector 返回值 === 前一次', () => {
      const mockViewState = createMockViewState();
      act(() => {
        useOnlineGameStore.setState({ gameState: mockViewState });
      });

      const { result: playersResult } = renderHook(() => usePlayers());
      const { result: strikesResult } = renderHook(() => useFlyingStrikes());
      const { result: logsResult } = renderHook(() => useLogs());

      const playersFirst = playersResult.current;
      const strikesFirst = strikesResult.current;
      const logsFirst = logsResult.current;

      // gameState 引用变化（新对象），但 players/flyingStrikes/logs 字段引用保持不变
      act(() => {
        useOnlineGameStore.setState({
          gameState: {
            ...mockViewState,
            totalTurn: 999, // 改变某个不相关字段，强制 gameState 引用变化
          },
        });
      });

      expect(playersResult.current).toBe(playersFirst);
      expect(strikesResult.current).toBe(strikesFirst);
      expect(logsResult.current).toBe(logsFirst);
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 4：字段级订阅
  // --------------------------------------------------------------------------

  describe('字段级订阅', () => {
    it('更新 logs 但保持 flyingStrikes 引用不变：useLogs rerender, useFlyingStrikes 不 rerender', () => {
      const logs1: LogEntry[] = [
        { id: 'log1', turn: 1, phase: 'actionPhase', message: 'first', type: 'info' },
      ];
      const logs2: LogEntry[] = [
        { id: 'log1', turn: 1, phase: 'actionPhase', message: 'first', type: 'info' },
        { id: 'log2', turn: 2, phase: 'actionPhase', message: 'second', type: 'info' },
      ];
      const strikes: FlyingStrikeView[] = [
        {
          uid: 's1',
          defId: 'strike-1',
          ownerId: 'p1',
          position: 0,
          targetSystem: 1,
          level: 1,
          speed: 2,
          remainingMoves: 1,
          strikeName: 'Thermal',
          arrived: false,
        },
      ];

      const baseState = createMockViewState({ logs: logs1, flyingStrikes: strikes });
      act(() => {
        useOnlineGameStore.setState({ gameState: baseState });
      });

      const { result: logsResult } = renderHook(() => useLogs());
      const { result: strikesResult } = renderHook(() => useFlyingStrikes());

      const logsBefore = logsResult.current;
      const strikesBefore = strikesResult.current;
      expect(logsBefore).toBe(logs1);
      expect(strikesBefore).toBe(strikes);

      // 更新 logs 引用，保持 flyingStrikes 引用不变
      act(() => {
        useOnlineGameStore.setState({
          gameState: { ...baseState, logs: logs2 },
        });
      });

      // useLogs 触发 rerender，获取新数组
      expect(logsResult.current).not.toBe(logsBefore);
      expect(logsResult.current).toBe(logs2);

      // useFlyingStrikes 不触发 rerender，保持原引用
      expect(strikesResult.current).toBe(strikesBefore);
      expect(strikesResult.current).toBe(strikes);
    });

    it('更新 flyingStrikes 但保持 logs 引用不变：useFlyingStrikes rerender, useLogs 不 rerender', () => {
      const logs: LogEntry[] = [
        { id: 'log1', turn: 1, phase: 'actionPhase', message: 'first', type: 'info' },
      ];
      const strikes1: FlyingStrikeView[] = [
        {
          uid: 's1',
          defId: 'strike-1',
          ownerId: 'p1',
          position: 0,
          targetSystem: 1,
          level: 1,
          speed: 2,
          remainingMoves: 1,
          strikeName: 'Thermal',
          arrived: false,
        },
      ];
      const strikes2: FlyingStrikeView[] = [
        ...strikes1,
        {
          uid: 's2',
          defId: 'strike-2',
          ownerId: 'p2',
          position: 1,
          targetSystem: 2,
          level: 2,
          speed: 3,
          remainingMoves: 2,
          strikeName: 'Dimensional',
          arrived: false,
        },
      ];

      const baseState = createMockViewState({ logs, flyingStrikes: strikes1 });
      act(() => {
        useOnlineGameStore.setState({ gameState: baseState });
      });

      const { result: logsResult } = renderHook(() => useLogs());
      const { result: strikesResult } = renderHook(() => useFlyingStrikes());

      const logsBefore = logsResult.current;
      const strikesBefore = strikesResult.current;
      expect(logsBefore).toBe(logs);
      expect(strikesBefore).toBe(strikes1);

      // 更新 flyingStrikes 引用，保持 logs 引用不变
      act(() => {
        useOnlineGameStore.setState({
          gameState: { ...baseState, flyingStrikes: strikes2 },
        });
      });

      // useFlyingStrikes 触发 rerender，获取新数组
      expect(strikesResult.current).not.toBe(strikesBefore);
      expect(strikesResult.current).toBe(strikes2);

      // useFlyingStrikes 不触发 rerender，保持原引用
      expect(logsResult.current).toBe(logsBefore);
      expect(logsResult.current).toBe(logs);
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 5：useLastRelicDiscovery
  // --------------------------------------------------------------------------

  describe('useLastRelicDiscovery', () => {
    it('gameState = null 时返回 undefined', () => {
      const { result } = renderHook(() => useLastRelicDiscovery());
      expect(result.current).toBeUndefined();
    });

    it('gameState.lastRelicDiscovery = null 时返回 null', () => {
      act(() => {
        useOnlineGameStore.setState({
          gameState: createMockViewState({ lastRelicDiscovery: null }),
        });
      });
      const { result } = renderHook(() => useLastRelicDiscovery());
      expect(result.current).toBeNull();
    });

    it('gameState.lastRelicDiscovery 非 null 时返回该值', () => {
      act(() => {
        useOnlineGameStore.setState({
          gameState: createMockViewState({ lastRelicDiscovery: mockRelicDiscovery }),
        });
      });
      const { result } = renderHook(() => useLastRelicDiscovery());
      expect(result.current).toBe(mockRelicDiscovery);
    });
  });
});
