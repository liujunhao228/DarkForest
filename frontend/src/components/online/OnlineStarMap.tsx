import { memo, useMemo, useCallback, useEffect, useState, useRef } from 'react';
import { STAR_NODES, STAR_EDGES, getSystemsInRange } from '@/lib/game/starmap';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { Player, FlyingStrike, GameState } from '@/lib/game/types';
import type { PlayerView, ViewState, FlyingStrikeView } from '@/lib/game/viewState';
import { PLAYER_COLORS, STRIKE_SHAPES, getOwnerColor, type StrikeShape } from '@/lib/game/strikeStyles';

// 按打击类型渲染对应几何形状（弹丸标记），填充发出者颜色
function renderStrikeShape(shape: StrikeShape, cx: number, cy: number, color: string) {
  const r = 1.3;
  switch (shape) {
    case 'circle':
      return <circle cx={cx} cy={cy} r={r} fill={color} />;
    case 'diamond':
      return <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} fill={color} />;
    case 'cross':
      return (
        <g stroke={color} strokeWidth="0.6" strokeLinecap="round">
          <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} />
          <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} />
        </g>
      );
    case 'square':
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={color} transform={`rotate(45 ${cx} ${cy})`} />;
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
      }).join(' ');
      return <polygon points={pts} fill={color} />;
    }
  }
}

interface StarMapProps {
  gameState?: GameState | ViewState;
  onSystemClick?: (systemId: number) => void;
  highlightSystems?: number[];
  strikeMoveTargets?: number[];
  interactiveMode?: boolean;
}

const BACKGROUND_STARS = [12,23,34,45,56,67,78,89,91,14,25,36,47,58,69,72,83,94,16,27,38,49,60,71,82,93,18,29,40,51,62,73,84,95,22,33,44,55,66,77].map((seed) => ({
  cx: ((seed * 7) % 97) + 1, cy: ((seed * 13) % 97) + 1, r: (seed % 3) * 0.1 + 0.1, opacity: ((seed % 5) * 0.1) + 0.2,
}));

interface BroadcastAnimation {
  id: string; broadcasterId: string; targetSystem: number; range: number;
  isOwn: boolean; subtype: string; startTime: number; phase: 'expanding' | 'stable' | 'fading';
}

const BROADCAST_ANIMATION_DURATION = 3000;
const BROADCAST_EXPAND_DURATION = 800;

function useBroadcastAnimations(broadcastActive: boolean, broadcasterId: string | null, targetSystem: number, range: number, subtype: string | undefined): { animations: BroadcastAnimation[]; currentTime: number } {
  const localPlayerId = useLocalPlayerId();
  const [animations, setAnimations] = useState<BroadcastAnimation[]>([]);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (!broadcastActive || !broadcasterId) {
      const t = setTimeout(() => setAnimations([]), 500);
      return () => clearTimeout(t);
    }

    const isOwn = broadcasterId === localPlayerId;
    const newAnimation: BroadcastAnimation = {
      id: `${broadcasterId}-${targetSystem}-${Date.now()}`, broadcasterId, targetSystem, range, isOwn,
      subtype: subtype || 'cooperation', startTime: Date.now(), phase: 'expanding',
    };

    const t0 = setTimeout(() => setAnimations(prev => { const f = prev.filter(a => !(a.targetSystem === targetSystem && a.broadcasterId === broadcasterId)); return [...f, newAnimation]; }), 0);
    const t1 = setTimeout(() => setAnimations(prev => prev.map(a => a.id === newAnimation.id ? { ...a, phase: 'stable' } : a)), BROADCAST_EXPAND_DURATION);
    const t2 = setTimeout(() => setAnimations(prev => prev.map(a => a.id === newAnimation.id ? { ...a, phase: 'fading' } : a)), BROADCAST_ANIMATION_DURATION - 500);
    const t3 = setTimeout(() => setAnimations(prev => prev.filter(a => a.id !== newAnimation.id)), BROADCAST_ANIMATION_DURATION);
    const interval = setInterval(() => setCurrentTime(Date.now()), 50);

    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearInterval(interval); };
  }, [broadcastActive, broadcasterId, targetSystem, range, subtype, localPlayerId]);

  return { animations, currentTime };
}

