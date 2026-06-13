// ============================
// 黑暗森林 - 在线游戏状态同步
// ============================
// 处理全量同步、增量同步和 Hash 验证
// ============================

import type { GameState, Card } from '@/lib/game/types';
import type { ViewState, PlayerView, FlyingStrikeView } from '@/types/viewState';
import type { OnlineGameStore } from './index';

/**
 * 处理全量同步
 */
/**
 * 验证状态 Hash（仅在开发模式启用）
 */
async function verifyStateHash(
  state: GameState,
  stateHash: string,
  get: () => OnlineGameStore
): Promise<void> {
  const localHash = await calculateStateHash(state);
  if (localHash !== stateHash) {
    console.error('[OnlineGame] ⚠️ 状态 Hash 不匹配！');
    console.error('[OnlineGame] 服务器 Hash:', stateHash);
    console.error('[OnlineGame] 本地 Hash:', localHash);

    // 请求重新同步
    setTimeout(() => {
      get().requestSync();
    }, 100);
  } else {
    console.log(`[OnlineGame] ✅ 状态 Hash 验证通过: ${stateHash.slice(0, 8)}...`);
  }
}

export async function handleFullSync(
  state: GameState | ViewState,
  version: number,
  stateHash: string | undefined,
  set: (partial: Partial<OnlineGameStore> | ((state: OnlineGameStore) => Partial<OnlineGameStore>)) => void,
  get: () => OnlineGameStore
): Promise<void> {
  console.log('[OnlineGame] handleFullSync 被调用:', {
    version,
    phase: (state as any).phase,
    players: (state as any).players?.length,
    hasViewMeta: '_viewMeta' in state,
  });

  set({
    gameState: state,
    gameVersion: version,
    error: null,
  });

  console.log('[OnlineGame] handleFullSync 完成，gameState 已更新');

  // 验证状态 Hash（仅在开发模式启用）
  // 注意：这里不 await，让 Hash 验证异步执行，不阻塞状态更新
  const ENABLE_HASH_VERIFY = process.env.NODE_ENV === 'development';
  if (ENABLE_HASH_VERIFY && stateHash) {
    void verifyStateHash(state as GameState, stateHash, get);
  }

  const viewState = state as ViewState;
  console.log(`[OnlineGame] 全量同步: version ${version}, role=${viewState._viewMeta?.role ?? 'unknown'}`);
}

/**
 * 处理增量同步
 */
export function handleDeltaSync(
  changes: Array<{ path: string; value: unknown; type: string }>,
  version: number,
  set: (partial: Partial<OnlineGameStore> | ((state: OnlineGameStore) => Partial<OnlineGameStore>)) => void,
  get: () => OnlineGameStore
): void {
  const { gameState } = get();
  if (!gameState) {
    console.warn('[OnlineGame] 收到增量同步但没有本地状态，请求全量同步');
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

/**
 * 应用状态变化（使用 Immer 进行高效的不可变更新）
 */
function applyChanges(
  state: GameState | ViewState,
  changes: Array<{ path: string; value: unknown; type: string }>
): GameState | ViewState {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { produce } = require('immer');
  return produce(state, (draft: GameState | ViewState) => {
    for (const change of changes) {
      setPathValue(draft, change.path, change.value);
    }
  });
}

/**
 * 设置路径值
 */
function setPathValue(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];

    // 处理数组索引
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

/**
 * 计算游戏状态的 Hash 值（用于校验一致性）
 */
export async function calculateStateHash(state: GameState | ViewState): Promise<string> {
  const players = state.players.map((p) => {
    const playerView = p as PlayerView;
    return {
      id: playerView.id,
      position: playerView.position,
      energy: playerView.energy,
      handCount: playerView.hand ? playerView.hand.length : (playerView.handCount ?? 0),
      faceUpCards: (playerView.faceUpCards ?? []).map((c: Card) => c.uid),
      eliminated: playerView.eliminated,
    };
  });

  const hashData = {
    players,
    currentPlayerIndex: state.currentPlayerIndex,
    turnPhase: state.turnPhase,
    totalTurn: state.totalTurn,
    flyingStrikes: (state.flyingStrikes ?? []).map((s) => {
      const strikeView = s as FlyingStrikeView;
      return {
        uid: strikeView.uid,
        ownerId: strikeView.ownerId,
        position: strikeView.position,
        targetSystem: strikeView.targetSystem,
      };
    }),
    broadcast: state.broadcast ? {
      active: state.broadcast.active,
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
