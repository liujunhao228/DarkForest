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
  delayed?: boolean;
  retargetedThisTurn?: boolean;
  /** 落空但未废弃标记（仅 FreeControl/RequireTarget 行为下为 true） */
  missed?: boolean;
}

export interface StarLeftover {
  systemId: number;
  energy: number;
  facilities: Card[];
  leftByPlayerId?: string;
  isRelic?: boolean;
  name?: string;
  lore?: string;
  broadcastOnInherit?: boolean;
  message?: string;
}

/**
 * 继承遗迹/遗留物时发送给继承者的瞬时私有揭示。
 * 后端 view_state.go 按 viewerID == playerId 门控：仅继承者本人可见。
 * 非遗迹（光速飞船遗留）时 isRelic=false 且 name/lore 为空，仅含 energy + facilityNames。
 */
export interface RelicDiscovery {
  playerId?: string;
  systemId: number;
  isRelic?: boolean;
  name?: string;
  lore?: string;
  energy: number;
  facilityNames?: string[];
  message?: string;
}

export type GameMode = 'classic' | 'civilization_relics';

export interface BroadcastState {
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
  strikeUid?: string;
  /** 涉及的星系 ID（打击目标/广播目标/跃迁目标等） */
  systemId?: number;
  /** 涉及的卡牌定义 ID（打击/出牌/广播卡牌） */
  cardDefId?: string;
  /** 涉及的玩家 ID 列表（行动者+目标） */
  playerIds?: string[];
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
  leftovers: StarLeftover[];
  winner: string | null;
  isProcessing: boolean;
  version?: number;
  replayTimestamp?: number;
  replayEventId?: string;
  gameMode?: GameMode;
  /**
   * 继承遗迹/遗留物时的瞬时私有揭示。
   * 在线模式由后端 CreateViewState 按 viewerID == playerId 门控，仅继承者本人非 null。
   * 回放/本地 GameState 中保留原值（可能为 null 或某次继承的揭示）。
   */
  lastRelicDiscovery?: RelicDiscovery | null;
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
  | { type: 'announceStrike'; strikeUid: string; targetSystem: number; targetPlayerIds: string[] }
  | { type: 'lightspeedEscape'; playerId: string }
  | { type: 'recycleCard'; cardUid: string; refundEnergy: number }
  | { type: 'selectTargetSystem'; card: Card; validTargets: number[] }
  | { type: 'strikeMissedFree'; strikeUid: string }
  | { type: 'strikeMissedRequireTarget'; strikeUid: string; validTargets: number[] };

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
