import type { OnlineGameStore } from './types';
import type { GameState } from '@/lib/game/types';
import type { ViewState } from '@/lib/game/viewState';
import { useMapStore } from '@/store/mapStore';

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

  // 若 ViewState 携带 mapSnapshot，仅在首次全量同步时更新全局地图 store。
  // 游戏过程中周期性全量广播的 mapSnapshot 不变，重复更新无意义。
  // GameState 路径（回放）不走此函数，由 ReplayPlayerEngine 自行处理。
  if (!get()._mapSnapshotApplied && state.mapSnapshot?.nodes?.length) {
    useMapStore.getState().setMapData(state.mapSnapshot.nodes, state.mapSnapshot.edges);
    set({ _mapSnapshotApplied: true });
  }

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
  if (version !== get().gameVersion + 1) {
    setTimeout(() => get().requestSync(), 100);
    return;
  }
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
    const draft = structuredClone(state);
    applyChangeList(draft, changes);
    return draft;
  }
  // ViewState：按重构前 filterChangesForPlayer 规则过滤（纵深防御）
  const isRevealed =
    !!state.broadcast &&
    (state.broadcast.phase === 'reveal' ||
      state.broadcast.phase === 'resolve' ||
      state.broadcast.phase === 'done');
  const allowed = changes.filter((c) => isViewPathAllowed(c.path, state, isRevealed));
  const draft = structuredClone(state);
  applyChangeList(draft, allowed);
  return draft;
}

// applyChangeList 按 set → delete 顺序应用变更。
// delete 类型的变更需要特殊处理：
//   - 对象属性：置为 null（与 JSON 序列化语义一致，undefined 会在 JSON.stringify 中被忽略）
//   - 数组元素：splice 移除（避免留下 undefined 元素导致后续 .filter/.map 抛 TypeError）
// 同数组内多个 delete 按索引降序处理，避免 splice 导致索引偏移。
function applyChangeList(
  draft: unknown,
  changes: Array<{ path: string; value: unknown; type: string }>
): void {
  const sets = changes.filter((c) => c.type !== 'delete');
  const deletes = changes.filter((c) => c.type === 'delete');

  for (const change of sets) {
    setPathValue(draft, change.path, change.value);
  }

  // 按路径降序排序：确保同数组内高索引先被删除，避免 splice 后索引偏移
  // 例如 prev=[a,b,c,d] → next=[a,b]，产出 delete [2] 和 delete [3]
  // 降序处理：先删 [3] → [a,b,c]，再删 [2] → [a,b] ✓
  // 升序处理：先删 [2] → [a,b,d]，再删 [3] → 索引越界 ✗
  deletes.sort((a, b) => b.path.localeCompare(a.path, undefined, { numeric: true, sensitivity: 'base' }));
  for (const change of deletes) {
    deletePathValue(draft, change.path);
  }
}

// deletePathValue 删除指定路径的属性或数组元素。
// - 纯属性路径（如 'broadcast'）：置为 null
// - 数组索引路径（如 'starEffects[2]'）：splice 移除元素
// - 嵌套路径（如 'a.b.c'）：递归定位后置为 null
function deletePathValue(obj: unknown, path: string): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const match = part.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      const [, arrayName, index] = match;
      const idx = parseInt(index, 10);
      if (!current[arrayName]) return;
      current = (current[arrayName] as Record<string, unknown>[])[idx];
    } else {
      if (!current[part]) return;
      current = current[part] as Record<string, unknown>;
    }
  }

  const lastPart = parts[parts.length - 1];
  const lastMatch = lastPart.match(/^(\w+)\[(\d+)\]$/);
  if (lastMatch) {
    const [, arrayName, index] = lastMatch;
    const idx = parseInt(index, 10);
    if (Array.isArray(current[arrayName])) {
      (current[arrayName] as unknown[]).splice(idx, 1);
    }
  } else {
    // 置为 null 而非 delete，保持对象 shape 稳定（V8 优化），且与 JSON 序列化语义一致
    current[lastPart] = null;
  }
}

// 纵深防御路径白名单。主防线是后端 per-viewer diff（DiffViewStates），此函数作为二重校验保留。
export function isViewPathAllowed(
  path: string,
  state: ViewState,
  isRevealed: boolean
): boolean {
  // 归一化：后端 DiffViewStates 产出方括号格式（players[0].energy），
  // 统一转为点号格式（players.0.energy）以匹配下方正则。
  const p = path.replace(/\[(\d+)\]/g, '.$1');
  // 规则 0：GameState-only 路径完全禁止（drawPile / discardPile）
  if (p === 'drawPile' || p.startsWith('drawPile.')) return false;
  if (p === 'discardPile' || p.startsWith('discardPile.')) return false;
  // 规则 1：对手手牌变化禁止
  const handMatch = p.match(/^players\.(\d+)\.hand(?:\.|$)/);
  if (handMatch) {
    const player = state.players[Number(handMatch[1])];
    return !player || player.id === state.localPlayerId;
  }
  // 规则 2：对手位置变化禁止（黑暗森林核心机制）
  const posMatch = p.match(/^players\.(\d+)\.position$/);
  if (posMatch) {
    const player = state.players[Number(posMatch[1])];
    return !player || player.id === state.localPlayerId;
  }
  // 规则 3：广播 subtype / card 未揭示且非广播者禁止
  if ((p === 'broadcast.subtype' || p === 'broadcast.card') && !isRevealed) {
    return !!state.broadcast && state.broadcast.broadcasterId === state.localPlayerId;
  }
  // 规则 4：非拥有者的打击 targetPlayerId（ViewState 本无此字段，防御性过滤）
  if (p.match(/^flyingStrikes\.\d+\.targetPlayerId$/)) return false;
  // 规则 5：顶层 responseCard 未揭示时禁止
  if (p === 'broadcast.responseCard' && !isRevealed) return false;
  // 规则 6：responses[N].responseCard 未揭示且非回应者禁止
  const respMatch = p.match(/^broadcast\.responses\.(\d+)\.responseCard$/);
  if (respMatch && !isRevealed) {
    const resp = state.broadcast?.responses[Number(respMatch[1])];
    return !!resp && resp.playerId === state.localPlayerId;
  }
  // 规则 7：pendingAction.validMoves 禁止（隐逐跳模式防反向泄露位置）
  if (p === 'pendingAction.validMoves' || p.startsWith('pendingAction.validMoves.')) return false;
  // 规则 8：logs[N].systemId 禁止（位置敏感，由后端 CreateViewState 脱敏）
  if (p.match(/^logs\.\d+\.systemId$/)) return false;
  // 规则 9：lastRelicDiscovery 非继承者禁止
  if (p === 'lastRelicDiscovery' || p.startsWith('lastRelicDiscovery.')) return false;
  // starEffects 是公开信息（降维锁定、湮灭余波等星系效果），所有玩家可见
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
  // 处理最后一段为纯数组索引的情况（如 'starEffects[0]'、'logs[2]'、'destroyedStars[1]'）。
  // 后端 DiffViewStates 对数组新增/替换整元素产出此格式；若不特殊处理，
  // current['starEffects[0]'] 会创建字面量属性而非写入数组元素，导致降维锁定等状态丢失。
  const lastMatch = lastPart.match(/^(\w+)\[(\d+)\]$/);
  if (lastMatch) {
    const [, arrayName, index] = lastMatch;
    const idx = parseInt(index, 10);
    if (!current[arrayName]) {
      current[arrayName] = [];
    }
    (current[arrayName] as unknown[])[idx] = value;
  } else {
    current[lastPart] = value;
  }
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
