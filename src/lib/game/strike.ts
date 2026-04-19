// ============================
// 游戏引擎 - 打击系统
// ============================
import { GameState, Player, Card, FlyingStrike } from './types';
import { addLog } from './utils';
import { ADJACENCY, getDistance } from './starmap';
import { afterStrikeMove } from './turn';

/**
 * 移动打击牌 - 根据速度属性移动
 */
export function moveStrike(state: GameState, strikeUid: string, targetSystem: number): void {
  const strike = state.flyingStrikes.find(s => s.uid === strikeUid);
  if (!strike) return;

  // 检查剩余移动次数
  if (strike.remainingMoves <= 0) return;

  // 科技锁死: 追踪目标玩家当前位置
  if (strike.targetPlayerId) {
    const targetPlayer = state.players.find(p => p.id === strike.targetPlayerId);
    if (targetPlayer && !targetPlayer.eliminated) {
      strike.targetSystem = targetPlayer.position;
    }
  }

  // 执行移动
  strike.position = targetSystem;
  strike.remainingMoves--;
  addLog(state, `【${strike.strikeName}】 (速度 ${strike.speed}, 剩余移动 ${strike.remainingMoves}) 移动到星系 ${targetSystem}`, 'combat');

  // 检查是否到达目标
  if (strike.position === strike.targetSystem && !strike.arrived) {
    // 标记已到达
    strike.arrived = true;
    const player = state.players.find(p => p.id === strike.ownerId)!;

    // 科技锁死: 只针对指定目标玩家
    let targets: Player[] = [];
    if (strike.targetPlayerId) {
      const targetPlayer = state.players.find(
        p => p.id === strike.targetPlayerId && !p.eliminated && p.position === strike.targetSystem
      );
      if (targetPlayer && targetPlayer.id !== strike.ownerId) {
        targets = [targetPlayer];
      }
    } else {
      // 普通打击: 针对星系内所有其他玩家
      targets = state.players.filter(
        p => !p.eliminated && p.position === strike.targetSystem && p.id !== strike.ownerId
      );
    }

    if (targets.length > 0) {
      // 有目标玩家,等待宣布打击生效
      state.pendingAction = {
        type: 'announceStrike',
        strikeUid: strike.uid,
        targetSystem: strike.targetSystem,
        targetPlayerIds: targets.map(t => t.id),
      };
      addLog(state, `【${strike.strikeName}】已到达目标! 可以宣布生效。`, 'combat');
      // 等待玩家操作,不继续处理其他打击
      return;
    } else {
      // 目标无人,打击无效
      addLog(state, `【${strike.strikeName}】到达目标星系,但无人在此。打击落空。`, 'combat');
      state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
      state.discardPile.push(createCardFromStrike(strike));
      // 继续处理其他打击
    }
  } else if (strike.remainingMoves <= 0) {
    // 移动次数用完,结束移动
    addLog(state, `【${strike.strikeName}】移动次数用完,停止移动。`, 'combat');
  }

  // 检查是否还有其他打击需要移动,使用统一回调
  afterStrikeMove(state);
}

/**
 * 结算打击
 */
export function resolveStrike(state: GameState, strike: FlyingStrike, targets: Player[]): void {
  const attacker = state.players.find(p => p.id === strike.ownerId)!;
  const targetSystem = strike.targetSystem;
  addLog(state, `${attacker.name} 宣布【${strike.strikeName}】在星系 ${targetSystem} 生效！`, 'combat');

  // 光粒打击：毁灭恒星
  if (strike.defId === 'strike_light_particle') {
    if (!state.destroyedStars.includes(targetSystem)) {
      state.destroyedStars.push(targetSystem);
      addLog(state, `【光粒打击】毁灭了星系 ${targetSystem} 的恒星！`, 'combat');
    }
  }

  // 湮灭打击：毁灭恒星及所有建设牌
  if (strike.defId === 'strike_annihilation') {
    if (!state.destroyedStars.includes(targetSystem)) {
      state.destroyedStars.push(targetSystem);
      addLog(state, `【湮灭打击】毁灭了星系 ${targetSystem} 的恒星！`, 'combat');
    }
    // 毁灭该星系所有玩家的建设牌
    for (const target of targets) {
      if (target.faceUpCards.length > 0) {
        addLog(state, `【湮灭打击】毁灭了 ${target.name} 的所有设施牌（${target.faceUpCards.length} 张）`, 'combat');
        state.discardPile.push(...target.faceUpCards);
        target.faceUpCards = [];
      }
    }
  }

  for (const target of targets) {
    // 获取最高防御等级
    let maxProtection = 0;
    for (const card of target.faceUpCards) {
      if (card.type === 'defense' && card.protectionLevel) {
        maxProtection = Math.max(maxProtection, card.protectionLevel);
      }
    }

    // 降维打击：无视防御
    if ((strike.level ?? 0) >= 4 && strike.effect !== 'discard_hand') {
      eliminatePlayer(state, target, attacker);
      addLog(state, `【降维打击】无视防御！${target.name} 被淘汰！`, 'combat');
      continue;
    }

    // 科技锁死特殊效果：不淘汰，只弃手牌
    if (strike.effect === 'discard_hand') {
      // 科技锁死等级 4，高于所有防御（最高 3），直接弃牌
      addLog(state, `${target.name} 无法防御【${strike.strikeName}】，弃掉了全部 ${target.hand.length} 张手牌！`, 'combat');
      state.discardPile.push(...target.hand);
      target.hand = [];
      continue;
    }

    // 普通打击
    if (strike.level! <= maxProtection) {
      addLog(state, `${target.name} 的防御（等级 ${maxProtection}）成功抵御了【${strike.strikeName}】（等级 ${strike.level}）`, 'combat');
    } else {
      eliminatePlayer(state, target, attacker);
      addLog(state, `${target.name} 被【${strike.strikeName}】淘汰！（打击等级 ${strike.level} > 防御等级 ${maxProtection}）`, 'combat');
    }
  }

  // 打击牌进入弃牌堆
  state.discardPile.push(createCardFromStrike(strike));
}

