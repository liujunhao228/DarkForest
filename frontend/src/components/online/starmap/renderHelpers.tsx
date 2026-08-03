import type { StarSize } from '@/lib/game/types';
import type { StrikeShape } from '@/lib/game/strikeStyles';

// 按打击类型渲染对应几何形状（弹丸标记），填充发出者颜色
export function renderStrikeShape(shape: StrikeShape, cx: number, cy: number, color: string) {
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

// 毁星星系的火星粒子：自星核向外缓慢漂移并消散，模拟死星余烬
// 使用基于 systemId 的确定性伪随机，避免每次渲染轨迹跳动；
// 位移通过 CSS 变量 --dx/--dy 注入 ember-drift keyframes，逐粒子错开 delay
export function renderEmberParticles(cx: number, cy: number, r: number, systemId: number) {
  const count = 3;
  const particles = [];
  for (let i = 0; i < count; i++) {
    const seed = systemId * 11 + i * 17;
    const angle = ((seed % 360) / 360) * Math.PI * 2 + (i * Math.PI * 2) / count;
    const dist = r + 1.2 + ((seed * 3) % 100) / 100 * 0.8;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    // 6-9s 漂移周期 + 周期内错开的延迟，让火星偶发出现而非齐发
    const dur = 6 + ((seed * 7) % 100) / 100 * 3;
    const delay = ((seed * 13) % 100) / 100 * dur;
    const color = i % 2 === 0 ? '#fb923c' : '#fdba74';
    particles.push(
      <circle
        key={`ember-${i}`}
        cx={cx}
        cy={cy}
        r={0.22}
        fill={color}
        style={{
          '--dx': `${dx}px`,
          '--dy': `${dy}px`,
          animation: `ember-drift ${dur}s linear ${delay}s infinite`,
        } as React.CSSProperties}
      />
    );
  }
  return <g>{particles}</g>;
}

// 降维星系周围的小方块碎片：暗示坍缩剥落
// 使用基于 systemId 的确定性伪随机，避免每次渲染位置跳动
export function renderDimFragments(cx: number, cy: number, r: number, systemId: number) {
  const count = 4;
  const fragments = [];
  for (let i = 0; i < count; i++) {
    const seed = systemId * 7 + i * 13;
    const angle = ((seed % 360) / 360) * Math.PI * 2 + (i * Math.PI * 2) / count;
    const dist = r + 0.8 + ((seed * 3) % 100) / 100 * 1.2;
    const size = 0.35 + ((seed * 5) % 100) / 100 * 0.35;
    const fx = cx + Math.cos(angle) * dist;
    const fy = cy + Math.sin(angle) * dist;
    const opacity = 0.35 + ((seed * 11) % 100) / 100 * 0.25;
    const rot = (seed * 7) % 90;
    fragments.push(
      <rect
        key={`dim-frag-${i}`}
        x={fx - size / 2}
        y={fy - size / 2}
        width={size}
        height={size}
        fill="#9ca3af"
        opacity={opacity}
        transform={`rotate(${rot} ${fx} ${fy})`}
      />
    );
  }
  return <g>{fragments}</g>;
}

export const BACKGROUND_STARS = [12,23,34,45,56,67,78,89,91,14,25,36,47,58,69,72,83,94,16,27,38,49,60,71,82,93,18,29,40,51,62,73,84,95,22,33,44,55,66,77].map((seed) => ({
  cx: ((seed * 7) % 97) + 1, cy: ((seed * 13) % 97) + 1, r: (seed % 3) * 0.1 + 0.1, opacity: ((seed % 5) * 0.1) + 0.2,
}));

// 星球个体半径档位（主体半径），用于打破统一圆形的机械感
export const SIZE_RADIUS: Record<StarSize, number> = { sm: 1.8, md: 2.2, lg: 2.6 };

export const BROADCAST_ANIMATION_DURATION = 3000;
export const BROADCAST_EXPAND_DURATION = 800;
