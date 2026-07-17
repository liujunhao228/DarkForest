import type { Card, LogEntry, GameState, RelicDiscovery, BroadcastSubtype } from './types';

export type ViewRole = 'PLAYER' | 'SPECTATOR' | 'REPLAY';

export interface PlayerView {
  id: string;
  name: string;
  color: string;
  position: number;
  energy: number;
  handCount: number;
  hand?: Card[];
  faceUpCards: Card[];
  eliminated: boolean;
  broadcastHistory: { systemId: number; turn: number }[];
}

export interface BroadcastResponseView {
  playerId: string;
  playerName: string;
  canRespond: boolean;
  mustRespond: boolean;
  responded: boolean;
  agreed: boolean;
  responseCard?: Card;
}

export interface BroadcastStateView {
  broadcasterId: string;
  cardUid: string;
  card?: Card;
  targetSystem: number;
  range: number;
  subtype?: BroadcastSubtype;
  responses: BroadcastResponseView[];
  phase: string;
  selectedResponderId?: string;
  responseCard?: Card;
}

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
  arrived: boolean;
  delayed?: boolean;
  retargetedThisTurn?: boolean;
}

export interface ViewState {
  kind: 'view';
  phase: string;
  totalTurn: number;
  playerCount: number;
  players: PlayerView[];
  currentPlayerIndex: number;
  currentPlayerId: string;
  localPlayerId: string;
  flyingStrikes: FlyingStrikeView[];
  broadcast: BroadcastStateView | null;
  turnPhase: string;
  pendingAction: unknown | null;
  logs: LogEntry[];
  destroyedStars: number[];
  winner: string | null;
  isProcessing: boolean;
  version?: number;
  /**
   * 继承遗迹/遗留物时的瞬时私有揭示。
   * 后端 CreateViewState 按 viewerID == playerId 门控，仅继承者本人非 null。
   */
  lastRelicDiscovery?: RelicDiscovery | null;
  _viewMeta: {
    role: ViewRole;
    viewerId?: string;
    timestamp: number;
  };
}

/**
 * 仅用于回放/本地脱敏；在线模式由后端 CreateViewState 完成脱敏，前端不应调用。
 * 逻辑与 backend/internal/game/view_state.go 的 CreateViewState 保持一致：
 *   - 对手位置隐藏为 -1（黑暗森林核心机制）
 *   - 广播 Card/Subtype/ResponseCard 按揭示阶段（reveal/resolve/done）与广播者身份门控
 */
export function createViewState(gameState: GameState, options: { role: ViewRole; playerId: string }): ViewState {
  const { role, playerId } = options;

  const players: PlayerView[] = gameState.players.map(p => {
    const isViewer = role === 'PLAYER' && p.id === playerId;
    const revealAll = role === 'REPLAY';
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      // 黑暗森林核心机制：仅自己或回放模式可见真实位置，对手位置隐藏为 -1
      position: (isViewer || revealAll) ? p.position : -1,
      energy: p.energy,
      handCount: p.hand.length,
      hand: role === 'REPLAY' ? p.hand : (p.id === playerId ? p.hand : undefined),
      faceUpCards: p.faceUpCards,
      eliminated: p.eliminated,
      broadcastHistory: p.broadcastHistory,
    };
  });

  const flyingStrikes: FlyingStrikeView[] = gameState.flyingStrikes.map(s => ({
    uid: s.uid,
    defId: s.defId,
    ownerId: s.ownerId,
    position: s.position,
    targetSystem: s.targetSystem,
    level: s.level,
    speed: s.speed,
    remainingMoves: s.remainingMoves,
    effect: s.effect,
    strikeName: s.strikeName,
    arrived: s.arrived,
  }));

  const broadcast = gameState.broadcast ? filterBroadcastForView(gameState.broadcast, playerId, role) : null;

  // 私有揭示门控：仅当 viewerID == state.lastRelicDiscovery.playerId 时填充。
  // 与后端 view_state.go CreateViewState 行为一致。
  const lastRelicDiscovery =
    gameState.lastRelicDiscovery && gameState.lastRelicDiscovery.playerId === playerId
      ? gameState.lastRelicDiscovery
      : null;

  return {
    kind: 'view',
    phase: gameState.phase,
    totalTurn: gameState.totalTurn,
    playerCount: gameState.playerCount,
    players,
    currentPlayerIndex: gameState.currentPlayerIndex,
    currentPlayerId: gameState.currentPlayerId,
    localPlayerId: playerId,
    flyingStrikes,
    broadcast,
    turnPhase: gameState.turnPhase,
    pendingAction: gameState.pendingAction,
    logs: gameState.logs,
    destroyedStars: gameState.destroyedStars || [],
    winner: gameState.winner,
    isProcessing: gameState.isProcessing,
    version: gameState.version,
    lastRelicDiscovery,
    _viewMeta: {
      role,
      viewerId: playerId,
      timestamp: Date.now(),
    },
  };
}

/**
 * 按揭示阶段与广播者身份对广播状态脱敏（与后端 filterBroadcastForView 一致）。
 * - Card / Subtype：仅广播者本人、已揭示或 REPLAY 可见
 * - Responses[].ResponseCard：仅已揭示、回应者本人或 REPLAY 可见
 * - 顶层 ResponseCard：仅已揭示或 REPLAY 可见
 */
function filterBroadcastForView(
  broadcast: NonNullable<GameState['broadcast']>,
  viewerId: string,
  role: ViewRole
): BroadcastStateView {
  const isBroadcaster = role === 'PLAYER' && broadcast.broadcasterId === viewerId;
  const isRevealed = broadcast.phase === 'reveal' || broadcast.phase === 'resolve' || broadcast.phase === 'done';
  const revealAll = role === 'REPLAY';

  const responses: BroadcastResponseView[] = broadcast.responses.map(r => {
    const isResponder = role === 'PLAYER' && r.playerId === viewerId;
    const rc = (isRevealed || isResponder || revealAll) ? r.responseCard : undefined;
    return {
      playerId: r.playerId,
      playerName: r.playerName,
      canRespond: r.canRespond,
      mustRespond: r.mustRespond,
      responded: r.responded,
      agreed: r.agreed,
      responseCard: rc,
    };
  });

  return {
    broadcasterId: broadcast.broadcasterId,
    cardUid: broadcast.cardUid,
    card: (isBroadcaster || isRevealed || revealAll) ? broadcast.card : undefined,
    targetSystem: broadcast.targetSystem,
    range: broadcast.range,
    subtype: (isBroadcaster || isRevealed || revealAll) ? broadcast.subtype : undefined,
    responses,
    phase: broadcast.phase,
    selectedResponderId: broadcast.selectedResponderId,
    responseCard: (isRevealed || revealAll) ? broadcast.responseCard : undefined,
  };
}
