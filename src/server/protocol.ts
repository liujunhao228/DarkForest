// ============================
// 黑暗森林 - 网络协议定义
// ============================
// 定义客户端与服务器之间的所有消息格式
// ============================

import type { GameState, Card, Player, PendingAction, LogEntry } from '@/lib/game/types';

// ============================
// 版本信息
// ============================

export const PROTOCOL_VERSION = '1.0.0';

// ============================
// 客户端 -> 服务器 消息类型
// ============================

export type ClientMessage =
  // 连接与认证
  | { type: 'player:login'; payload: LoginPayload }
  | { type: 'player:logout' }
  
  // 匹配系统
  | { type: 'match:joinQueue'; payload: JoinQueuePayload }
  | { type: 'match:cancelQueue' }
  | { type: 'match:getStatus' }
  
  // 房间管理
  | { type: 'room:join'; payload: RoomJoinPayload }
  | { type: 'room:leave' }
  | { type: 'room:ready'; payload: RoomReadyPayload }
  | { type: 'room:start' }
  
  // 游戏操作
  | { type: 'game:action'; payload: GameActionPayload }
  | { type: 'game:requestSync' }
  | { type: 'game:ackState'; payload: AckStatePayload };

// ============================
// 服务器 -> 客户端 消息类型
// ============================

export type ServerMessage =
  // 连接与认证
  | { type: 'player:loginSuccess'; payload: LoginSuccessPayload }
  | { type: 'player:loginError'; payload: ErrorPayload }
  
  // 匹配系统
  | { type: 'match:queueJoined'; payload: QueueJoinedPayload }
  | { type: 'match:queueCancelled' }
  | { type: 'match:queueError'; payload: ErrorPayload }
  | { type: 'match:found'; payload: MatchFoundPayload }
  | { type: 'match:queueStatus'; payload: QueueStatusPayload }
  
  // 房间管理
  | { type: 'room:joined'; payload: RoomJoinedPayload }
  | { type: 'room:error'; payload: ErrorPayload }
  | { type: 'room:playerJoined'; payload: RoomPlayerUpdatePayload }
  | { type: 'room:playerLeft'; payload: RoomPlayerUpdatePayload }
  | { type: 'room:playerDisconnected'; payload: PlayerDisconnectedPayload }
  | { type: 'room:playerReady'; payload: RoomPlayerUpdatePayload }
  | { type: 'room:gameStarting'; payload: RoomGameStartingPayload }
  
  // 游戏状态同步
  | { type: 'game:fullSync'; payload: FullSyncPayload }
  | { type: 'game:deltaSync'; payload: DeltaSyncPayload }
  | { type: 'game:actionResult'; payload: ActionResultPayload }
  | { type: 'game:error'; payload: ErrorPayload }
  
  // 游戏事件
  | { type: 'game:turnStart'; payload: TurnStartPayload }
  | { type: 'game:turnEnd'; payload: TurnEndPayload }
  | { type: 'game:phaseChange'; payload: PhaseChangePayload }
  | { type: 'game:playerAction'; payload: PlayerActionPayload }
  | { type: 'game:broadcastRequest'; payload: BroadcastRequestPayload }
  | { type: 'game:strikeMoveRequest'; payload: StrikeMoveRequestPayload }
  | { type: 'game:gameOver'; payload: GameOverPayload };

// ============================
// 载荷类型定义
// ============================

// 登录
export interface LoginPayload {
  userId: string;
  displayName: string;
}

export interface LoginSuccessPayload {
  playerId: string;
  displayName: string;
  playerInfo?: PlayerInfoPayload;
}

export interface PlayerInfoPayload {
  id: string;
  displayName: string;
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
}

// 匹配队列
export interface JoinQueuePayload {
  playerCount: number;  // 3-5
  quickMatch?: boolean;  // 快速匹配：接受3-5人任意组合
}

export interface QueueJoinedPayload {
  playerCount: number;
  position: number;
  totalInQueue: number;
  groups: Array<{
    playerCount: number;
    count: number;
  }>;
  quickMatch: boolean;
}

export interface QueueStatusPayload {
  inQueue: boolean;
  position?: number;
  estimatedTime?: number;
  totalInQueue?: number;
  groups?: Array<{
    playerCount: number;
    count: number;
  }>;
}

export interface MatchFoundPayload {
  roomId: string;
  roomCode: string;
  hostId: string;
  players: RoomPlayerInfo[];
  isHost: boolean;
}

// 自定义匹配队列
export interface CreateQueuePayload {
  queueName: string;
  minPlayers?: number;  // 3-5，默认3
  maxPlayers?: number;  // 3-5，默认4
}

