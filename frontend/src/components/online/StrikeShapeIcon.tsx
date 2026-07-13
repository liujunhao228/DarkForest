import type { StrikeShape } from '@/lib/game/strikeStyles';

// 小型打击类型形状徽标，供侧边栏等处复用（与星图弹丸形状语义一致）
export function StrikeShapeIcon({ shape, color, className }: { shape: StrikeShape; color: string; className?: string }) {
  const cx = 5, cy = 5, r = 3;
  switch (shape) {
    case 'circle':
      return (<svg viewBox="0 0 10 10" className={className}><circle cx={cx} cy={cy} r={r} fill={color} /></svg>);
    case 'diamond':
      return (<svg viewBox="0 0 10 10" className={className}><polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} fill={color} /></svg>);
    case 'cross':
      return (
        <svg viewBox="0 0 10 10" className={className}>
          <g stroke={color} strokeWidth="1.4" strokeLinecap="round">
            <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} />
            <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} />
          </g>
        </svg>
      );
    case 'square':
      return (<svg viewBox="0 0 10 10" className={className}><rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={color} transform={`rotate(45 ${cx} ${cy})`} /></svg>);
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
      }).join(' ');
      return (<svg viewBox="0 0 10 10" className={className}><polygon points={pts} fill={color} /></svg>);
    }
  }
}
