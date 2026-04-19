// ============================
// 黑暗森林 - 客户端视图状态类型
// ============================
// 定义客户端从服务器接收的过滤后状态类型
// 与服务器端 ViewManager.ts 中的 ViewState 对应
// ============================

import type { Card, LogEntry } from '@/lib/game/types';

/** 视图角色类型 */
export type ViewRole = 'PLAYER' | 'SPECTATOR' | 'REPLAY';

/** 过滤后的玩家信息 */
export interface PlayerView {
  id: string;
  name: string;
  color: string;
  position: number;
  energy: number;
  handCount: number;        // 手牌数量
  hand?: Card[];            // 仅自己可见完整手牌
  faceUpCards: Card[];      // 场上门牌（公开信息）
  eliminated: boolean;
  broadcastHistory: { systemId: number; turn: number }[];
}

/** 过滤后的广播响应 */
export interface BroadcastResponseView {
  playerId: string;
  playerName: string;
  canRespond: boolean;
  mustRespond: boolean;
  responded: boolean;
  agreed: boolean;
  responseCard?: Card;      // 仅揭示后可见
}

/** 过滤后的广播状态 */
export interface BroadcastStateView {
  active: boolean;
  broadcasterId: string;
  cardUid: string;
  card?: Card;              // 仅揭示后可见
  targetSystem: number;
  range: number;
  subtype?: string;         // 仅揭示后可见
  responses: BroadcastResponseView[];
  phase: string;
  selectedResponderId?: string;
  responseCard?: Card;      // 仅揭示后可见
}

/** 过滤后的打击状态 */
export interface FlyingStrikeView {
  uid: string;
  defId: string;
  ownerId: string;
  position: number;
  targetSystem: number;
  level: number;
  speed: number;
  remainingMoves: number;
  effect?: string;
  strikeName: string;
  arrived: boolean;  // 是否已到达目标
}

/** 视图状态（客户端接收的完整状态） */
export interface ViewState {
  // 游戏配置
  phase: string;
  totalTurn: number;
  playerCount: number;

  // 玩家（已过滤）
  players: PlayerView[];

  // 当前玩家
  currentPlayerIndex: number;
  localPlayerId: string;

  // 飞行中的打击（已过滤）
  flyingStrikes: FlyingStrikeView[];

  // 广播状态（已过滤）
  broadcast: BroadcastStateView | null;

  // 回合阶段
  turnPhase: string;

  // 需要玩家操作（仅发送给相关玩家）
  pendingAction: unknown | null;

  // 日志
  logs: LogEntry[];

  // 被毁灭的恒星
  destroyedStars: number[];

  // 胜利者
  winner: string | null;

  // 动画控制
  isProcessing: boolean;

  // 状态版本号
  version?: number;

  // 元信息
  _viewMeta: {
    role: ViewRole;
    viewerId?: string;
    timestamp: number;
  };
}
