import { memo, useMemo } from 'react';
import { STAR_NODES } from '@/lib/game/starmap';
import { useFlyingStrikes, usePlayers } from '@/store/onlineGameStore/selectors';
import { getOwnerColor } from '@/lib/game/strikeStyles';
import { SIZE_RADIUS } from './renderHelpers';
import type { FlyingStrike, Player } from '@/lib/game/types';
import type { FlyingStrikeView, PlayerView } from '@/lib/game/viewState';

interface StealthStrikeLayerProps {
  // 回放模式用 props（在线模式 undefined，由 selector 兜底）
  flyingStrikes?: Array<FlyingStrike | FlyingStrikeView>;
  players?: Array<Player | PlayerView>;
}

function StealthStrikeLayerComponent({ flyingStrikes: propStrikes, players: propPlayers }: StealthStrikeLayerProps) {
  // 在线模式用 selector；回放模式用 props
  const storeStrikes = useFlyingStrikes();
  const storePlayers = usePlayers();
  const flyingStrikesList = propStrikes ?? storeStrikes;
  const playersList = propPlayers ?? storePlayers;

  // 隐逐跳脱敏后打击：position 被脱敏为 -1 但 distance 已填充。
  // 按目标星系分组，在目标节点上渲染「距目标 N 跳」指示器。
  const incomingStealthStrikesByTarget = useMemo(() => {
    const map: Record<number, Array<FlyingStrike | FlyingStrikeView>> = {};
    for (const s of flyingStrikesList) {
      if (s.position === -1 && typeof s.distance === 'number') {
        if (!map[s.targetSystem]) map[s.targetSystem] = [];
        map[s.targetSystem].push(s);
      }
    }
    return map;
  }, [flyingStrikesList]);

  // 无隐逐跳打击时返回 null，避免无谓渲染
  const hasAny = useMemo(() => Object.keys(incomingStealthStrikesByTarget).length > 0, [incomingStealthStrikesByTarget]);
  if (!hasAny) return null;

  return (
    <>
      {STAR_NODES.map(node => {
        const list = incomingStealthStrikesByTarget[node.id] || [];
        if (list.length === 0) return null;
        // 本图层不感知紧凑模式（无 isCompact prop），使用非紧凑档位的 SIZE_RADIUS[node.size]
        const starR = SIZE_RADIUS[node.size];
        return list.map((strike, idx: number) => {
          const angle = (idx / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 4;
          const radius = starR + 2.2;
          const sx = node.x + Math.cos(angle) * radius;
          const sy = node.y + Math.sin(angle) * radius;
          const color = getOwnerColor(strike.ownerId, playersList);
          const distance = typeof strike.distance === 'number' ? strike.distance : 0;
          return (
            <g key={`stealth-incoming-${strike.uid}`} opacity="0.9">
              <animate attributeName="opacity" values="0.9;0.55;0.9" dur="1.2s" repeatCount="indefinite" />
              <circle cx={sx} cy={sy} r="1.6" fill="none" stroke={color} strokeWidth="0.4" strokeDasharray="0.6 0.4" />
              <text x={sx} y={sy + 0.7} textAnchor="middle" fill={color} fontSize="2" fontWeight="bold">{distance}</text>
              <title>{`隐逐跳打击 ${strike.strikeName}：距目标 ${distance} 跳（路径保密）`}</title>
            </g>
          );
        });
      })}
    </>
  );
}

export const StealthStrikeLayer = memo(StealthStrikeLayerComponent);
