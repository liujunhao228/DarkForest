import { useCallback, useSyncExternalStore } from 'react';

/** 玩家状态栏显示模式 */
export type PlayerPanelMode = 'detailed' | 'brief' | 'minimal';

const STORAGE_KEY = 'df_player_panel_mode';
const VALID_MODES: ReadonlySet<string> = new Set(['detailed', 'brief', 'minimal']);

/** 模式中文标签（供 UI 切换控件复用） */
export const PANEL_MODE_LABELS: Record<PlayerPanelMode, string> = {
  detailed: '详细',
  brief: '简略',
  minimal: '极简',
};

/** 有序模式列表，供切换控件遍历 */
export const PANEL_MODE_ORDER: readonly PlayerPanelMode[] = ['detailed', 'brief', 'minimal'];

/**
 * 根据视口宽度推导默认模式（不依赖 React，供模块级 store 使用）。
 * - width < 640 (xs/sm) → minimal
 * - 640 <= width < 768 (md) → brief
 * - width >= 768 (lg+) → detailed
 *
 * 与 useGameLayout.getPanelModeDefaultForBreakpoint 保持一致。
 */
function getDefaultModeForViewport(width: number): PlayerPanelMode {
  if (width < 640) return 'minimal';
  if (width < 768) return 'brief';
  return 'detailed';
}

// ---- 模块级外部 store：全局共享，不按 room 隔离 ----

let currentMode: PlayerPanelMode | null = null;
const listeners = new Set<() => void>();

/**
 * 从 localStorage 加载模式。
 * - 优先返回用户已保存的偏好；
 * - 若无偏好，按当前视口宽度推导默认值（不写入 localStorage，让用户切换后才持久化）。
 */
function loadMode(): PlayerPanelMode {
  if (currentMode !== null) return currentMode;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_MODES.has(raw)) {
      currentMode = raw as PlayerPanelMode;
      return currentMode;
    }
  } catch {
    // 读取失败（隐私模式等）， fallthrough 到默认值
  }
  // 无用户偏好时，按视口宽度推导
  const width = typeof window !== 'undefined' ? window.innerWidth : 1280;
  currentMode = getDefaultModeForViewport(width);
  return currentMode;
}

/**
 * 当用户在无偏好状态下首次访问后，视口尺寸变化可能导致默认值变化。
 * 此函数在订阅时调用，确保默认值随屏宽更新（仅当用户未手动设置时）。
 */
function refreshDefaultIfUnset(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_MODES.has(raw)) return; // 用户已设置，不覆盖
  } catch {
    return;
  }
  const width = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const next = getDefaultModeForViewport(width);
  if (next !== currentMode) {
    currentMode = next;
    for (const cb of listeners) cb();
  }
}

/** 写入模式：更新缓存 + 持久化 + 通知订阅者 */
function saveMode(mode: PlayerPanelMode): void {
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
  // 订阅时检查默认值是否需要随屏宽更新
  if (typeof window !== 'undefined') {
    refreshDefaultIfUnset();
    const handleChange = () => refreshDefaultIfUnset();
    window.addEventListener('resize', handleChange, { passive: true });
    return () => {
      listeners.delete(cb);
      window.removeEventListener('resize', handleChange);
    };
  }
  return () => {
    listeners.delete(cb);
  };
}

/**
 * 玩家状态栏显示模式持久化 Hook。
 * 模式全局共享（不按 room 隔离），持久化到 localStorage。
 * 使用 useSyncExternalStore 订阅模块级 store，避免 effect 竞态。
 *
 * 默认值策略：
 * - 用户已手动切换过模式 → 使用 localStorage 中的偏好；
 * - 否则按当前视口宽度自动选择（xs/sm→minimal, md→brief, lg+→detailed），
 *   用户手动切换后才写入 localStorage。
 */
export function usePlayerPanelMode(): {
  mode: PlayerPanelMode;
  setMode: (mode: PlayerPanelMode) => void;
} {
  const subscribeFn = useCallback((cb: () => void) => subscribe(cb), []);
  const getSnapshot = useCallback(() => loadMode(), []);
  const mode = useSyncExternalStore<PlayerPanelMode>(subscribeFn, getSnapshot, () => 'detailed');

  const setMode = useCallback((next: PlayerPanelMode) => {
    saveMode(next);
  }, []);

  return { mode, setMode };
}
