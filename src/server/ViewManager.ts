// ============================
// 黑暗森林 - 视角过滤管理器
// ============================
// 实现"服务器保存绝对真相，客户端只拿到合法视角"的原则
// 根据不同角色（PLAYER/SPECTATOR/REPLAY）生成差异化的视图状态
// ============================

import type {
  GameState,
  Player,
  Card,
  BroadcastState,
  BroadcastResponse,
  FlyingStrike,
  LogEntry,
} from '@/lib/game/types';

// ============================
// 类型定义
// ============================

/** 视图角色类型 */
export type ViewRole = 'PLAYER' | 'SPECTATOR' | 'REPLAY';

/** 视图选项 */
export interface ViewOptions {
  role: ViewRole;
  playerId?: string;        // PLAYER 角色时必须提供
  revealAll?: boolean;      // REPLAY 角色时可选是否显示全图
}

/** 过滤后的玩家信息 */
export interface PlayerView {
  id: string;
  name: string;
  color: string;
  position: number;
  energy: number;
  handCount: number;        // 手牌数量（而非具体内容）
  hand?: Card[];            // 仅自己可见完整手牌
  faceUpCards: Card[];      // 场上门牌（公开信息）
  eliminated: boolean;
  broadcastHistory: { systemId: number; turn: number }[];
}

