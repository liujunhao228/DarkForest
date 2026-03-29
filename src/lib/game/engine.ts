// ============================
// 游戏引擎 - 核心逻辑
// ============================
import { v4 as uuid } from 'uuid';
import {
  Card, CardDef, Player, FlyingStrike, GameState,
  LogEntry, BroadcastState, BroadcastResponse,
  PendingAction, BroadcastSubtype, BroadcastResult,
} from './types';
import { CARD_DEFINITIONS } from './cards';
import { ADJACENCY, getDistance, getSystemsInRange, areAdjacent } from './starmap';

// 日志最大数量限制
const MAX_LOGS = 200;

// ==================
// 牌堆工具
// ==================

/** 从CardDef生成卡牌实例 */
function createCardInstances(def: CardDef): Card[] {
  const instances: Card[] = [];
  for (let i = 0; i < def.quantity; i++) {
    instances.push({
      uid: `${def.id}_${i}_${uuid().slice(0, 6)}`,
      defId: def.id,
      name: def.name,
      type: def.type,
      energy: def.energy,
      description: def.description,
      image: def.image,
      subtype: def.extended.subtype as BroadcastSubtype | undefined,
      range: def.extended.range as number | undefined,
      level: def.extended.level as number | undefined,
      speed: def.extended.speed as number | undefined,
      effect: def.extended.effect as string | undefined,
      protectionLevel: def.extended.protection_level as number | undefined,
      energyPerTurn: def.extended.energy_per_turn as number | undefined,
      ability: def.extended.ability as string | undefined,
    });
  }
  return instances;
}

/** 洗牌 */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 创建初始牌堆 */
export function createDrawPile(): Card[] {
  const allCards: Card[] = [];
  for (const def of CARD_DEFINITIONS) {
    allCards.push(...createCardInstances(def));
  }
  return shuffle(allCards);
}

// ==================
// 初始化游戏
// ==================

export interface InitConfig {
  playerCount: number;
  humanName: string;
}

const AI_NAMES = ['三体文明', '歌者文明', '归零者', '魔戒文明'];
const PLAYER_COLORS: Array<'red' | 'blue' | 'green' | 'amber' | 'purple'> = ['red', 'blue', 'green', 'amber', 'purple'];

export function initGame(config: InitConfig): GameState {
  const drawPile = createDrawPile();
  const players: Player[] = [];

  // 生成不重复的星系位置
  const positions = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, config.playerCount);

  for (let i = 0; i < config.playerCount; i++) {
    const isAI = i > 0;
    players.push({
      id: `player_${i}`,
      name: isAI ? AI_NAMES[i - 1] : config.humanName,
      color: PLAYER_COLORS[i],
      isAI,
      position: positions[i],
      energy: 3,
      hand: [],
      faceUpCards: [],
      eliminated: false,
      broadcastHistory: [],
    });
  }

  // 发初始手牌（每人4张）
  for (const player of players) {
    for (let i = 0; i < 4; i++) {
      if (drawPile.length > 0) {
        player.hand.push(drawPile.pop()!);
      }
    }
  }

  return {
    phase: 'playing',
    totalTurn: 1,
    playerCount: config.playerCount,
    players,
    currentPlayerIndex: 0,
    humanPlayerId: 'player_0',
    drawPile,
    discardPile: [],
    flyingStrikes: [],
    broadcast: null,
    turnPhase: 'settlement',
    pendingAction: null,
    logs: [{ id: uuid(), turn: 0, phase: 'system', message: '游戏开始！隐藏自己，做好清理。', type: 'system' }],
    winner: null,
    isProcessing: false,
  };
}

// ==================
// 日志
// ==================

function addLog(state: GameState, message: string, type: LogEntry['type'] = 'info'): void {
  state.logs.push({
    id: uuid(),
    turn: state.totalTurn,
    phase: state.turnPhase,
    message,
    type,
  });
  // 限制日志数量，移除过旧的日志
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS + 10);
  }
}

// ==================
// 摸牌（处理牌堆耗尽）
// ==================

