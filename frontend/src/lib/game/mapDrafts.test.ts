import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listDrafts,
  getDraft,
  saveDraft,
  deleteDraft,
  copyDraft,
  renameDraft,
  DRAFT_LIMIT,
  DRAFT_KEY_PREFIX,
} from './mapDrafts';
import type { MapLayoutSnapshot } from '@/api/maps';
import type { StarNode, StarEdge } from './types';

function makeLayout(): MapLayoutSnapshot {
  const nodes: StarNode[] = [
    { id: 1, x: 20, y: 20, name: '星系 1', size: 'md', tint: '#6366f1' },
    { id: 2, x: 50, y: 20, name: '星系 2', size: 'md', tint: '#6366f1' },
    { id: 3, x: 50, y: 50, name: '星系 3', size: 'md', tint: '#6366f1' },
  ];
  const edges: StarEdge[] = [
    { from: 1, to: 2 },
    { from: 2, to: 3 },
  ];
  return { nodes, edges };
}

// localStorage mock backed by an in-memory Map
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => store.get(key) ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
    store.set(key, value);
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
    store.delete(key);
  });
  vi.spyOn(Storage.prototype, 'key').mockImplementation((index: number) => {
    const keys = Array.from(store.keys());
    return keys[index] ?? null;
  });
  Object.defineProperty(Storage.prototype, 'length', {
    configurable: true,
    get: () => store.size,
  });
});

describe('mapDrafts', () => {
  it('saveDraft then getDraft returns layout', () => {
    const layout = makeLayout();
    const res = saveDraft('a', layout);
    expect(res.ok).toBe(true);
    expect(getDraft('a')).toEqual(layout);
  });

  it('listDrafts returns metadata sorted by updatedAt desc', async () => {
    saveDraft('a', makeLayout());
    // 确保 updatedAt 不同
    await new Promise((r) => setTimeout(r, 5));
    saveDraft('b', makeLayout());
    const drafts = listDrafts();
    expect(drafts).toHaveLength(2);
    expect(drafts[0].name).toBe('b');
    expect(drafts[1].name).toBe('a');
    expect(drafts[0].nodeCount).toBe(3);
    expect(drafts[0].edgeCount).toBe(2);
  });

  it('saveDraft rejects invalid name', () => {
    const res = saveDraft('a b', makeLayout());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/非法/);
  });

  it('saveDraft rejects too long name', () => {
    const res = saveDraft('a'.repeat(31), makeLayout());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/非法/);
  });

  it('saveDraft enforces limit', () => {
    for (let i = 0; i < DRAFT_LIMIT; i++) {
      const res = saveDraft(`draft${i}`, makeLayout());
      expect(res.ok).toBe(true);
    }
    const res = saveDraft('overflow', makeLayout());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/上限/);
  });

  it('saveDraft overwrite existing does not count against limit', () => {
    saveDraft('a', makeLayout());
    const res = saveDraft('a', makeLayout());
    expect(res.ok).toBe(true);
  });

  it('deleteDraft removes entry', () => {
    saveDraft('a', makeLayout());
    deleteDraft('a');
    expect(getDraft('a')).toBeNull();
  });

  it('copyDraft copies layout to new name', () => {
    saveDraft('a', makeLayout());
    const res = copyDraft('a', 'b');
    expect(res.ok).toBe(true);
    expect(getDraft('b')).toEqual(makeLayout());
    // 源草稿仍存在
    expect(getDraft('a')).toEqual(makeLayout());
  });

  it('renameDraft moves layout to new name', () => {
    saveDraft('a', makeLayout());
    const res = renameDraft('a', 'c');
    expect(res.ok).toBe(true);
    expect(getDraft('a')).toBeNull();
    expect(getDraft('c')).toEqual(makeLayout());
  });

  it('QuotaExceeded handling', () => {
    saveDraft('a', makeLayout()); // 先确保有一个有效草稿
    (Storage.prototype.setItem as ReturnType<typeof vi.spyOn>).mockImplementation(() => {
      const err = new DOMException('quota exceeded', 'QuotaExceededError');
      throw err;
    });
    const res = saveDraft('b', makeLayout());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/存储已满/);
  });

  it('DRAFT_KEY_PREFIX is versioned', () => {
    expect(DRAFT_KEY_PREFIX).toMatch(/^dfmap-editor-v\d+-$/);
  });

  it('corrupted draft is skipped in listDrafts', () => {
    store.set(DRAFT_KEY_PREFIX + 'bad', '{not json');
    const drafts = listDrafts();
    expect(drafts.find((d) => d.name === 'bad')).toBeUndefined();
  });
});
