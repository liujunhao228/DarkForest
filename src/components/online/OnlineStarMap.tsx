'use client';

import { memo, useMemo, useCallback, useEffect, useState } from 'react';
import { STAR_NODES, STAR_EDGES, getSystemsInRange } from '@/lib/game/starmap';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { Zap } from 'lucide-react';
import type { Player, FlyingStrike } from '@/lib/game/types';
import type { PlayerView } from '@/types/viewState';

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

const BACKGROUND_STARS = [12,23,34,45,56,67,78,89,91,14,25,36,47,58,69,72,83,94,16,27,38,49,60,71,82,93,18,29,40,51,62,73,84,95,22,33,44,55,66,77].map((seed) => ({
  cx: ((seed * 7) % 97) + 1,
  cy: ((seed * 13) % 97) + 1,
  r: (seed % 3) * 0.1 + 0.1,
  opacity: ((seed % 5) * 0.1) + 0.2,
}));

interface BroadcastAnimation {
  id: string;
  broadcasterId: string;
  targetSystem: number;
  range: number;
  isOwn: boolean;
  subtype: string;
  startTime: number;
  phase: 'expanding' | 'stable' | 'fading';
}

const BROADCAST_ANIMATION_DURATION = 3000;
const BROADCAST_EXPAND_DURATION = 800;

function useBroadcastAnimations(broadcastActive: boolean, broadcasterId: string | null, targetSystem: number, range: number, subtype: string | undefined): { animations: BroadcastAnimation[]; currentTime: number } {
  const localPlayerId = useLocalPlayerId();
  const [animations, setAnimations] = useState<BroadcastAnimation[]>([]);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (!broadcastActive || !broadcasterId) {
      const existingTimeout = setTimeout(() => {
        setAnimations([]);
      }, 500);
      return () => clearTimeout(existingTimeout);
    }

    const isOwn = broadcasterId === localPlayerId;
    const newAnimation: BroadcastAnimation = {
      id: `${broadcasterId}-${targetSystem}-${Date.now()}`,
      broadcasterId: broadcasterId!,
      targetSystem,
      range,
      isOwn,
      subtype: subtype || 'cooperation',
      startTime: Date.now(),
      phase: 'expanding',
    };

    const initTimeout = setTimeout(() => {
      setAnimations(prev => {
        const filtered = prev.filter(a => !(a.targetSystem === targetSystem && a.broadcasterId === broadcasterId));
        return [...filtered, newAnimation];
      });
    }, 0);

    const expandTimeout = setTimeout(() => {
      setAnimations(prev => prev.map(a => a.id === newAnimation.id ? { ...a, phase: 'stable' } : a));
    }, BROADCAST_EXPAND_DURATION);

    const fadeTimeout = setTimeout(() => {
      setAnimations(prev => prev.map(a => a.id === newAnimation.id ? { ...a, phase: 'fading' } : a));
    }, BROADCAST_ANIMATION_DURATION - 500);

    const removeTimeout = setTimeout(() => {
      setAnimations(prev => prev.filter(a => a.id !== newAnimation.id));
    }, BROADCAST_ANIMATION_DURATION);

    const intervalId = setInterval(() => {
      setCurrentTime(Date.now());
    }, 50);

    return () => {
      clearTimeout(initTimeout);
      clearTimeout(expandTimeout);
      clearTimeout(fadeTimeout);
      clearTimeout(removeTimeout);
      clearInterval(intervalId);
    };
  }, [broadcastActive, broadcasterId, targetSystem, range, subtype, localPlayerId]);

  return { animations, currentTime };
}