function drawCard(state: GameState, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) break;
      // 重新洗牌
      state.drawPile = shuffle(state.discardPile);
      state.discardPile = [];
      addLog(state, '牌堆已耗尽，弃牌堆重新洗牌。', 'system');
    }
    if (state.drawPile.length > 0) {
      drawn.push(state.drawPile.pop()!);
    }
  }
  return drawn;
}

// ==================
// 回合流程
// ==================

/** 开始新回合 */
export function startTurn(state: GameState): void {
  const player = getCurrentPlayer(state);
  if (!player || player.eliminated) {
    advanceToNextPlayer(state);
    return;
  }

  state.turnPhase = 'settlement';
  state.pendingAction = null;
  state.isProcessing = false;
  addLog(state, `--- ${player.name} 的回合 ---`, 'system');

  // 阶段1: 结算 - 设施能量产出
  settlementPhase(state);

  // 检查是否有飞行打击需要移动
  const playerStrikes = state.flyingStrikes.filter(s => s.ownerId === player.id && s.position !== s.targetSystem);
  if (playerStrikes.length > 0) {
    state.turnPhase = 'strikeMovement';
    if (player.isAI) {
      // AI自动移动打击牌
      for (const strike of playerStrikes) {
        aiMoveStrike(state, strike);
      }
    } else {
      // 等待玩家操作 - 一次移动一个
      const strike = playerStrikes[0];
      const validMoves = ADJACENCY[strike.position]?.filter(n => {
        // 不能回退太远，优先移向目标方向
        return true;
      }) ?? [];
      state.pendingAction = {
        type: 'strikeMove',
        strikeUid: strike.uid,
        validMoves,
      };
      return; // 等待玩家操作
    }
  }

  // 阶段2: 摸牌
  drawPhase(state);
}

/** 阶段1: 结算 */
function settlementPhase(state: GameState): void {
  const player = getCurrentPlayer(state)!;

  // 设施能量产出
  let energyGained = 0;
  for (const card of player.faceUpCards) {
    if (card.type === 'facility' && card.energyPerTurn) {
      energyGained += card.energyPerTurn;
    }
  }
  if (energyGained > 0) {
    player.energy += energyGained;
    addLog(state, `${player.name} 的设施产出了 ${energyGained} 点能量（当前能量: ${player.energy}）`, 'info');
  }

  // 结算到达目标的打击牌
  const arrivedStrikes = state.flyingStrikes.filter(
    s => s.ownerId === player.id && s.position === s.targetSystem
  );
  for (const strike of arrivedStrikes) {
    // 检查目标星系是否有玩家
    const targets = state.players.filter(
      p => !p.eliminated && p.position === strike.targetSystem && p.id !== strike.ownerId
    );
    if (targets.length > 0) {
      state.pendingAction = {
        type: 'announceStrike',
        strikeUid: strike.uid,
        targetSystem: strike.targetSystem,
        targetPlayerIds: targets.map(t => t.id),
      };
      if (player.isAI) {
        // AI自动宣布生效
        resolveStrike(state, strike, targets);
        // 从飞行列表移除
        state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
      } else {
        addLog(state, `${player.name} 的【${strike.strikeName}】已到达目标星系 ${strike.targetSystem}，等待宣布生效！`, 'combat');
        return; // 等待玩家操作
      }
    } else {
      // 目标无人，打击无效
      addLog(state, `${player.name} 的【${strike.strikeName}】到达星系 ${strike.targetSystem}，但该星系无目标。打击落空。`, 'combat');
      state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
      // 打击牌进入弃牌堆
      state.discardPile.push(createCardFromStrike(strike));
    }
  }
}

/** 阶段2: 摸牌 */
export function drawPhase(state: GameState): void {
  const player = getCurrentPlayer(state)!;
  state.turnPhase = 'draw';
  const drawn = drawCard(state, 4);
  player.hand.push(...drawn);
  addLog(state, `${player.name} 摸了 ${drawn.length} 张牌（手牌: ${player.hand.length} 张）`, 'info');

  // 阶段3: 行动
  actionPhase(state);
}

/** 阶段3: 行动 */
export function actionPhase(state: GameState): void {
  const player = getCurrentPlayer(state)!;
  state.turnPhase = 'action';

  if (player.isAI) {
    // AI行动
    aiAction(state, player);
  }
  // 玩家等待操作 - 不设置pendingAction，让UI自由选择
}

