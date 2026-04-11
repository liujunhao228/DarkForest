// ============================
// 黑暗森林 - 游戏动作验证器
// ============================
// 验证所有玩家操作的合法性，防止作弊
// ============================

import type { GameState, Player, Card, TurnPhase, PendingAction } from '@/lib/game/types';
import type { ValidationResult, ActionType } from './protocol';
import { getSystemsInRange, getDistance } from '@/lib/game/starmap';

// 重新导出 ValidationResult 以便于导入
export type { ValidationResult } from './protocol';

// ============================
// 验证上下文
// ============================

export interface ValidationContext {
  gameState: GameState;
  playerId: string;
  action: ActionType;
  payload?: Record<string, unknown>;
}

// ============================
// 主验证函数
// ============================

/**
 * 验证游戏操作
 */
export function validateGameAction(
  gameState: GameState,
  playerId: string,
  action: ActionType,
  payload?: Record<string, unknown>
): ValidationResult {
  const context: ValidationContext = {
    gameState,
    playerId,
    action,
    payload,
  };

  // 基础验证
  const baseValidation = validateBaseAction(context);
  if (!baseValidation.valid) {
    return baseValidation;
  }

  // 根据动作类型分发到具体验证器
  switch (action) {
    case 'playCard':
      return validatePlayCard(context);
    case 'moveStrike':
      return validateMoveStrike(context);
    case 'endTurn':
      return validateEndTurn(context);
    case 'respondBroadcast':
      return validateRespondBroadcast(context);
    case 'selectResponder':
      return validateSelectResponder(context);
    case 'announceStrike':
      return validateAnnounceStrike(context);
    case 'skipAnnounceStrike':
      return validateSkipAnnounceStrike(context);
    case 'recycleCard':
      return validateRecycleCard(context);
    case 'useLightspeedShip':
      return validateUseLightspeedShip(context);
    case 'discardCards':
      return validateDiscardCards(context);
    case 'cancelBroadcast':
      return validateCancelBroadcast(context);
    default:
      return { valid: false, error: '未知的操作类型', errorCode: 'UNKNOWN_ACTION' };
  }
}

// ============================
// 基础验证
// ============================

/**
 * 基础验证：检查游戏状态和玩家状态
 */
function validateBaseAction(context: ValidationContext): ValidationResult {
  const { gameState, playerId } = context;

  // 游戏是否在进行中
  if (gameState.phase !== 'playing') {
    return { valid: false, error: '游戏未开始或已结束', errorCode: 'GAME_NOT_PLAYING' };
  }

  // 玩家是否存在
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) {
    return { valid: false, error: '玩家不存在', errorCode: 'PLAYER_NOT_FOUND' };
  }

  // 玩家是否已被淘汰
  if (player.eliminated) {
    return { valid: false, error: '玩家已被淘汰', errorCode: 'PLAYER_ELIMINATED' };
  }

  // 是否正在处理中（动画播放等）
  if (gameState.isProcessing) {
    return { valid: false, error: '服务器正在处理中，请稍后', errorCode: 'IS_PROCESSING' };
  }

  return { valid: true };
}

// ============================
// 具体动作验证
// ============================

/**
 * 验证出牌操作
 */