function BroadcastRangeIndicator({ targetSystem, range, isOwn, phase, startTime, currentTime }: {
  targetSystem: number;
  range: number;
  isOwn: boolean;
  phase: string;
  startTime: number;
  currentTime: number;
}) {
  const targetNode = STAR_NODES.find(n => n.id === targetSystem);

  const inRangeSystems = useMemo(() => getSystemsInRange(targetSystem, range), [targetSystem, range]);

  if (!targetNode) return null;

  const primaryColor = isOwn ? '#22c55e' : '#f59e0b';
  const secondaryColor = isOwn ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.1)';

  let expandProgress = 0;
  if (phase === 'expanding') {
    expandProgress = Math.min(1, (currentTime - startTime) / BROADCAST_EXPAND_DURATION);
  } else if (phase === 'stable') {
    expandProgress = 1;
  } else {
    const fadeStart = BROADCAST_ANIMATION_DURATION - 500;
    const elapsed = currentTime - startTime - fadeStart;
    expandProgress = Math.max(0, 1 - elapsed / 500);
  }

  return (
    <g className="broadcast-range-indicator">
      {inRangeSystems.map(systemId => {
        const node = STAR_NODES.find(n => n.id === systemId);
        if (!node) return null;
        const dx = node.x - targetNode.x;
        const dy = node.y - targetNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.1) return null;

        const animatedDist = dist * expandProgress;

        return (
          <g key={`range-${systemId}`}>
            <line
              x1={targetNode.x}
              y1={targetNode.y}
              x2={targetNode.x + (dx / dist) * animatedDist}
              y2={targetNode.y + (dy / dist) * animatedDist}
              stroke={secondaryColor}
              strokeWidth="0.8"
              strokeDasharray="0.5 0.5"
              opacity={expandProgress * 0.6}
            />
            <circle
              cx={node.x}
              cy={node.y}
              r={1.5 * expandProgress}
              fill={secondaryColor}
              stroke={primaryColor}
              strokeWidth="0.3"
              opacity={expandProgress * 0.8}
            />
          </g>
        );
      })}

      <circle
        cx={targetNode.x}
        cy={targetNode.y}
        r={2.5 * expandProgress}
        fill={secondaryColor}
        stroke={primaryColor}
        strokeWidth="0.5"
        opacity={expandProgress * 0.9}
      >
        {phase !== 'fading' && (
          <animate
            attributeName="r"
            values={`${2 * expandProgress};${3 * expandProgress};${2 * expandProgress}`}
            dur="1.5s"
            repeatCount="indefinite"
          />
        )}
      </circle>

      {phase === 'stable' && (
        <circle
          cx={targetNode.x}
          cy={targetNode.y}
          r={range * 8}
          fill="none"
          stroke={primaryColor}
          strokeWidth="0.3"
          strokeDasharray="2 1"
          opacity="0.4"
        >
          <animate
            attributeName="r"
            values={`${range * 7};${range * 9};${range * 7}`}
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.4;0.2;0.4"
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>
      )}
    </g>
  );
}

