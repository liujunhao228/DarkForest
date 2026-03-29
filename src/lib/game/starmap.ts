// ============================
// 星图数据定义
// ============================
import { StarNode, StarEdge } from './types';

/**
 * 标准星图布局 - 3x3 网格
 * 
 * 连接规则：
 * - 4号、5号为中央星系，各4条连线
 * - 9号为边缘星系，仅2条连线
 * - 其余星球均为3条连线
 * 
 * 布局：
 *     1 -------- 4 -------- 2
 *    /|          |          /|
 *   / |          |         / |
 *  7  |          |        /  |
 *  |  |          |       /   |
 *  |  +----------+------/    |
 *  | /          /|           |
 *  |/          / |           |
 *  8 ---------9  6 ---------3
 *              \/
 *            3--9
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
  { from: 1, to: 2 },   // top horizontal
  { from: 1, to: 4 },   // top left to center
  { from: 1, to: 7 },   // left top vertical
  { from: 2, to: 4 },   // top right to center (shared with 1-4 line)
  { from: 2, to: 6 },   // right top to mid
  { from: 3, to: 5 },   // diagonal: bottom-right to center
  { from: 3, to: 6 },   // right mid to bottom
  { from: 3, to: 9 },   // bottom right to bottom center
  { from: 4, to: 5 },   // center top to center
  { from: 4, to: 7 },   // diagonal: center to left mid
  { from: 5, to: 6 },   // center to right mid
  { from: 5, to: 8 },   // diagonal: center to bottom left
  { from: 7, to: 8 },   // left mid to bottom left
  { from: 8, to: 9 },   // bottom left to bottom center
];

/** 邻接表：星系ID → 相邻星系ID数组 */
export const ADJACENCY: Record<number, number[]> = {};

function buildAdjacency() {
  for (let i = 1; i <= 9; i++) {
    ADJACENCY[i] = [];
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
}
buildAdjacency();

/**
 * BFS计算两个星系之间的最短距离
 */
export function getDistance(from: number, to: number): number {
  if (from === to) return 0;
  const visited = new Set<number>();
  const queue: { node: number; dist: number }[] = [{ node: from, dist: 0 }];
  visited.add(from);

  while (queue.length > 0) {
    const { node, dist } = queue.shift()!;
    for (const neighbor of ADJACENCY[node]) {
      if (neighbor === to) return dist + 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, dist: dist + 1 });
      }
    }
  }
  return Infinity;
}

/**
 * 获取指定距离范围内的所有星系ID
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