function validatePlayCard(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 检查是否是当前玩家的回合
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (currentPlayer.id !== playerId) {
    // 例外：广播回应可以在非自己回合进行
    if (gameState.broadcast?.active && gameState.broadcast.phase === 'waiting') {
      return validateBroadcastPlay(context);
    }
    return { valid: false, error: '不是你的回合', errorCode: 'NOT_YOUR_TURN' };
  }

  // 检查是否在行动阶段
  if (gameState.turnPhase !== 'actionPhase') {
    return { valid: false, error: '当前不是行动阶段', errorCode: 'INVALID_PHASE' };
  }

  // 检查 payload
  if (!payload?.cardUid) {
    return { valid: false, error: '缺少卡牌 UID', errorCode: 'MISSING_CARD_UID' };
  }

  // 检查卡牌是否在手中
  const player = gameState.players.find(p => p.id === playerId)!;
  const card = player.hand.find(c => c.uid === payload.cardUid);
  if (!card) {
    return { valid: false, error: '卡牌不在手中', errorCode: 'CARD_NOT_IN_HAND' };
  }

  // 检查能量是否足够
  if (player.energy < card.energy) {
    return { valid: false, error: '能量不足', errorCode: 'NOT_ENOUGH_ENERGY' };
  }

  // 根据卡牌类型进行额外验证
  if (card.type === 'broadcast' && !payload.targetSystem) {
    return { valid: false, error: '广播牌需要指定目标星系', errorCode: 'MISSING_TARGET' };
  }

  if ((card.type === 'strike') && !payload.targetSystem) {
    return { valid: false, error: '打击牌需要指定目标星系', errorCode: 'MISSING_TARGET' };
  }

  if (card.type === 'broadcast') {
    // 验证广播距离
    const range = card.range ?? 1;
    const distance = getDistance(player.position, payload.targetSystem as number);
    if (range < 100 && distance > range) {
      return { valid: false, error: '目标星系超出广播范围', errorCode: 'OUT_OF_RANGE' };
    }

    // 验证不能连续两次在同一星系广播
    const lastBroadcast = player.broadcastHistory.find(
      b => b.systemId === payload.targetSystem && b.turn === gameState.totalTurn
    );
    if (lastBroadcast) {
      return { valid: false, error: '本回合已在此星系广播过', errorCode: 'ALREADY_BROADCAST' };
    }
  }

  if (card.type === 'strike' && card.effect === 'discard_hand' && !payload.targetPlayerId) {
    return { valid: false, error: '科技锁死需要指定目标玩家', errorCode: 'MISSING_TARGET_PLAYER' };
  }

  return { valid: true };
}

/**
 * 验证广播牌出牌（特殊处理）
 */
function validateBroadcastPlay(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 检查是否有活跃的广播
  if (!gameState.broadcast?.active) {
    return { valid: false, error: '当前没有活跃的广播', errorCode: 'NO_ACTIVE_BROADCAST' };
  }

  // 检查玩家是否在回应列表中
  const response = gameState.broadcast.responses.find(r => r.playerId === playerId);
  if (!response || !response.canRespond) {
    return { valid: false, error: '你不能回应此广播', errorCode: 'CANNOT_RESPOND' };
  }

  // 检查是否已经回应过
  if (response.responded) {
    return { valid: false, error: '你已经回应过了', errorCode: 'ALREADY_RESPONDED' };
  }

  // 检查 payload
  if (!payload?.cardUid) {
    return { valid: false, error: '缺少卡牌 UID', errorCode: 'MISSING_CARD_UID' };
  }

  // 检查卡牌是否在手中
  const player = gameState.players.find(p => p.id === playerId)!;
  const card = player.hand.find(c => c.uid === payload.cardUid);
  if (!card) {
    return { valid: false, error: '卡牌不在手中', errorCode: 'CARD_NOT_IN_HAND' };
  }

  // 检查是否是广播牌
  if (card.type !== 'broadcast') {
    return { valid: false, error: '只能使用广播牌回应', errorCode: 'NOT_BROADCAST_CARD' };
  }

  // 检查能量是否足够
  if (player.energy < card.energy) {
    return { valid: false, error: '能量不足', errorCode: 'NOT_ENOUGH_ENERGY' };
  }

  return { valid: true };
}

/**
 * 验证移动打击牌
 */
function validateMoveStrike(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 检查是否是打击移动阶段
  if (gameState.turnPhase !== 'strikeMovement' && gameState.turnPhase !== 'actionPhase') {
    return { valid: false, error: '当前不是打击移动阶段', errorCode: 'INVALID_PHASE' };
  }

  // 检查 payload
  if (!payload?.strikeUid || !payload.targetSystem) {
    return { valid: false, error: '缺少打击 UID 或目标星系', errorCode: 'MISSING_PARAMS' };
  }

  // 查找打击牌
  const strike = gameState.flyingStrikes.find(s => s.uid === payload.strikeUid);
  if (!strike) {
    return { valid: false, error: '打击牌不存在', errorCode: 'STRIKE_NOT_FOUND' };
  }

  // 检查是否是打击牌的所有者
  if (strike.ownerId !== playerId) {
    return { valid: false, error: '这不是你的打击牌', errorCode: 'NOT_YOUR_STRIKE' };
  }

  // 检查移动是否合法（相邻星系）
  const distance = getDistance(strike.position, payload.targetSystem as number);
  if (distance > strike.speed) {
    return { valid: false, error: '目标星系超出移动范围', errorCode: 'OUT_OF_RANGE' };
  }

  // 检查 pending action
  if (gameState.pendingAction?.type === 'strikeMove') {
    if (gameState.pendingAction.strikeUid !== payload.strikeUid) {
      return { valid: false, error: '当前需要移动其他打击牌', errorCode: 'WRONG_STRIKE' };
    }
    if (!gameState.pendingAction.validMoves.includes(payload.targetSystem as number)) {
      return { valid: false, error: '目标星系不可达', errorCode: 'INVALID_MOVE' };
    }
  }

  return { valid: true };
}

