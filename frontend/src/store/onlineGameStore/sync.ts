import { produce } from 'immer';
import type { OnlineGameStore } from './types';
import type { GameState } from '@/lib/game/types';
import type { ViewState } from '@/lib/game/viewState';

export async function handleFullSync(
  state: GameState | ViewState,
  version: number,
  stateHash: string | undefined,
  set: (partial: Partial<OnlineGameStore> | ((state: OnlineGameStore) => Partial<OnlineGameStore>)) => void,
  get: () => OnlineGameStore
): Promise<void> {
  set({
    gameState: state,
    gameVersion: version,
    error: null,
  });

  const ENABLE_HASH_VERIFY = import.meta.env.DEV;
  if (ENABLE_HASH_VERIFY && stateHash) {
    const localHash = await calculateStateHash(state);
    if (localHash !== stateHash) {
      console.error('[OnlineGame] 状态 Hash 不匹配！');
      setTimeout(() => {
        get().requestSync();
      }, 100);
    }
  }
}

export function handleDeltaSync(
  changes: Array<{ path: string; value: unknown; type: string }>,
  version: number,
  set: (partial: Partial<OnlineGameStore> | ((state: OnlineGameStore) => Partial<OnlineGameStore>)) => void,
  get: () => OnlineGameStore
): void {
  const { gameState } = get();
  if (!gameState) {
    setTimeout(() => {
      if (!get().gameState) {
        get().requestSync();
      }
    }, 100);
    return;
  }

  const newState = applyChanges(gameState, changes);
  set({
    gameState: newState,
    gameVersion: version,
  });
}

function applyChanges(
  state: GameState | ViewState,
  changes: Array<{ path: string; value: unknown; type: string }>
): GameState | ViewState {
  // GameState（回放）：无需过滤
  if (state.kind === 'game') {
    return produce(state, (draft) => {
      for (const change of changes) {
        setPathValue(draft, change.path, change.value);
      }
    });
  }
  // ViewState：按重构前 filterChangesForPlayer 规则过滤（纵深防御，当前 deltaSync 为死代码）
  // TODO(deltaSync): 当前 deltaSync 为死代码，此脱敏防线暂不生效。
  // 启用 deltaSync 前必须重新评审本函数的广播脱敏规则（规则 3、规则 5）完整性，
  // 并补充与后端 filterBroadcastForView 一致的全部字段门控。
  const isRevealed =
    !!state.broadcast &&
    (state.broadcast.phase === 'reveal' ||
      state.broadcast.phase === 'resolve' ||
      state.broadcast.phase === 'done');
  const allowed = changes.filter((c) => isViewPathAllowed(c.path, state, isRevealed));
  return produce(state, (draft) => {
    for (const change of allowed) {
      setPathValue(draft, change.path, change.value);
    }
  });
}

/**
 * 纵深防御路径白名单（覆盖重构前 StateSyncManager.filterChangesForPlayer 5 条规则 + GameState-only 路径）。
 * 在线模式 fullSync 已由后端 CreateViewState 脱敏；此函数仅防御 deltaSync 若未来重启用时的潜在泄露。
 */
function isViewPathAllowed(
  path: string,
  state: ViewState,
  isRevealed: boolean
): boolean {
  // TODO(deltaSync): 当前 deltaSync 为死代码，此脱敏防线暂不生效。
  // 启用 deltaSync 前必须重新评审本函数的广播脱敏规则（规则 3、规则 5）完整性，
  // 并补充与后端 filterBroadcastForView 一致的全部字段门控。
  // 规则 0：GameState-only 路径完全禁止（drawPile / discardPile）
  if (path === 'drawPile' || path.startsWith('drawPile.') || path.startsWith('drawPile[')) return false;
  if (path === 'discardPile' || path.startsWith('discardPile.') || path.startsWith('discardPile[')) return false;
  // 规则 1：对手手牌变化禁止
  const handMatch = path.match(/^players\.(\d+)\.hand(?:\.|$)/);
  if (handMatch) {
    const p = state.players[Number(handMatch[1])];
    return !p || p.id === state.localPlayerId;
  }
  // 规则 2：对手位置变化禁止（黑暗森林核心机制）
  const posMatch = path.match(/^players\.(\d+)\.position$/);
  if (posMatch) {
    const p = state.players[Number(posMatch[1])];
    return !p || p.id === state.localPlayerId;
  }
  // 规则 3：广播 subtype / card 未揭示时禁止
  if ((path === 'broadcast.subtype' || path === 'broadcast.card') && !isRevealed) return false;
  // 规则 4：非拥有者的打击 targetPlayerId（ViewState 本无此字段，防御性过滤）
  if (path.match(/^flyingStrikes\.\d+\.targetPlayerId$/)) return false;
  // 规则 5：顶层 responseCard 未揭示时禁止
  if (path === 'broadcast.responseCard' && !isRevealed) return false;
  return true;
}

export function setPathValue(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const match = part.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      const [, arrayName, index] = match;
      const idx = parseInt(index, 10);
      if (!current[arrayName]) {
        current[arrayName] = [];
      }
      if (!(current[arrayName] as unknown[])[idx]) {
        (current[arrayName] as Record<string, unknown>[])[idx] = {};
      }
      current = (current[arrayName] as Record<string, unknown>[])[idx];
    } else {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

export async function calculateStateHash(state: GameState | ViewState): Promise<string> {
  const players = state.players.map((p) => {
    // 类型安全：Player 有 hand，PlayerView 有 handCount；用 in 判别窄化
    const handCount = 'handCount' in p ? p.handCount : (p.hand?.length ?? 0);
    return {
      id: p.id,
      position: p.position,
      energy: p.energy,
      handCount,
      faceUpCards: (p.faceUpCards ?? []).map((c) => c.uid),
      eliminated: p.eliminated,
    };
  });

  const hashData = {
    players,
    currentPlayerIndex: state.currentPlayerIndex,
    turnPhase: state.turnPhase,
    totalTurn: state.totalTurn,
    flyingStrikes: (state.flyingStrikes ?? []).map((s) => ({
      uid: s.uid,
      ownerId: s.ownerId,
      position: s.position,
      targetSystem: s.targetSystem,
    })),
    broadcast: state.broadcast ? {
      broadcasterId: state.broadcast.broadcasterId,
      phase: state.broadcast.phase,
    } : null,
    destroyedStars: state.destroyedStars,
    winner: state.winner,
  };

  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(hashData));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
