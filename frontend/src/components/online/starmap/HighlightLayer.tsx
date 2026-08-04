import { memo, useMemo } from 'react';
import { useMapStore } from '@/store/mapStore';

interface HighlightLayerProps {
  activeHighlights: number[];
}

function HighlightLayerComponent({ activeHighlights }: HighlightLayerProps) {
  // P1：节点坐标从 useMapStore 订阅（替代旧 STAR_NODE_MAP）
  const nodes = useMapStore(s => s.nodes);
  const nodeMap = useMemo(() => {
    const m = new Map<number, { x: number; y: number }>();
    for (const n of nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [nodes]);

  return (
    <>
      {activeHighlights.map(systemId => {
        const node = nodeMap.get(systemId);
        if (!node) return null;
        return (
          <circle key={`highlight-${systemId}`} cx={node.x} cy={node.y} r="5" fill="url(#highlightGlow)" className="animate-pulse" style={{ animation: 'pulse-highlight 2s ease-in-out infinite' }} />
        );
      })}
    </>
  );
}

export const HighlightLayer = memo(HighlightLayerComponent);
