import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { STAR_NODE_MAP, getSystemsInRange } from '@/lib/game/starmap';
import { useBroadcast, usePlayers, useTotalTurn } from '@/store/onlineGameStore/selectors';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import type { Player, BroadcastState } from '@/lib/game/types';
import type { PlayerView, BroadcastStateView } from '@/lib/game/viewState';
import type { BroadcastAnimation, ResidualMarker } from './types';
import { BROADCAST_ANIMATION_DURATION, BROADCAST_EXPAND_DURATION } from './renderHelpers';

// ---- 迁移自 OnlineStarMap.tsx lines 115-146 ----
function useBroadcastAnimations(broadcastActive: boolean, broadcasterId: string | null, targetSystem: number, range: number, subtype: string | undefined, replayMode?: boolean, isAutoAdvancing?: boolean): { animations: BroadcastAnimation[]; currentTime: number } {
  const localPlayerId = useLocalPlayerId();
  const [animations, setAnimations] = useState<BroadcastAnimation[]>([]);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    // 回放 seek 时不新建动画（自动播放则正常触发）
    if (replayMode && !isAutoAdvancing) {
      return;
    }
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
  }, [broadcastActive, broadcasterId, targetSystem, range, subtype, localPlayerId, replayMode, isAutoAdvancing]);

  return { animations, currentTime };
}

// ---- 迁移自 OnlineStarMap.tsx lines 150-173 ----
// P0-A2: 广播动画图层独立子组件，将 setInterval(50ms) 触发的 setCurrentTime 限制在子组件内部，
// 避免动画期间主 OnlineStarMap 整棵 SVG 树重渲染
interface BroadcastAnimationsLayerProps {
  broadcastActive: boolean;
  broadcasterId: string | null;
  targetSystem: number;
  range: number;
  subtype: string | undefined;
  replayMode?: boolean;
  isAutoAdvancing?: boolean;
}

const BroadcastAnimationsLayer = memo(function BroadcastAnimationsLayer({
  broadcastActive, broadcasterId, targetSystem, range, subtype, replayMode, isAutoAdvancing,
}: BroadcastAnimationsLayerProps) {
  const { animations, currentTime } = useBroadcastAnimations(
    broadcastActive, broadcasterId, targetSystem, range, subtype, replayMode, isAutoAdvancing
  );
  return (
    <>
      {animations.map(anim => (
        <BroadcastRangeIndicator key={anim.id} targetSystem={anim.targetSystem} range={anim.range} isOwn={anim.isOwn} phase={anim.phase} startTime={anim.startTime} currentTime={currentTime} />
      ))}
    </>
  );
});