/**
 * 验证结束回合
 */
function validateEndTurn(context: ValidationContext): ValidationResult {
  const { gameState, playerId } = context;

  // 检查是否是当前玩家
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (currentPlayer.id !== playerId) {
    return { valid: false, error: '不是你的回合', errorCode: 'NOT_YOUR_TURN' };
  }

  // 检查是否在行动阶段
  if (gameState.turnPhase !== 'actionPhase') {
    return { valid: false, error: '当前不是行动阶段', errorCode: 'INVALID_PHASE' };
  }

  return { valid: true };
}

/**
 * 验证回应广播
 */
function validateRespondBroadcast(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 检查是否有活跃的广播
  if (!gameState.broadcast?.active) {
    return { valid: false, error: '当前没有活跃的广播', errorCode: 'NO_ACTIVE_BROADCAST' };
  }

  // 检查是否在等待回应阶段
  if (gameState.broadcast.phase !== 'waiting') {
    return { valid: false, error: '当前不是回应阶段', errorCode: 'INVALID_PHASE' };
  }

  // 检查玩家是否在回应列表中
  const response = gameState.broadcast.responses.find(r => r.playerId === playerId);
  if (!response || !response.canRespond) {
    return { valid: false, error: '你不能回应此广播', errorCode: 'CANNOT_RESPOND' };
  }

  // 检查是否已经回应过
  if (response.responded) {
    return { valid: false, error: '你已经回应过了', errorCode: 'ALREADY_RESPONDED' };
  }

  // 检查 payload
  if (payload?.agreed === undefined) {
    return { valid: false, error: '缺少回应决定', errorCode: 'MISSING_DECISION' };
  }

  // 如果同意回应，需要检查卡牌
  if (payload.agreed && !payload.cardUid) {
    return { valid: false, error: '回应需要提供卡牌 UID', errorCode: 'MISSING_CARD_UID' };
  }

  // 如果同意回应，验证卡牌
  if (payload.agreed && payload.cardUid) {
    const player = gameState.players.find(p => p.id === playerId)!;
    const card = player.hand.find(c => c.uid === payload.cardUid);
    if (!card) {
      return { valid: false, error: '卡牌不在手中', errorCode: 'CARD_NOT_IN_HAND' };
    }
    if (card.type !== 'broadcast') {
      return { valid: false, error: '只能使用广播牌回应', errorCode: 'NOT_BROADCAST_CARD' };
    }
    if (player.energy < card.energy) {
      return { valid: false, error: '能量不足', errorCode: 'NOT_ENOUGH_ENERGY' };
    }
  }

  return { valid: true };
}

/**
 * 验证选择回应者
 */
function validateSelectResponder(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 调试日志
  console.log('[GameValidator] validateSelectResponder 被调用', {
    playerId,
    hasBroadcast: !!gameState.broadcast,
    broadcastActive: gameState.broadcast?.active,
    broadcastPhase: gameState.broadcast?.phase,
    broadcasterId: gameState.broadcast?.broadcasterId,
    selectedResponderId: gameState.broadcast?.selectedResponderId,
  });

  // 检查是否有活跃的广播
  if (!gameState.broadcast?.active) {
    return { valid: false, error: '当前没有活跃的广播', errorCode: 'NO_ACTIVE_BROADCAST' };
  }

  // 检查是否在选择阶段或揭示阶段（幂等性：允许重复请求）
  if (gameState.broadcast.phase !== 'select' && gameState.broadcast.phase !== 'reveal') {
    console.log('[GameValidator] 验证失败: phase 不是 select 或 reveal', {
      currentPhase: gameState.broadcast.phase,
    });
    return { valid: false, error: '当前不是选择回应者阶段', errorCode: 'INVALID_PHASE' };
  }

  // 如果已经选择了回应者，检查是否是同一个（幂等性）
  if (gameState.broadcast.selectedResponderId) {
    const requestedResponderId = payload?.responderId as string;
    if (gameState.broadcast.selectedResponderId !== requestedResponderId) {
      return { valid: false, error: '已经选择了回应者，无法更改', errorCode: 'ALREADY_SELECTED' };
    }
    // 同一个回应者，允许通过（幂等性）
    return { valid: true };
  }

  // 检查是否是广播发布者
  if (gameState.broadcast.broadcasterId !== playerId) {
    return { valid: false, error: '只有广播发布者可以选择回应者', errorCode: 'NOT_BROADCASTER' };
  }

  // 检查 payload
  if (!payload?.responderId) {
    return { valid: false, error: '缺少回应者 ID', errorCode: 'MISSING_RESPONDER' };
  }

  // 检查回应者是否在列表中
  const canRespond = gameState.broadcast.responses.filter(r => r.responded && r.agreed);
  if (!canRespond.find(r => r.playerId === payload.responderId)) {
    return { valid: false, error: '回应者无效', errorCode: 'INVALID_RESPONDER' };
  }

  return { valid: true };
}