function OnlineStarMapComponent({ onSystemClick, highlightSystems = [], strikeMoveTargets = [], interactiveMode = false }: StarMapProps) {
  const gameState = useOnlineGameStore(s => s.gameState);
  const localPlayerId = useLocalPlayerId();

  const broadcast = gameState?.broadcast;
  const broadcastActive = broadcast?.active ?? false;
  const broadcasterId = broadcast?.broadcasterId ?? null;
  const targetSystem = broadcast?.targetSystem ?? 0;
  const range = broadcast?.range ?? 1;
  const subtype = broadcast?.subtype;

  const { animations, currentTime } = useBroadcastAnimations(broadcastActive, broadcasterId, targetSystem, range, subtype);

  const localPlayerIdFromState = localPlayerId || gameState?.localPlayerId;

  const handleSystemClick = useCallback((systemId: number) => {
    onSystemClick?.(systemId);
  }, [onSystemClick]);

  const handleSystemKeyDown = useCallback((systemId: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSystemClick?.(systemId);
    }
  }, [onSystemClick]);

  if (!gameState) return null;

  const { players, flyingStrikes, destroyedStars } = gameState;

  const activeHighlights = strikeMoveTargets.length > 0 ? strikeMoveTargets : highlightSystems;

  const playersByPosition = useMemo(() => {
    const map: Record<number, Array<Player | PlayerView>> = {};
    for (const p of players) {
      if (p.eliminated || p.position === -1) continue;
      if (!map[p.position]) map[p.position] = [];
      map[p.position].push(p);
    }
    return map;
  }, [players]);

  const strikesByPosition = useMemo(() => {
    const map: Record<number, FlyingStrike[]> = {};
    for (const s of flyingStrikes) {
      if (!map[s.position]) map[s.position] = [];
      map[s.position].push(s);
    }
    return map;
  }, [flyingStrikes]);

  return (
    <div className="relative w-full aspect-[16/10] max-w-[800px] mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full" style={{ filter: 'drop-shadow(0 0 20px rgba(0,0,0,0.5))' }}>
        <defs>
          {/* Star glow */}
          <radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          {/* Highlight glow */}
          <radialGradient id="highlightGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(34,197,94,0.6)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          {/* Strike glow */}
          <radialGradient id="strikeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(239,68,68,0.8)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          {/* Background nebula effect */}
          <radialGradient id="nebula1" cx="30%" cy="30%" r="40%">
            <stop offset="0%" stopColor="rgba(88,28,135,0.08)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <radialGradient id="nebula2" cx="70%" cy="70%" r="35%">
            <stop offset="0%" stopColor="rgba(30,58,138,0.06)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          {/* Pulse animation */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="0.8" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Background */}
        <rect width="100" height="100" fill="#0a0e1a" rx="4" />
        <rect width="100" height="100" fill="url(#nebula1)" rx="4" />
        <rect width="100" height="100" fill="url(#nebula2)" rx="4" />

        {/* Stars background - 使用预计算数据，降低精度优化性能 */}
        {BACKGROUND_STARS.map((star, i) => (
          <circle
            key={`bg-star-${i}`}
            cx={star.cx}
            cy={star.cy}
            r={Math.round(star.r * 10) / 10}
            fill="white"
            opacity={star.opacity}
          />
        ))}

        {/* Edges (connections) */}
        {STAR_EDGES.map((edge, i) => {
          const from = STAR_NODES.find(n => n.id === edge.from)!;
          const to = STAR_NODES.find(n => n.id === edge.to)!;
          return (
            <g key={`edge-${i}`}>
              <line
                x1={from.x} y1={from.y}
                x2={to.x} y2={to.y}
                stroke="rgba(100,130,180,0.25)"
                strokeWidth="0.4"
                strokeDasharray="1 0.5"
              />
              <line
                x1={from.x} y1={from.y}
                x2={to.x} y2={to.y}
                stroke="rgba(100,150,200,0.08)"
                strokeWidth="1.2"
              />
            </g>
          );
        })}

        {/* Broadcast animations */}
        {animations.map(anim => (
          <BroadcastRangeIndicator
            key={anim.id}
            targetSystem={anim.targetSystem}
            range={anim.range}
            isOwn={anim.isOwn}
            phase={anim.phase}
            startTime={anim.startTime}
            currentTime={currentTime}
          />
        ))}

        {/* Highlight systems */}
        {activeHighlights.map(systemId => {
          const node = STAR_NODES.find(n => n.id === systemId)!;
          return (
            <circle
              key={`highlight-${systemId}`}
              cx={node.x} cy={node.y}
              r="6"
              fill="url(#highlightGlow)"
              className="animate-pulse"
            >
              <animate
                attributeName="r"
                values="5;7;5"
                dur="2s"
                repeatCount="indefinite"
              />
            </circle>
          );
        })}

        {/* System nodes */}
        {STAR_NODES.map(node => {
          const playersHere = playersByPosition[node.id] || [];
          const strikesHere = strikesByPosition[node.id] || [];
          const isHighlighted = activeHighlights.includes(node.id);
          const hasStrikeTargets = strikeMoveTargets.includes(node.id);
          const isClickable = interactiveMode && isHighlighted;
          const isDestroyed = destroyedStars?.includes(node.id);

          return (
            <g key={`node-${node.id}`}>
              {/* Outer glow */}
              <circle
                cx={node.x} cy={node.y}
                r="3.5"
                fill={hasStrikeTargets ? 'url(#strikeGlow)' : 'url(#starGlow)'}
              />

              {/* Main node */}
              <circle
                cx={node.x} cy={node.y}
                r="2.2"
                fill={isDestroyed ? '#1a0a0a' : '#1e293b'}
                stroke={isHighlighted ? '#22c55e' : isDestroyed ? '#7f1d1d' : '#475569'}
                strokeWidth="0.4"
                style={{ cursor: isClickable ? 'pointer' : 'default' }}
                onClick={() => isClickable && handleSystemClick(node.id)}
                role={isClickable ? 'button' : undefined}
                aria-label={isClickable ? `选择星系 ${node.id}` : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={isClickable ? handleSystemKeyDown(node.id) : undefined}
                filter="url(#glow)"
              >
                {isHighlighted && (
                  <animate
                    attributeName="stroke"
                    values="#22c55e;#86efac;#22c55e"
                    dur="1.5s"
                    repeatCount="indefinite"
                  />
                )}
              </circle>

              {/* Destroyed star overlay */}
              {isDestroyed && (
                <>
                  <circle cx={node.x} cy={node.y} r="2.2" fill="none" stroke="#dc2626" strokeWidth="0.3" strokeDasharray="0.5 0.5" opacity="0.6" />
                  <line x1={node.x - 1.5} y1={node.y - 1.5} x2={node.x + 1.5} y2={node.y + 1.5} stroke="#dc2626" strokeWidth="0.3" opacity="0.5" />
                  <line x1={node.x + 1.5} y1={node.y - 1.5} x2={node.x - 1.5} y2={node.y + 1.5} stroke="#dc2626" strokeWidth="0.3" opacity="0.5" />
                </>
              )}

              {/* Center dot */}
              <circle cx={node.x} cy={node.y} r="0.8" fill="#94a3b8" />

              {/* System ID */}
              <text
                x={node.x} y={node.y - 3.5}
                textAnchor="middle"
                fill="#64748b"
                fontSize="3.5"
                fontFamily="monospace"
              >
                {node.id}
              </text>

              {/* Player indicators */}
              {playersHere.map((player, idx) => {
                const angle = (idx / Math.max(playersHere.length, 1)) * Math.PI * 2 - Math.PI / 2;
                const radius = playersHere.length > 1 ? 5 : 4;
                const px = node.x + Math.cos(angle) * radius;
                const py = node.y + Math.sin(angle) * radius;

                return (
                  <g key={`player-${player.id}`}>
                    <circle
                      cx={px} cy={py}
                      r="1.5"
                      fill={PLAYER_COLORS[player.color]}
                      stroke="rgba(0,0,0,0.5)"
                      strokeWidth="0.3"
                    />
                    {/* Player initial */}
                    <text
                      x={px} y={py + 1}
                      textAnchor="middle"
                      fill="white"
                      fontSize="2"
                      fontWeight="bold"
                    >
                      {player.name[0]}
                    </text>
                  </g>
                );
              })}

              {/* Strike indicators */}
              {strikesHere.map((strike, idx) => {
                const angle = (idx / Math.max(strikesHere.length, 1)) * Math.PI * 2 + Math.PI / 4;
                const radius = 4;
                const sx = node.x + Math.cos(angle) * radius;
                const sy = node.y + Math.sin(angle) * radius;

                return (
                  <g key={`strike-${strike.uid}`}>
                    <circle
                      cx={sx} cy={sy}
                      r="1.2"
                      fill="#ef4444"
                      opacity="0.9"
                    >
                      <animate
                        attributeName="r"
                        values="1;1.5;1"
                        dur="0.8s"
                        repeatCount="indefinite"
                      />
                    </circle>
                    {/* Strike arrow toward target */}
                    {(() => {
                      const target = STAR_NODES.find(n => n.id === strike.targetSystem);
                      if (!target) return null;
                      const dx = target.x - node.x;
                      const dy = target.y - node.y;
                      const len = Math.sqrt(dx * dx + dy * dy);
                      if (len < 0.1) return null;
                      return (
                        <line
                          x1={sx} y1={sy}
                          x2={sx + (dx / len) * 3}
                          y2={sy + (dy / len) * 3}
                          stroke="rgba(239,68,68,0.5)"
                          strokeWidth="0.3"
                          markerEnd="url(#arrowRed)"
                        />
                      );
                    })()}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Arrow marker */}
        <defs>
          <marker id="arrowRed" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="2" markerHeight="2" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(239,68,68,0.6)" />
          </marker>
        </defs>
      </svg>

      {/* Floating player labels - 黑暗森林核心机制：仅显示自己的标签 */}
      <div className="absolute inset-0 pointer-events-none">
        {players.filter((p: Player | PlayerView) => !p.eliminated && p.position !== -1).map((player: Player | PlayerView) => {
          const node = STAR_NODES.find(n => n.id === player.position);
          if (!node) return null;
          return (
            <div
              key={player.id}
              className="absolute flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
              style={{
                left: `${node.x}%`,
                top: `${node.y + 8}%`,
                transform: 'translateX(-50%)',
                backgroundColor: `${PLAYER_COLORS[player.color]}22`,
                border: `1px solid ${PLAYER_COLORS[player.color]}66`,
                color: PLAYER_COLORS[player.color],
              }}
            >
              <span>{player.name}</span>
              <span className="opacity-70 flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" />{player.energy}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const OnlineStarMap = memo(OnlineStarMapComponent);
