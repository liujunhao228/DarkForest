import { useCallback, useSyncExternalStore } from 'react';
import { useOnlineGameStore } from '../store/onlineGameStore';

/** 记事本单条记录 */
export interface NotepadEntry {
  /** 条目唯一 ID */
  id: string;
  /** 条目文本（可编辑） */
  text: string;
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 来源日志 ID（用于防重复添加） */
  sourceLogId?: string;
}

/** 兜底房间键名（未进房时使用） */
const DEFAULT_ROOM_KEY = 'default';

/** localStorage 键名前缀 */
const STORAGE_KEY_PREFIX = 'df_notepad_';

/** 稳定的空数组引用，避免 useSyncExternalStore 快照引用抖动 */
const EMPTY_ENTRIES: NotepadEntry[] = [];

/** 根据房间 key 生成 localStorage 键名 */
function buildStorageKey(roomKey: string): string {
  return `${STORAGE_KEY_PREFIX}${roomKey}`;
}

/** 安全地从 localStorage 读取条目 */
function loadEntries(key: string): NotepadEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as NotepadEntry[];
  } catch {
    return [];
  }
}

/** 安全地把条目写入 localStorage */
function saveEntries(key: string, entries: NotepadEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // 忽略写入错误（如配额满、隐私模式禁用 localStorage）
  }
}

// ---- 模块级外部 store：按房间 key 隔离缓存与订阅 ----

/** roomKey -> entries 缓存，保证 getSnapshot 返回稳定引用 */
const entriesCache = new Map<string, NotepadEntry[]>();

/** roomKey -> 订阅回调集合 */
const listeners = new Map<string, Set<() => void>>();

/** 读取房间记事本（命中缓存时返回稳定引用） */
function getRoomEntries(roomKey: string): NotepadEntry[] {
  const cached = entriesCache.get(roomKey);
  if (cached) return cached;
  const entries = loadEntries(buildStorageKey(roomKey));
  entriesCache.set(roomKey, entries);
  return entries;
}

/** 写入房间记事本：更新缓存 + 持久化 + 通知订阅者 */
function setRoomEntries(roomKey: string, entries: NotepadEntry[]): void {
  entriesCache.set(roomKey, entries);
  saveEntries(buildStorageKey(roomKey), entries);
  const set = listeners.get(roomKey);
  if (set) {
    for (const cb of set) cb();
  }
}

/** 订阅房间记事本变更，返回取消订阅函数 */
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
 * 记事本数据层 Hook。
 * 数据按房间隔离持久化到 localStorage，roomId 来自 onlineGameStore。
 * 使用 useSyncExternalStore 订阅模块级 store，避免 effect 竞态。
 */
export function useNotepad() {
  const roomId = useOnlineGameStore((s) => s.roomId);
  const roomKey = roomId ?? DEFAULT_ROOM_KEY;

  const subscribe = useCallback(
    (cb: () => void) => subscribeRoom(roomKey, cb),
    [roomKey],
  );
  const getSnapshot = useCallback(
    () => getRoomEntries(roomKey),
    [roomKey],
  );

  const entries = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_ENTRIES,
  );

  const addEntry = useCallback(
    (text: string, sourceLogId?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const next: NotepadEntry[] = [
        ...getRoomEntries(roomKey),
        {
          id: crypto.randomUUID(),
          text: trimmed,
          createdAt: Date.now(),
          sourceLogId,
        },
      ];
      setRoomEntries(roomKey, next);
    },
    [roomKey],
  );

  const updateEntry = useCallback(
    (id: string, text: string) => {
      const current = getRoomEntries(roomKey);
      const next = current.map((entry) =>
        entry.id === id ? { ...entry, text } : entry,
      );
      setRoomEntries(roomKey, next);
    },
    [roomKey],
  );

  const removeEntry = useCallback(
    (id: string) => {
      const current = getRoomEntries(roomKey);
      const next = current.filter((entry) => entry.id !== id);
      setRoomEntries(roomKey, next);
    },
    [roomKey],
  );

  const clearAll = useCallback(() => {
    setRoomEntries(roomKey, []);
  }, [roomKey]);

  const hasSourceLog = useCallback(
    (logId: string) => entries.some((entry) => entry.sourceLogId === logId),
    [entries],
  );

  return {
    entries,
    addEntry,
    updateEntry,
    removeEntry,
    clearAll,
    hasSourceLog,
  };
}
