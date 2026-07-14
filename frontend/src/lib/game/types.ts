export type CardType = 'broadcast' | 'strike' | 'defense' | 'facility';

export type BroadcastSubtype = 'cooperation' | 'disguise';

export type GamePhase = 'setup' | 'playing' | 'gameOver';

export type TurnPhase =
  | 'turnBegin'
  | 'strikeMovement'
  | 'drawPhase'
  | 'actionPhase'
  | 'turnEnd'
  | 'interrupted';

export type PlayerColor = 'red' | 'blue' | 'green' | 'amber' | 'purple';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  energy: number;
  quantity: number;
  description: string;
  image: string;
  extended: Record<string, number | string | boolean>;
}

export interface Card {
  uid: string;
  defId: string;
  name: string;
  type: CardType;
  energy: number;
  description: string;
  image: string;
  subtype?: BroadcastSubtype;
  range?: number;
  level?: number;
  speed?: number;
  effect?: string;
  protectionLevel?: number;
  energyPerTurn?: number;
  ability?: string;
}

export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  position: number;
  energy: number;
  hand: Card[];
  faceUpCards: Card[];
  eliminated: boolean;
  broadcastHistory: { systemId: number; turn: number }[];
}

export interface FlyingStrike {
  uid: string;
  defId: string;
  ownerId: string;
  position: number;
  targetSystem: number;
  targetPlayerId?: string;
  level: number;
  speed: number;
  remainingMoves: number;
  effect?: string;
  strikeName: string;
  arrived: boolean;
}

export interface BroadcastState {
  active: boolean;
  broadcasterId: string;
  cardUid: string;
  card: Card;
  targetSystem: number;
  range: number;
  subtype: BroadcastSubtype;
  responses: BroadcastResponse[];
  phase: 'waiting' | 'select' | 'reveal' | 'resolve' | 'done';
  selectedResponderId?: string;
  responseCard?: Card;
}

export interface BroadcastResponse {
  playerId: string;
  playerName: string;
  canRespond: boolean;
  mustRespond: boolean;
  responded: boolean;
  agreed: boolean;
  responseCard?: Card;
}

export interface LogEntry {
  id: string;
  turn: number;
  phase: string;
  message: string;
  type: 'info' | 'action' | 'combat' | 'system' | 'broadcast';
}

export interface GameState {
  kind: 'game';
  phase: GamePhase;
  totalTurn: number;
  playerCount: number;
  players: Player[];
  currentPlayerIndex: number;
  currentPlayerId: string;
  localPlayerId: string;
  drawPile: Card[];
  discardPile: Card[];
  flyingStrikes: FlyingStrike[];
  broadcast: BroadcastState | null;
  turnPhase: TurnPhase;
  pendingAction: PendingAction | null;
  logs: LogEntry[];
  destroyedStars: number[];
  winner: string | null;
  isProcessing: boolean;
  version?: number;
  replayTimestamp?: number;
  replayEventId?: string;
}

export interface ReplayMetadata {
  id: string;
  gameId: string;
  startTime: number;
  endTime: number;
  duration: number;
  playerCount: number;
  players: { id: string; name: string; color: string }[];
  winner: string | null;
  version: string;
}

export interface ReplayStateNode {
  timestamp: number;
  version: number;
  state: GameState;
  hash: string;
}

export interface ReplayDelta {
  timestamp: number;
  version: number;
  changes: StateChange[];
}

export interface StateChange {
  path: string;
  value: unknown;
  type: 'set' | 'push' | 'splice';
}

export interface ReplayData {
  metadata: ReplayMetadata;
  snapshots: ReplayStateNode[];
  deltas: ReplayDelta[];
  checkpoints: number[];
}

export type PendingAction =
  | { type: 'strikeMove'; strikeUid: string; validMoves: number[] }
  | { type: 'strikeSelect'; strikeUids: string[] }
  | { type: 'broadcastResponse'; broadcastState: BroadcastState }
  | { type: 'broadcastSelect'; responders: string[] }
  | { type: 'announceStrike'; strikeUid: string; targetSystem: number; targetPlayerIds: string[] }
  | { type: 'lightspeedEscape'; playerId: string }
  | { type: 'recycleCard'; cardUid: string; refundEnergy: number }
  | { type: 'selectTargetSystem'; card: Card; validTargets: number[] }
  | { type: 'selectBroadcastSystem'; card: Card; validTargets: number[] };

export interface BroadcastResult {
  broadcasterSubtype: BroadcastSubtype;
  responderSubtype: BroadcastSubtype;
  broadcasterEnergy: number;
  responderEnergy: number;
}

export type StarSize = 'sm' | 'md' | 'lg';

export interface StarNode {
  id: number;
  x: number;
  y: number;
  name: string;
  size: StarSize;
  tint: string;
}

export interface StarEdge {
  from: number;
  to: number;
}

export interface InitConfig {
  playerCount: number;
  humanName: string;
}
