import { useOnlineGameStore } from './index';
import type {
  BroadcastState,
  FlyingStrike,
  LogEntry,
  PendingAction,
  Player,
  RelicDiscovery,
  StarEffect,
} from '@/lib/game/types';
import type {
  BroadcastStateView,
  FlyingStrikeView,
  PlayerView,
} from '@/lib/game/viewState';

// ============================================================================
// EMPTY 常量（模块级单例）
// ============================================================================
// selector 函数体内禁止创建 [] 字面量，统一通过 ?? EMPTY_XXX 兜底，
// 保证 gameState 为 null 时多次调用返回同一引用，避免无谓重渲染。

export const EMPTY_PLAYERS: Array<Player | PlayerView> = [];
export const EMPTY_STRIKES: Array<FlyingStrike | FlyingStrikeView> = [];
export const EMPTY_LOGS: LogEntry[] = [];
export const EMPTY_EFFECTS: StarEffect[] = [];
export const EMPTY_DESTROYED_STARS: number[] = [];

// ============================================================================
// 数组字段 selector（null 兜底为 EMPTY 常量）
// ============================================================================

export function usePlayers(): Array<Player | PlayerView> {
  return useOnlineGameStore((s) => s.gameState?.players ?? EMPTY_PLAYERS);
}

export function useFlyingStrikes(): Array<FlyingStrike | FlyingStrikeView> {
  return useOnlineGameStore((s) => s.gameState?.flyingStrikes ?? EMPTY_STRIKES);
}

export function useLogs(): LogEntry[] {
  return useOnlineGameStore((s) => s.gameState?.logs ?? EMPTY_LOGS);
}

export function useStarEffects(): StarEffect[] {
  return useOnlineGameStore((s) => s.gameState?.starEffects ?? EMPTY_EFFECTS);
}

export function useDestroyedStars(): number[] {
  return useOnlineGameStore((s) => s.gameState?.destroyedStars ?? EMPTY_DESTROYED_STARS);
}

// ============================================================================
// 标量字段 selector（null 兜底为 undefined / false / null）
// ============================================================================

export function useTurnPhase(): string | undefined {
  return useOnlineGameStore((s) => s.gameState?.turnPhase);
}

export function useGamePhase(): string | undefined {
  return useOnlineGameStore((s) => s.gameState?.phase);
}

export function useTotalTurn(): number | undefined {
  return useOnlineGameStore((s) => s.gameState?.totalTurn);
}

export function useCurrentPlayerIndex(): number | undefined {
  return useOnlineGameStore((s) => s.gameState?.currentPlayerIndex);
}

export function useCurrentPlayerId(): string | undefined {
  return useOnlineGameStore((s) => s.gameState?.currentPlayerId);
}

export function useLocalPlayerId(): string | undefined {
  return useOnlineGameStore((s) => s.gameState?.localPlayerId);
}

export function useWinner(): string | null | undefined {
  return useOnlineGameStore((s) => s.gameState?.winner);
}

export function useIsProcessing(): boolean {
  return useOnlineGameStore((s) => s.gameState?.isProcessing ?? false);
}

// ============================================================================
// 特殊字段 selector
// ============================================================================

export function usePendingAction(): PendingAction | null {
  // ViewState.pendingAction 类型声明为 unknown | null，但后端实际下发均为 PendingAction | null。
  // 此处通过 as 断言还原判别式联合访问能力（非 as any），供消费组件按 type 窄化。
  const value = useOnlineGameStore((s) => s.gameState?.pendingAction) as
    | PendingAction
    | null
    | undefined;
  return value ?? null;
}

export function useBroadcast(): BroadcastState | BroadcastStateView | null {
  return useOnlineGameStore((s) => s.gameState?.broadcast ?? null);
}

export function useLastRelicDiscovery(): RelicDiscovery | null | undefined {
  return useOnlineGameStore((s) => s.gameState?.lastRelicDiscovery);
}
