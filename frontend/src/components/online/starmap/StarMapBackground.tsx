import { memo, useMemo } from 'react';
import { useMapStore } from '@/store/mapStore';
import { BACKGROUND_STARS } from './renderHelpers';

// 纯静态背景层：渲染 <defs> 渐变/滤镜、底色 + nebula 渐变、背景星点、星图边
// P1：星图边数据从 useMapStore 订阅（后端单一数据源），nodes 仅用于坐标查找
function StarMapBackgroundComponent() {
  const edges = useMapStore(s => s.edges);
  const nodes = useMapStore(s => s.nodes);
  // 节点 id → 坐标，替代旧 STAR_NODE_MAP.get()
  const nodeMap = useMemo(() => {
    const m = new Map<number, { x: number; y: number }>();
    for (const n of nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [nodes]);

  return (
    <>
      <defs>
        <radialGradient id="starGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(255,255,255,0.3)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
        <radialGradient id="highlightGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(34,197,94,0.6)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
        <radialGradient id="strikeGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(239,68,68,0.8)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
        <radialGradient id="dimGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(156,163,175,0.25)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
        {/* 毁星余烬光晕：内橙红余温 → 中暗红 → 外透明（StarSystemNodes 毁星分支专用） */}
        <radialGradient id="emberGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(194,65,12,0.30)" /><stop offset="55%" stopColor="rgba(154,52,18,0.12)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
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

      {edges.map((edge, i) => {
        const from = nodeMap.get(edge.from);
        const to = nodeMap.get(edge.to);
        if (!from || !to) return null;
        return (
          <g key={`edge-${i}`}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(100,130,180,0.25)" strokeWidth="0.4" strokeDasharray="1 0.5" />
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(100,150,200,0.08)" strokeWidth="1.2" />
          </g>
        );
      })}
    </>
  );
}

export const StarMapBackground = memo(StarMapBackgroundComponent);