/** 过滤后的广播状态 */
export interface BroadcastStateView {
  active: boolean;
  broadcasterId: string;
  cardUid: string;
  card?: Card;              // 仅揭示后可见具体卡牌
  targetSystem: number;
  range: number;
  subtype?: string;         // 仅揭示后可见
  responses: BroadcastResponseView[];
  phase: string;
  selectedResponderId?: string;
  responseCard?: Card;      // 仅揭示后可见
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

/** 过滤后的打击状态 */
export interface FlyingStrikeView {
  uid: string;
  defId: string;
  ownerId: string;
  position: number;
  targetSystem: number;
  level: number;
  speed: number;
  effect?: string;
  strikeName: string;
  arrived: boolean;  // 是否已到达目标
  // 注意：不暴露 targetPlayerId，避免提前泄露科技锁死目标
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
  humanPlayerId: string;

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

// ============================
// 视角过滤核心逻辑
// ============================

/**
 * 为指定角色生成视图状态
 * 这是权威服务器架构的核心函数，确保信息隔离
 */
export function createViewState(
  absoluteState: GameState,
  options: ViewOptions
): ViewState {
  const { role, playerId } = options;

  // 验证参数
  if (role === 'PLAYER' && !playerId) {
    throw new Error('PLAYER 角色必须提供 playerId');
  }

  return {
    phase: absoluteState.phase,
    totalTurn: absoluteState.totalTurn,
    playerCount: absoluteState.playerCount,
    players: filterPlayers(absoluteState.players, playerId, role),
    currentPlayerIndex: absoluteState.currentPlayerIndex,
    humanPlayerId: absoluteState.humanPlayerId,
    flyingStrikes: filterFlyingStrikes(absoluteState.flyingStrikes, playerId, role),
    broadcast: filterBroadcastState(absoluteState.broadcast, playerId, role),
    turnPhase: absoluteState.turnPhase,
    pendingAction: filterPendingAction(absoluteState.pendingAction, playerId, role),
    logs: filterLogs(absoluteState.logs, playerId, role),
    destroyedStars: [...absoluteState.destroyedStars],
    winner: absoluteState.winner,
    isProcessing: absoluteState.isProcessing,
    version: absoluteState.version,
    _viewMeta: {
      role,
      viewerId: playerId,
      timestamp: Date.now(),
    },
  };
}

/**
 * 过滤玩家列表
 * - 自己：完整手牌可见，位置可见
 * - 对手：仅手牌数量可见，位置隐藏（黑暗森林核心机制）
 * - 观战者：所有玩家仅手牌数量可见，位置隐藏
 */
function filterPlayers(
  players: Player[],
  viewerId: string | undefined,
  role: ViewRole
): PlayerView[] {
  return players.map(player => {
    const isViewer = role === 'PLAYER' && player.id === viewerId;
    const revealAll = role === 'REPLAY';

    return {
      id: player.id,
      name: player.name,
      color: player.color,
      // 黑暗森林核心机制：仅自己或回放模式可见位置，其他人位置隐藏（-1）
      position: (isViewer || revealAll) ? player.position : -1,
      energy: player.energy,
      handCount: player.hand.length,
      // 仅自己或回放模式可见完整手牌
      hand: (isViewer || revealAll) ? [...player.hand] : undefined,
      faceUpCards: [...player.faceUpCards],  // 门牌是公开信息
      eliminated: player.eliminated,
      broadcastHistory: [...player.broadcastHistory],
    };
  });
}

/**
 * 过滤飞行打击
 * - 打击的拥有者：可见完整信息（包括 targetPlayerId）
 * - 其他玩家：隐藏 targetPlayerId
 * - 观战者：隐藏 targetPlayerId
 */
function filterFlyingStrikes(
  strikes: FlyingStrike[],
  viewerId: string | undefined,
  role: ViewRole
): FlyingStrikeView[] {
  return strikes.map(strike => {
    const isOwner = role === 'PLAYER' && strike.ownerId === viewerId;

    return {
      uid: strike.uid,
      defId: strike.defId,
      ownerId: strike.ownerId,
      position: strike.position,
      targetSystem: strike.targetSystem,
      level: strike.level,
      speed: strike.speed,
      effect: strike.effect,
      strikeName: strike.strikeName,
      arrived: strike.arrived,
      // 不暴露 targetPlayerId，避免提前泄露科技锁死目标
      // 仅在打击到达时才揭示
    };
  });
}

/**
 * 过滤广播状态
 * 核心规则：
 * - 广播发出者：始终可见自己的 subtype 和 card
 * - 回应者：在 select 阶段前不可见其他回应者的 subtype
 * - 揭示阶段后：所有 subtype 可见
 * - 观战者：仅 reveal 阶段后可见 subtype
 */
function filterBroadcastState(
  broadcast: BroadcastState | null,
  viewerId: string | undefined,
  role: ViewRole
): BroadcastStateView | null {
  if (!broadcast) return null;

  const isBroadcaster = role === 'PLAYER' && broadcast.broadcasterId === viewerId;
  const isRevealed = broadcast.phase === 'reveal' || broadcast.phase === 'resolve' || broadcast.phase === 'done';
  const revealAll = role === 'REPLAY';

  // 过滤回应列表
  const filteredResponses = broadcast.responses.map(response => {
    const isResponder = role === 'PLAYER' && response.playerId === viewerId;

    return {
      playerId: response.playerId,
      playerName: response.playerName,
      canRespond: response.canRespond,
      mustRespond: response.mustRespond,
      responded: response.responded,
      agreed: response.agreed,
      // 回应者的牌仅在揭示后或自己是回应者时可见
      responseCard: (isRevealed || isResponder || revealAll) && response.responseCard
        ? { ...response.responseCard }
        : undefined,
    };
  });

  return {
    active: broadcast.active,
    broadcasterId: broadcast.broadcasterId,
    cardUid: broadcast.cardUid,
    // 卡牌信息仅在揭示后或自己是广播者时可见
    card: (isBroadcaster || isRevealed || revealAll) ? { ...broadcast.card } : undefined,
    targetSystem: broadcast.targetSystem,
    range: broadcast.range,
    // subtype 仅在揭示后或自己是广播者时可见
    subtype: (isBroadcaster || isRevealed || revealAll) ? broadcast.subtype : undefined,
    responses: filteredResponses,
    phase: broadcast.phase,
    selectedResponderId: broadcast.selectedResponderId,
    // 被选中者的牌仅在揭示后可见
    responseCard: (isRevealed || revealAll) && broadcast.responseCard
      ? { ...broadcast.responseCard }
      : undefined,
  };
}

/**
 * 过滤待处理操作
 * - 仅发送给相关玩家
 * - 其他玩家收到 null
 */
function filterPendingAction(
  action: unknown,
  viewerId: string | undefined,
  role: ViewRole
): unknown {
  if (!action || role !== 'PLAYER') return null;

  const actionObj = action as Record<string, unknown>;
  const actionType = actionObj.type as string;

  // 检查操作是否与当前玩家相关
  switch (actionType) {
    case 'strikeMove':
      // 打击移动：打击拥有者可见
      return actionObj.ownerId === viewerId ? action : null;

    case 'broadcastResponse':
      // 广播回应：被广播者可见
      const broadcastState = actionObj.broadcastState as BroadcastState | undefined;
      if (!broadcastState) return null;
      const canRespond = broadcastState.responses.some(
        r => r.playerId === viewerId && r.canRespond && !r.responded
      );
      return canRespond ? action : null;

    case 'broadcastSelect':
      // 选择回应者：仅广播发出者可见
      return actionObj.broadcasterId === viewerId ? action : null;

    case 'announceStrike':
      // 宣布打击：打击拥有者可见
      return actionObj.ownerId === viewerId ? action : null;

    case 'lightspeedEscape':
      // 光速逃逸：相关玩家可见
      return actionObj.playerId === viewerId ? action : null;

    case 'recycleCard':
    case 'selectTargetSystem':
    case 'selectBroadcastSystem':
      // 这些操作通常在 actionPhase，当前行动玩家可见
      return action;

    default:
      return action;
  }
}

/**
 * 过滤日志
 * - 移除可能泄露隐藏信息的日志
 * - 例如：不应在日志中直接暴露对手手牌
 * - 保密弃牌日志对其他玩家隐藏具体牌面
 */
function filterLogs(
  logs: LogEntry[],
  viewerId: string | undefined,
  role: ViewRole
): LogEntry[] {
  return logs.map(log => {
    // 保密弃牌日志：对其他玩家隐藏具体牌面
    if (log.message.includes('弃掉了') && log.message.includes('（保密）')) {
      // 提取玩家名称
      const playerNameMatch = log.message.match(/^(.+?) 弃掉了/);
      if (playerNameMatch) {
        const playerName = playerNameMatch[1];
        // 对其他玩家隐藏具体数量
        return {
          ...log,
          message: `${playerName} 弃掉了一些牌（保密）`,
        };
      }
    }
    return log;
  });
}

// ============================
// 事件驱动的视角过滤
// ============================

/**
 * 游戏事件（用于事件驱动架构）
 * 服务器只发送事件，不发送完整状态
 */
export interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  turnNumber: number;
}

/**
 * 为不同玩家生成不同的事件
 * 这是事件驱动模式下的核心函数
 */
export function createEventForPlayer(
  event: GameEvent,
  absoluteState: GameState,
  playerId: string
): GameEvent {
  const { type, payload } = event;

  // 先过滤载荷中的敏感信息
  const filteredPayload = filterEventPayload(type, payload, playerId, absoluteState);

  // 根据不同事件类型进行过滤
  switch (type) {
    case 'draw_card':
      // 摸牌事件：摸牌者知道具体牌，其他人只知道数量
      if (payload.playerId === playerId) {
        return { ...event, payload: filteredPayload };  // 自己摸牌，可见具体牌
      } else {
        return {
          ...event,
          payload: {
            playerId: payload.playerId,
            playerName: payload.playerName,
            handCount: payload.handCount,
          },
        };
      }

    case 'play_card':
      // 出牌事件：打出的牌是公开信息，所有人都可见
      // 但需要隐藏 targetPlayerId（科技锁死目标）
      return { ...event, payload: filteredPayload };

    case 'broadcast_response':
      // 广播回应事件：回应者在揭示后才公开 subtype
      const broadcast = absoluteState.broadcast;
      if (!broadcast || broadcast.phase === 'select') {
        // 还在选择阶段，不暴露具体回应
        return {
          ...event,
          payload: {
            playerId: payload.playerId,
            responded: true,
          },
        };
      }
      return { ...event, payload: filteredPayload };

    case 'strike_hit':
      // 打击命中事件：隐藏 targetPlayerId
      return {
        ...event,
        payload: {
          strikeUid: payload.strikeUid,
          targetSystem: payload.targetSystem,
          level: payload.level,
          effect: payload.effect,
          // 不暴露 targetPlayerId
        },
      };

    default:
      return { ...event, payload: filteredPayload };
  }
}

/**
 * 过滤事件载荷中的敏感信息
 * 关键规则：
 * 1. 隐藏科技锁死的目标玩家 (targetPlayerId)
 * 2. 隐藏其他玩家的手牌信息
 * 3. 隐藏未揭示的广播 subtype
 */
export function filterEventPayload(
  eventType: string,
  payload: Record<string, unknown>,
  playerId: string,
  absoluteState: GameState
): Record<string, unknown> {
  const filtered = { ...payload };

  // 规则 1: 隐藏科技锁死的目标玩家
  // 只有打击的拥有者才能看到 targetPlayerId
  if (filtered.targetPlayerId) {
    let isOwner = false;

    // 检查是否是打击相关的事件
    if (payload.cardUid) {
      // 查找卡牌对应的打击
      const player = absoluteState.players.find(p => p.id === playerId);
      const card = player?.hand.find(c => c.uid === payload.cardUid) ||
                   player?.faceUpCards.find(c => c.uid === payload.cardUid);

      if (card && card.type === 'strike') {
        // 检查是否有对应的飞行打击
        const strike = absoluteState.flyingStrikes.find(
          s => s.ownerId === playerId && s.defId === payload.cardUid
        );
        isOwner = !!strike;
      }
    }

    // 检查是否是打击移动/宣布事件
    if (payload.strikeUid) {
      const strike = absoluteState.flyingStrikes.find(s => s.uid === payload.strikeUid);
      isOwner = !!strike && strike.ownerId === playerId;
    }

    // 非拥有者隐藏 targetPlayerId
    if (!isOwner) {
      delete filtered.targetPlayerId;
    }
  }

  // 规则 2: 隐藏其他玩家的手牌信息
  if (payload.hand && payload.playerId !== playerId) {
    // 只保留手牌数量
    filtered.handCount = Array.isArray(payload.hand) ? (payload.hand as unknown[]).length : payload.handCount;
    delete filtered.hand;
  }

  // 规则 3: 隐藏未揭示的广播 subtype
  if (eventType === 'broadcast_responded' || eventType === 'card_played') {
    const broadcast = absoluteState.broadcast;
    if (broadcast && filtered.cardUid === broadcast.cardUid) {
      const isBroadcaster = broadcast.broadcasterId === playerId;
      const isRevealed = broadcast.phase === 'reveal' || broadcast.phase === 'resolve' || broadcast.phase === 'done';

      if (!isBroadcaster && !isRevealed && filtered.subtype) {
        delete filtered.subtype;
      }
    }
  }

  return filtered;
}

// ============================
// 导出
// ============================

export default {
  createViewState,
  createEventForPlayer,
};
