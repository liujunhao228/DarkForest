'use client';

import { memo, useMemo, useCallback } from 'react';
import { STAR_NODES, STAR_EDGES } from '@/lib/game/starmap';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import type { Player, FlyingStrike } from '@/lib/game/types';

const PLAYER_COLORS: Record<string, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  purple: '#a855f7',
};

interface StarMapProps {
  onSystemClick?: (systemId: number) => void;
  highlightSystems?: number[];
  strikeMoveTargets?: number[];
  interactiveMode?: boolean;
}

const BACKGROUND_STARS = [12,23,34,45,56,67,78,89,91,14,25,36,47,58,69,72,83,94,16,27,38,49,60,71,82,93,18,29,40,51,62,73,84,95,22,33,44,55,66,77].map((seed, i) => ({
  cx: ((seed * 7) % 97) + 1,
  cy: ((seed * 13) % 97) + 1,
  r: (seed % 3) * 0.1 + 0.1,
  opacity: ((seed % 5) * 0.1) + 0.2,
}));

function OnlineStarMapComponent({ onSystemClick, highlightSystems = [], strikeMoveTargets = [], interactiveMode = false }: StarMapProps) {
  const gameState = useOnlineGameStore(s => s.gameState);
  if (!gameState) return null;

  const { players, flyingStrikes, pendingAction, destroyedStars } = gameState;

  const activeHighlights = strikeMoveTargets.length > 0 ? strikeMoveTargets : highlightSystems;

  // Group players by position
  const playersByPosition = useMemo(() => {
    const map: Record<number, Player[]> = {};
    for (const p of players) {
      if (p.eliminated) continue;
      if (!map[p.position]) map[p.position] = [];
      map[p.position].push(p);
    }
    return map;
  }, [players]);

  // Group strikes by position
  const strikesByPosition = useMemo(() => {
    const map: Record<number, FlyingStrike[]> = {};
    for (const s of flyingStrikes) {
      if (!map[s.position]) map[s.position] = [];
      map[s.position].push(s);
    }
    return map;
  }, [flyingStrikes]);

  const handleSystemClick = useCallback((systemId: number) => {
    onSystemClick?.(systemId);
  }, [onSystemClick]);

  return (
    <div className="relative w-full aspect-[16/10] max-w-[800px] mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full" style={{ filter: 'drop-shadow(0 0 20px rgba(0,0,0,0.5))' }}>
        <defs>
          <radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <radialGradient id="highlightGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(34,197,94,0.6)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <radialGradient id="strikeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(239,68,68,0.8)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <radialGradient id="nebula1" cx="30%" cy="30%" r="40%">
            <stop offset="0%" stopColor="rgba(88,28,135,0.08)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <radialGradient id="nebula2" cx="70%" cy="70%" r="35%">
            <stop offset="0%" stopColor="rgba(30,58,138,0.06)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="0.8" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Background effects */}
        <rect width="100" height="100" fill="url(#nebula1)" />
        <rect width="100" height="100" fill="url(#nebula2)" />
        
        {/* Background stars */}
        {BACKGROUND_STARS.map((star, i) => (
          <circle key={i} cx={star.cx} cy={star.cy} r={star.r} fill="white" opacity={star.opacity} />
        ))}

        {/* Edges */}
        {STAR_EDGES.map((edge, i) => (
          <line
            key={i}
            x1={STAR_NODES[edge.from].x * 100}
            y1={STAR_NODES[edge.from].y * 100}
            x2={STAR_NODES[edge.to].x * 100}
            y2={STAR_NODES[edge.to].y * 100}
            stroke="rgba(148,163,184,0.15)"
            strokeWidth="0.2"
          />
        ))}

        {/* Systems */}
        {STAR_NODES.map((node) => {
          const systemId = node.id;
          const players = playersByPosition[systemId] || [];
          const strikes = strikesByPosition[systemId] || [];
          const isHighlighted = activeHighlights.includes(systemId);
          const isDestroyed = destroyedStars?.includes(systemId);
          const isClickable = interactiveMode && onSystemClick;

          return (
            <g key={systemId}>
              {/* System glow */}
              {isHighlighted && (
                <circle
                  cx={node.x * 100}
                  cy={node.y * 100}
                  r="5"
                  fill="url(#highlightGlow)"
                />
              )}

              {/* System circle */}
              <circle
                cx={node.x * 100}
                cy={node.y * 100}
                r={isDestroyed ? 2 : 3}
                fill={isDestroyed ? 'rgba(100,100,100,0.3)' : 'rgba(255,255,255,0.1)'}
                stroke={isHighlighted ? 'rgba(34,197,94,0.8)' : 'rgba(148,163,184,0.3)'}
                strokeWidth={isHighlighted ? 0.5 : 0.2}
                className={isClickable ? 'cursor-pointer hover:opacity-80' : ''}
                onClick={() => isClickable && handleSystemClick(systemId)}
              />

              {/* System label */}
              {!isDestroyed && (
                <text
                  x={node.x * 100}
                  y={node.y * 100 + 5}
                  fontSize="2.5"
                  fill="rgba(148,163,184,0.6)"
                  textAnchor="middle"
                  className="select-none"
                >
                  {node.name}
                </text>
              )}

              {/* Player indicators */}
              {players.length > 0 && !isDestroyed && (
                <g>
                  {players.map((player, idx) => (
                    <g key={player.id}>
                      <circle
                        cx={node.x * 100 + (idx - players.length / 2) * 2}
                        cy={node.y * 100 - 5}
                        r="1.5"
                        fill={PLAYER_COLORS[player.color] || '#3b82f6'}
                        filter="url(#glow)"
                      />
                      <text
                        x={node.x * 100 + (idx - players.length / 2) * 2}
                        y={node.y * 100 - 7}
                        fontSize="2"
                        fill="white"
                        textAnchor="middle"
                        className="select-none"
                      >
                        {player.name}
                      </text>
                    </g>
                  ))}
                </g>
              )}

              {/* Strike indicators */}
              {strikes.length > 0 && (
                <g>
                  {strikes.map((strike, idx) => (
                    <circle
                      key={strike.uid}
                      cx={node.x * 100 + (idx - strikes.length / 2) * 1.5}
                      cy={node.y * 100 + 5}
                      r="1"
                      fill="rgba(239,68,68,0.8)"
                      filter="url(#glow)"
                    />
                  ))}
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const OnlineStarMap = memo(OnlineStarMapComponent);
