import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { STAR_NODES, STAR_EDGES, getDistance } from '@/lib/game/starmap';
import type { StarMapExport } from '@/api/rules';

// ============================================================================
// StarMapPreview — 星图预览
//
// 后端 API 仅返回 nodes (id/name) 与 edges (from/to)，不含坐标。
// 前端借用本地 STAR_NODES 的固定坐标布局生成 SVG，确保视觉一致。
// 距离矩阵基于本地 BFS 计算结果（与后端语义一致）。
// ============================================================================

export interface StarMapPreviewProps {
  /** 后端返回的星图（仅含 id/name 与 edges）；为空时回退到本地 STAR_NODES + STAR_EDGES */
  starMap?: StarMapExport;
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

function getNodeVisual(nodeId: number): { x: number; y: number; size: 'sm' | 'md' | 'lg'; color: string } {
  const local = STAR_NODES.find((n) => n.id === nodeId);
  if (local) {
    return { x: local.x, y: local.y, size: local.size, color: NODE_COLOR[local.size] ?? '#6366f1' };
  }
  // 兜底布局：均匀分布
  const angle = ((nodeId - 1) * 360) / 9 / 180 * Math.PI;
  return { x: 50 + 35 * Math.cos(angle), y: 50 + 35 * Math.sin(angle), size: 'md', color: '#6366f1' };
}

export function StarMapPreview({ starMap, compact }: StarMapPreviewProps) {
  const nodes = starMap?.nodes ?? STAR_NODES.map((n) => ({ id: n.id, name: n.name }));
  const edges = starMap?.edges ?? STAR_EDGES;

  // 距离矩阵
  const distanceMatrix = useMemo(() => {
    const ids = nodes.map((n) => n.id).sort((a, b) => a - b);
    return ids.map((row) => ids.map((col) => getDistance(row, col)));
  }, [nodes]);

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
