import { memo } from 'react';
import { STAR_NODE_MAP } from '@/lib/game/starmap';

interface HighlightLayerProps {
  activeHighlights: number[];
}

function HighlightLayerComponent({ activeHighlights }: HighlightLayerProps) {
  return (
    <>
      {activeHighlights.map(systemId => {
        const node = STAR_NODE_MAP.get(systemId)!;
        return (
          <circle key={`highlight-${systemId}`} cx={node.x} cy={node.y} r="5" fill="url(#highlightGlow)" className="animate-pulse" style={{ animation: 'pulse-highlight 2s ease-in-out infinite' }} />
        );
      })}
    </>
  );
}

export const HighlightLayer = memo(HighlightLayerComponent);