export interface JoinSpecificQueuePayload {
  queueId: string;
  playerCount?: number;  // 3-5，可选
}

export interface LeaveSpecificQueuePayload {
  queueId: string;
}

export interface GetQueueInfoPayload {
  queueId: string;
}

export interface GetMyQueuesPayload {
  playerId?: string;  // 可选，服务器使用 socket.data.playerId
}

export interface QueueCreatedPayload {
  queueId: string;
  queueName: string;
  minPlayers: number;
  maxPlayers: number;
  players: Array<{ playerId: string; displayName: string }>;
}

export interface QueueInfoResponsePayload {
  queue: {
    queueId: string;
    queueName: string;
    creatorId: string;
    creatorName: string;
    minPlayers: number;
    maxPlayers: number;
    status: string;
    players: Array<{
      playerId: string;
      displayName: string;
      isReady: boolean;
      joinedAt: Date;
    }>;
  };
}

export interface MyQueuesResponsePayload {
  queues: Array<{
    queueId: string;
    queueName: string;
    status: string;
    minPlayers: number;
    maxPlayers: number;
    players: Array<{ playerId: string; displayName: string }>;
  }>;
}

export interface SpecificQueueLeftPayload {
  queueId: string;
}

export interface SpecificQueueJoinedPayload {
  queueId: string;
  queueName: string;
  position: number;
  totalInQueue: number;
}

export interface CustomQueueInfoPayload {
  queueId: string;
  queueName: string;
  creatorId: string;
  creatorName: string;
  minPlayers: number;
  maxPlayers: number;
  status: string;
  players: Array<{
    playerId: string;
    displayName: string;
    isReady: boolean;
    joinedAt: Date;
  }>;
}

// 房间
export interface RoomJoinPayload {
  roomCode: string;
}

export interface RoomReadyPayload {
  ready: boolean;
}

export interface RoomPlayerInfo {
  playerId: string;
  displayName: string;
  isHost: boolean;
  playerNumber: number;
  position: number;
  ready: boolean;
  connected: boolean;
}

export interface RoomJoinedPayload {
  roomId: string;
  roomCode: string;
  players: RoomPlayerInfo[];
}

export interface RoomPlayerUpdatePayload {
  roomId: string;
  players: RoomPlayerInfo[];
}

export interface PlayerDisconnectedPayload {
  roomId: string;
  disconnectedPlayerId: string;
  disconnectedPlayerName: string;
  players: RoomPlayerInfo[];
  reason: 'timeout' | 'network_error' | 'client_closed';
  canReconnect: boolean;
  reconnectTimeout?: number;  // 重连超时时间 (ms)
}

export interface RoomGameStartingPayload {
  roomId: string;
  gameState: GameState;
}

// 游戏操作
export interface GameActionPayload {
  action: ActionType;
  payload?: Record<string, unknown>;
  requestId?: string;  // 唯一请求 ID（用于幂等性）
}

export type ActionType =
  | 'playCard'           // 出牌
  | 'moveStrike'        // 移动打击牌
  | 'endTurn'           // 结束回合
  | 'respondBroadcast'  // 回应广播
  | 'selectResponder'   // 选择回应者
  | 'announceStrike'    // 宣布打击生效
  | 'skipAnnounceStrike' // 跳过宣布(延迟)
  | 'recycleCard'       // 回收门牌
  | 'useLightspeedShip' // 使用光速飞船
  | 'discardCards'      // 弃牌
  | 'cancelBroadcast';  // 取消广播（无人回应时）

// 游戏状态同步
export interface FullSyncPayload {
  state: Record<string, unknown>;  // 过滤后的 ViewState（而非完整 GameState）
  version: number;
  timestamp: number;
}

export interface DeltaSyncPayload {
  changes: StateChange[];
  version: number;
  timestamp: number;
}

export interface StateChange {
  path: string;         // 变化路径，如 'players.0.energy'
  value: unknown;       // 新值
  type: 'set' | 'push' | 'splice';  // 变化类型
}

export interface AckStatePayload {
  version: number;
}

export interface ActionResultPayload {
  success: boolean;
  error?: string;
  action?: ActionType;
  newState?: Partial<GameState>;
}

// 游戏事件
export interface TurnStartPayload {
  turnNumber: number;
  currentPlayerId: string;
  phase: string;
}

export interface TurnEndPayload {
  turnNumber: number;
  nextPlayerId: string;
  phase: string;
}

export interface PhaseChangePayload {
  oldPhase: string;
  newPhase: string;
  turnNumber: number;
}

