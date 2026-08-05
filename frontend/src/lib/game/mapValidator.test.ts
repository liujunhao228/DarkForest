import { describe, it, expect } from 'vitest';
import { validateMap, MIN_NODE_COUNT, MAX_NODE_COUNT } from './mapValidator';
import type { MapLayoutSnapshot } from '@/api/maps';
import type { StarNode, StarEdge } from './types';

function makeNode(id: number, x = 50, y = 50): StarNode {
  return { id, x, y, name: `星系 ${id}`, size: 'md', tint: '#6366f1' };
}

function makeLayout(nodes: StarNode[], edges: StarEdge[]): MapLayoutSnapshot {
  return { nodes, edges };
}

// 3 节点连通图 fixture
const validLayout: MapLayoutSnapshot = makeLayout(
  [makeNode(1, 20, 20), makeNode(2, 50, 20), makeNode(3, 50, 50)],
  [{ from: 1, to: 2 }, { from: 2, to: 3 }],
);

describe('validateMap', () => {
  it('valid map passes', () => {
    const result = validateMap(validLayout);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('too few nodes fails', () => {
    const layout = makeLayout([makeNode(1), makeNode(2)], [{ from: 1, to: 2 }]);
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('少于下限'))).toBe(true);
  });

  it('too many nodes fails', () => {
    const nodes: StarNode[] = [];
    for (let i = 0; i < MAX_NODE_COUNT + 1; i++) {
      nodes.push(makeNode(i, (i % 10) * 10, Math.floor(i / 10) * 20));
    }
    // 用链式连通图保证只触发节点数上限错误
    const edges: StarEdge[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({ from: i, to: i + 1 });
    }
    const result = validateMap(makeLayout(nodes, edges));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('超过上限'))).toBe(true);
  });

  it('negative id fails', () => {
    const layout = makeLayout(
      [makeNode(-1), makeNode(2), makeNode(3)],
      [{ from: -1, to: 2 }, { from: 2, to: 3 }],
    );
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('为负数'))).toBe(true);
  });

  it('duplicate id fails', () => {
    const layout = makeLayout(
      [makeNode(1), makeNode(1), makeNode(3)],
      [{ from: 1, to: 3 }],
    );
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('重复'))).toBe(true);
  });

  it('coord out of range fails', () => {
    const layout = makeLayout(
      [makeNode(1, 101, 50), makeNode(2), makeNode(3)],
      [{ from: 1, to: 2 }, { from: 2, to: 3 }],
    );
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('x 坐标') && e.includes('超出范围'))).toBe(true);
  });

  it('edge ref missing fails', () => {
    const layout = makeLayout(
      [makeNode(1), makeNode(2), makeNode(3)],
      [{ from: 1, to: 99 }, { from: 2, to: 3 }],
    );
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('引用不存在的节点'))).toBe(true);
  });

  it('self loop fails', () => {
    const layout = makeLayout(
      [makeNode(1), makeNode(2), makeNode(3)],
      [{ from: 1, to: 1 }, { from: 2, to: 3 }],
    );
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('自环'))).toBe(true);
  });

  it('duplicate edge fails', () => {
    const layout = makeLayout(
      [makeNode(1), makeNode(2), makeNode(3)],
      [{ from: 1, to: 2 }, { from: 2, to: 1 }, { from: 2, to: 3 }],
    );
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('重复边'))).toBe(true);
  });

  it('disconnected fails', () => {
    const layout = makeLayout(
      [makeNode(1), makeNode(2), makeNode(3), makeNode(4)],
      [{ from: 1, to: 2 }, { from: 3, to: 4 }],
    );
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('不连通'))).toBe(true);
  });

  it('collects multiple errors', () => {
    // 节点数不足（2 节点）且不连通（无边）
    const layout = makeLayout([makeNode(1), makeNode(2)], []);
    const result = validateMap(layout);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some((e) => e.includes('少于下限'))).toBe(true);
    expect(result.errors.some((e) => e.includes('不连通'))).toBe(true);
  });

  it('MIN_NODE_COUNT and MAX_NODE_COUNT constants match backend', () => {
    expect(MIN_NODE_COUNT).toBe(3);
    expect(MAX_NODE_COUNT).toBe(20);
  });
});