/**
 * 宣布打击生效
 */
export function announceStrike(state: GameState): void {
  const action = state.pendingAction;
  if (!action || action.type !== 'announceStrike') return;

  const strike = state.flyingStrikes.find(s => s.uid === action.strikeUid);
  if (!strike) return;

  const targets = state.players.filter(p => action.targetPlayerIds.includes(p.id) && !p.eliminated);
  resolveStrike(state, strike, targets);
  state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
  state.pendingAction = null;

  // 检查游戏是否结束
  const alivePlayers = state.players.filter(p => !p.eliminated);
  if (alivePlayers.length <= 1) {
    state.phase = 'gameOver';
    if (alivePlayers.length === 1) {
      state.winner = alivePlayers[0].id;
    } else {
      state.winner = null;
    }
    return;
  }

  // 根据当前回合阶段,决定如何继续
  // 如果在 strikeMovement 或 turnBegin 阶段,继续到 drawPhase
  if (state.turnPhase === 'turnBegin' || state.turnPhase === 'strikeMovement') {
    afterStrikeMove(state);
  }
  // 如果在 actionPhase (例如中途宣布打击),回到 actionPhase
  // 不自动推进,等待玩家继续操作
}

/**
 * 跳过宣布打击(延迟宣布)
 * 打击保留在目标星系,下回合可以再次宣布
 */
export function skipAnnounceStrike(state: GameState): void {
  const action = state.pendingAction;
  if (!action || action.type !== 'announceStrike') return;

  const strike = state.flyingStrikes.find(s => s.uid === action.strikeUid);
  if (!strike) return;

  // 清除 pendingAction,但保留打击牌
  state.pendingAction = null;

  const owner = state.players.find(p => p.id === strike.ownerId);
  addLog(state, `${owner?.name ?? 'Unknown'} 选择暂不宣布【${strike.strikeName}】生效`, 'info');

  // 根据当前阶段继续流程
  if (state.turnPhase === 'turnBegin' || state.turnPhase === 'strikeMovement') {
    afterStrikeMove(state);
  }
  // actionPhase 不自动推进
}

/**
 * 从打击信息重建卡牌（用于弃牌堆）
 */
export function createCardFromStrike(strike: FlyingStrike): Card {
  return {
    uid: strike.uid,
    defId: strike.defId,
    name: strike.strikeName,
    type: 'strike',
    energy: 0,
    description: '',
    image: '',
    level: strike.level,
    speed: strike.speed ?? 1,
    effect: strike.effect,
  };
}

/**
 * 淘汰玩家
 */
function eliminatePlayer(state: GameState, target: Player, attacker: Player): void {
  target.eliminated = true;
  // 弃掉所有手牌和门牌
  state.discardPile.push(...target.hand, ...target.faceUpCards);
  target.hand = [];
  target.faceUpCards = [];

  // 打击者获得能量
  const aliveCount = state.players.filter(p => !p.eliminated).length;
  const energyGain = aliveCount * 3;
  attacker.energy += energyGain;
  addLog(state, `${attacker.name} 获得 ${energyGain} 点能量（剩余玩家 × 3）`, 'combat');
}

/**
 * 获取打击牌到目标的最短路径下一步（用于 AI）
 */
export function getStrikeBestMove(strike: FlyingStrike): number {
  const neighbors = ADJACENCY[strike.position] ?? [];
  let bestMove = neighbors[0];
  let bestDist = Infinity;
  for (const n of neighbors) {
    const d = getDistance(n, strike.targetSystem);
    if (d < bestDist) {
      bestDist = d;
      bestMove = n;
    }
  }
  return bestMove;
}
