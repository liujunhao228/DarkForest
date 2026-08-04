import { memo, useMemo } from 'react';
import { useMapStore } from '@/store/mapStore';
import { useFlyingStrikes, usePlayers } from '@/store/onlineGameStore/selectors';
import { getOwnerColor } from '@/lib/game/strikeStyles';
import type { FlyingStrike, Player } from '@/lib/game/types';
import type { FlyingStrikeView, PlayerView } from '@/lib/game/viewState';

interface StrikePathsLayerProps {
  // 回放模式用 props（在线模式 undefined，由 selector 兜底）
  flyingStrikes?: Array<FlyingStrike | FlyingStrikeView>;
  players?: Array<Player | PlayerView>;
}

function StrikePathsLayerComponent({ flyingStrikes: propStrikes, players: propPlayers }: StrikePathsLayerProps) {
  // 在线模式用 selector；回放模式用 props
  const storeStrikes = useFlyingStrikes();
  const storePlayers = usePlayers();
  // P1：节点坐标从 useMapStore 订阅（替代旧 STAR_NODE_MAP）
  const nodes = useMapStore(s => s.nodes);
  const strikes = propStrikes ?? storeStrikes;
  const playersList = propPlayers ?? storePlayers;

  // 节点 id → 坐标，替代旧 STAR_NODE_MAP.get()
  const nodeMap = useMemo(() => {
    const m = new Map<number, { x: number; y: number }>();
    for (const n of nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [nodes]);

  // 直线路径：每个飞行中打击从当前位置直接指向目标星系，并附带发出者颜色
  const strikePaths = useMemo(() => {
    return strikes
      .filter(s => s.position !== s.targetSystem)
      .map(s => {
        const from = nodeMap.get(s.position);
        const to = nodeMap.get(s.targetSystem);
        if (!from || !to) return null;
        const color = getOwnerColor(s.ownerId, playersList);
        return { uid: s.uid, from, to, color };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [strikes, playersList, nodeMap]);

  if (strikePaths.length === 0) return null;

  return (
    <>
      {/* 打击直线路径：流动虚线 + 目标端三角箭头，颜色按发出者 */}
      {strikePaths.map(p => {
        const dx = p.to.x - p.from.x;
        const dy = p.to.y - p.from.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // 目标端箭头，留出星系圆盘
        const tip = { x: p.to.x - ux * 1.5, y: p.to.y - uy * 1.5 };
        const left = { x: tip.x - ux * 1.2 + uy * 0.8, y: tip.y - uy * 1.2 - ux * 0.8 };
        const right = { x: tip.x - ux * 1.2 - uy * 0.8, y: tip.y - uy * 1.2 + ux * 0.8 };
        return (
          <g key={`strike-path-${p.uid}`}>
            <line x1={p.from.x} y1={p.from.y} x2={p.to.x} y2={p.to.y}
              stroke={p.color} strokeWidth="0.4" opacity="0.55" strokeLinecap="round"
              style={{
                strokeDasharray: '1.5 1',
                strokeDashoffset: 0,
                animation: 'dashflow 0.6s linear infinite',
              } as React.CSSProperties} />
            <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={p.color} opacity="0.75" />
          </g>
        );
      })}
    </>
  );
}

export const StrikePathsLayer = memo(StrikePathsLayerComponent);
