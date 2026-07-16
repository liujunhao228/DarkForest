import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';

// 图钉标记：标记单个星系的位置推测
export interface PinMarker {
  kind: 'pin';
  id: string;           // 唯一 ID
  systemId: number;     // 标记的星系 ID
  playerId: string;     // 关联的玩家 ID（用于按玩家颜色显示）
  color: string;        // 玩家颜色（hex，如 '#ef4444'）
  createdAt: number;    // 创建时间戳
}

// 区域高亮标记：标记一片区域 + 文字注释
export interface RegionMarker {
  kind: 'region';
  id: string;
  systemIds: number[];  // 区域包含的星系 ID 列表
  color: string;        // 高亮颜色
  note: string;         // 文字注释
  createdAt: number;
}

// 判别式联合：渲染时通过 marker.kind === 'pin' 窄化
export type StarMapMarker = PinMarker | RegionMarker;

// localStorage 中存储的结构
interface StoredMarkers {
  pins: PinMarker[];
  regions: RegionMarker[];
}

/** 兜底房间键名（未进房时使用） */
const DEFAULT_ROOM_KEY = 'default';

/** localStorage 键名前缀 */
const STORAGE_KEY_PREFIX = 'df_markers_';

/** 稳定的空数据引用，避免 useSyncExternalStore 快照引用抖动 */
const EMPTY_MARKERS: StoredMarkers = { pins: [], regions: [] };

/** 根据房间 key 生成 localStorage 键名 */
function buildStorageKey(roomKey: string): string {
  return `${STORAGE_KEY_PREFIX}${roomKey}`;
}

/** 安全地从 localStorage 读取标记数据 */
function loadMarkers(roomKey: string): StoredMarkers {
  try {
    const raw = localStorage.getItem(buildStorageKey(roomKey));
    if (!raw) return { pins: [], regions: [] };
    const parsed = JSON.parse(raw) as Partial<StoredMarkers>;
    // 防御性校验：确保结构正确
    if (!parsed || !Array.isArray(parsed.pins) || !Array.isArray(parsed.regions)) {
      return { pins: [], regions: [] };
    }
    return { pins: parsed.pins, regions: parsed.regions };
  } catch (err) {
    console.error('加载星图标记失败', err);
    return { pins: [], regions: [] };
  }
}

/** 安全地把标记数据写入 localStorage */
function saveMarkers(roomKey: string, data: StoredMarkers): void {
  try {
    localStorage.setItem(buildStorageKey(roomKey), JSON.stringify(data));
  } catch (err) {
    console.error('保存星图标记失败', err);
  }
}

/** 生成唯一 ID：优先用 crypto.randomUUID，老环境兜底 */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- 模块级外部 store：按房间 key 隔离缓存与订阅 ----

/** roomKey -> StoredMarkers 缓存，保证 getSnapshot 返回稳定引用 */
const markersCache = new Map<string, StoredMarkers>();

/** roomKey -> 订阅回调集合 */
const listeners = new Map<string, Set<() => void>>();

/** 读取房间标记（命中缓存时返回稳定引用） */
function getRoomMarkers(roomKey: string): StoredMarkers {
  const cached = markersCache.get(roomKey);
  if (cached) return cached;
  const data = loadMarkers(roomKey);
  markersCache.set(roomKey, data);
  return data;
}

/** 写入房间标记：更新缓存 + 持久化 + 通知订阅者 */
function setRoomMarkers(roomKey: string, data: StoredMarkers): void {
  markersCache.set(roomKey, data);
  saveMarkers(roomKey, data);
  const set = listeners.get(roomKey);
  if (set) {
    for (const cb of set) cb();
  }
}

/** 订阅房间标记变更，返回取消订阅函数 */
function subscribeRoom(roomKey: string, cb: () => void): () => void {
  let set = listeners.get(roomKey);
  if (!set) {
    set = new Set();
    listeners.set(roomKey, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

/**
 * 星图标记数据层 Hook。
 * 数据按房间隔离持久化到 localStorage，roomId 来自 onlineGameStore。
 * 使用 useSyncExternalStore 订阅模块级 store，实现跨实例实时同步
 * （OnlineStarMap 渲染 + OnlineMarkerManager 管理共享同一份状态）。
 */
export function useStarMapMarkers(): {
  pins: PinMarker[];
  regions: RegionMarker[];
  markers: StarMapMarker[];  // pins + regions 合并
  addPin: (systemId: number, playerId: string, color: string) => void;
  addRegion: (systemIds: number[], color: string, note: string) => void;
  removeMarker: (id: string) => void;
  clearAll: () => void;
} {
  const roomId = useOnlineGameStore((s) => s.roomId);
  // 拿不到 roomId（比如还没进房）用 'default' 兜底
  const roomKey = roomId ?? DEFAULT_ROOM_KEY;

  const subscribe = useCallback(
    (cb: () => void) => subscribeRoom(roomKey, cb),
    [roomKey],
  );
  const getSnapshot = useCallback(
    () => getRoomMarkers(roomKey),
    [roomKey],
  );

  const data = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_MARKERS,
  );

  const { pins, regions } = data;

  // 合并后的 markers 列表：data 引用稳定时 pins/regions 也稳定，markers 随之稳定
  const markers = useMemo<StarMapMarker[]>(
    () => [...pins, ...regions],
    [pins, regions],
  );

  // 添加图钉：不去重，允许同一星系放多个图钉（不同玩家颜色的推测）
  const addPin = useCallback(
    (systemId: number, playerId: string, color: string) => {
      const pin: PinMarker = {
        kind: 'pin',
        id: createId(),
        systemId,
        playerId,
        color,
        createdAt: Date.now(),
      };
      const current = getRoomMarkers(roomKey);
      setRoomMarkers(roomKey, { ...current, pins: [...current.pins, pin] });
    },
    [roomKey],
  );

  // 添加区域高亮
  const addRegion = useCallback(
    (systemIds: number[], color: string, note: string) => {
      const region: RegionMarker = {
        kind: 'region',
        id: createId(),
        systemIds,
        color,
        note,
        createdAt: Date.now(),
      };
      const current = getRoomMarkers(roomKey);
      setRoomMarkers(roomKey, { ...current, regions: [...current.regions, region] });
    },
    [roomKey],
  );

  // 按 id 删除（pins 和 regions 都查）
  const removeMarker = useCallback(
    (id: string) => {
      const current = getRoomMarkers(roomKey);
      setRoomMarkers(roomKey, {
        pins: current.pins.filter((m) => m.id !== id),
        regions: current.regions.filter((m) => m.id !== id),
      });
    },
    [roomKey],
  );

  // 清空所有标记
  const clearAll = useCallback(() => {
    setRoomMarkers(roomKey, { pins: [], regions: [] });
  }, [roomKey]);

  return {
    pins,
    regions,
    markers,
    addPin,
    addRegion,
    removeMarker,
    clearAll,
  };
}
