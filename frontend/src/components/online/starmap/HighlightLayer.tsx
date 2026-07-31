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
          <circle key={`highlight-${systemId}`} cx={node.x} cy={node.y} r="6" fill="url(#highlightGlow)" className="animate-pulse">
            <animate attributeName="r" values="5;7;5" dur="2s" repeatCount="indefinite" />
          </circle>
        );
      })}
    </>
  );
}

export const HighlightLayer = memo(HighlightLayerComponent);
