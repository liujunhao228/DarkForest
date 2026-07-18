import { useCallback, useSyncExternalStore } from 'react';

/** 玩家状态栏显示模式 */
export type PlayerPanelMode = 'detailed' | 'brief' | 'minimal';

const STORAGE_KEY = 'df_player_panel_mode';
const DEFAULT_MODE: PlayerPanelMode = 'detailed';

const VALID_MODES: ReadonlySet<string> = new Set(['detailed', 'brief', 'minimal']);

/** 模式中文标签（供 UI 切换控件复用） */
export const PANEL_MODE_LABELS: Record<PlayerPanelMode, string> = {
  detailed: '详细',
  brief: '简略',
  minimal: '极简',
};

/** 有序模式列表，供切换控件遍历 */
export const PANEL_MODE_ORDER: readonly PlayerPanelMode[] = ['detailed', 'brief', 'minimal'];

// ---- 模块级外部 store：全局共享，不按 room 隔离 ----

let currentMode: PlayerPanelMode = DEFAULT_MODE;
let initialized = false;
const listeners = new Set<() => void>();

/** 从 localStorage 加载模式（首次调用时初始化，后续直接返回缓存） */
function loadMode(): PlayerPanelMode {
  if (initialized) return currentMode;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_MODES.has(raw)) {
      currentMode = raw as PlayerPanelMode;
    }
  } catch {
    // 读取失败（隐私模式等），使用默认值
  }
  initialized = true;
  return currentMode;
}

/** 写入模式：更新缓存 + 持久化 + 通知订阅者 */
function saveMode(mode: PlayerPanelMode): void {
  if (mode === currentMode && initialized) return;
  currentMode = mode;
  initialized = true;
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
 * 玩家状态栏显示模式持久化 Hook。
 * 模式全局共享（不按 room 隔离），持久化到 localStorage。
 * 使用 useSyncExternalStore 订阅模块级 store，避免 effect 竞态。
 */
export function usePlayerPanelMode(): {
  mode: PlayerPanelMode;
  setMode: (mode: PlayerPanelMode) => void;
} {
  const subscribeFn = useCallback((cb: () => void) => subscribe(cb), []);
  const getSnapshot = useCallback(() => loadMode(), []);
  const mode = useSyncExternalStore(subscribeFn, getSnapshot, () => DEFAULT_MODE);

  const setMode = useCallback((next: PlayerPanelMode) => {
    saveMode(next);
  }, []);

  return { mode, setMode };
}
