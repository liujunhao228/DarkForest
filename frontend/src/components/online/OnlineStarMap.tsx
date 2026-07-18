import { memo, useMemo, useCallback, useEffect, useState, useRef } from 'react';
import { STAR_NODES, STAR_EDGES, STAR_NODE_MAP, getSystemsInRange } from '@/lib/game/starmap';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { useStarMapMarkers } from '@/hooks/useStarMapMarkers';
import { Zap, MapPin, Shapes, Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Player, FlyingStrike, GameState, StarSize } from '@/lib/game/types';
import type { PlayerView, ViewState, FlyingStrikeView } from '@/lib/game/viewState';
import { PLAYER_COLORS, STRIKE_SHAPES, getOwnerColor, type StrikeShape } from '@/lib/game/strikeStyles';

// 标记模式工具类型：'pin' 图钉单点标记 / 'region' 区域高亮 + 文字注释
type MarkingTool = 'pin' | 'region';

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
  replayMode?: boolean;
  replayStateIndex?: number;
  isAutoAdvancing?: boolean;
  /** 星图标记模式：非 null 时点击星系放置图钉（而非触发 onSystemClick），ESC 退出 */
  markingMode?: { playerId: string; color: string } | null;
  /** 退出标记模式回调（由 ESC 键触发） */
  onExitMarkingMode?: () => void;
}

// P0-A3: 模块级空数组常量，替代组件内内联 || []，避免每次渲染产生新引用导致下游 useMemo 失效
const EMPTY_ARRAY_PLAYERS: Array<Player | PlayerView> = [];
const EMPTY_ARRAY_STRIKES: Array<FlyingStrike | FlyingStrikeView> = [];
const EMPTY_ARRAY_NUMBERS: number[] = [];

const BACKGROUND_STARS = [12,23,34,45,56,67,78,89,91,14,25,36,47,58,69,72,83,94,16,27,38,49,60,71,82,93,18,29,40,51,62,73,84,95,22,33,44,55,66,77].map((seed) => ({
  cx: ((seed * 7) % 97) + 1, cy: ((seed * 13) % 97) + 1, r: (seed % 3) * 0.1 + 0.1, opacity: ((seed % 5) * 0.1) + 0.2,
}));

// 星球个体半径档位（主体半径），用于打破统一圆形的机械感
const SIZE_RADIUS: Record<StarSize, number> = { sm: 1.8, md: 2.2, lg: 2.6 };

interface BroadcastAnimation {
  id: string; broadcasterId: string; targetSystem: number; range: number;
  isOwn: boolean; subtype: string; startTime: number; phase: 'expanding' | 'stable' | 'fading';
}

// 已结束广播的残留标记：广播结束后仍以淡灰色光晕显示可能位置，3 回合内逐步淡出
interface ResidualMarker {
  key: string;          // 唯一键，避免重复推入
  targetSystem: number;
  range: number;
  broadcasterId: string;
  endTurn: number;      // 广播结束时所在回合（用于计算年龄与移除）
}

const BROADCAST_ANIMATION_DURATION = 3000;
const BROADCAST_EXPAND_DURATION = 800;

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

