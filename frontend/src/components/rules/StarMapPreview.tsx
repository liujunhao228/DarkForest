import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { getDistance, buildMapData } from '@/lib/game/starmap';
import { useMapStore } from '@/store/mapStore';

// ============================================================================
// StarMapPreview — 星图预览
//
// P1：星图数据（节点 + 边 + 坐标 + 视觉）统一从 useMapStore 订阅，
// 后端 GET /api/game/rules 为单一数据源；本地不再保留 fallback 硬编码。
// 距离矩阵基于本地 BFS 计算结果（与后端语义一致）。
// ============================================================================

export interface StarMapPreviewProps {
  /** 紧凑模式：缩小整体尺寸 */
  compact?: boolean;
}

const NODE_RADIUS: Record<string, number> = {
  sm: 4,
  md: 5.5,
  lg: 7,
};

const NODE_COLOR: Record<string, string> = {
  sm: '#0ea5e9',
  md: '#6366f1',
  lg: '#a855f7',
};

const SVG_WIDTH = 100;
const SVG_HEIGHT = 100;

interface NodeVisual {
  x: number;
  y: number;
  size: 'sm' | 'md' | 'lg';
  color: string;
}

function makeNodeVisualLookup(nodes: { id: number; x: number; y: number; size: 'sm' | 'md' | 'lg' }[]): (nodeId: number) => NodeVisual {
  const map = new Map<number, NodeVisual>();
  for (const n of nodes) {
    map.set(n.id, { x: n.x, y: n.y, size: n.size, color: NODE_COLOR[n.size] ?? '#6366f1' });
  }
  return (nodeId: number): NodeVisual => {
    const cached = map.get(nodeId);
    if (cached) return cached;
    // 兜底布局：均匀分布（仅在后端返回缺节点 id 的极端情况下出现）
    const angle = ((nodeId - 1) * 360) / 9 / 180 * Math.PI;
    return { x: 50 + 35 * Math.cos(angle), y: 50 + 35 * Math.sin(angle), size: 'md', color: '#6366f1' };
  };
}

export function StarMapPreview({ compact }: StarMapPreviewProps) {
  const nodes = useMapStore(s => s.nodes);
  const edges = useMapStore(s => s.edges);
  const adjacency = useMapStore(s => s.adjacency);
  const distanceCache = useMapStore(s => s.distanceCache);
  const mapData = useMemo(
    () => ({ nodes, edges, adjacency, distanceCache }),
    [nodes, edges, adjacency, distanceCache]
  );

  const getNodeVisual = useMemo(() => makeNodeVisualLookup(nodes), [nodes]);

  // 距离矩阵
  const distanceMatrix = useMemo(() => {
    // 若 store 已含 distanceCache（在线加载完成），优先复用；
    // 否则现场 buildMapData 重建一份（开发预览场景下数据量小，BFS 可接受）。
    const md =
      Object.keys(distanceCache).length > 0
        ? mapData
        : buildMapData(nodes, edges);
    const ids = nodes.map((n) => n.id).sort((a, b) => a - b);
    return ids.map((row) => ids.map((col) => getDistance(md, row, col)));
  }, [nodes, edges, distanceCache, mapData]);

  if (nodes.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic">地图数据加载中…</div>
    );
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
        {/* SVG 星图 */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="w-full h-auto max-h-[280px]">
            {/* 边 */}
            {edges.map((edge, idx) => {
              const a = getNodeVisual(edge.from);
              const b = getNodeVisual(edge.to);
              return (
                <line
                  key={`edge-${idx}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="rgba(100, 116, 139, 0.35)"
                  strokeWidth={0.5}
                />
              );
            })}
            {/* 节点 */}
            {nodes.map((node) => {
              const v = getNodeVisual(node.id);
              const r = NODE_RADIUS[v.size] ?? 5;
              return (
                <g key={`node-${node.id}`}>
                  <circle
                    cx={v.x}
                    cy={v.y}
                    r={r}
                    fill={v.color}
                    stroke="rgba(255, 255, 255, 0.5)"
                    strokeWidth={0.4}
                  />
                  <text
                    x={v.x}
                    y={v.y + r + 3}
                    fontSize={3.5}
                    fill="rgba(203, 213, 225, 0.9)"
                    textAnchor="middle"
                    fontFamily="monospace"
                  >
                    {node.id}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* 节点图例 */}
        <div className="space-y-2 min-w-[140px]">
          <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">星系节点</div>
          <div className="space-y-1">
            {nodes.map((node) => {
              const v = getNodeVisual(node.id);
              return (
                <div key={node.id} className="flex items-center gap-2 text-xs">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: v.color }}
                  />
                  <span className="text-slate-300">{node.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 距离矩阵 */}
      {!compact && (
        <div>
          <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">距离矩阵</div>
          <p className="text-[10px] text-slate-500 mb-2">行起点 / 列终点，单位为图最短跳数。∞ 表示不可达。</p>
          <div className="overflow-x-auto rounded-md border border-slate-800">
            <table className="text-[10px] font-mono">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-800">
                  <th className="px-2 py-1 text-slate-500">起 \\ 终</th>
                  {nodes.map((n) => (
                    <th key={n.id} className="px-2 py-1 text-slate-400 text-center min-w-[28px]">{n.id}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nodes.map((rowNode, rowIdx) => (
                  <tr key={rowNode.id} className="border-b border-slate-800/60 last:border-b-0">
                    <td className="px-2 py-1 text-slate-400 font-medium">{rowNode.id}</td>
                    {nodes.map((_, colIdx) => {
                      const d = distanceMatrix[rowIdx]?.[colIdx];
                      const isSelf = rowIdx === colIdx;
                      return (
                        <td
                          key={colIdx}
                          className={cn(
                            'px-2 py-1 text-center',
                            isSelf ? 'text-slate-700' : d === 1 ? 'text-emerald-400' : d === 2 ? 'text-cyan-400' : d === 3 ? 'text-amber-400' : 'text-slate-500',
                          )}
                        >
                          {isSelf ? '·' : d === Infinity ? '∞' : d}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
