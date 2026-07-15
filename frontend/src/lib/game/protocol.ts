export type ActionType =
  | 'playCard'
  | 'deployCard'
  | 'strike'
  | 'broadcast'
  | 'moveStrike'
  | 'retargetStrike'
  | 'selectStrike'
  | 'skipStrikeSelect'
  | 'skipStrikeMove'
  | 'endTurn'
  | 'respondBroadcast'
  | 'selectBroadcastResponder'
  | 'announceStrike'
  | 'skipAnnounceStrike'
  | 'recycleCard'
  | 'lightspeedShip'
  | 'discardCards'
  | 'cancelBroadcast';

export const ErrorCode = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CARD_NOT_FOUND: 'CARD_NOT_FOUND',
  CARD_NOT_IN_HAND: 'CARD_NOT_IN_HAND',
  NOT_BROADCAST_CARD: 'NOT_BROADCAST_CARD',
  NOT_ENOUGH_ENERGY: 'NOT_ENOUGH_ENERGY',
  INVALID_PHASE: 'INVALID_PHASE',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  GAME_OVER: 'GAME_OVER',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
