// 打击显示样式映射（颜色按发出者，形状按打击类型）

// 玩家颜色映射（red/blue/green/amber/purple → 十六进制色值）
export const PLAYER_COLORS: Record<string, string> = {
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', amber: '#f59e0b', purple: '#a855f7',
};

// 打击类型 → 几何形状键
export type StrikeShape = 'circle' | 'diamond' | 'cross' | 'square' | 'hexagon';
export const STRIKE_SHAPES: Record<string, StrikeShape> = {
  strike_thermal: 'circle',         // 热核打击 → 圆形（蘑菇云意象）
  strike_light_particle: 'diamond', // 光粒打击 → 菱形（尖锐穿透意象）
  strike_annihilation: 'cross',     // 湮灭打击 → 叉形（对撞意象）
  strike_dimensional: 'square',     // 降维打击 → 方形（二维化意象）
  strike_tech_lock: 'hexagon',      // 科技锁死 → 六边形（智子轨道意象）
};

// 由打击发出者 ID 与玩家列表解析发出者颜色，找不到时回退中性灰
export function getOwnerColor(ownerId: string, players: { id: string; color: string }[]): string {
  const owner = players.find(p => p.id === ownerId);
  return owner ? PLAYER_COLORS[owner.color] ?? '#9ca3af' : '#9ca3af';
}
