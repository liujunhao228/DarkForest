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
  | 'room:start'
  | 'game:action'
  | 'game:cancelAction'
  | 'game:requestSync'
  | 'game:ackState';

export type ServerEvent = 
  | 'player:loginSuccess'
  | 'player:loginError'
  | 'match:queueJoined'
  | 'match:queueCancelled'
  | 'match:queueError'
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
  | 'room:playerReconnected'
  | 'room:playerReady'
  | 'room:gameStarting'
  | 'room:gameStarted'
  | 'room:hostChanged'
  | 'game:fullSync'
  | 'game:deltaSync'
  | 'game:actionResult'
  | 'game:error'
  | 'game:turnStart'
  | 'game:turnEnd'
  | 'game:phaseChange'
  | 'game:playerAction'
  | 'game:broadcastRequest'
  | 'game:strikeMoveRequest'
  | 'game:gameOver';

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
}

export interface LoginRequest {
  token: string;
}

export interface MatchmakingRequest {
  preferredCount: number;
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

export interface MatchFoundResponse {
  roomId: string;
  roomCode: string;
  players: PlayerInfo[];
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