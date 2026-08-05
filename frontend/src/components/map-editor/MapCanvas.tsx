import { useRef, useCallback } from 'react';
import type { StarNode, StarEdge } from '@/lib/game/types';

interface MapCanvasProps {
  nodes: StarNode[];
  edges: StarEdge[];
  selectedNodeId: number | null;
  mode: 'select' | 'edge';
  edgeFrom: number | null;
  onSelectNode: (id: number | null) => void;
  onMoveNode: (id: number, x: number, y: number) => void;
  onConnectEdge: (from: number, to: number) => void;
  onClearEdgeFrom: () => void;
}

const SIZE_RADIUS: Record<string, number> = { sm: 2, md: 3, lg: 4 };

/** SVG 编辑画布：渲染节点+边，支持选中/拖拽/连边。 */
export default function MapCanvas({
  nodes,
  edges,
  selectedNodeId,
  mode,
  edgeFrom,
  onSelectNode,
  onMoveNode,
  onConnectEdge,
  onClearEdgeFrom,
}: MapCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingId = useRef<number | null>(null);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const clientToSvg = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  const clampStep = (v: number): number => {
    const clamped = Math.max(0, Math.min(100, v));
    return Math.round(clamped * 2) / 2;
  };

  const handleNodePointerDown = (e: React.PointerEvent, id: number) => {
    e.stopPropagation();
    if (mode === 'select') {
      draggingId.current = id;
      onSelectNode(id);
      (e.target as Element).setPointerCapture(e.pointerId);
    } else if (mode === 'edge') {
      if (edgeFrom === null) {
        onSelectNode(id); // 设置 edgeFrom
      } else if (edgeFrom !== id) {
        onConnectEdge(edgeFrom, id);
        onClearEdgeFrom();
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingId.current === null) return;
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    onMoveNode(draggingId.current, clampStep(x), clampStep(y));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingId.current !== null) {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      draggingId.current = null;
    }
  };

  const handleSvgClick = (e: React.MouseEvent) => {
    // 点击空白处取消选中 + 清空 edgeFrom
    if (e.target === svgRef.current) {
      onSelectNode(null);
      onClearEdgeFrom();
    }
  };

  const cursor = mode === 'edge' ? 'crosshair' : 'default';

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      className="w-full h-full bg-slate-900 rounded border border-slate-700"
      style={{ cursor, touchAction: 'none' }}
      onClick={handleSvgClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* 边 */}
      {edges.map((e, i) => {
        const from = nodeById.get(e.from);
        const to = nodeById.get(e.to);
        if (!from || !to) return null;
        return (
          <line
            key={`edge-${i}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="#475569"
            strokeWidth={0.4}
          />
        );
      })}

      {/* edgeFrom 高亮（连边模式下的起点） */}
      {mode === 'edge' && edgeFrom !== null && nodeById.has(edgeFrom) && (
        <circle
          cx={nodeById.get(edgeFrom)!.x}
          cy={nodeById.get(edgeFrom)!.y}
          r={(SIZE_RADIUS[nodeById.get(edgeFrom)!.size] ?? 3) + 1.5}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={0.5}
          strokeDasharray="1,1"
        />
      )}

      {/* 节点 */}
      {nodes.map((n) => {
        const r = SIZE_RADIUS[n.size] ?? 3;
        const isSelected = n.id === selectedNodeId;
        return (
          <g key={`node-${n.id}`}>
            <circle
              cx={n.x}
              cy={n.y}
              r={r}
              fill={n.tint}
              stroke={isSelected ? '#fbbf24' : '#1e293b'}
              strokeWidth={isSelected ? 0.6 : 0.3}
              onPointerDown={(e) => handleNodePointerDown(e, n.id)}
              style={{ cursor: mode === 'edge' ? 'crosshair' : 'pointer' }}
            />
            <text
              x={n.x}
              y={n.y - r - 1}
              fontSize={3}
              fill="#e2e8f0"
              textAnchor="middle"
              pointerEvents="none"
            >
              {n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
