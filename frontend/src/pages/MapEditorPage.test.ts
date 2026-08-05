import { describe, it, expect } from 'vitest';
import { reducer, initialState } from './mapEditorState';
import type { MapSource } from './mapEditorState';
import type { MapLayoutSnapshot } from '@/api/maps';
import type { StarNode, StarEdge } from '@/lib/game/types';

// 构造测试用 layout：2 节点 1 边
function makeLayout(): MapLayoutSnapshot {
  const nodes: StarNode[] = [
    { id: 1, x: 20, y: 20, name: '星系 1', size: 'md', tint: '#6366f1' },
    { id: 2, x: 50, y: 50, name: '星系 2', size: 'md', tint: '#6366f1' },
  ];
  const edges: StarEdge[] = [{ from: 1, to: 2 }];
  return { nodes, edges };
}

// 构造测试用 mine source
const mineSource: MapSource = { kind: 'mine', mapId: 'y', ownedByMe: true };
const foreignSource: MapSource = { kind: 'foreign', mapId: 'x', originName: '他人图' };

describe('MapEditorPage reducer —— source 字段不变性', () => {
  it('ADD_NODE 不改变 source', () => {
    // 初始 source={kind:'new'}
    expect(initialState.source.kind).toBe('new');
    const next = reducer(initialState, { type: 'ADD_NODE' });
    expect(next.source.kind).toBe('new');
  });

  it('LOAD_LAYOUT 带 foreign source', () => {
    const next = reducer(initialState, {
      type: 'LOAD_LAYOUT',
      layout: makeLayout(),
      source: foreignSource,
    });
    expect(next.source.kind).toBe('foreign');
    expect(next.source.mapId).toBe('x');
    expect(next.source.originName).toBe('他人图');
  });

  it('LOAD_LAYOUT 带 mine source', () => {
    const next = reducer(initialState, {
      type: 'LOAD_LAYOUT',
      layout: makeLayout(),
      source: mineSource,
    });
    expect(next.source.kind).toBe('mine');
    expect(next.source.mapId).toBe('y');
    expect(next.source.ownedByMe).toBe(true);
  });

  it('SET_SOURCE 覆盖：先 foreign 再 SET_SOURCE{kind:"mine"}', () => {
    const loaded = reducer(initialState, {
      type: 'LOAD_LAYOUT',
      layout: makeLayout(),
      source: foreignSource,
    });
    expect(loaded.source.kind).toBe('foreign');
    const next = reducer(loaded, {
      type: 'SET_SOURCE',
      source: { kind: 'mine', mapId: 'z' },
    });
    expect(next.source.kind).toBe('mine');
    expect(next.source.mapId).toBe('z');
  });

  it('CLEAR 重置为 new：先 mine 再 CLEAR', () => {
    const loaded = reducer(initialState, {
      type: 'LOAD_LAYOUT',
      layout: makeLayout(),
      source: mineSource,
    });
    expect(loaded.source.kind).toBe('mine');
    const next = reducer(loaded, { type: 'CLEAR' });
    expect(next.source.kind).toBe('new');
    expect(next.nodes).toEqual([]);
    expect(next.edges).toEqual([]);
  });

  it('UPDATE_NODE 不改变 source：先 mine，UPDATE_NODE 后仍 mine', () => {
    const loaded = reducer(initialState, {
      type: 'LOAD_LAYOUT',
      layout: makeLayout(),
      source: mineSource,
    });
    const next = reducer(loaded, {
      type: 'UPDATE_NODE',
      id: 1,
      patch: { x: 30, y: 30 },
    });
    expect(next.source.kind).toBe('mine');
    expect(next.source.mapId).toBe('y');
    // 节点确实被更新
    expect(next.nodes.find((n) => n.id === 1)).toMatchObject({ x: 30, y: 30 });
  });

  it('DELETE_NODE 不改变 source 且清空关联边', () => {
    const loaded = reducer(initialState, {
      type: 'LOAD_LAYOUT',
      layout: makeLayout(),
      source: mineSource,
    });
    // layout 中有 {1,2} 节点和 {1->2} 边
    expect(loaded.edges).toHaveLength(1);
    const next = reducer(loaded, { type: 'DELETE_NODE', id: 1 });
    // source 仍是 mine
    expect(next.source.kind).toBe('mine');
    expect(next.source.mapId).toBe('y');
    // 节点 1 被删除
    expect(next.nodes.find((n) => n.id === 1)).toBeUndefined();
    // 关联边被过滤掉
    expect(next.edges).toEqual([]);
  });
});
