import type { StarNode, StarEdge } from './types';

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

export const ADJACENCY: Record<number, number[]> = {};

const DISTANCE_CACHE: Record<number, Record<number, number>> = {};

function computeDistance(from: number, to: number): number {
  if (from === to) return 0;
  const visited = new Set<number>();
  const queue: { node: number; dist: number }[] = [{ node: from, dist: 0 }];
  visited.add(from);

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const { node, dist } = item;
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
  for (const key of Object.keys(ADJACENCY)) {
    ADJACENCY[Number(key)].sort((a, b) => a - b);
  }

  for (let i = 1; i <= 9; i++) {
    for (let j = 1; j <= 9; j++) {
      DISTANCE_CACHE[i][j] = computeDistance(i, j);
    }
  }
}
buildAdjacency();

export function getDistance(from: number, to: number): number {
  return DISTANCE_CACHE[from]?.[to] ?? Infinity;
}

export function getSystemsInRange(center: number, range: number): number[] {
  const result: number[] = [];
  for (let i = 1; i <= 9; i++) {
    if (i !== center && getDistance(center, i) <= range) {
      result.push(i);
    }
  }
  return result;
}

export function areAdjacent(a: number, b: number): boolean {
  return ADJACENCY[a]?.includes(b) ?? false;
}

/**
 * BFS 最短路径：返回从 from 到 to 的最短路径节点数组（含两端）。
 * 若不可达返回空数组。
 */
export function getShortestPath(from: number, to: number): number[] {
  if (from === to) return [from];
  const visited = new Set<number>([from]);
  const queue: { node: number; path: number[] }[] = [{ node: from, path: [from] }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const { node, path } = item;
    for (const neighbor of ADJACENCY[node] || []) {
      if (neighbor === to) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, path: [...path, neighbor] });
      }
    }
  }
  return [];
}