export interface PlayerActionPayload {
  playerId: string;
  action: ActionType;
  result: Record<string, unknown>;
  turnNumber: number;
}

export interface BroadcastRequestPayload {
  broadcasterId: string;
  card: Card;
  targetSystem: number;
  range: number;
  responses: BroadcastResponseInfo[];
  timeout: number;  // 超时时间 (ms)
}

export interface BroadcastResponseInfo {
  playerId: string;
  playerName: string;
  canRespond: boolean;
  mustRespond: boolean;
  responded: boolean;
  agreed?: boolean;
}

export interface StrikeMoveRequestPayload {
  strikeUid: string;
  currentSystem: number;
  validMoves: number[];
  timeout: number;  // 超时时间 (ms)
}

export interface GameOverPayload {
  winnerId: string | null;
  winnerType: 'human' | 'ai' | 'draw';
  rankings: PlayerRanking[];
  totalTurns: number;
  duration: number;
}

export interface PlayerRanking {
  playerId: string;
  displayName: string;
  rank: number;
  eliminated: boolean;
  eliminatedTurn?: number;
}

// 错误
export interface ErrorPayload {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ============================
// 服务器端内部类型
// ============================

export interface RoomPlayer {
  socketId: string;
  playerId: string;
  displayName: string;
  isHost: boolean;
  playerNumber: number;
  position: number;
  ready: boolean;
  connected: boolean;
  lastAckVersion: number;  // 最后确认的状态版本
}

export interface Room {
  id: string;
  roomCode: string;
  hostId: string;
  players: Map<string, RoomPlayer>;  // playerId -> RoomPlayer
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  lastActivity: number;
  gameVersion: number;  // 游戏状态版本号
}

// 状态变化类型（公开导出）
export interface StateChange {
  path: string;         // 变化路径，如 'players.0.energy'
  value: unknown;       // 新值
  type: 'set' | 'push' | 'splice';  // 变化类型
}

export interface PendingBroadcast {
  roomId: string;
  broadcasterId: string;
  cardUid: string;
  targetSystem: number;
  responses: Map<string, boolean>;  // playerId -> agreed
  timeout: NodeJS.Timeout;
}

export interface PendingStrikeMove {
  roomId: string;
  strikeUid: string;
  ownerId: string;
  validMoves: number[];
  timeout: NodeJS.Timeout;
}

// ============================
// 验证结果类型
// ============================

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: string;
}

// ============================
// 工具函数
// ============================

/**
 * 创建客户端消息
 */
export function createClientMessage(type: string, payload?: Record<string, unknown>): ClientMessage {
  // 验证 type 是否为有效的 ActionType
  const validTypes = ['player:login', 'match:joinQueue', 'match:joinSpecificQueue', 'match:createQueue', 'match:leaveSpecificQueue', 'match:cancelQueue', 'match:getQueueInfo', 'match:getMyQueues', 'room:create', 'room:join', 'room:leave', 'room:kick', 'room:startGame', 'game:action', 'game:sync', 'game:ack', 'game:heartbeat'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid client message type: ${type}`);
  }
  return { type: type as ClientMessage['type'], payload } as ClientMessage;
}

/**
 * 创建服务端消息
 */
export function createServerMessage(type: string, payload?: Record<string, unknown>): ServerMessage {
  const validTypes = ['player:loginSuccess', 'player:loginFailed', 'match:queueJoined', 'match:queueCreated', 'match:queueCancelled', 'match:queueUpdate', 'match:matchFound', 'room:created', 'room:joined', 'room:left', 'room:update', 'room:playerReady', 'room:playerNotReady', 'room:disconnectedPlayers', 'game:fullSync', 'game:deltaSync', 'game:event', 'game:error', 'game:actionResult', 'game:syncRequested'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid server message type: ${type}`);
  }
  return { type: type as ServerMessage['type'], payload } as ServerMessage;
}

/**
 * 验证消息类型
 */
export function isValidClientMessage(msg: unknown): msg is ClientMessage {
  if (!msg || typeof msg !== 'object') return false;
  const message = msg as Record<string, unknown>;
  return typeof message.type === 'string' && VALID_CLIENT_TYPES.includes(message.type);
}

const VALID_CLIENT_TYPES = [
  'player:login',
  'player:logout',
  'match:joinQueue',
  'match:cancelQueue',
  'match:getStatus',
  'match:joinSpecificQueue',
  'match:createQueue',
  'match:leaveSpecificQueue',
  'match:getQueueInfo',
  'match:getMyQueues',
  'room:join',
  'room:leave',
  'room:ready',
  'room:start',
  'game:action',
  'game:requestSync',
  'game:ackState',
];