function BroadcastRangeIndicator({ targetSystem, range, isOwn, phase, startTime, currentTime }: {
  targetSystem: number; range: number; isOwn: boolean; phase: string; startTime: number; currentTime: number;
}) {
  const targetNode = STAR_NODES.find(n => n.id === targetSystem);
  const inRangeSystems = useMemo(() => getSystemsInRange(targetSystem, range), [targetSystem, range]);
  if (!targetNode) return null;

  const primaryColor = isOwn ? '#22c55e' : '#f59e0b';
  const secondaryColor = isOwn ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.1)';

  let expandProgress = 0;
  if (phase === 'expanding') expandProgress = Math.min(1, (currentTime - startTime) / BROADCAST_EXPAND_DURATION);
  else if (phase === 'stable') expandProgress = 1;
  else {
    const elapsed = currentTime - startTime - (BROADCAST_ANIMATION_DURATION - 500);
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
            <line x1={targetNode.x} y1={targetNode.y} x2={targetNode.x + (dx / dist) * animatedDist} y2={targetNode.y + (dy / dist) * animatedDist}
              stroke={secondaryColor} strokeWidth="0.8" strokeDasharray="0.5 0.5" opacity={expandProgress * 0.6} />
            <circle cx={node.x} cy={node.y} r={1.5 * expandProgress} fill={secondaryColor} stroke={primaryColor} strokeWidth="0.3" opacity={expandProgress * 0.8} />
          </g>
        );
      })}
      <circle cx={targetNode.x} cy={targetNode.y} r={2.5 * expandProgress} fill={secondaryColor} stroke={primaryColor} strokeWidth="0.5" opacity={expandProgress * 0.9}>
        {phase !== 'fading' && <animate attributeName="r" values={`${2 * expandProgress};${3 * expandProgress};${2 * expandProgress}`} dur="1.5s" repeatCount="indefinite" />}
      </circle>
      {phase === 'stable' && (
        <circle cx={targetNode.x} cy={targetNode.y} r={range * 8} fill="none" stroke={primaryColor} strokeWidth="0.3" strokeDasharray="2 1" opacity="0.4">
          <animate attributeName="r" values={`${range * 7};${range * 9};${range * 7}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.2;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
}

function OnlineStarMapComponent({ gameState: propGameState, onSystemClick, highlightSystems = [], strikeMoveTargets = [], interactiveMode = false }: StarMapProps) {
  const storeGameState = useOnlineGameStore(s => s.gameState);
  const gameState = propGameState || storeGameState;

  const broadcast = gameState?.broadcast;
  const broadcastActive = broadcast?.active ?? false;
  const broadcasterId = broadcast?.broadcasterId ?? null;
  const targetSystem = broadcast?.targetSystem ?? 0;
  const range = broadcast?.range ?? 1;
  const subtype = broadcast?.subtype;

  const { animations, currentTime } = useBroadcastAnimations(broadcastActive, broadcasterId, targetSystem, range, subtype);

  const handleSystemClick = useCallback((systemId: number) => onSystemClick?.(systemId), [onSystemClick]);

  // 键盘可访问性：聚焦到可点击星系后按 Enter/Space 触发选择
  const handleSystemKeyDown = useCallback((systemId: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSystemClick?.(systemId);
    }
  }, [onSystemClick]);

  const playersList = useMemo(() => gameState?.players || [], [gameState?.players]);
  const flyingStrikesList = useMemo(() => gameState?.flyingStrikes || [], [gameState?.flyingStrikes]);
  const destroyedStars = useMemo(() => gameState?.destroyedStars || [], [gameState?.destroyedStars]);

  const activeHighlights = strikeMoveTargets.length > 0 ? strikeMoveTargets : highlightSystems;

  const playersByPosition = useMemo(() => {
    const map: Record<number, Array<Player | PlayerView>> = {};
    for (const p of playersList) {
      if (p.eliminated || p.position === -1) continue;
      if (!map[p.position]) map[p.position] = [];
      map[p.position].push(p);
    }
    return map;
  }, [playersList]);

  const strikesByPosition = useMemo(() => {
    const map: Record<number, Array<FlyingStrike | FlyingStrikeView>> = {};
    for (const s of flyingStrikesList) {
      if (!map[s.position]) map[s.position] = [];
      map[s.position].push(s);
    }
    return map;
  }, [flyingStrikesList]);

  // 直线路径：每个飞行中打击从当前位置直接指向目标星系，并附带发出者颜色
  const strikePaths = useMemo(() => {
    return flyingStrikesList
      .filter(s => s.position !== s.targetSystem)
      .map(s => {
        const from = STAR_NODES.find(n => n.id === s.position);
        const to = STAR_NODES.find(n => n.id === s.targetSystem);
        if (!from || !to) return null;
        const color = getOwnerColor(s.ownerId, playersList);
        return { uid: s.uid, from, to, color };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [flyingStrikesList, playersList]);

  // 打击生效动画：监听 logs 末尾新增的"宣布【X】在星系 Y 生效"
  const [explosions, setExplosions] = useState<{ id: string; systemId: number; color: string }[]>([]);
  const lastLogId = useRef<string | null>(null);

  useEffect(() => {
    if (!gameState?.logs || gameState.logs.length === 0) return;
    const latestLog = gameState.logs[gameState.logs.length - 1];
    if (!latestLog || lastLogId.current === latestLog.id) return;
    lastLogId.current = latestLog.id;

    const match = latestLog.message.match(/宣布【.+】在星系 (\d+) 生效/);
    if (match) {
      const systemId = parseInt(match[1], 10);
      const explosionId = `exp-${systemId}-${Date.now()}`;
      // 从飞行打击列表中查找目标星系对应的打击以解析发出者颜色，找不到则回退红色
      const ownerStrike = flyingStrikesList.find(s => s.targetSystem === systemId);
      const color = ownerStrike ? getOwnerColor(ownerStrike.ownerId, playersList) : '#ef4444';
      // 异步更新状态（避免在 effect body 中同步 setState）
      const addTimer = setTimeout(() => {
        setExplosions(prev => [...prev, { id: explosionId, systemId, color }]);
        toast.success('打击生效！', { description: `星系 ${systemId} 受到打击` });
      }, 0);
      const removeTimer = setTimeout(() => {
        setExplosions(prev => prev.filter(e => e.id !== explosionId));
      }, 2000);
      return () => { clearTimeout(addTimer); clearTimeout(removeTimer); };
    }
  }, [gameState?.logs, flyingStrikesList, playersList]);

  if (!gameState) return null;

  return (
    <div className="relative w-full aspect-[16/10] max-w-[800px] mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full" style={{ filter: 'drop-shadow(0 0 20px rgba(0,0,0,0.5))' }}>
        <defs>
          <radialGradient id="starGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(255,255,255,0.3)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
          <radialGradient id="highlightGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(34,197,94,0.6)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
          <radialGradient id="strikeGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(239,68,68,0.8)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
          <radialGradient id="nebula1" cx="30%" cy="30%" r="40%"><stop offset="0%" stopColor="rgba(88,28,135,0.08)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
          <radialGradient id="nebula2" cx="70%" cy="70%" r="35%"><stop offset="0%" stopColor="rgba(30,58,138,0.06)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="0.8" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>

        <rect width="100" height="100" fill="#0a0e1a" rx="4" />
        <rect width="100" height="100" fill="url(#nebula1)" rx="4" />
        <rect width="100" height="100" fill="url(#nebula2)" rx="4" />

        {BACKGROUND_STARS.map((star, i) => (
          <circle key={`bg-star-${i}`} cx={star.cx} cy={star.cy} r={star.r} fill="white" opacity={star.opacity} />
        ))}

        {STAR_EDGES.map((edge, i) => {
          const from = STAR_NODES.find(n => n.id === edge.from)!;
          const to = STAR_NODES.find(n => n.id === edge.to)!;
          return (
            <g key={`edge-${i}`}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(100,130,180,0.25)" strokeWidth="0.4" strokeDasharray="1 0.5" />
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(100,150,200,0.08)" strokeWidth="1.2" />
            </g>
          );
        })}

        {animations.map(anim => (
          <BroadcastRangeIndicator key={anim.id} targetSystem={anim.targetSystem} range={anim.range} isOwn={anim.isOwn} phase={anim.phase} startTime={anim.startTime} currentTime={currentTime} />
        ))}

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
                stroke={p.color} strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.55" strokeLinecap="round">
                <animate attributeName="stroke-dashoffset" from="0" to="-5" dur="0.6s" repeatCount="indefinite" />
              </line>
              <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={p.color} opacity="0.75" />
            </g>
          );
        })}

        {/* 打击生效爆炸动画：外圈按发出者着色 */}
        {explosions.map(exp => {
          const node = STAR_NODES.find(n => n.id === exp.systemId);
          if (!node) return null;
          return (
            <g key={exp.id}>
              <circle cx={node.x} cy={node.y} r="2" fill="none" stroke={exp.color} strokeWidth="0.5">
                <animate attributeName="r" values="2;10;14" dur="2s" fill="freeze" />
                <animate attributeName="opacity" values="1;0.6;0" dur="2s" fill="freeze" />
              </circle>
              <circle cx={node.x} cy={node.y} r="1" fill="#fbbf24">
                <animate attributeName="r" values="1;6;0" dur="1.2s" fill="freeze" />
                <animate attributeName="opacity" values="1;0.8;0" dur="1.2s" fill="freeze" />
              </circle>
            </g>
          );
        })}

        {activeHighlights.map(systemId => {
          const node = STAR_NODES.find(n => n.id === systemId)!;
          return (
            <circle key={`highlight-${systemId}`} cx={node.x} cy={node.y} r="6" fill="url(#highlightGlow)" className="animate-pulse">
              <animate attributeName="r" values="5;7;5" dur="2s" repeatCount="indefinite" />
            </circle>
          );
        })}

        {STAR_NODES.map(node => {
          const playersHere = playersByPosition[node.id] || [];
          const strikesHere = strikesByPosition[node.id] || [];
          const isHighlighted = activeHighlights.includes(node.id);
          const hasStrikeTargets = strikeMoveTargets.includes(node.id);
          const isClickable = interactiveMode && isHighlighted;
          const isDestroyed = destroyedStars?.includes(node.id);

          return (
            <g key={`node-${node.id}`}>
              <circle cx={node.x} cy={node.y} r="3.5" fill={hasStrikeTargets ? 'url(#strikeGlow)' : 'url(#starGlow)'} />
              <circle cx={node.x} cy={node.y} r="2.2" fill={isDestroyed ? '#1a0a0a' : '#1e293b'}
                stroke={isHighlighted ? '#22c55e' : isDestroyed ? '#7f1d1d' : '#475569'} strokeWidth="0.4"
                style={{ cursor: isClickable ? 'pointer' : 'default' }}
                onClick={() => isClickable && handleSystemClick(node.id)} role={isClickable ? 'button' : undefined}
                aria-label={isClickable ? `选择星系 ${node.id}` : undefined} tabIndex={isClickable ? 0 : undefined}
                onKeyDown={isClickable ? handleSystemKeyDown(node.id) : undefined}
                filter="url(#glow)">
                {isHighlighted && <animate attributeName="stroke" values="#22c55e;#86efac;#22c55e" dur="1.5s" repeatCount="indefinite" />}
              </circle>

              {isDestroyed && (
                <>
                  <circle cx={node.x} cy={node.y} r="2.2" fill="none" stroke="#dc2626" strokeWidth="0.3" strokeDasharray="0.5 0.5" opacity="0.6" />
                  <line x1={node.x - 1.5} y1={node.y - 1.5} x2={node.x + 1.5} y2={node.y + 1.5} stroke="#dc2626" strokeWidth="0.3" opacity="0.5" />
                  <line x1={node.x + 1.5} y1={node.y - 1.5} x2={node.x - 1.5} y2={node.y + 1.5} stroke="#dc2626" strokeWidth="0.3" opacity="0.5" />
                </>
              )}

              <circle cx={node.x} cy={node.y} r="0.8" fill="#94a3b8" />
              <text x={node.x} y={node.y - 3.5} textAnchor="middle" fill="#64748b" fontSize="3.5" fontFamily="monospace">{node.id}</text>

              {playersHere.map((player, idx: number) => {
                const angle = (idx / Math.max(playersHere.length, 1)) * Math.PI * 2 - Math.PI / 2;
                const radius = playersHere.length > 1 ? 5 : 4;
                const px = node.x + Math.cos(angle) * radius;
                const py = node.y + Math.sin(angle) * radius;
                return (
                  <g key={`player-${player.id}`}>
                    <circle cx={px} cy={py} r="1.5" fill={PLAYER_COLORS[player.color]} stroke="rgba(0,0,0,0.5)" strokeWidth="0.3" />
                    <text x={px} y={py + 1} textAnchor="middle" fill="white" fontSize="2" fontWeight="bold">{player.name[0]}</text>
                  </g>
                );
              })}

              {strikesHere.map((strike, idx: number) => {
                const angle = (idx / Math.max(strikesHere.length, 1)) * Math.PI * 2 + Math.PI / 4;
                const radius = 4;
                const sx = node.x + Math.cos(angle) * radius;
                const sy = node.y + Math.sin(angle) * radius;
                const color = getOwnerColor(strike.ownerId, playersList);
                const shape = STRIKE_SHAPES[strike.defId] ?? 'circle';
                return (
                  <g key={`strike-${strike.uid}`} opacity="0.95">
                    <animate attributeName="opacity" values="0.95;0.6;0.95" dur="0.8s" repeatCount="indefinite" />
                    {renderStrikeShape(shape, sx, sy, color)}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-0 pointer-events-none">
        {playersList.filter((p) => !p.eliminated && p.position !== -1).map((player) => {
          const node = STAR_NODES.find(n => n.id === player.position);
          if (!node) return null;
          return (
            <div key={player.id} className="absolute flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
              style={{ left: `${node.x}%`, top: `${node.y + 8}%`, transform: 'translateX(-50%)', backgroundColor: `${PLAYER_COLORS[player.color]}22`, border: `1px solid ${PLAYER_COLORS[player.color]}66`, color: PLAYER_COLORS[player.color] }}>
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