/**
 * 验证宣布打击生效
 */
function validateAnnounceStrike(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 检查 payload
  if (!payload?.strikeUid) {
    return { valid: false, error: '缺少打击 UID', errorCode: 'MISSING_STRIKE_UID' };
  }

  // 查找打击牌
  const strike = gameState.flyingStrikes.find(s => s.uid === payload.strikeUid);
  if (!strike) {
    return { valid: false, error: '打击牌不存在', errorCode: 'STRIKE_NOT_FOUND' };
  }

  // 检查是否是打击牌的所有者
  if (strike.ownerId !== playerId) {
    return { valid: false, error: '这不是你的打击牌', errorCode: 'NOT_YOUR_STRIKE' };
  }

  // 检查打击牌是否已到达目标
  if (strike.position !== strike.targetSystem) {
    return { valid: false, error: '打击牌尚未到达目标星系', errorCode: 'STRIKE_NOT_ARRIVED' };
  }

  // 检查是否有 pending action
  if (gameState.pendingAction?.type !== 'announceStrike') {
    return { valid: false, error: '当前不能宣布打击', errorCode: 'INVALID_TIMING' };
  }

  return { valid: true };
}

/**
 * 验证跳过宣布打击(延迟宣布)
 */
function validateSkipAnnounceStrike(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 检查 payload
  if (!payload?.strikeUid) {
    return { valid: false, error: '缺少打击 UID', errorCode: 'MISSING_STRIKE_UID' };
  }

  // 查找打击牌
  const strike = gameState.flyingStrikes.find(s => s.uid === payload.strikeUid);
  if (!strike) {
    return { valid: false, error: '打击牌不存在', errorCode: 'STRIKE_NOT_FOUND' };
  }

  // 检查是否是打击牌的所有者
  if (strike.ownerId !== playerId) {
    return { valid: false, error: '这不是你的打击牌', errorCode: 'NOT_YOUR_STRIKE' };
  }

  // 检查是否有 pending action
  if (gameState.pendingAction?.type !== 'announceStrike') {
    return { valid: false, error: '当前没有待宣布的打击', errorCode: 'INVALID_TIMING' };
  }

  return { valid: true };
}

/**
 * 验证回收卡牌
 */
function validateRecycleCard(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 检查是否是当前玩家
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (currentPlayer.id !== playerId) {
    return { valid: false, error: '不是你的回合', errorCode: 'NOT_YOUR_TURN' };
  }

  // 检查是否在行动阶段
  if (gameState.turnPhase !== 'actionPhase') {
    return { valid: false, error: '当前不是行动阶段', errorCode: 'INVALID_PHASE' };
  }

  // 检查 payload
  if (!payload?.cardUid) {
    return { valid: false, error: '缺少卡牌 UID', errorCode: 'MISSING_CARD_UID' };
  }

  // 检查卡牌是否在场上
  const player = gameState.players.find(p => p.id === playerId)!;
  const card = player.faceUpCards.find(c => c.uid === payload.cardUid);
  if (!card) {
    return { valid: false, error: '卡牌不在场上', errorCode: 'CARD_NOT_ON_FIELD' };
  }

  // 检查是否是防御或设施牌
  if (card.type !== 'defense' && card.type !== 'facility') {
    return { valid: false, error: '只能回收防御或设施牌', errorCode: 'INVALID_CARD_TYPE' };
  }

  return { valid: true };
}

/**
 * 验证使用光速飞船
 */
