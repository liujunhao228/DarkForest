import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useMapStore } from '@/store/mapStore';
import { useFlyingStrikes, useLogs, usePlayers } from '@/store/onlineGameStore/selectors';
import { getOwnerColor } from '@/lib/game/strikeStyles';
import { toast } from 'sonner';
import type { FlyingStrike, Player } from '@/lib/game/types';
import type { FlyingStrikeView, PlayerView } from '@/lib/game/viewState';
import type { Explosion } from './types';

interface StrikeExplosionsLayerProps {
  replayMode?: boolean;
  replayStateIndex?: number;
  isAutoAdvancing?: boolean;
  // 回放模式用 props（在线模式由 selector 兜底）
  flyingStrikes?: Array<FlyingStrike | FlyingStrikeView>;
  players?: Array<Player | PlayerView>;
}

function StrikeExplosionsLayerComponent({
  replayMode,
  replayStateIndex,
  isAutoAdvancing,
  flyingStrikes: propStrikes,
  players: propPlayers,
}: StrikeExplosionsLayerProps) {
  // 在线模式用 selector；回放模式用 props
  const storeLogs = useLogs();
  const storeStrikes = useFlyingStrikes();
  const storePlayers = usePlayers();
  // P1：节点坐标从 useMapStore 订阅（替代旧 STAR_NODE_MAP）
  const nodes = useMapStore(s => s.nodes);
  // 回放模式容器不传 logs prop（爆炸用 flyingStrikes diff 触发），所以始终用 selector
  const logs = storeLogs;
  const flyingStrikesList = propStrikes ?? storeStrikes;
  const playersList = propPlayers ?? storePlayers;

  // 节点 id → 坐标，替代旧 STAR_NODE_MAP.get()
  const nodeMap = useMemo(() => {
    const m = new Map<number, { x: number; y: number }>();
    for (const n of nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [nodes]);

  // 爆炸动画状态
  const [explosions, setExplosions] = useState<Explosion[]>([]);
  const lastLogId = useRef<string | null>(null); // 在线对局用
  // 联合类型：回放切片为 FlyingStrikeView，在线为 FlyingStrike，统一存储避免 as 断言
  const prevStrikesRef = useRef<Array<FlyingStrike | FlyingStrikeView> | null>(null); // 回放用

  // P1-6: 计算 lastCombatLog — 末尾 type === 'combat' 日志。
  // 用于将在线模式爆炸 effect 的依赖从整个 logs 数组收窄为单条日志 id，
  // 避免无新增 combat 日志时（如普通 fullSync）effect 重跑。
  const lastCombatLog = useMemo(() => {
    if (!logs || logs.length === 0) return null;
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].type === 'combat') return logs[i];
    }
    return null;
  }, [logs]);
  const lastCombatLogId = lastCombatLog?.id ?? null;

  // P1-6: 在线模式爆炸 effect 通过 ref 读取最新 flyingStrikesList/playersList，
  // 使 effect 依赖仅 [lastCombatLogId, replayMode]，fullSync 不再触发重跑
  // ref 在 effect 中更新（非 render 阶段），声明顺序保证爆炸 effect 读取到最新值
  const flyingStrikesListRef = useRef(flyingStrikesList);
  const playersListRef = useRef(playersList);
  useEffect(() => { flyingStrikesListRef.current = flyingStrikesList; }, [flyingStrikesList]);
  useEffect(() => { playersListRef.current = playersList; }, [playersList]);

  // 回放模式爆炸 effect：对比前后 flyingStrikes，找出"消失的 strike"（已生效/已落空）
  useEffect(() => {
    if (!replayMode) return;
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
  }, [replayMode, flyingStrikesList, playersList]);

  // P1-6: 在线模式爆炸 effect — 依赖收窄为 [lastCombatLogId, replayMode, lastCombatLog]
  // 仅当新增 combat 日志时触发；flyingStrikesList/playersList 通过 ref 读取最新值
  useEffect(() => {
    if (replayMode) return;
    if (!lastCombatLog) return;
    // 去重：已触发过的 combat log id 不再触发（替代原 lastLogId.current 守卫）
    if (lastLogId.current === lastCombatLog.id) return;
    lastLogId.current = lastCombatLog.id;

    const match = lastCombatLog.message.match(/宣布【.+】在星系 (\d+) 生效/);
    // 仅当日志消息匹配"打击生效"格式时才触发动画/Toast，systemId 字段只作为星系号来源
    if (!match) return;
    const fallbackSystemId = parseInt(match[1], 10);
    const systemId = lastCombatLog.systemId ?? fallbackSystemId;
    if (systemId === undefined) return;
    const explosionId = `exp-${systemId}-${Date.now()}`;
    // 从飞行打击列表中查找目标星系对应的打击以解析发出者颜色，找不到则回退红色
    const currentFlyingStrikes = flyingStrikesListRef.current;
    const ownerStrike = currentFlyingStrikes.find(s => s.targetSystem === systemId);
    const color = ownerStrike ? getOwnerColor(ownerStrike.ownerId, playersListRef.current) : '#ef4444';
    // 异步更新状态（避免在 effect body 中同步 setState）
    const addTimer = setTimeout(() => {
      setExplosions(prev => [...prev, { id: explosionId, systemId, color }]);
      toast.success('打击生效！', { description: `星系 ${systemId} 受到打击` });
    }, 0);
    const removeTimer = setTimeout(() => {
      setExplosions(prev => prev.filter(e => e.id !== explosionId));
    }, 2000);
    return () => { clearTimeout(addTimer); clearTimeout(removeTimer); };
  }, [lastCombatLogId, lastCombatLog, replayMode]);

  // 回放 seek 跳转/后退时重置 diff ref，避免错误触发动画
  useEffect(() => {
    if (replayMode && !isAutoAdvancing && replayStateIndex !== undefined) {
      prevStrikesRef.current = null;
      // seek 时清理残留爆炸动画属必要的重置场景
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExplosions([]);
    }
  }, [replayMode, isAutoAdvancing, replayStateIndex]);

  return (
    <>
      {/* 打击生效爆炸动画：外圈按发出者着色 */}
      {explosions.map(exp => {
        const node = nodeMap.get(exp.systemId);
        if (!node) return null;
        return (
          <g key={exp.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r="2"
              fill="none"
              stroke={exp.color}
              strokeWidth="0.5"
              style={{ animation: 'explosion-outer-r 2s linear forwards, explosion-outer-opacity 2s linear forwards' }}
            />
            <circle
              cx={node.x}
              cy={node.y}
              r="1"
              fill="#fbbf24"
              style={{ animation: 'explosion-inner-r 1.2s linear forwards, explosion-inner-opacity 1.2s linear forwards' }}
            />
          </g>
        );
      })}
    </>
  );
}

export const StrikeExplosionsLayer = memo(StrikeExplosionsLayerComponent);
