export const ProtocolVersion = '1.0.0';

export type ClientEvent = 
  | 'player:login'
  | 'player:logout'
  | 'match:joinQueue'
  | 'match:cancelQueue'
  | 'match:getStatus'
  | 'match:joinSpecificQueue'
  | 'match:createQueue'
  | 'match:leaveSpecificQueue'
  | 'match:getQueueInfo'
  | 'match:getMyQueues'
  | 'room:join'
  | 'room:leave'
  | 'room:ready'
  | 'room:rejoin'
  | 'game:action'
  | 'game:cancelAction'
  | 'game:requestSync'
  | 'game:ackState';

export type ServerEvent = 
  | 'player:loginSuccess'
  | 'player:loginError'
  | 'match:queueJoined'
  | 'match:queueCancelled'
  | 'match:queueStatus'
  | 'match:found'
  | 'match:queueCreated'
  | 'match:specificQueueJoined'
  | 'match:specificQueueLeft'
  | 'match:queueInfoResponse'
  | 'match:myQueuesResponse'
  | 'match:queueUpdate'
  | 'match:error'
  | 'room:joined'
  | 'room:playerJoined'
  | 'room:playerLeft'
  | 'room:playerDisconnected'
  | 'room:playerReady'
  | 'room:gameStarting'
  | 'room:gameStarted'
  | 'room:hostChanged'
  | 'room:activeRoomFound'
  | 'room:playerReconnected'
  | 'game:fullSync'
  | 'game:deltaSync'
  | 'game:actionResult'
  | 'game:error';

export interface Message {
  type: string;
  payload?: unknown;
  roomId?: string;
}

export interface PlayerInfo {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  ready: boolean;
  connected: boolean;
}

export interface LoginRequest {
  token: string;
}

export interface MatchmakingRequest {
  preferredCount: number;
  /** 游戏模式：'classic'（经典，默认）或 'civilization_relics'（文明遗迹）。省略时为 classic。 */
  gameMode?: 'classic' | 'civilization_relics';
}

export interface RoomJoinRequest {
  roomId: string;
}

export interface GameActionRequest {
  action: string;
  data: unknown;
}

export interface ErrorResponse {
  code: string;
  message: string;
}

/**
 * match:found 的玩家条目（对齐后端 MatchPlayerInfo，非房间 PlayerInfo）：
 * 字段为 playerId/isHost/playerNumber/position，与 PlayerInfo 的 id/role 体系不同。
 */
export interface MatchPlayerInfo {
  playerId: string;
  displayName: string;
  isHost: boolean;
  playerNumber: number;
  position: number;
}

export interface MatchFoundResponse {
  roomId: string;
  roomCode: string;
  players: MatchPlayerInfo[];
}

export interface RoomPlayer {
  playerId: string;
  displayName: string;
  isHost: boolean;
  playerNumber: number;
  position: number;
  ready: boolean;
  connected: boolean;
}

export interface RoomJoinedResponse {
  roomId: string;
  roomCode: string;
  players: RoomPlayer[];
  isHost: boolean;
}

export interface DeltaSyncPayload {
  changes: Array<{ path: string; value: unknown; type: string }>;
  version: number;
  timestamp: number;
}

export interface ActiveGameInfo {
  roomId: string;
  roomCode: string;
  gameMode: string;
  playerCount: number;
  activePlayers: number;
  totalTurn: number;
  startedAt: number;
}