/** 结束回合 */
export function endTurn(state: GameState): void {
  const player = getCurrentPlayer(state)!;
  addLog(state, `${player.name} 结束了回合。`, 'info');
  advanceToNextPlayer(state);
}

/** 前进到下一个存活玩家 */
export function advanceToNextPlayer(state: GameState): void {
  const alivePlayers = state.players.filter(p => !p.eliminated);
  if (alivePlayers.length <= 1) {
    // 游戏结束
    state.phase = 'gameOver';
    if (alivePlayers.length === 1) {
      state.winner = alivePlayers[0].id;
      addLog(state, `游戏结束！${alivePlayers[0].name} 获胜！`, 'system');
    } else {
      state.winner = null;
      addLog(state, '游戏结束！所有文明陨落，永恒黑暗降临。', 'system');
    }
    return;
  }

  // 检查是否需要换回合数
  let nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  let looped = false;
  while (state.players[nextIndex].eliminated) {
    nextIndex = (nextIndex + 1) % state.players.length;
    if (nextIndex <= state.currentPlayerIndex) {
      if (looped) break;
      looped = true;
    }
  }
  if (nextIndex <= state.currentPlayerIndex && looped) {
    state.totalTurn++;
  }
  state.currentPlayerIndex = nextIndex;

  // 延迟开始新回合（让UI有时间更新）
  startTurn(state);
}

// ==================
// 卡牌操作
// ==================

/** 获取当前玩家 */
function getCurrentPlayer(state: GameState): Player | undefined {
  return state.players[state.currentPlayerIndex];
}

/** 打出卡牌 - 通用 */
export function playCard(state: GameState, player: Player, cardUid: string): boolean {
  const cardIndex = player.hand.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return false;
  const card = player.hand[cardIndex];

  // 检查能量
  if (player.energy < card.energy) {
    addLog(state, `${player.name} 能量不足（需要 ${card.energy}，拥有 ${player.energy}）`, 'system');
    return false;
  }

  // 消耗能量
  player.energy -= card.energy;
  player.hand.splice(cardIndex, 1);
  return true;
}

/** 实际部署防御/设施牌 */
export function deployCard(state: GameState, playerId: string, cardUid: string): boolean {
  const player = state.players.find(p => p.id === playerId)!;
  const cardIndex = player.hand.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return false;
  const card = player.hand[cardIndex];

  if (player.energy < card.energy) {
    addLog(state, `${player.name} 能量不足`, 'system');
    return false;
  }

  // 戴森球限制：每个星系只能建造 1 个
  if (card.id === 'facility_dyson_sphere') {
    const playersAtSameSystem = state.players.filter(
      p => !p.eliminated && p.position === player.position
    );
    for (const p of playersAtSameSystem) {
      if (p.faceUpCards.some(c => c.id === 'facility_dyson_sphere')) {
        addLog(state, `该星系已有戴森球，无法建造`, 'system');
        return false;
      }
    }
  }

  player.energy -= card.energy;
  player.hand.splice(cardIndex, 1);
  player.faceUpCards.push(card);
  addLog(state, `${player.name} 部署了【${card.name}】`, 'action');
  return true;
}

/** 打出打击牌 */
export function playStrikeCard(state: GameState, playerId: string, cardUid: string, targetSystem: number): boolean {
  const player = state.players.find(p => p.id === playerId)!;
  const cardIndex = player.hand.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return false;
  const card = player.hand[cardIndex];

  if (player.energy < card.energy) return false;
  if (card.type !== 'strike') return false;

  player.energy -= card.energy;
  player.hand.splice(cardIndex, 1);

  // 创建飞行打击
  const strike: FlyingStrike = {
    uid: card.uid,
    ownerId: playerId,
    position: player.position,
    targetSystem,
    level: card.level ?? 1,
    speed: card.speed ?? 1,  // 保存速度属性
    effect: card.effect,
    strikeName: card.name,
  };
  state.flyingStrikes.push(strike);

  addLog(state, `${player.name} 向星系 ${targetSystem} 发射了【${card.name}】！`, 'combat');
  return true;
}

