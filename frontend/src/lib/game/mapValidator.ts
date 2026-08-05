import type { MapLayoutSnapshot } from '@/api/maps';

// 镜像 backend/internal/game/mapvalidate.go 的 ValidateMap 规则（P2 锁定阈值）。
// 修改此处需同步后端。后端返回首个错误；前端收集所有错误以提升编辑器体验。

export const MIN_NODE_COUNT = 3;
export const MAX_NODE_COUNT = 20;
export const MIN_COORD = 0;
export const MAX_COORD = 100;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** 无序边键：小 id 在前，与后端 edgeKey 一致。 */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** BFS 验证无向图是否连通，镜像后端 isConnected。 */
function isConnected(layout: MapLayoutSnapshot): boolean {
  if (layout.nodes.length === 0) {
    return true;
  }
  const adj = new Map<number, number[]>();
  for (const n of layout.nodes) {
    adj.set(n.id, []);
  }
  for (const e of layout.edges) {
    adj.get(e.from)?.push(e.to);
    adj.get(e.to)?.push(e.from);
  }
  const start = layout.nodes[0].id;
  const visited = new Set<number>([start]);
  const queue: number[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  for (const n of layout.nodes) {
    if (!visited.has(n.id)) {
      return false;
    }
  }
  return true;
}

/**
 * 校验地图布局的合法性。规则镜像后端 game.ValidateMap：
 *  1. 节点数在 [MIN_NODE_COUNT, MAX_NODE_COUNT] 范围内
 *  2. 节点 ID 唯一且非负
 *  3. 节点坐标 x/y 在 [MIN_COORD, MAX_COORD] 范围内
 *  4. 边的 from/to 引用存在的节点 ID
 *  5. 禁止自环（from === to）
 *  6. 禁止重复边（无序键）
 *  7. 强制连通图（BFS）
 *
 * 返回所有违规的中文错误消息列表。
 */
export function validateMap(layout: MapLayoutSnapshot): ValidationResult {
  const errors: string[] = [];
  const { nodes, edges } = layout;

  if (nodes.length < MIN_NODE_COUNT) {
    errors.push(`节点数 ${nodes.length} 少于下限 ${MIN_NODE_COUNT}`);
  }
  if (nodes.length > MAX_NODE_COUNT) {
    errors.push(`节点数 ${nodes.length} 超过上限 ${MAX_NODE_COUNT}`);
  }

  // 节点 ID 唯一性 + 非负 + 坐标范围
  const idSet = new Set<number>();
  for (const n of nodes) {
    if (n.id < 0) {
      errors.push(`节点 ID ${n.id} 为负数`);
    }
    if (idSet.has(n.id)) {
      errors.push(`节点 ID ${n.id} 重复`);
    }
    idSet.add(n.id);
    if (n.x < MIN_COORD || n.x > MAX_COORD) {
      errors.push(`节点 ${n.id} 的 x 坐标 ${n.x} 超出范围 [${MIN_COORD}, ${MAX_COORD}]`);
    }
    if (n.y < MIN_COORD || n.y > MAX_COORD) {
      errors.push(`节点 ${n.id} 的 y 坐标 ${n.y} 超出范围 [${MIN_COORD}, ${MAX_COORD}]`);
    }
  }

  // 边引用合法性 + 自环 + 重复边
  const edgeSet = new Set<string>();
  for (const e of edges) {
    if (!idSet.has(e.from)) {
      errors.push(`边 (${e.from} → ${e.to}) 的 from 引用不存在的节点`);
    }
    if (!idSet.has(e.to)) {
      errors.push(`边 (${e.from} → ${e.to}) 的 to 引用不存在的节点`);
    }
    if (e.from === e.to) {
      errors.push(`边 (${e.from} → ${e.to}) 为自环`);
    }
    const key = edgeKey(e.from, e.to);
    if (edgeSet.has(key)) {
      errors.push(`重复边 (${e.from} ↔ ${e.to})`);
    }
    edgeSet.add(key);
  }

  // 连通性
  if (!isConnected(layout)) {
    errors.push('地图不连通');
  }

  return { valid: errors.length === 0, errors };
}