// ---- 迁移自 OnlineStarMap.tsx lines 175-222 ----
function BroadcastRangeIndicator({ targetSystem, range, isOwn, phase, startTime, currentTime }: {
  targetSystem: number; range: number; isOwn: boolean; phase: string; startTime: number; currentTime: number;
}) {
  const targetNode = STAR_NODE_MAP.get(targetSystem);
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
        const node = STAR_NODE_MAP.get(systemId);
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

// ---- 迁移自 OnlineStarMap.tsx lines 224-262 ----
// 广播可能位置半透明标记：对广播范围内每个星系叠加光晕，提示玩家从范围逆推可能位置
// 与 BroadcastRangeIndicator（动画）解耦：直接从 gameState.broadcast 读取，持续显示而非动画
function PossiblePositionIndicator({ targetSystem, range, broadcasterId, players }: {
  targetSystem: number;
  range: number;
  broadcasterId: string;
  players: Array<Player | PlayerView>;
}) {
  const inRangeSystems = useMemo(() => getSystemsInRange(targetSystem, range), [targetSystem, range]);

  // 在线模式对手 position 被脱敏为 -1（见 viewState.ts createViewState），此时无法确认广播者实际所在星系
  const broadcaster = players.find(p => p.id === broadcasterId);
  const broadcasterPos = broadcaster?.position ?? -1;
  const broadcasterVisible = broadcasterPos > 0;

  return (
    <g className="possible-position-indicator">
      {inRangeSystems.map(systemId => {
        const node = STAR_NODE_MAP.get(systemId);
        if (!node) return null;
        const isKnownBroadcaster = broadcasterVisible && systemId === broadcasterPos;
        if (isKnownBroadcaster) {
          // 广播者已知位置：绿色实心边缘 + 浅色填充
          return (
            <circle key={`possible-pos-${systemId}`} cx={node.x} cy={node.y} r={3.5}
              fill="#22c55e" fillOpacity={0.15}
              stroke="#22c55e" strokeOpacity={0.85} strokeWidth={0.4} />
          );
        }
        // 接收者可能位置（含广播者位置不可见时的广播者所在星系）：琥珀色半透明填充
        return (
          <circle key={`possible-pos-${systemId}`} cx={node.x} cy={node.y} r={3.5}
            fill="#f59e0b" fillOpacity={0.32}
            stroke="#f59e0b" strokeOpacity={0.45} strokeWidth={0.3} />
        );
      })}
    </g>
  );
}

// ---- 迁移自 OnlineStarMap.tsx lines 264-286 ----
// 残留可能位置标记：已结束广播的淡化光晕，用灰色与"正在进行"的琥珀色/绿色标记区分
// 与 PossiblePositionIndicator 视觉一致（半透明光晕叠加在范围内每个星系），但颜色和透明度不同
// 整体透明度通过 SVG <g opacity> 控制，按年龄递减：0 岁 0.4 / 1 岁 0.25 / 2 岁 0.1 / 3 岁移除
function ResidualPositionIndicator({ targetSystem, range, opacity }: {
  targetSystem: number;
  range: number;
  opacity: number;
}) {
  const inRangeSystems = useMemo(() => getSystemsInRange(targetSystem, range), [targetSystem, range]);
  return (
    <g className="residual-position-indicator" opacity={opacity}>
      {inRangeSystems.map(systemId => {
        const node = STAR_NODE_MAP.get(systemId);
        if (!node) return null;
        return (
          <circle key={`residual-pos-${systemId}`} cx={node.x} cy={node.y} r={3.5}
            fill="#9ca3af" fillOpacity={0.32}
            stroke="#9ca3af" strokeOpacity={0.45} strokeWidth={0.3} />
        );
      })}
    </g>
  );
}

// ---- 主组件 ----
interface BroadcastMarkersLayerProps {
  replayMode?: boolean;
  isAutoAdvancing?: boolean;
  // 回放模式用 props（在线模式由 selector 兜底）
  broadcast?: BroadcastState | BroadcastStateView | null;
  players?: Array<Player | PlayerView>;
  totalTurn?: number;
}

function BroadcastMarkersLayerComponent({
  replayMode,
  isAutoAdvancing,
  broadcast: propBroadcast,
  players: propPlayers,
  totalTurn: propTotalTurn,
}: BroadcastMarkersLayerProps) {
  // 在线模式用 selector；回放模式用 props
  const storeBroadcast = useBroadcast();
  const storePlayers = usePlayers();
  const storeTotalTurn = useTotalTurn();
  const broadcast = propBroadcast ?? storeBroadcast;
  const playersList = propPlayers ?? storePlayers;
  const totalTurn = propTotalTurn ?? storeTotalTurn;

  // 派生字段
  const broadcastActive = !!broadcast;
  const broadcasterId = broadcast?.broadcasterId ?? null;
  const targetSystem = broadcast?.targetSystem ?? 0;
  const range = broadcast?.range ?? 1;
  const subtype = broadcast?.subtype;

  // 残留广播标记 state + refs（迁移自 OnlineStarMap.tsx lines 589-591）
  const [residualMarkers, setResidualMarkers] = useState<ResidualMarker[]>([]);
  const prevBroadcastActiveRef = useRef<boolean>(false);
  const prevBroadcastPhaseRef = useRef<string>('');

  // 监听 broadcast phase 变化（迁移自 lines 595-611）：
  // 从激活（active && phase !== 'done'）→ 结束时推入残留队列
  // key 用 broadcasterId-targetSystem-range-endTurn 组合，避免同一广播被重复推入
  useEffect(() => {
    const wasActive = prevBroadcastActiveRef.current && prevBroadcastPhaseRef.current !== 'done';
    const isDone = !broadcastActive || broadcast?.phase === 'done';
    const currentTurn = totalTurn ?? 0;

    if (wasActive && isDone && broadcasterId && targetSystem) {
      const key = `${broadcasterId}-${targetSystem}-${range}-${currentTurn}`;
      // 推入前检查残留队列是否已有相同 key，避免重复
      setResidualMarkers(prev => {
        if (prev.some(m => m.key === key)) return prev;
        return [...prev, { key, targetSystem, range, broadcasterId, endTurn: currentTurn }];
      });
    }

    prevBroadcastActiveRef.current = broadcastActive;
    prevBroadcastPhaseRef.current = broadcast?.phase ?? '';
  }, [broadcastActive, broadcast?.phase, broadcasterId, targetSystem, range, totalTurn]);

  // 按当前回合移除年龄 ≥ 3 的残留标记（迁移自 lines 615-623）
  // 使用 filter 后比较长度避免无变化时返回新引用导致无谓重渲染
  // 注意：原代码依赖 gameStateExists，本图层不订阅 gameState 存在性，
  // 改用 totalTurn != null 作为存在性判断（totalTurn 仅在 gameState 非 null 时有值）
  useEffect(() => {
    if (totalTurn == null) return;
    const currentTurn = totalTurn;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResidualMarkers(prev => {
      const filtered = prev.filter(m => currentTurn - m.endTurn < 3);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [totalTurn]);

  return (
    <>
      <BroadcastAnimationsLayer
        broadcastActive={broadcastActive}
        broadcasterId={broadcasterId}
        targetSystem={targetSystem}
        range={range}
        subtype={subtype}
        replayMode={replayMode}
        isAutoAdvancing={isAutoAdvancing}
      />

      {/* 广播可能位置半透明标记：广播激活期间对范围内每个星系叠加光晕，便于逆推可能位置 */}
      {broadcast && broadcast.phase !== 'done' && broadcasterId && (
        <PossiblePositionIndicator targetSystem={targetSystem} range={range} broadcasterId={broadcasterId} players={playersList} />
      )}

      {/* 残留广播标记：已结束广播的淡化灰色光晕，按年龄（currentTurn - endTurn）递减透明度，3 回合后移除 */}
      {residualMarkers.map(marker => {
        const age = (totalTurn ?? 0) - marker.endTurn;
        // 0 岁 0.4 / 1 岁 0.25 / 2 岁 0.1 / ≥3 岁已在 effect 中移除，此处兜底返回 null
        const opacity = age <= 0 ? 0.4 : age === 1 ? 0.25 : age === 2 ? 0.1 : 0;
        if (opacity === 0) return null;
        return (
          <ResidualPositionIndicator
            key={marker.key}
            targetSystem={marker.targetSystem}
            range={marker.range}
            opacity={opacity}
          />
        );
      })}
    </>
  );
}

export const BroadcastMarkersLayer = memo(BroadcastMarkersLayerComponent);