/** 回收场上门牌 */
export function recycleCard(state: GameState, playerId: string, cardUid: string): boolean {
  const player = state.players.find(p => p.id === playerId)!;
  const cardIndex = player.faceUpCards.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return false;

  const card = player.faceUpCards[cardIndex];
  const refund = Math.floor(card.energy / 2);

  player.faceUpCards.splice(cardIndex, 1);
  player.energy += refund;
  state.discardPile.push(card);

  addLog(state, `${player.name} 回收了【${card.name}】，获得 ${refund} 点能量`, 'action');
  return true;
}
// ==================
// 打击移动
// ==================

/** 移动打击牌 - 根据速度属性移动 */
export function moveStrike(state: GameState, strikeUid: string, targetSystem: number): void {
  const strike = state.flyingStrikes.find(s => s.uid === strikeUid);
  if (!strike) return;

  // 根据速度移动（速度默认为 1）
  const speed = strike.speed ?? 1;
  strike.position = targetSystem;
  addLog(state, `【${strike.strikeName}】（速度 ${speed}）移动到星系 ${targetSystem}`, 'combat');

  // 检查是否到达目标
  if (strike.position === strike.targetSystem) {
    // 移除pendingAction
    state.pendingAction = null;

    const player = state.players.find(p => p.id === strike.ownerId)!;
    const targets = state.players.filter(
      p => !p.eliminated && p.position === strike.targetSystem && p.id !== strike.ownerId
    );

    if (targets.length > 0) {
      state.pendingAction = {
        type: 'announceStrike',
        strikeUid: strike.uid,
        targetSystem: strike.targetSystem,
        targetPlayerIds: targets.map(t => t.id),
      };
      addLog(state, `【${strike.strikeName}】已到达目标！等待宣布生效。`, 'combat');
    } else {
      addLog(state, `【${strike.strikeName}】到达目标星系，但无人在此。打击落空。`, 'combat');
      state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
      state.discardPile.push(createCardFromStrike(strike));
    }
  } else {
    // 还有更多打击要移动，或者继续移动这个
    const player = state.players.find(p => p.id === strike.ownerId)!;
    const remainingStrikes = state.flyingStrikes.filter(
      s => s.ownerId === player.id && s.position !== s.targetSystem
    );

    if (remainingStrikes.length > 0) {
      // 还有打击要移动
      const nextStrike = remainingStrikes[0];
      const validMoves = ADJACENCY[nextStrike.position] ?? [];
      state.pendingAction = {
        type: 'strikeMove',
        strikeUid: nextStrike.uid,
        validMoves,
      };
    } else {
      // 所有打击已移动，进入摸牌阶段
      state.pendingAction = null;
      drawPhase(state);
    }
  }
}

/** AI移动打击 */
function aiMoveStrike(state: GameState, strike: FlyingStrike): void {
  // 简单AI：向目标方向移动
  const neighbors = ADJACENCY[strike.position] ?? [];
  if (neighbors.length === 0) return;

  // 选择最接近目标的邻居
  let bestMove = neighbors[0];
  let bestDist = getDistance(neighbors[0], strike.targetSystem);
  for (const n of neighbors) {
    const d = getDistance(n, strike.targetSystem);
    if (d < bestDist) {
      bestDist = d;
      bestMove = n;
    }
  }

  strike.position = bestMove;
  addLog(state, `【${strike.strikeName}】移动到星系 ${bestMove}`, 'combat');

  // 检查到达
  if (strike.position === strike.targetSystem) {
    const targets = state.players.filter(
      p => !p.eliminated && p.position === strike.targetSystem && p.id !== strike.ownerId
    );
    if (targets.length > 0) {
      resolveStrike(state, strike, targets);
      state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
    } else {
      addLog(state, `【${strike.strikeName}】到达目标但无人在此。`, 'combat');
      state.flyingStrikes = state.flyingStrikes.filter(s => s.uid !== strike.uid);
      state.discardPile.push(createCardFromStrike(strike));
    }
  }
}

// ==================
// 打击结算
// ==================

