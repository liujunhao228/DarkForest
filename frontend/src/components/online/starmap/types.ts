// 标记模式工具类型：'pin' 图钉单点标记 / 'region' 区域高亮 + 文字注释
export type MarkingTool = 'pin' | 'region';

// 爆炸动画状态（打击生效后渲染的临时爆炸）
export interface Explosion {
  id: string;
  systemId: number;
  color: string;
}

// 广播动画状态
export interface BroadcastAnimation {
  id: string;
  broadcasterId: string;
  targetSystem: number;
  range: number;
  isOwn: boolean;
  subtype: string;
  startTime: number;
  phase: 'expanding' | 'stable' | 'fading';
}

// 已结束广播的残留标记：广播结束后仍以淡灰色光晕显示可能位置，3 回合内逐步淡出
export interface ResidualMarker {
  key: string;          // 唯一键，避免重复推入
  targetSystem: number;
  range: number;
  broadcasterId: string;
  endTurn: number;      // 广播结束时所在回合（用于计算年龄与移除）
}
