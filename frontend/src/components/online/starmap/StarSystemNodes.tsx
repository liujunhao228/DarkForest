import { memo, useCallback, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { STAR_NODES } from '@/lib/game/starmap';
import { useDestroyedStars, useFlyingStrikes, usePlayers, useStarEffects } from '@/store/onlineGameStore/selectors';
import { PLAYER_COLORS, STRIKE_SHAPES, getOwnerColor } from '@/lib/game/strikeStyles';
import { renderStrikeShape, renderDimFragments, SIZE_RADIUS } from './renderHelpers';
import type { MarkingTool } from './types';
import type { FlyingStrike, Player, StarEffect, StarSize } from '@/lib/game/types';
import type { FlyingStrikeView, PlayerView } from '@/lib/game/viewState';

interface StarSystemNodesProps {
  isCompact: boolean;
  isMarking: boolean;
  activeTool: MarkingTool;
  activeHighlights: number[];
  strikeMoveTargets: number[];
  interactiveMode: boolean;
  onSystemClick: (systemId: number) => void;
  // 回放模式用 props（在线模式由 selector 兜底）
  players?: Array<Player | PlayerView>;
  starEffects?: StarEffect[];
  destroyedStars?: number[];
  flyingStrikes?: Array<FlyingStrike | FlyingStrikeView>;
}

function StarSystemNodesComponent({
  isCompact,
  isMarking,
  activeTool,
  activeHighlights,
  strikeMoveTargets,
  interactiveMode,
  onSystemClick,
  players: propPlayers,
  starEffects: propEffects,
  destroyedStars: propDestroyed,
  flyingStrikes: propStrikes,
}: StarSystemNodesProps) {
  // 在线模式用 selector；回放模式用 props
  const storePlayers = usePlayers();
  const storeEffects = useStarEffects();
  const storeDestroyed = useDestroyedStars();
  const storeStrikes = useFlyingStrikes();
  const playersList = propPlayers ?? storePlayers;
  const starEffects = propEffects ?? storeEffects;
  const destroyedStars = propDestroyed ?? storeDestroyed;
  const flyingStrikesList = propStrikes ?? storeStrikes;

  // 紧凑模式缩放：星球半径按 0.7 缩；名牌字号从 3.5 → 2.5；星系 ID 字号 3.5 → 2.5
  // 注意：foreignObject 内 CSS 像素会随 SVG 缩放，3.5px 在 2.5x 缩放下约等于屏幕上 8.75px（接近原 10px 视觉）
  const COMPACT_SCALE = 0.7;
  const COMPACT_NAME_FONT = 2.5;
  const COMPACT_ID_FONT = 2.5;
  const REGULAR_NAME_FONT = 3.5;
  const REGULAR_ID_FONT = 3.5;
  const effectiveStarR = (size: StarSize) => (isCompact ? COMPACT_SCALE : 1) * SIZE_RADIUS[size];

  // 降维锁定星系集合
  // P1-5: 依赖收窄 — 仅依赖 starEffects（在线模式由 selector 提供稳定引用），避免 logs/players 等无关字段变化触发重算。
  const dimensionalLockedSystems = useMemo(() => {
    return new Set(
      starEffects
        .filter(e => e.type === 'dimensionalLock')
        .map(e => e.systemId)
    );
  }, [starEffects]);

  // 按位置分组的玩家
  const playersByPosition = useMemo(() => {
    const map: Record<number, Array<Player | PlayerView>> = {};
    for (const p of playersList) {
      if (p.eliminated || p.position === -1) continue;
      if (!map[p.position]) map[p.position] = [];
      map[p.position].push(p);
    }
    return map;
  }, [playersList]);

  // 按位置分组的打击
  const strikesByPosition = useMemo(() => {
    const map: Record<number, Array<FlyingStrike | FlyingStrikeView>> = {};
    for (const s of flyingStrikesList) {
      if (!map[s.position]) map[s.position] = [];
      map[s.position].push(s);
    }
    return map;
  }, [flyingStrikesList]);

  // 键盘可访问性：聚焦到可点击星系后按 Enter/Space 触发选择
  const handleSystemKeyDown = useCallback((systemId: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSystemClick(systemId);
    }
  }, [onSystemClick]);

  return (
    <>
      {STAR_NODES.map(node => {
        const playersHere = playersByPosition[node.id] || [];
        const strikesHere = strikesByPosition[node.id] || [];
        // 注意：incomingStealthHere 已移除（由 StealthStrikeLayer 承担）
        const isHighlighted = activeHighlights.includes(node.id);
        const hasStrikeTargets = strikeMoveTargets.includes(node.id);
        // 标记模式下所有星系均可点击（用于放置图钉），否则仅高亮星系可点击
        const isClickable = (interactiveMode && isHighlighted) || isMarking;
        const isDestroyed = destroyedStars?.includes(node.id);
        const isDimLocked = dimensionalLockedSystems.has(node.id);

        const starR = effectiveStarR(node.size);
        const idFontSize = isCompact ? COMPACT_ID_FONT : REGULAR_ID_FONT;
        return (
          <g key={`node-${node.id}`}>
            {/* 触屏命中区：透明圆扩大可点击区域至 ~44px 等效，仅可点击时渲染 */}
            {isClickable && (
              <circle
                cx={node.x}
                cy={node.y}
                r={Math.max(starR + 4, 6)}
                fill="transparent"
                style={{ cursor: isMarking ? 'crosshair' : 'pointer' }}
                onClick={() => onSystemClick(node.id)}
                onKeyDown={handleSystemKeyDown(node.id)}
                role="button"
                aria-label={isMarking ? (activeTool === 'pin' ? `在星系 ${node.id} 放置图钉` : `切换星系 ${node.id} 的区域选择`) : `选择星系 ${node.id}`}
                tabIndex={0}
              />
            )}
            {/* 光晕：降维星系用灰色 dimGlow，打击目标用红色 strikeGlow，默认 starGlow */}
            {isDimLocked ? (
              <rect
                x={node.x - (starR + 1.3)}
                y={node.y - (starR + 1.3)}
                width={(starR + 1.3) * 2}
                height={(starR + 1.3) * 2}
                fill="url(#dimGlow)"
              />
            ) : (
              <circle cx={node.x} cy={node.y} r={starR + 1.3} fill={hasStrikeTargets ? 'url(#strikeGlow)' : 'url(#starGlow)'} />
            )}

            {/* 主体：降维星系压成方形（二维化）+ 灰化；正常星系保持圆形 */}
            {isDimLocked ? (
              <>
                <rect
                  x={node.x - starR}
                  y={node.y - starR}
                  width={starR * 2}
                  height={starR * 2}
                  fill="#374151"
                  stroke={isHighlighted ? node.tint : '#6b7280'}
                  strokeWidth="0.4"
                  style={{ cursor: isMarking ? 'crosshair' : (isClickable ? 'pointer' : 'default'), pointerEvents: isClickable ? 'none' : 'auto' }}
                  filter="url(#glow)"
                >
                  {isHighlighted && <animate attributeName="stroke" values={`${node.tint};#ffffff;${node.tint}`} dur="1.5s" repeatCount="indefinite" />}
                </rect>
                <title>降维锁定 — 无法跃迁至该星系</title>
              </>
            ) : (
              <circle cx={node.x} cy={node.y} r={starR} fill={isDestroyed ? '#1a0a0a' : '#1e293b'}
                stroke={isHighlighted ? node.tint : isDestroyed ? '#7f1d1d' : '#475569'} strokeWidth="0.4"
                style={{ cursor: isMarking ? 'crosshair' : (isClickable ? 'pointer' : 'default'), pointerEvents: isClickable ? 'none' : 'auto' }}
                filter="url(#glow)">
                {isHighlighted && <animate attributeName="stroke" values={`${node.tint};#ffffff;${node.tint}`} dur="1.5s" repeatCount="indefinite" />}
              </circle>
            )}

            {isDestroyed && (
              <>
                <circle cx={node.x} cy={node.y} r={starR} fill="none" stroke="#dc2626" strokeWidth="0.3" strokeDasharray="0.5 0.5" opacity="0.6" />
                <line x1={node.x - starR * 0.68} y1={node.y - starR * 0.68} x2={node.x + starR * 0.68} y2={node.y + starR * 0.68} stroke="#dc2626" strokeWidth="0.3" opacity="0.5" />
                <line x1={node.x + starR * 0.68} y1={node.y - starR * 0.68} x2={node.x - starR * 0.68} y2={node.y + starR * 0.68} stroke="#dc2626" strokeWidth="0.3" opacity="0.5" />
              </>
            )}

            {/* 核点：降维星系变灰，正常/摧毁保持原有色 */}
            <circle cx={node.x} cy={node.y} r={starR * 0.36} fill={isDimLocked ? '#9ca3af' : (isDestroyed ? '#475569' : node.tint)} />

            {/* 降维星系周围的小方块碎片 */}
            {isDimLocked && renderDimFragments(node.x, node.y, starR, node.id)}
            <text x={node.x} y={node.y - starR - 1.5} textAnchor="middle" fill="#64748b" fontSize={idFontSize} fontFamily="monospace">{node.id}</text>

            {playersHere.map((player, idx: number) => {
              const angle = (idx / Math.max(playersHere.length, 1)) * Math.PI * 2 - Math.PI / 2;
              const radius = starR + 2;
              const px = node.x + Math.cos(angle) * radius;
              const py = node.y + Math.sin(angle) * radius;
              const nameColor = PLAYER_COLORS[player.color];
              // 名牌：位于 token 外侧（角度方向 + 1.5 SVG 单位），紧凑模式下仅首字符，常规模式显示 name + 能量
              const nameAnchorX = node.x + Math.cos(angle) * (radius + 1.5);
              const nameAnchorY = node.y + Math.sin(angle) * (radius + 1.5);
              // foreignObject 尺寸根据是否紧凑自适应：紧凑模式窄一点避免遮挡相邻 token
              // 高度设为 7 SVG 单位给文字与图标足够留白；overflow="visible" 让超长名字溢出而非被裁
              const nameBoxW = isCompact ? 10 : 24;
              const nameBoxH = 7;
              return (
                <g key={`player-${player.id}`}>
                  <circle cx={px} cy={py} r="1.5" fill={nameColor} stroke="rgba(0,0,0,0.5)" strokeWidth="0.3" />
                  <text x={px} y={py + 1} textAnchor="middle" fill="white" fontSize="2" fontWeight="bold">{player.name[0]}</text>
                  {/* 玩家名牌：搬入 SVG 与 token 同坐标系，绕过 absolute 越界问题 */}
                  {/* overflow="visible" 让 HTML 浮出 foreignObject 边界，避免被 viewBox 裁切 */}
                  {/* transform 居中：x 锚点为名-box 中心，先减半宽再 translateX(-50%)；为简化采用左对齐 + 偏移 */}
                  <foreignObject
                    x={nameAnchorX - nameBoxW / 2}
                    y={nameAnchorY - nameBoxH / 2}
                    width={nameBoxW}
                    height={nameBoxH}
                    overflow="visible"
                    pointerEvents="none"
                  >
                    <div
                      // SVG 规范要求 foreignObject 内的 HTML 显式声明 xhtml 命名空间
                      // 但 React @types 不接受 div 上的 xmlns 属性，用 Record<string,string> 类型安全地塞入
                      {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as Record<string, string>)}
                      className="name-chip"
                      style={{
                        backgroundColor: `${nameColor}22`,
                        borderColor: `${nameColor}66`,
                        color: nameColor,
                        fontSize: isCompact ? `${COMPACT_NAME_FONT}px` : `${REGULAR_NAME_FONT}px`,
                      }}
                    >
                      {isCompact ? (
                        <span>{player.name[0]}</span>
                      ) : (
                        <>
                          <span className="name-chip__name">{player.name}</span>
                          <span className="name-chip__energy">
                            <Zap className="name-chip__icon" />{player.energy}
                          </span>
                        </>
                      )}
                    </div>
                  </foreignObject>
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
          </g>
        );
      })}
    </>
  );
}

export const StarSystemNodes = memo(StarSystemNodesComponent);