export function resolveStrike(state: GameState, strike: FlyingStrike, targets: Player[]): void {
  const attacker = state.players.find(p => p.id === strike.ownerId)!;
  addLog(state, `${attacker.name} 宣布【${strike.strikeName}】在星系 ${strike.targetSystem} 生效！`, 'combat');

  for (const target of targets) {
    // 获取最高防御等级
    let maxProtection = 0;
    for (const card of target.faceUpCards) {
      if (card.type === 'defense' && card.protectionLevel) {
        maxProtection = Math.max(maxProtection, card.protectionLevel);
      }
    }

    // 降维打击：无视防御
    if (strike.level >= 4) {
      eliminatePlayer(state, target, attacker);
      addLog(state, `【降维打击】无视防御！${target.name} 被淘汰！`, 'combat');
      continue;
    }

    // 科技锁死特殊效果：不淘汰，只弃手牌
    if (strike.effect === 'discard_hand') {
      if (strike.level <= maxProtection) {
        addLog(state, `${target.name} 的防御成功抵御了【${strike.strikeName}】`, 'combat');
      } else {
        addLog(state, `${target.name} 无法防御【${strike.strikeName}】，弃掉了全部 ${target.hand.length} 张手牌！`, 'combat');
        state.discardPile.push(...target.hand);
        target.hand = [];
      }
      continue;
    }

    // 普通打击
    if (strike.level <= maxProtection) {
      addLog(state, `${target.name} 的防御（等级 ${maxProtection}）成功抵御了【${strike.strikeName}】（等级 ${strike.level}）`, 'combat');
    } else {
      eliminatePlayer(state, target, attacker);
      addLog(state, `${target.name} 被【${strike.strikeName}】淘汰！（打击等级 ${strike.level} > 防御等级 ${maxProtection}）`, 'combat');
    }
  }

  // 光粒打击效果：摧毁恒星（暂不实现星系毁灭）
  // 湮灭打击效果：摧毁设施（暂不实现）

  // 打击牌进入弃牌堆
  state.discardPile.push(createCardFromStrike(strike));
}

/** 从打击信息重建卡牌（用于弃牌堆） */
function createCardFromStrike(strike: FlyingStrike): Card {
  return {
    uid: strike.uid,
    defId: '',
    name: strike.strikeName,
    type: 'strike',
    energy: 0,
    description: '',
    image: '',
    level: strike.level,
    speed: strike.speed ?? 1,  // 保留速度属性
    effect: strike.effect,
  };
}

/** 淘汰玩家 */
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

/** 宣布打击生效 */
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

  // 如果在settlement阶段，继续到draw
  if (state.turnPhase === 'settlement' || state.turnPhase === 'strikeMovement') {
    drawPhase(state);
  }
}

// ==================
// 广播系统
// ==================