function validateUseLightspeedShip(context: ValidationContext): ValidationResult {
  const { gameState, playerId } = context;

  // 检查是否是当前玩家
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (currentPlayer.id !== playerId) {
    return { valid: false, error: '不是你的回合', errorCode: 'NOT_YOUR_TURN' };
  }

  // 检查是否在行动阶段
  if (gameState.turnPhase !== 'actionPhase') {
    return { valid: false, error: '当前不是行动阶段', errorCode: 'INVALID_PHASE' };
  }

  // 检查玩家是否有光速飞船
  const player = gameState.players.find(p => p.id === playerId)!;
  const hasLightspeedShip = player.faceUpCards.some(
    c => c.type === 'facility' && c.ability === 'escape'
  );
  if (!hasLightspeedShip) {
    return { valid: false, error: '没有光速飞船', errorCode: 'NO_LIGHTSPEED_SHIP' };
  }

  return { valid: true };
}

/**
 * 验证弃牌
 */
function validateDiscardCards(context: ValidationContext): ValidationResult {
  const { gameState, playerId, payload } = context;

  // 检查 payload
  if (!payload?.cardUids || !Array.isArray(payload.cardUids)) {
    return { valid: false, error: '缺少卡牌列表', errorCode: 'MISSING_CARDS' };
  }

  // 检查所有卡牌是否在手中
  const player = gameState.players.find(p => p.id === playerId)!;
  for (const cardUid of payload.cardUids as string[]) {
    const card = player.hand.find(c => c.uid === cardUid);
    if (!card) {
      return { valid: false, error: `卡牌 ${cardUid} 不在手中`, errorCode: 'CARD_NOT_IN_HAND' };
    }
  }

  return { valid: true };
}

/**
 * 验证取消广播
 */
function validateCancelBroadcast(context: ValidationContext): ValidationResult {
  const { gameState, playerId } = context;

  // 检查是否存在活跃广播
  if (!gameState.broadcast || !gameState.broadcast.active) {
    return { valid: false, error: '当前没有活跃的广播', errorCode: 'NO_ACTIVE_BROADCAST' };
  }

  // 检查请求者是否为广播发起者
  if (gameState.broadcast.broadcasterId !== playerId) {
    return { valid: false, error: '只有广播发起者可以取消广播', errorCode: 'NOT_BROADCASTER' };
  }

  // 检查是否有人已回应（有人回应时不应允许取消）
  const hasResponses = gameState.broadcast.responses.some(r => r.responded && r.agreed);
  if (hasResponses) {
    return { valid: false, error: '已有玩家回应广播，无法取消', errorCode: 'BROADCAST_ALREADY_RESPONDED' };
  }

  return { valid: true };
}

// ============================
// 辅助函数
// ============================

/**
 * 获取玩家可执行的操作列表
 */
export function getValidActions(gameState: GameState, playerId: string): ActionType[] {
  const actions: ActionType[] = [];
  const player = gameState.players.find(p => p.id === playerId);
  
  if (!player || player.eliminated) return actions;

  const isCurrentPlayer = gameState.players[gameState.currentPlayerIndex]?.id === playerId;

  // 结束回合（总是可以）
  if (isCurrentPlayer && gameState.turnPhase === 'actionPhase') {
    actions.push('endTurn');
  }

  // 出牌
  if (isCurrentPlayer && gameState.turnPhase === 'actionPhase') {
    actions.push('playCard');
    
    // 回收卡牌
    if (player.faceUpCards.some(c => c.type === 'defense' || c.type === 'facility')) {
      actions.push('recycleCard');
    }

    // 光速飞船
    if (player.faceUpCards.some(c => c.type === 'facility' && c.ability === 'escape')) {
      actions.push('useLightspeedShip');
    }
  }

  // 回应广播
  if (gameState.broadcast?.active && gameState.broadcast.phase === 'waiting') {
    const response = gameState.broadcast.responses.find(r => r.playerId === playerId);
    if (response?.canRespond && !response.responded) {
      actions.push('respondBroadcast');
    }
  }

  // 移动打击牌
  if (gameState.flyingStrikes.some(s => s.ownerId === playerId)) {
    if (gameState.turnPhase === 'strikeMovement' ||
        (gameState.turnPhase === 'actionPhase' && gameState.pendingAction?.type === 'strikeMove')) {
      actions.push('moveStrike');
    }
  }

  // 宣布打击
  if (gameState.pendingAction?.type === 'announceStrike') {
    const pendingAction = gameState.pendingAction as { type: 'announceStrike'; strikeUid: string; targetSystem: number; targetPlayerIds: string[] };
    const strike = gameState.flyingStrikes.find(s => s.uid === pendingAction.strikeUid);
    if (strike?.ownerId === playerId) {
      actions.push('announceStrike');
    }
  }

  return actions;
}
