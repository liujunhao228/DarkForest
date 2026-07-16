import { useCallback, useState, useSyncExternalStore } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';

/** 便签种类：笔记本 / 星图标记 */
export type StickyKind = 'notepad' | 'marker';

/** 便签布局状态：位置、尺寸、锁定、折叠 */
export interface StickyLayout {
  /** 左上角 x（相对 window） */
  x: number;
  /** 左上角 y（相对 window） */
  y: number;
  /** 宽度（px） */
  width: number;
  /** 高度（px） */
  height: number;
  /** 是否锁定（锁定后不可拖动也不可拉伸） */
  locked: boolean;
  /** 是否折叠为小圆按钮 */
  collapsed: boolean;
}

/** 兜底房间键名（未进房时使用） */
const DEFAULT_ROOM_KEY = 'default';

/** localStorage 键名前缀 */
const STORAGE_KEY_PREFIX = 'df_sticky_';

/** 稳定的空对象引用，避免 useSyncExternalStore 快照引用抖动 */
const EMPTY_LAYOUT: StickyLayout = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  locked: false,
  collapsed: true,
};

/** 根据 roomKey + kind 生成 localStorage 键名 */
function buildStorageKey(roomKey: string, kind: StickyKind): string {
  return `${STORAGE_KEY_PREFIX}${roomKey}_${kind}`;
}

/** 安全地从 localStorage 读取布局 */
function loadLayout(roomKey: string, kind: StickyKind, defaults: StickyLayout): StickyLayout {
  try {
    const raw = localStorage.getItem(buildStorageKey(roomKey, kind));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StickyLayout>;
    // 防御性校验：合并默认值，避免缺字段
    return {
      x: typeof parsed.x === 'number' ? parsed.x : defaults.x,
      y: typeof parsed.y === 'number' ? parsed.y : defaults.y,
      width: typeof parsed.width === 'number' ? parsed.width : defaults.width,
      height: typeof parsed.height === 'number' ? parsed.height : defaults.height,
      locked: typeof parsed.locked === 'boolean' ? parsed.locked : defaults.locked,
      collapsed:
        typeof parsed.collapsed === 'boolean' ? parsed.collapsed : defaults.collapsed,
    };
  } catch {
    return defaults;
  }
}

/** 安全地把布局写入 localStorage */
function saveLayout(roomKey: string, kind: StickyKind, layout: StickyLayout): void {
  try {
    localStorage.setItem(buildStorageKey(roomKey, kind), JSON.stringify(layout));
  } catch {
    // 忽略写入错误（如配额满、隐私模式禁用 localStorage）
  }
}

// ---- 模块级外部 store：按 roomKey + kind 隔离缓存与订阅 ----

/** storeKey（`roomKey:kind`）-> StickyLayout 缓存 */
const layoutCache = new Map<string, StickyLayout>();

/** storeKey -> 订阅回调集合 */
const listeners = new Map<string, Set<() => void>>();

/** 写入布局：更新缓存 + 持久化 + 通知订阅者 */
function setLayoutSnapshot(
  roomKey: string,
  kind: StickyKind,
  storeKey: string,
  next: StickyLayout,
): void {
  layoutCache.set(storeKey, next);
  saveLayout(roomKey, kind, next);
  const set = listeners.get(storeKey);
  if (set) {
    for (const cb of set) cb();
  }
}

/** 订阅布局变更，返回取消订阅函数 */
function subscribeLayout(storeKey: string, cb: () => void): () => void {
  let set = listeners.get(storeKey);
  if (!set) {
    set = new Set();
    listeners.set(storeKey, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

/**
 * 便签布局持久化 Hook。
 * 位置/尺寸/锁定/折叠状态按 roomKey + kind 隔离持久化到 localStorage。
 * 使用 useSyncExternalStore 订阅模块级 store，避免 effect 竞态。
 *
 * @param kind 便签种类
 * @param defaults 默认布局（首次进入或读取失败时使用）
 */
export function useStickyLayout(
  kind: StickyKind,
  defaults: StickyLayout,
): {
  layout: StickyLayout;
  setLayout: (partial: Partial<StickyLayout>) => void;
} {
  const roomId = useOnlineGameStore((s) => s.roomId);
  const roomKey = roomId ?? DEFAULT_ROOM_KEY;
  // 用 `roomKey:kind` 作为 storeKey，避免不同 kind 共享同一缓存槽
  const storeKey = `${roomKey}:${kind}`;

  // 用 useState 锁定首次传入的 defaults，避免父组件重渲染时 defaults 引用变化
  // 导致 getSnapshot/setLayout 依赖抖动；defaults 语义上不应在运行时改变
  // React 19 禁止在 render 期间写 ref，改用 useState 的惰性初始化锁定首次值
  const [defaultsRef] = useState(() => defaults);

  const subscribe = useCallback(
    (cb: () => void) => subscribeLayout(storeKey, cb),
    [storeKey],
  );

  // getSnapshot 需返回稳定引用：缓存命中时直接返回缓存对象；未命中时加载并填充缓存
  const getSnapshot = useCallback((): StickyLayout => {
    const cached = layoutCache.get(storeKey);
    if (cached) return cached;
    const loaded = loadLayout(roomKey, kind, defaultsRef);
    layoutCache.set(storeKey, loaded);
    return loaded;
  }, [roomKey, kind, storeKey, defaultsRef]);

  const layout = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_LAYOUT,
  );

  const setLayout = useCallback(
    (partial: Partial<StickyLayout>) => {
      const current =
        layoutCache.get(storeKey) ?? loadLayout(roomKey, kind, defaultsRef);
      const next: StickyLayout = { ...current, ...partial };
      setLayoutSnapshot(roomKey, kind, storeKey, next);
    },
    [roomKey, kind, storeKey, defaultsRef],
  );

  return { layout, setLayout };
}