export function initiateBroadcast(
  state: GameState,
  playerId: string,
  cardUid: string,
  targetSystem: number
): void {
  const player = state.players.find(p => p.id === playerId)!;
  const cardIndex = player.hand.findIndex(c => c.uid === cardUid);
  if (cardIndex === -1) return;
  const card = player.hand[cardIndex];

  if (card.type !== 'broadcast') return;
  if (player.energy < card.energy) return;

  // 检查广播限制
  const recentBroadcast = player.broadcastHistory.find(
    h => h.systemId === targetSystem && state.totalTurn - h.turn < 2
  );
  if (recentBroadcast) {
    addLog(state, `${player.name} 不能连续在同一星系广播`, 'system');
    return;
  }

  // 消耗能量，移除手牌
  player.energy -= card.energy;
  player.hand.splice(cardIndex, 1);

  const range = card.range ?? 1;
  player.broadcastHistory.push({ systemId: targetSystem, turn: state.totalTurn });

  // 确定可以回应的玩家
  const responses: BroadcastResponse[] = [];
  for (const other of state.players) {
    if (other.id === playerId || other.eliminated) continue;
    const dist = getDistance(other.position, targetSystem);
    const inRange = dist <= range;

    if (!inRange) continue;

    // 检查是否有合适的广播牌且有足够能量
    const hasBroadcastCard = other.hand.some(c => c.type === 'broadcast');
    const hasEnergy = other.energy >= (other.hand.find(c => c.type === 'broadcast')?.energy ?? 0);

    // 检查监听基地（允许不做回应）
    const hasMonitoringStation = other.faceUpCards.some(c => c.ability === 'detect_broadcast');

    const isAtTarget = other.position === targetSystem;
    // 有监听基地时，即使在目标星系也不必回应
    const mustRespond = isAtTarget && hasBroadcastCard && hasEnergy && !hasMonitoringStation;

    responses.push({
      playerId: other.id,
      playerName: other.name,
      canRespond: hasBroadcastCard && hasEnergy,
      mustRespond,
      responded: false,
      agreed: false,
    });
  }

  state.broadcast = {
    active: true,
    broadcasterId: playerId,
    cardUid,
    card,
    targetSystem,
    range,
    subtype: card.subtype ?? 'cooperation',
    responses,
    phase: 'waiting',
  };

  addLog(state, `${player.name} 向星系 ${targetSystem} 发送了【${card.name}】（${card.subtype === 'cooperation' ? '合作' : '伪装'}）`, 'broadcast');

  // 检查是否有可以回应的玩家
  const possibleResponders = responses.filter(r => r.canRespond);
  if (possibleResponders.length === 0) {
    // 无人回应
    player.energy += 1;
    state.discardPile.push(card);
    addLog(state, `无人回应广播，${player.name} 获得 1 点能量`, 'broadcast');
    state.broadcast = null;
  } else if (player.isAI) {
    // AI发布者 - 自动选择
    const mustResponders = responses.filter(r => r.mustRespond);
    const optionalResponders = responses.filter(r => r.canRespond && !r.mustRespond);

    if (mustResponders.length > 0) {
      // 有必须回应的玩家，自动结算
      for (const resp of mustResponders) {
        aiRespondToBroadcast(state, resp.playerId);
      }
      // AI选择一个回应者结算
      const allResponded = responses.filter(r => r.responded);
      if (allResponded.length > 0) {
        state.broadcast!.phase = 'select';
        state.broadcast!.selectedResponderId = allResponded[0].playerId;
        resolveBroadcast(state);
      }
    } else if (optionalResponders.length > 0) {
      // AI决定是否接受回应
      for (const resp of optionalResponders) {
        aiRespondToBroadcast(state, resp.playerId);
      }
      const allResponded = responses.filter(r => r.responded);
      if (allResponded.length > 0) {
        state.broadcast!.selectedResponderId = allResponded[0].playerId;
        resolveBroadcast(state);
      } else {
        // 无人回应
        player.energy += 1;
        state.discardPile.push(card);
        addLog(state, `无人回应广播，${player.name} 获得 1 点能量`, 'broadcast');
        state.broadcast = null;
      }
    }
  }
}

/** AI回应广播 */
function aiRespondToBroadcast(state: GameState, playerId: string): void {
  if (!state.broadcast) return;
  const player = state.players.find(p => p.id === playerId)!;
  const response = state.broadcast.responses.find(r => r.playerId === playerId);
  if (!response || !response.canRespond) return;

  // 简单AI: 80%概率回应
  const shouldRespond = response.mustRespond || Math.random() < 0.8;
  if (shouldRespond) {
    response.agreed = true;
    response.responded = true;
    // AI选择手中随机一张广播牌
    const broadcastCards = player.hand.filter(c => c.type === 'broadcast' && player.energy >= c.energy);
    if (broadcastCards.length > 0) {
      const chosenCard = broadcastCards[Math.floor(Math.random() * broadcastCards.length)];
      response.responseCard = chosenCard;
    }
  } else {
    response.responded = true;
  }
}

/** 玩家选择回应广播 */
export function respondToBroadcast(state: GameState, playerId: string, agreed: boolean, cardUid?: string): void {
  if (!state.broadcast) return;
  const response = state.broadcast.responses.find(r => r.playerId === playerId);
  if (!response) return;

  response.agreed = agreed;
  response.responded = true;

  if (agreed && cardUid) {
    const player = state.players.find(p => p.id === playerId)!;
    const card = player.hand.find(c => c.uid === cardUid);
    if (card) {
      response.responseCard = card;
    }
  }
}

/** 广播发布者选择回应者 */
export function selectBroadcastResponder(state: GameState, responderId: string): void {
  if (!state.broadcast) return;
  state.broadcast.selectedResponderId = responderId;
  state.broadcast.phase = 'reveal';
  resolveBroadcast(state);
}

