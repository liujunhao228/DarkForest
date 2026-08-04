import type { StarNode, StarEdge, StarSize } from './types';

// 类型再导出，方便调用方从单点引入
export type { StarNode, StarEdge, StarSize };

/**
 * 地图数据的统一描述：节点、边、邻接表与距离缓存。
 *
 * 由后端 GET /api/game/rules 的 starMap 字段构建；前端 `mapStore` 在应用启动时
 * 调用 `buildMapData(nodes, edges)` 生成，组件通过 `useMapStore` 订阅消费。
 *
 * P1 之前地图布局/视觉数据在 `lib/game/starmap.ts` 中硬编码；P1 起改为后端
 * 单一数据源，本文件仅保留 map-感知工具函数。
 */
export interface StarMapData {
  nodes: StarNode[];
  edges: StarEdge[];
  adjacency: Record<number, number[]>;
  distanceCache: Record<number, Record<number, number>>;
}

/** 不可达哨兵值（与 backend `unreachableDistance` 一致） */
export const UNREACHABLE = 1000000;

/**
 * computeDistance 用 BFS 计算从 from 到 to 的最短跳数。
 * 同节点返回 0，不连通返回 UNREACHABLE（与 backend MapState.GetDistance 一致）。
 */
function computeDistance(
  adjacency: Record<number, number[]>,
  from: number,
  to: number
): number {
  if (from === to) return 0;
  const visited = new Set<number>([from]);
  const queue: { node: number; dist: number }[] = [{ node: from, dist: 0 }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const { node, dist } = item;
    for (const neighbor of adjacency[node] || []) {
      if (neighbor === to) return dist + 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, dist: dist + 1 });
      }
    }
  }
  return UNREACHABLE;
}

/**
 * buildMapData 从 nodes 与 edges 构建邻接表与距离缓存。
 * 邻接表去重 + 排序，保证遍历顺序确定（与后端 NewMapState 行为一致）。
 */
export function buildMapData(nodes: StarNode[], edges: StarEdge[]): StarMapData {
  const adjacency: Record<number, number[]> = {};
  const distanceCache: Record<number, Record<number, number>> = {};

  for (const n of nodes) {
    if (!(n.id in adjacency)) adjacency[n.id] = [];
    if (!(n.id in distanceCache)) distanceCache[n.id] = {};
  }

  for (const e of edges) {
    if (!(e.from in adjacency)) adjacency[e.from] = [];
    if (!(e.to in adjacency)) adjacency[e.to] = [];
    if (!adjacency[e.from].includes(e.to)) adjacency[e.from].push(e.to);
    if (!adjacency[e.to].includes(e.from)) adjacency[e.to].push(e.from);
  }

  for (const key of Object.keys(adjacency)) {
    adjacency[Number(key)].sort((a, b) => a - b);
  }

  const ids = Object.keys(adjacency).map(Number);
  for (const from of ids) {
    if (!(from in distanceCache)) distanceCache[from] = {};
    for (const to of ids) {
      distanceCache[from][to] = computeDistance(adjacency, from, to);
    }
  }

  return { nodes, edges, adjacency, distanceCache };
}

/**
 * 取 from → to 的最短跳数。
 * 不可达返回 UNREACHABLE；同节点返回 0。
 */
export function getDistance(map: StarMapData, from: number, to: number): number {
  return map.distanceCache[from]?.[to] ?? UNREACHABLE;
}

/**
 * 返回与 center 距离 ≤ rangeDist 的所有节点 id（不含 center 自身）。
 */
export function getSystemsInRange(
  map: StarMapData,
  center: number,
  rangeDist: number
): number[] {
  const result: number[] = [];
  for (const n of map.nodes) {
    if (n.id !== center && getDistance(map, center, n.id) <= rangeDist) {
      result.push(n.id);
    }
  }
  return result;
}

/** 判断 a、b 是否直接相邻。 */
export function areAdjacent(map: StarMapData, a: number, b: number): boolean {
  return map.adjacency[a]?.includes(b) ?? false;
}

/**
 * BFS 最短路径：返回从 from 到 to 的最短路径节点数组（含两端）。
 * 若不可达返回空数组。
 */
export function getShortestPath(map: StarMapData, from: number, to: number): number[] {
  if (from === to) return [from];
  const visited = new Set<number>([from]);
  const queue: { node: number; path: number[] }[] = [{ node: from, path: [from] }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const { node, path } = item;
    for (const neighbor of map.adjacency[node] || []) {
      if (neighbor === to) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, path: [...path, neighbor] });
      }
    }
  }
  return [];
}
