import { memo, useMemo } from 'react';
import { STAR_NODE_MAP } from '@/lib/game/starmap';
import type { PinMarker, RegionMarker } from '@/hooks/useStarMapMarkers';
import type { MarkingTool } from './types';
import { truncateToFirstLine } from './utils';

interface RegionRenderDatum {
  region: RegionMarker;
  nodes: NonNullable<ReturnType<typeof STAR_NODE_MAP.get>>[];
  cx: number;
  cy: number;
  truncated: string;
}

function computeRegionRenderData(regions: RegionMarker[]): RegionRenderDatum[] {
  return regions.map((region) => {
    const nodes = region.systemIds
      .map((id) => STAR_NODE_MAP.get(id))
      .filter((n): n is NonNullable<typeof n> => n != null);
    if (nodes.length === 0) return null;
    const cx = nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length;
    const cy = nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length;
    const truncated = truncateToFirstLine(region.note);
    return { region, nodes, cx, cy, truncated };
  }).filter((r): r is NonNullable<typeof r> => r != null);
}

// ============ Background: 区域高亮圆 ============
interface MarkingOverlayLayerBackgroundProps {
  regions: RegionMarker[];
}

function MarkingOverlayLayerBackgroundComponent({ regions }: MarkingOverlayLayerBackgroundProps) {
  const regionRenderData = useMemo(() => computeRegionRenderData(regions), [regions]);
  return (
    <>
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
    </>
  );
}

export const MarkingOverlayLayerBackground = memo(MarkingOverlayLayerBackgroundComponent);

// ============ Foreground: 图钉 + 注释文字 + 选择集 ring ============
interface MarkingOverlayLayerForegroundProps {
  pins: PinMarker[];
  regions: RegionMarker[];
  selectedSystems: Set<number>;
  isMarking: boolean;
  activeTool: MarkingTool;
}

function MarkingOverlayLayerForegroundComponent({
  pins,
  regions,
  selectedSystems,
  isMarking,
  activeTool,
}: MarkingOverlayLayerForegroundProps) {
  const regionRenderData = useMemo(() => computeRegionRenderData(regions), [regions]);

  return (
    <>
      {/* 玩家图钉标记：实心圆针头 + 三角尾巴指向星系，白色描边在深色背景上突出，与半透明光晕视觉明确区分 */}
      {pins.map((pin) => {
        const node = STAR_NODE_MAP.get(pin.systemId);
        if (!node) return null;
        return (
          <g key={`pin-${pin.id}`} pointerEvents="none">
            {/* 注释 tooltip：note 非空时挂载 SVG <title> 子元素，浏览器原生 hover 显示完整注释（移动端无 hover 由管理面板承担） */}
            {pin.note ? <title>{pin.note}</title> : null}
            {/* 三角尾巴：从星系表面指向针头底部 */}
            <polygon
              points={`${node.x},${node.y - 1.5} ${node.x - 0.5},${node.y - 2.6} ${node.x + 0.5},${node.y - 2.6}`}
              fill={pin.color}
              stroke="white"
              strokeWidth="0.25"
              strokeLinejoin="round"
            />
            {/* 针头：实心圆，放置时弹出动画（fill="freeze" 仅在新节点插入时播放） */}
            <circle cx={node.x} cy={node.y - 4.2} r={0} fill={pin.color} stroke="white" strokeWidth="0.4"
              style={{ animation: 'pin-pop 0.35s ease-out forwards' }} />
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
            strokeDasharray="1 0.5" pointerEvents="none"
            style={{ animation: 'pulse-select 1.2s ease-in-out infinite' }} />
        );
      })}
    </>
  );
}

export const MarkingOverlayLayerForeground = memo(MarkingOverlayLayerForegroundComponent);