/** 结算广播 */
export function resolveBroadcast(state: GameState): void {
  if (!state.broadcast || !state.broadcast.selectedResponderId) return;

  const broadcaster = state.players.find(p => p.id === state.broadcast!.broadcasterId)!;
  const responder = state.players.find(p => p.id === state.broadcast!.selectedResponderId)!;
  const response = state.broadcast.responses.find(r => r.playerId === state.broadcast!.selectedResponderId)!;

  const bSubtype = state.broadcast.subtype;
  const rSubtype = (response.responseCard?.subtype ?? 'cooperation') as BroadcastSubtype;

  // 消耗回应者的能量和牌
  if (response.responseCard) {
    const cardIdx = responder.hand.findIndex(c => c.uid === response.responseCard!.uid);
    if (cardIdx >= 0) {
      responder.energy -= response.responseCard.energy;
      responder.hand.splice(cardIdx, 1);
    }
  }

  // 结算
  let bEnergy = 0;
  let rEnergy = 0;

  if (bSubtype === 'cooperation' && rSubtype === 'cooperation') {
    bEnergy = 3;
    rEnergy = 3;
    addLog(state, `双方合作！${broadcaster.name} 和 ${responder.name} 各获得 3 点能量`, 'broadcast');
  } else if (bSubtype === 'disguise' && rSubtype === 'cooperation') {
    bEnergy = 5;
    addLog(state, `${broadcaster.name} 伪装成功！获得 5 点能量`, 'broadcast');
  } else if (bSubtype === 'cooperation' && rSubtype === 'disguise') {
    rEnergy = 5;
    addLog(state, `${responder.name} 伪装成功！获得 5 点能量`, 'broadcast');
  } else {
    addLog(state, `双方伪装！无人获得能量`, 'broadcast');
  }

  broadcaster.energy += bEnergy;
  responder.energy += rEnergy;

  // 回应者补1张牌
  const drawn = drawCard(state, 1);
  responder.hand.push(...drawn);

  // 广播牌明牌放在发布者面前
  broadcaster.faceUpCards.push(state.broadcast.card);

  // 检查胜方是否已经有足够的广播牌（暂不实现额外胜利条件）

  state.broadcast = null;
  state.pendingAction = null;
}

/** 取消广播（无人回应时） */
export function cancelBroadcast(state: GameState): void {
  if (!state.broadcast) return;
  const player = state.players.find(p => p.id === state.broadcast!.broadcasterId)!;
  player.energy += 1;
  state.discardPile.push(state.broadcast.card);
  addLog(state, `无人回应，${player.name} 获得 1 点能量`, 'broadcast');
  state.broadcast = null;
  state.pendingAction = null;
}

// ==================
// AI逻辑
// ==================

