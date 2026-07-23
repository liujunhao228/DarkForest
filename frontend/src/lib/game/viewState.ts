import type { Card, LogEntry, GameState, GameMode, RelicDiscovery, BroadcastSubtype, StarEffect } from './types';
import type { ModeRules } from './modeRules';
import { getModeRules } from './modeRules';
import { getDistance } from './starmap';

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
  /** 受跃迁惩罚影响，本回合只能弃牌或直接结束回合 */
  penaltyTurn?: boolean;
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
  /**
   * 隐逐跳模式下对非拥有者填充：当前位置到 TargetSystem 的图最短跳数。
   * 拥有者与回放观察者不填（Position 已暴露真实位置）。
   */
  distance?: number;
}

export interface ViewState {
  kind: 'view';
  phase: string;
  /**
   * 对局模式。后端 CreateViewState 透传自 GameState.gameMode。
   * 在线模式必需：前端据 modeRules 切换光速飞船等模式相关 UI；
   * 此前缺失会导致 `'gameMode' in gameState` 守卫失效，回退到 Classic 规则。
   */
  gameMode?: GameMode;
  /**
   * 自定义房间规则覆盖。后端 CreateViewState 透传自 GameState.modeRules。
   * 非空时 getModeRules(viewState) 优先返回此值，覆盖 gameMode 预设。
   */
  modeRules?: ModeRules | null;
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
  /** 星系持续效果（降维锁定、湮灭余波等）—— 公开信息，所有玩家可见 */
  starEffects: StarEffect[];
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
      penaltyTurn: p.penaltyTurn,
    };
  });

  const flyingStrikes: FlyingStrikeView[] = gameState.flyingStrikes.map(s => {
    const view: FlyingStrikeView = {
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
    };
    // 隐逐跳脱敏：非拥有者且非回放观察者仅可见 TargetSystem + Distance，Position 隐藏为 -1
    // 注意：必须用状态对象重载 getModeRules(gameState)，否则自定义房间的 strikeOrigin 覆盖不生效
    if (
      getModeRules(gameState).strikeOrigin === 'stealthOwnerPlanet' &&
      role !== 'REPLAY' &&
      s.ownerId !== playerId
    ) {
      view.position = -1;
      view.distance = getDistance(s.position, s.targetSystem);
    }
    return view;
  });

  const broadcast = gameState.broadcast ? filterBroadcastForView(gameState.broadcast, playerId, role) : null;

  // 私有揭示门控：仅当 viewerID == state.lastRelicDiscovery.playerId 时填充。
  // 与后端 view_state.go CreateViewState 行为一致。
  const lastRelicDiscovery =
    gameState.lastRelicDiscovery && gameState.lastRelicDiscovery.playerId === playerId
      ? gameState.lastRelicDiscovery
      : null;

  // PendingAction 脱敏：隐逐跳模式下 strikeMove 类型对非拥有者隐藏 validMoves
  // （validMoves = Adjacency[Position]，会反向暴露 Position，破坏路径保密）。
  // 与后端 view_state.go CreateViewState 行为一致。
  const stealthMode = getModeRules(gameState).strikeOrigin === 'stealthOwnerPlanet';
  const revealAllStrikes = role === 'REPLAY';
  let pendingAction = gameState.pendingAction;
  if (stealthMode && !revealAllStrikes && pendingAction && pendingAction.type === 'strikeMove') {
    const ownerID = lookupStrikeOwner(gameState.flyingStrikes, pendingAction.strikeUid);
    if (ownerID && ownerID !== playerId) {
      pendingAction = { type: 'strikeMove', strikeUid: pendingAction.strikeUid, validMoves: [] };
    }
  }

  // Logs 脱敏：positionOwnerId 标记的日志仅对位置所属玩家与 REPLAY 可见完整信息；
  // 其他观察者脱敏 systemId 与 message 中的星系编号。
  // 与后端 view_state.go CreateViewState 行为一致。
  const logs: LogEntry[] = gameState.logs.map(log => {
    if (role === 'REPLAY' || !log.positionOwnerId || log.positionOwnerId === playerId) {
      return log;
    }
    return {
      ...log,
      systemId: undefined,
      message: log.message.replace(/星系\s*\d+/g, '星系 ???'),
    };
  });

  return {
    kind: 'view',
    phase: gameState.phase,
    gameMode: gameState.gameMode,
    modeRules: gameState.modeRules,
    totalTurn: gameState.totalTurn,
    playerCount: gameState.playerCount,
    players,
    currentPlayerIndex: gameState.currentPlayerIndex,
    currentPlayerId: gameState.currentPlayerId,
    localPlayerId: playerId,
    flyingStrikes,
    broadcast,
    turnPhase: gameState.turnPhase,
    pendingAction,
    logs,
    destroyedStars: gameState.destroyedStars || [],
    starEffects: gameState.starEffects || [],
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

/**
 * 在 flyingStrikes 中按 UID 查找拥有者 ID。
 * 与后端 view_state.go lookupStrikeOwner 行为一致。
 */
function lookupStrikeOwner(strikes: GameState['flyingStrikes'], strikeUid: string): string {
  const s = strikes.find(item => item.uid === strikeUid);
  return s ? s.ownerId : '';
}