function OnlineStarMapComponent({ gameState: propGameState, onSystemClick, highlightSystems = [], strikeMoveTargets = [], interactiveMode = false, replayMode, replayStateIndex, isAutoAdvancing, markingMode, onExitMarkingMode }: StarMapProps) {
  const storeGameState = useOnlineGameStore(s => s.gameState);
  const gameState = propGameState || storeGameState;

  // 星图标记：从 useStarMapMarkers 读取图钉/区域列表并获取 addPin/addRegion；标记模式下点击星系放置图钉或加入区域选择集
  const { pins, addPin, regions, addRegion } = useStarMapMarkers();
  const isMarking = markingMode != null;

  // 标记工具切换：默认 'pin'，markingMode 激活时由工具栏切换；切工具时清空区域选择集避免残留
  const [activeTool, setActiveTool] = useState<MarkingTool>('pin');
  // 区域模式选择集：点击星系 toggle 加入/移除，确认后调用 addRegion 并清空
  const [selectedSystems, setSelectedSystems] = useState<Set<number>>(new Set());
  // 区域注释输入 Dialog 状态
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteInput, setNoteInput] = useState('');

  // markingMode 关闭时重置工具与选择集，避免下次进入时残留旧状态
  // 采用渲染期间调整 state 的模式（参考 useStarMapMarkers.ts 中 roomId 变化重置），
  // 避免 effect 内同步 setState 触发级联渲染（react-hooks/set-state-in-effect）
  const [prevMarkingMode, setPrevMarkingMode] = useState(markingMode);
  if (markingMode !== prevMarkingMode) {
    setPrevMarkingMode(markingMode);
    if (!markingMode) {
      setActiveTool('pin');
      setSelectedSystems(new Set());
      setNoteDialogOpen(false);
      setNoteInput('');
    }
  }

  // 切换工具：同时清空选择集（pin 与 region 的"点击语义"不同，避免误用旧选择集）
  const switchTool = useCallback((tool: MarkingTool) => {
    setActiveTool((prev) => {
      if (prev === tool) return prev;
      setSelectedSystems(new Set());
      return tool;
    });
  }, []);

  // 清空区域选择集
  const clearSelection = useCallback(() => {
    setSelectedSystems(new Set());
  }, []);

  // 打开注释 Dialog：选择集为空时不允许
  const openNoteDialog = useCallback(() => {
    if (selectedSystems.size === 0) return;
    setNoteInput('');
    setNoteDialogOpen(true);
  }, [selectedSystems]);

  // 确认添加区域：调用 addRegion 后清空选择集，保持在区域模式以便继续标记
  const confirmNote = useCallback(() => {
    if (!markingMode || selectedSystems.size === 0) return;
    const note = noteInput.trim();
    if (!note) return;
    addRegion(Array.from(selectedSystems), markingMode.color, note);
    setSelectedSystems(new Set());
    setNoteInput('');
    setNoteDialogOpen(false);
  }, [markingMode, selectedSystems, noteInput, addRegion]);

  // 取消注释 Dialog：丢弃输入，回到选择状态（仍保留选择集以便再次确认）
  const cancelNoteDialog = useCallback(() => {
    setNoteDialogOpen(false);
    setNoteInput('');
  }, []);

  const broadcast = gameState?.broadcast;
  const broadcastActive = !!broadcast;
  const broadcasterId = broadcast?.broadcasterId ?? null;
  const targetSystem = broadcast?.targetSystem ?? 0;
  const range = broadcast?.range ?? 1;
  const subtype = broadcast?.subtype;

  // 星系点击：标记模式下按工具分支——pin 放图钉 / region toggle 选择集；否则透传 onSystemClick
  const handleSystemClick = useCallback((systemId: number) => {
    if (markingMode) {
      if (activeTool === 'pin') {
        addPin(systemId, markingMode.playerId, markingMode.color);
      } else {
        // 区域模式：toggle 加入/移除选择集（不直接放图钉）
        setSelectedSystems((prev) => {
          const next = new Set(prev);
          if (next.has(systemId)) next.delete(systemId);
          else next.add(systemId);
          return next;
        });
      }
      return;
    }
    onSystemClick?.(systemId);
  }, [markingMode, activeTool, addPin, onSystemClick]);

  // 键盘可访问性：聚焦到可点击星系后按 Enter/Space 触发选择（标记模式下同样放置图钉/切换选择）
  const handleSystemKeyDown = useCallback((systemId: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSystemClick(systemId);
    }
  }, [handleSystemClick]);

  // ESC 退出标记模式：仅在标记模式下监听全局 keydown；注释 Dialog 打开时跳过（让 Radix Dialog 先处理 ESC 关闭自身）
  useEffect(() => {
    if (!markingMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (noteDialogOpen) return;
        e.preventDefault();
        onExitMarkingMode?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [markingMode, onExitMarkingMode, noteDialogOpen]);

  // P0-A3: 稳定 useMemo 依赖，使用模块级 EMPTY_ARRAY 常量替代内联 || []，避免每次渲染产生新引用
  const playersList = gameState?.players ?? EMPTY_ARRAY_PLAYERS;
  const flyingStrikesList = gameState?.flyingStrikes ?? EMPTY_ARRAY_STRIKES;
  const destroyedStars = gameState?.destroyedStars ?? EMPTY_ARRAY_NUMBERS;

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

  // 直线路径：每个飞行中打击从当前位置直接指向目标星系，并附带发出者颜色
  const strikePaths = useMemo(() => {
    return flyingStrikesList
      .filter(s => s.position !== s.targetSystem)
      .map(s => {
        const from = STAR_NODE_MAP.get(s.position);
        const to = STAR_NODE_MAP.get(s.targetSystem);
        if (!from || !to) return null;
        const color = getOwnerColor(s.ownerId, playersList);
        return { uid: s.uid, from, to, color };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [flyingStrikesList, playersList]);

  // 打击生效动画：回放模式对比前后 flyingStrikes，在线模式监听 logs 末尾新增
  const [explosions, setExplosions] = useState<{ id: string; systemId: number; color: string }[]>([]);
  const lastLogId = useRef<string | null>(null); // 在线对局用
  const prevStrikesRef = useRef<FlyingStrikeView[] | null>(null); // 回放用

  useEffect(() => {
    if (replayMode) {
      // 回放模式：对比前后 flyingStrikes，找出"消失的 strike"（已生效/已落空）
      const prev = prevStrikesRef.current || [];
      const currentUids = new Set(flyingStrikesList.map(s => s.uid));
      const disappeared = prev.filter(s => !currentUids.has(s.uid));

      const addTimers: ReturnType<typeof setTimeout>[] = [];
      const removeTimers: ReturnType<typeof setTimeout>[] = [];

      for (const strike of disappeared) {
        const explosionId = `exp-${strike.targetSystem}-${Date.now()}-${strike.uid}`;
        const color = getOwnerColor(strike.ownerId, playersList);
        const t1 = setTimeout(() => {
          setExplosions(prev => [...prev, { id: explosionId, systemId: strike.targetSystem, color }]);
        }, 0);
        const t2 = setTimeout(() => {
          setExplosions(prev => prev.filter(e => e.id !== explosionId));
        }, 2000);
        addTimers.push(t1);
        removeTimers.push(t2);
      }

      prevStrikesRef.current = flyingStrikesList;
      return () => {
        addTimers.forEach(clearTimeout);
        removeTimers.forEach(clearTimeout);
      };
    }

    // 在线对局模式：保留原 logs 末尾匹配逻辑
    if (!gameState?.logs || gameState.logs.length === 0) return;
    const latestLog = gameState.logs[gameState.logs.length - 1];
    if (!latestLog || lastLogId.current === latestLog.id) return;
    lastLogId.current = latestLog.id;

    const match = latestLog.message.match(/宣布【.+】在星系 (\d+) 生效/);
    // 仅当日志消息匹配"打击生效"格式时才触发动画/Toast，systemId 字段只作为星系号来源
    if (!match) return;
    const fallbackSystemId = parseInt(match[1], 10);
    const systemId = latestLog.systemId ?? fallbackSystemId;
    if (systemId === undefined) return;
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
  }, [replayMode, flyingStrikesList, gameState?.logs, playersList]);

  // 回放 seek 跳转/后退时重置 diff ref，避免错误触发动画
  useEffect(() => {
    if (replayMode && !isAutoAdvancing && replayStateIndex !== undefined) {
      prevStrikesRef.current = null;
      // seek 时清理残留爆炸动画属必要的重置场景
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExplosions([]);
    }
  }, [replayMode, isAutoAdvancing, replayStateIndex]);

  // 残留广播标记：广播结束后记录 targetSystem/range/broadcasterId/endTurn，按回合淡出
  const [residualMarkers, setResidualMarkers] = useState<ResidualMarker[]>([]);
  const prevBroadcastActiveRef = useRef<boolean>(false);
  const prevBroadcastPhaseRef = useRef<string>('');

  // 监听 broadcast phase 变化：从激活（active && phase !== 'done'）→ 结束时推入残留队列
  // key 用 broadcasterId-targetSystem-range-endTurn 组合，避免同一广播被重复推入
  useEffect(() => {
    const wasActive = prevBroadcastActiveRef.current && prevBroadcastPhaseRef.current !== 'done';
    const isDone = !broadcastActive || broadcast?.phase === 'done';
    const currentTurn = gameState?.totalTurn ?? 0;

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
  }, [broadcastActive, broadcast?.phase, broadcasterId, targetSystem, range, gameState?.totalTurn]);

  // 按当前回合移除年龄 ≥ 3 的残留标记（年龄 = currentTurn - endTurn）
  // 使用 filter 后比较长度避免无变化时返回新引用导致无谓重渲染
  useEffect(() => {
    if (!gameState) return;
    const currentTurn = gameState.totalTurn;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResidualMarkers(prev => {
      const filtered = prev.filter(m => currentTurn - m.endTurn < 3);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [gameState?.totalTurn, gameState]);

  // 区域高亮渲染数据：解析每个 region 的星系节点、中心点（坐标平均值）与截断注释
  // 注释超过 MAX_NOTE_LEN 字符时常态截断为「前 N 字 + …」，hover 通过 SVG <title> 显示完整注释
  const MAX_NOTE_LEN = 12;
  const regionRenderData = useMemo(() => {
    return regions.map((region) => {
      const nodes = region.systemIds
        .map((id) => STAR_NODE_MAP.get(id))
        .filter((n): n is NonNullable<typeof n> => n != null);
      if (nodes.length === 0) return null;
      const cx = nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length;
      const cy = nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length;
      const truncated = region.note.length > MAX_NOTE_LEN
        ? `${region.note.slice(0, MAX_NOTE_LEN)}…`
        : region.note;
      return { region, nodes, cx, cy, truncated };
    }).filter((r): r is NonNullable<typeof r> => r != null);
  }, [regions]);

  if (!gameState) return null;

  return (
    <div className={`relative w-full aspect-[16/10] max-w-[800px] mx-auto ${isMarking ? 'cursor-crosshair ring-2 ring-amber-400/60 rounded-lg' : ''}`}>
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
          const from = STAR_NODE_MAP.get(edge.from)!;
          const to = STAR_NODE_MAP.get(edge.to)!;
          return (
            <g key={`edge-${i}`}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(100,130,180,0.25)" strokeWidth="0.4" strokeDasharray="1 0.5" />
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(100,150,200,0.08)" strokeWidth="1.2" />
            </g>
          );
        })}

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
          const age = (gameState?.totalTurn ?? 0) - marker.endTurn;
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
          const node = STAR_NODE_MAP.get(exp.systemId);
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
          const node = STAR_NODE_MAP.get(systemId)!;
          return (
            <circle key={`highlight-${systemId}`} cx={node.x} cy={node.y} r="6" fill="url(#highlightGlow)" className="animate-pulse">
              <animate attributeName="r" values="5;7;5" dur="2s" repeatCount="indefinite" />
            </circle>
          );
        })}

        {/* 区域高亮标记 - 圆形覆盖层：在星系之下，半透明大圆覆盖每个星系，不遮挡星系本体 */}
        {regionRenderData.map(({ region, nodes }) => (
          <g key={`region-circles-${region.id}`} pointerEvents="none">
            {nodes.map((n) => (
              <circle key={`region-circle-${region.id}-${n.id}`} cx={n.x} cy={n.y} r={4.5}
                fill={region.color} fillOpacity={0.3}
                stroke={region.color} strokeOpacity={0.5} strokeWidth={0.3} />
            ))}
          </g>
        ))}

        {STAR_NODES.map(node => {
          const playersHere = playersByPosition[node.id] || [];
          const strikesHere = strikesByPosition[node.id] || [];
          const incomingStealthHere = incomingStealthStrikesByTarget[node.id] || [];
          const isHighlighted = activeHighlights.includes(node.id);
          const hasStrikeTargets = strikeMoveTargets.includes(node.id);
          // 标记模式下所有星系均可点击（用于放置图钉），否则仅高亮星系可点击
          const isClickable = (interactiveMode && isHighlighted) || isMarking;
          const isDestroyed = destroyedStars?.includes(node.id);

          const starR = SIZE_RADIUS[node.size];
          return (
            <g key={`node-${node.id}`}>
              <circle cx={node.x} cy={node.y} r={starR + 1.3} fill={hasStrikeTargets ? 'url(#strikeGlow)' : 'url(#starGlow)'} />
              <circle cx={node.x} cy={node.y} r={starR} fill={isDestroyed ? '#1a0a0a' : '#1e293b'}
                stroke={isHighlighted ? node.tint : isDestroyed ? '#7f1d1d' : '#475569'} strokeWidth="0.4"
                style={{ cursor: isMarking ? 'crosshair' : (isClickable ? 'pointer' : 'default') }}
                onClick={() => isClickable && handleSystemClick(node.id)} role={isClickable ? 'button' : undefined}
                aria-label={isClickable ? (isMarking ? (activeTool === 'pin' ? `在星系 ${node.id} 放置图钉` : `切换星系 ${node.id} 的区域选择`) : `选择星系 ${node.id}`) : undefined} tabIndex={isClickable ? 0 : undefined}
                onKeyDown={isClickable ? handleSystemKeyDown(node.id) : undefined}
                filter="url(#glow)">
                {isHighlighted && <animate attributeName="stroke" values={`${node.tint};#ffffff;${node.tint}`} dur="1.5s" repeatCount="indefinite" />}
              </circle>

              {isDestroyed && (
                <>
                  <circle cx={node.x} cy={node.y} r={starR} fill="none" stroke="#dc2626" strokeWidth="0.3" strokeDasharray="0.5 0.5" opacity="0.6" />
                  <line x1={node.x - starR * 0.68} y1={node.y - starR * 0.68} x2={node.x + starR * 0.68} y2={node.y + starR * 0.68} stroke="#dc2626" strokeWidth="0.3" opacity="0.5" />
                  <line x1={node.x + starR * 0.68} y1={node.y - starR * 0.68} x2={node.x - starR * 0.68} y2={node.y + starR * 0.68} stroke="#dc2626" strokeWidth="0.3" opacity="0.5" />
                </>
              )}

              <circle cx={node.x} cy={node.y} r={starR * 0.36} fill={isDestroyed ? '#475569' : node.tint} />
              <text x={node.x} y={node.y - starR - 1.5} textAnchor="middle" fill="#64748b" fontSize="3.5" fontFamily="monospace">{node.id}</text>

              {playersHere.map((player, idx: number) => {
                const angle = (idx / Math.max(playersHere.length, 1)) * Math.PI * 2 - Math.PI / 2;
                const radius = starR + 2;
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
                const radius = starR + 1.4;
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

              {/* 隐逐跳打击：对非拥有者仅显示「距目标 N 跳」标记，不绘制路径与当前位置图标 */}
              {incomingStealthHere.map((strike, idx: number) => {
                const angle = (idx / Math.max(incomingStealthHere.length, 1)) * Math.PI * 2 - Math.PI / 4;
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
              })}
            </g>
          );
        })}

        {/* 玩家图钉标记：实心圆针头 + 三角尾巴指向星系，白色描边在深色背景上突出，与半透明光晕视觉明确区分 */}
        {pins.map((pin) => {
          const node = STAR_NODE_MAP.get(pin.systemId);
          if (!node) return null;
          return (
            <g key={`pin-${pin.id}`} pointerEvents="none">
              {/* 三角尾巴：从星系表面指向针头底部 */}
              <polygon
                points={`${node.x},${node.y - 1.5} ${node.x - 0.5},${node.y - 2.6} ${node.x + 0.5},${node.y - 2.6}`}
                fill={pin.color}
                stroke="white"
                strokeWidth="0.25"
                strokeLinejoin="round"
              />
              {/* 针头：实心圆，放置时弹出动画（fill="freeze" 仅在新节点插入时播放） */}
              <circle cx={node.x} cy={node.y - 4.2} r={1.6} fill={pin.color} stroke="white" strokeWidth="0.4">
                <animate attributeName="r" values="0;2.2;1.6" dur="0.35s" fill="freeze" />
              </circle>
            </g>
          );
        })}

        {/* 区域注释文字：在星系之上确保可读，使用 paintOrder="stroke" 描黑边增强对比；hover 文字显示完整注释（<title>） */}
        {regionRenderData.map(({ region, cx, cy, truncated }) => (
          <text key={`region-note-${region.id}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
            fill={region.color} fontSize="2.8" fontWeight="bold"
            stroke="#000" strokeWidth="0.7" paintOrder="stroke"
            pointerEvents="all" style={{ cursor: 'help' }}>
            <title>{region.note}</title>
            {truncated}
          </text>
        ))}

        {/* 区域模式选择集临时高亮：被选中的星系显示琥珀色虚线 ring + 呼吸动画，与已确认区域的半透明圆区分 */}
        {isMarking && activeTool === 'region' && Array.from(selectedSystems).map((systemId) => {
          const node = STAR_NODE_MAP.get(systemId);
          if (!node) return null;
          return (
            <circle key={`sel-${systemId}`} cx={node.x} cy={node.y} r={3.6}
              fill="none" stroke="#fbbf24" strokeWidth="0.6"
              strokeDasharray="1 0.5" pointerEvents="none">
              <animate attributeName="stroke-opacity" values="0.55;1;0.55" dur="1.2s" repeatCount="indefinite" />
            </circle>
          );
        })}
      </svg>

      <div className="absolute inset-0 pointer-events-none">
        {playersList.filter((p) => !p.eliminated && p.position !== -1).map((player) => {
          const node = STAR_NODE_MAP.get(player.position);
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

      {/* 标记模式工具栏：顶部居中，含图钉/区域工具切换 + 提示文字 + 区域模式下的选择集操作按钮 */}
      {isMarking && (
        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-950/90 border border-amber-500/60 text-amber-300 text-[11px] font-medium shadow-lg">
          {/* 工具切换：图钉 / 区域 互斥 */}
          <button
            type="button"
            onClick={() => switchTool('pin')}
            title="图钉模式：单点标记"
            className={`flex items-center justify-center rounded px-1.5 py-0.5 transition-colors ${activeTool === 'pin' ? 'bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/50' : 'text-amber-400 hover:bg-amber-500/20'}`}
          >
            <MapPin className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => switchTool('region')}
            title="区域模式：多选星系 + 注释"
            className={`flex items-center justify-center rounded px-1.5 py-0.5 transition-colors ${activeTool === 'region' ? 'bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/50' : 'text-amber-400 hover:bg-amber-500/20'}`}
          >
            <Shapes className="w-3 h-3" />
          </button>

          <span className="text-amber-500/40">|</span>

          <span className="text-[10px] whitespace-nowrap">
            {activeTool === 'pin'
              ? '图钉模式：点击星系放置图钉，ESC 退出'
              : '区域模式：点击星系选择区域，确认后添加注释'}
          </span>

          {/* 区域模式额外操作：已选数量 + 清空 + 确认 */}
          {activeTool === 'region' && (
            <>
              <span className="text-amber-500/40">|</span>
              <span className="text-[10px] tabular-nums">已选 {selectedSystems.size}</span>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectedSystems.size === 0}
                title="清空选择"
                className="flex items-center justify-center rounded px-1.5 py-0.5 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Trash2 className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={openNoteDialog}
                disabled={selectedSystems.size === 0}
                title="确认区域并添加注释"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/50 hover:bg-amber-500/40 transition-colors disabled:opacity-40 disabled:hover:bg-amber-500/30 disabled:ring-0 disabled:cursor-not-allowed"
              >
                <Check className="w-3 h-3" /> 确认
              </button>
            </>
          )}
        </div>
      )}

      {/* 区域注释输入 Dialog：确认选择集后弹出，输入注释调用 addRegion */}
      <Dialog open={noteDialogOpen} onOpenChange={(open) => { if (!open) cancelNoteDialog(); }}>
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>添加区域注释</DialogTitle>
            <DialogDescription>
              已选择 {selectedSystems.size} 个星系，输入注释后将在星图上显示半透明高亮与文字。按 Ctrl/⌘ + Enter 快速确认。
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="例如：玩家可能藏身于此区域"
            autoFocus
            className="w-full min-h-[80px] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                confirmNote();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={cancelNoteDialog}>取消</Button>
            <Button onClick={confirmNote} disabled={!noteInput.trim()}>确认添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const OnlineStarMap = memo(OnlineStarMapComponent);