function aiAction(state: GameState, player: Player): void {
  // AI简单策略：每回合执行一个主要行动
  const defenseCards = player.hand.filter(c => c.type === 'defense' && c.energy <= player.energy);
  const facilityCards = player.hand.filter(c => c.type === 'facility' && c.ability !== 'escape' && c.energy <= player.energy);
  const strikeCards = player.hand.filter(c => c.type === 'strike' && c.energy <= player.energy);
  const broadcastCards = player.hand.filter(c => c.type === 'broadcast' && c.energy <= player.energy);

  let cardsPlayedCount = 0;

  // 优先部署防御（最多1张）
  if (defenseCards.length > 0 && player.faceUpCards.filter(c => c.type === 'defense').length < 2) {
    const card = defenseCards[0];
    if (deployCard(state, player.id, card.uid)) {
      cardsPlayedCount++;
    }
  }

  // 部署设施（最多1张）
  const updatedFacilityCards = player.hand.filter(c => c.type === 'facility' && c.ability !== 'escape' && c.energy <= player.energy);
  if (updatedFacilityCards.length > 0 && player.faceUpCards.filter(c => c.type === 'facility').length < 2) {
    const card = updatedFacilityCards[Math.floor(Math.random() * updatedFacilityCards.length)];
    if (deployCard(state, player.id, card.uid)) {
      cardsPlayedCount++;
    }
  }

  // 随机选择：打击或广播（二选一）
  const updatedStrikeCards = player.hand.filter(c => c.type === 'strike' && c.energy <= player.energy);
  const updatedBroadcastCards = player.hand.filter(c => c.type === 'broadcast' && c.energy <= player.energy);
  
  const action = Math.random();
  
  if (action < 0.5 && updatedStrikeCards.length > 0) {
    // 发射打击
    const card = updatedStrikeCards[0];
    const targets = state.players.filter(p => !p.eliminated && p.id !== player.id);
    if (targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      if (playStrikeCard(state, player.id, card.uid, target.position)) {
        cardsPlayedCount++;
      }
    }
  } else if (updatedBroadcastCards.length > 0) {
    // 广播
    const card = updatedBroadcastCards[Math.floor(Math.random() * updatedBroadcastCards.length)];
    const range = card.range ?? 1;
    const validSystems = getSystemsInRange(player.position, range);
    if (validSystems.length > 0) {
      const targetSystem = validSystems[Math.floor(Math.random() * validSystems.length)];
      initiateBroadcast(state, player.id, card.uid, targetSystem);
      // broadcast is resolved inline for AI, cardsPlayedCount already handled
    }
  }

  // 补牌（打出多少补多少）
  if (cardsPlayedCount > 0) {
    const drawn = drawCard(state, cardsPlayedCount);
    player.hand.push(...drawn);
  }

  // 结束回合
  addLog(state, `${player.name} 结束了回合`, 'info');
  advanceToNextPlayer(state);
}

/** 换牌行动：弃掉选择的牌，然后补相同数量的牌 */
export function exchangeCards(state: GameState, playerId: string, discardUids: string[]): void {
  const player = state.players.find(p => p.id === playerId)!;
  const discardCount = discardUids.length;
  
  // 弃掉选择的牌
  for (const uid of discardUids) {
    const idx = player.hand.findIndex(c => c.uid === uid);
    if (idx >= 0) {
      const card = player.hand.splice(idx, 1)[0];
      state.discardPile.push(card);
    }
  }

  // 补相同数量的牌
  const drawn = drawCard(state, discardCount);
  player.hand.push(...drawn);
  
  addLog(state, `${player.name} 进行了换牌行动`, 'action');
  
  // 结束回合
  advanceToNextPlayer(state);
}

/** 使用光速飞船 */
export function executeLightspeedShip(state: GameState, playerId: string): void {
  const player = state.players.find(p => p.id === playerId)!;
  const shipIndex = player.faceUpCards.findIndex(c => c.ability === 'escape');
  if (shipIndex === -1) return;

  // 弃置光速飞船
  const ship = player.faceUpCards.splice(shipIndex, 1)[0];
  state.discardPile.push(ship);

  // 找无人星系
  const occupied = new Set(state.players.filter(p => !p.eliminated).map(p => p.position));
  const available = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(s => !occupied.has(s));

  if (available.length === 0) {
    addLog(state, `没有可用的星系，${player.name} 无法跃迁`, 'system');
    return;
  }

  const newPos = available[Math.floor(Math.random() * available.length)];
  
  // 携带能量：保留当前能量（规则：可携带能量）
  // 注意：这里不消耗额外能量，只是位置移动
  
  // 处理原星系上的建设牌：选择废弃（留在原星系成为无主设施）
  // 简化实现：直接弃掉所有场上牌
  if (player.faceUpCards.length > 0) {
    addLog(state, `${player.name} 放弃了所有设施，带着能量逃离`, 'action');
    state.discardPile.push(...player.faceUpCards);
    player.faceUpCards = [];
  }
  
  player.position = newPos;
  addLog(state, `${player.name} 使用光速飞船跃迁至星系 ${newPos}！（保留 ${player.energy} 点能量）`, 'action');
}

/** 获取打击牌到目标的最短路径下一步 */
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

// ==================
// 辅助函数
// ==================

/** 检查星系是否在广播范围内 */
export function isSystemInRange(from: number, to: number, range: number): boolean {
  return getDistance(from, to) <= range;
}

/** 获取星系中的存活玩家 */
export function getPlayersAtSystem(state: GameState, systemId: number): Player[] {
  return state.players.filter(p => !p.eliminated && p.position === systemId);
}
