import { create } from 'zustand';
import { getAllRules } from '../api/rules';
import { buildMapData } from '../lib/game/starmap';
import type { StarMapData } from '../lib/game/starmap';
import type { StarNode, StarEdge } from '../lib/game/types';

/**
 * 地图数据 store：从后端 GET /api/game/rules 拉取 starMap 字段并构建邻接/距离缓存。
 *
 * P1 之前地图数据在 lib/game/starmap.ts 中硬编码；P1 起改为后端单一数据源，
 * 应用启动时由 main.tsx 触发 load()，组件通过 useMapStore 订阅消费。
 *
 * 不回落到本地硬编码：失败时仅打印错误日志，UI 显示加载失败状态
 * （与 initiative 单一数据源原则一致）。
 */
interface MapStore extends StarMapData {
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useMapStore = create<MapStore>((set, get) => ({
  nodes: [],
  edges: [],
  adjacency: {},
  distanceCache: {},
  loaded: false,
  error: null,
  load: async () => {
    if (get().loaded) return;
    try {
      const rules = await getAllRules();
      const nodes: StarNode[] = rules.starMap.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        name: n.name,
        size: n.size,
        tint: n.tint,
      }));
      const edges: StarEdge[] = rules.starMap.edges.map((e) => ({
        from: e.from,
        to: e.to,
      }));
      const { adjacency, distanceCache } = buildMapData(nodes, edges);
      set({ nodes, edges, adjacency, distanceCache, loaded: true, error: null });
    } catch (err) {
      // 不回落到本地硬编码（与 initiative 单一数据源原则一致）
      const message = err instanceof Error ? err.message : '加载地图数据失败';
      console.error('mapStore.load failed:', message, err);
      set({ loaded: false, error: message });
    }
  },
}));
