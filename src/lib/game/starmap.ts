// ============================
// 星图数据定义
// ============================
import { StarNode, StarEdge } from './types';

/**
 * 标准星图布局 - 3x3 网格
 *
 * 连接规则：
 * - 4 号、5 号为中央星系，各 4 条连线
 * - 9 号为边缘星系，仅 2 条连线
 * - 其余星球均为 3 条连线
 */
export const STAR_NODES: StarNode[] = [
  { id: 1, x: 15, y: 12, name: '星系 1' },
  { id: 2, x: 85, y: 12, name: '星系 2' },
  { id: 3, x: 85, y: 88, name: '星系 3' },
  { id: 4, x: 50, y: 12, name: '星系 4' },
  { id: 5, x: 50, y: 50, name: '星系 5' },
  { id: 6, x: 85, y: 50, name: '星系 6' },
  { id: 7, x: 15, y: 50, name: '星系 7' },
  { id: 8, x: 15, y: 88, name: '星系 8' },
  { id: 9, x: 50, y: 88, name: '星系 9' },
];

export const STAR_EDGES: StarEdge[] = [
  { from: 1, to: 2 },
  { from: 1, to: 4 },
  { from: 1, to: 7 },
  { from: 2, to: 4 },
  { from: 2, to: 6 },
  { from: 3, to: 5 },
  { from: 3, to: 6 },
  { from: 3, to: 9 },
  { from: 4, to: 5 },
  { from: 4, to: 7 },
  { from: 5, to: 6 },
  { from: 5, to: 8 },
  { from: 7, to: 8 },
  { from: 8, to: 9 },
];

/** 邻接表：星系 ID → 相邻星系 ID 数组 */
export const ADJACENCY: Record<number, number[]> = {};

/** 预计算的距离缓存 [from][to] = distance */
const DISTANCE_CACHE: Record<number, Record<number, number>> = {};

/** BFS 计算距离（用于预计算） */
function computeDistance(from: number, to: number): number {
  if (from === to) return 0;
  const visited = new Set<number>();
  const queue: { node: number; dist: number }[] = [{ node: from, dist: 0 }];
  visited.add(from);

  while (queue.length > 0) {
    const { node, dist } = queue.shift()!;
    for (const neighbor of ADJACENCY[node] || []) {
      if (neighbor === to) return dist + 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, dist: dist + 1 });
      }
    }
  }
  return Infinity;
}

function buildAdjacency() {
  for (let i = 1; i <= 9; i++) {
    ADJACENCY[i] = [];
    DISTANCE_CACHE[i] = {};
  }
  for (const edge of STAR_EDGES) {
    if (!ADJACENCY[edge.from].includes(edge.to)) {
      ADJACENCY[edge.from].push(edge.to);
    }
    if (!ADJACENCY[edge.to].includes(edge.from)) {
      ADJACENCY[edge.to].push(edge.from);
    }
  }
  // 排序
  for (const key of Object.keys(ADJACENCY)) {
    ADJACENCY[Number(key)].sort((a, b) => a - b);
  }
  
  // 预计算所有星系对之间的距离
  for (let i = 1; i <= 9; i++) {
    for (let j = 1; j <= 9; j++) {
      DISTANCE_CACHE[i][j] = computeDistance(i, j);
    }
  }
}
buildAdjacency();

/**
 * 获取两个星系之间的距离（使用预计算缓存）
 */
export function getDistance(from: number, to: number): number {
  return DISTANCE_CACHE[from]?.[to] ?? Infinity;
}

/**
 * 获取指定距离范围内的所有星系 ID
 */
export function getSystemsInRange(center: number, range: number): number[] {
  const result: number[] = [];
  for (let i = 1; i <= 9; i++) {
    if (i !== center && getDistance(center, i) <= range) {
      result.push(i);
    }
  }
  return result;
}

/**
 * 检查两个星系是否直接相邻
 */
export function areAdjacent(a: number, b: number): boolean {
  return ADJACENCY[a]?.includes(b) ?? false;
}
