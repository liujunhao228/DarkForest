import { useCallback, useSyncExternalStore } from 'react';

/**
 * 移动端「场上门牌」展示模式。
 * - default：门牌区与手牌区横向同行，门牌区靠右、从右向左排列（卡牌图文）
 * - simple：门牌区与手牌区横向同行，门牌区改用文字呈现（按 defId 分组，每类一行，列满再开新列）
 *
 * 桌面端不使用此偏好（保持原有垂直堆叠实现）。
 */
export type DoorCardDisplayMode = 'default' | 'simple';

const STORAGE_KEY = 'df_door_card_display_mode';
const VALID_MODES: ReadonlySet<string> = new Set(['default', 'simple']);

/** 模式中文标签（供 UI 切换控件复用） */
export const DOOR_CARD_MODE_LABELS: Record<DoorCardDisplayMode, string> = {
  default: '默认',
  simple: '简略',
};

/** 有序模式列表，供切换控件遍历 */
export const DOOR_CARD_MODE_ORDER: readonly DoorCardDisplayMode[] = ['default', 'simple'];

// ---- 模块级外部 store：全局共享，不按 room 隔离 ----

let currentMode: DoorCardDisplayMode | null = null;
const listeners = new Set<() => void>();

/**
 * 从 localStorage 加载模式。
 * - 优先返回用户已保存的偏好；
 * - 若无偏好，默认 'default'（不写入 localStorage，让用户切换后才持久化）。
 */
function loadMode(): DoorCardDisplayMode {
  if (currentMode !== null) return currentMode;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_MODES.has(raw)) {
      currentMode = raw as DoorCardDisplayMode;
      return currentMode;
    }
  } catch {
    // 读取失败（隐私模式等），fallthrough 到默认值
  }
  currentMode = 'default';
  return currentMode;
}

/** 写入模式：更新缓存 + 持久化 + 通知订阅者 */
function saveMode(mode: DoorCardDisplayMode): void {
  if (mode === currentMode && currentMode !== null) return;
  currentMode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 写入失败（配额满、隐私模式等），忽略
  }
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * 场上门牌展示模式持久化 Hook。
 * 模式全局共享（不按 room 隔离），持久化到 localStorage。
 * 使用 useSyncExternalStore 订阅模块级 store，避免 effect 竞态。
 *
 * 默认值：'default'。用户手动切换后才写入 localStorage。
 */
export function useDoorCardDisplayMode(): {
  mode: DoorCardDisplayMode;
  setMode: (mode: DoorCardDisplayMode) => void;
} {
  const subscribeFn = useCallback((cb: () => void) => subscribe(cb), []);
  const getSnapshot = useCallback(() => loadMode(), []);
  const mode = useSyncExternalStore<DoorCardDisplayMode>(subscribeFn, getSnapshot, () => 'default');

  const setMode = useCallback((next: DoorCardDisplayMode) => {
    saveMode(next);
  }, []);

  return { mode, setMode };
}
