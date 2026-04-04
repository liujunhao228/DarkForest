// ============================
// 游戏引擎 - 回合流程 (状态机重构版)
// ============================
//
// 状态转换图:
// turnBegin → strikeMovement → drawPhase → actionPhase → turnEnd → (下一玩家)turnBegin
//      ↓            ↓              ↓            ↓
//   (设施产出)  (有打击?)      (摸牌)      (玩家操作)
//      ↓            ↓              ↓            ↓
//      └────────────┴──────────────┴────────────┘
//                                   ↓
//                         (广播/打击宣布生效)
//                                   ↓
//                           interrupted (等待响应)
//                                   ↓
//                         (响应完成后回到 actionPhase)
// ============================

import { GameState, Player } from './types';
import { shuffle, addLog, getCurrentPlayer } from './utils';
import { drawCard } from './deck';
import { settlementPhase } from './settlement';
import { ADJACENCY } from './starmap';
import { discardHandCards } from './cards-actions';

/**
 * 开始新回合 - 状态机入口
 * 
 * 回合结构:
 * 1. turnBegin: 获得基础能量 + 设施能量产出
 * 2. strikeMovement: 移动飞行中的打击牌
 * 3. drawPhase: 摸牌补至 4 张
 * 4. actionPhase: 打牌/换牌
 * 5. turnEnd: 清理状态,推进到下一玩家
 */
export function startTurn(state: GameState): void {
  const player = getCurrentPlayer(state);
  
  // 跳过已淘汰玩家
  if (!player || player.eliminated) {
    advanceToNextPlayer(state);
    return;
  }

  // 进入回合开始阶段
  state.turnPhase = 'turnBegin';
  state.pendingAction = null;
  state.isProcessing = false;
  
  addLog(state, `--- ${player.name} 的回合 ---`, 'system');

  // 执行回合开始逻辑
  processTurnBegin(state);
}

/**
 * 处理 turnBegin 阶段
 * - 获得基础能量 (1 点)
 * - 设施能量产出
 * - 推进到 strikeMovement
 */
function processTurnBegin(state: GameState): void {
  const player = getCurrentPlayer(state)!;

  // 1. 获得基础能量 (每回合 1 点)
  player.energy += 1;
  addLog(state, `${player.name} 获得 1 点基础能量 (当前能量: ${player.energy})`, 'info');

  // 2. 设施能量产出
  settlementPhase(state);

  // 3. 推进到打击移动阶段
  advanceToStrikeMovement(state);
}

/**
 * 推进到 strikeMovement 阶段
 * 检查是否有飞行中的打击牌需要移动
 */
function advanceToStrikeMovement(state: GameState): void {
  state.turnPhase = 'strikeMovement';
  
  const player = getCurrentPlayer(state)!;
  const playerStrikes = state.flyingStrikes.filter(
    s => s.ownerId === player.id && s.position !== s.targetSystem
  );

  if (playerStrikes.length === 0) {
    // 没有打击需要移动,直接进入摸牌阶段
    drawPhase(state);
  } else {
    // 有打击需要移动，等待玩家操作
    const strike = playerStrikes[0];
    const validMoves = ADJACENCY[strike.position] ?? [];
    state.pendingAction = {
      type: 'strikeMove',
      strikeUid: strike.uid,
      validMoves,
    };
    addLog(state, `${player.name} 需要移动打击牌 【${strike.strikeName}】`, 'combat');
    // 玩家移动后在 moveStrike 函数中继续流程
  }
}

/**
 * 推进到 drawPhase 阶段
 * 摸牌补至 4 张
 */
export function drawPhase(state: GameState): void {
  state.turnPhase = 'drawPhase';
  
  const player = getCurrentPlayer(state)!;
  
  // 计算需要补的牌数 (补充至 4 张)
  const cardsNeeded = 4 - player.hand.length;
  const cardsToDraw = Math.max(0, cardsNeeded);

  const drawn = drawCard(state, cardsToDraw);
  player.hand.push(...drawn);
  addLog(state, `${player.name} 补充了 ${drawn.length} 张牌 (手牌: ${player.hand.length} 张)`, 'info');

  // 推进到行动阶段
  advanceToActionPhase(state);
}

/**
 * 推进到 actionPhase 阶段
 * 玩家可执行打牌等操作
 */
function advanceToActionPhase(state: GameState): void {
  state.turnPhase = 'actionPhase';

  // 人类玩家: 等待 UI 操作,不设置 pendingAction,让 UI 自由选择
}

/**
 * 行动阶段 - 公开版本 (供 store 调用)
 */
export function actionPhase(state: GameState): void {
  advanceToActionPhase(state);
}

/**
 * 推进到 turnEnd 阶段
 * 清理当前玩家状态,准备推进到下一玩家
 */
function advanceToEndPhase(state: GameState): void {
  state.turnPhase = 'turnEnd';
  state.pendingAction = null;
  
  // 推进到下一玩家
  advanceToNextPlayer(state);
}

/**
 * 结束回合
 * @param state 游戏状态
 * @param discardCardUids 可选: 要弃掉的手牌 UID 列表
 */
export function endTurn(state: GameState, discardCardUids: string[] = []): void {
  const player = getCurrentPlayer(state)!;

  // 如果有弃牌,先弃牌
  if (discardCardUids.length > 0) {
    discardHandCards(state, player.id, discardCardUids);
  }

  addLog(state, `${player.name} 结束了回合。`, 'info');
  
  // 推进到回合结束阶段
  advanceToEndPhase(state);
}

/**
 * 前进到下一个存活玩家
 */
export function advanceToNextPlayer(state: GameState): void {
  const alivePlayers = state.players.filter(p => !p.eliminated);
  
  // 检查游戏是否结束
  if (alivePlayers.length <= 1) {
    state.phase = 'gameOver';
    if (alivePlayers.length === 1) {
      state.winner = alivePlayers[0].id;
      addLog(state, `游戏结束! ${alivePlayers[0].name} 获胜!`, 'system');
    } else {
      state.winner = null;
      addLog(state, '游戏结束! 所有文明陨落,永恒黑暗降临。', 'system');
    }
    return;
  }

  // 查找下一个存活玩家
  let nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  let looped = false;
  
  while (state.players[nextIndex].eliminated) {
    nextIndex = (nextIndex + 1) % state.players.length;
    if (nextIndex <= state.currentPlayerIndex) {
      if (looped) break;
      looped = true;
    }
  }
  
  // 如果绕了一圈,增加总回合数
  if (nextIndex <= state.currentPlayerIndex && looped) {
    state.totalTurn++;
  }
  
  state.currentPlayerIndex = nextIndex;

  // 开始新回合
  startTurn(state);
}

/**
 * 打击移动完成后的回调
 * 检查是否还有更多打击需要移动,否则进入摸牌阶段
 */
export function afterStrikeMove(state: GameState): void {
  const player = getCurrentPlayer(state)!;
  const remainingStrikes = state.flyingStrikes.filter(
    s => s.ownerId === player.id && s.position !== s.targetSystem
  );

  if (remainingStrikes.length > 0) {
    // 还有打击需要移动,设置下一个 pendingAction
    const nextStrike = remainingStrikes[0];
    const validMoves = ADJACENCY[nextStrike.position] ?? [];
    state.pendingAction = {
      type: 'strikeMove',
      strikeUid: nextStrike.uid,
      validMoves,
    };
  } else {
    // 所有打击移动完成,进入摸牌阶段
    state.pendingAction = null;
    drawPhase(state);
  }
}

/**
 * 中断当前回合流程 (用于广播等跨回合交互)
 */
export function interruptTurn(state: GameState, reason: string): void {
  state.turnPhase = 'interrupted';
  addLog(state, `回合中断: ${reason}`, 'system');
}

/**
 * 恢复中断的回合流程
 */
export function resumeTurn(state: GameState): void {
  // 恢复到行动阶段
  state.turnPhase = 'actionPhase';
  addLog(state, '回合已恢复', 'system');
}

/**
 * 使用光速飞船
 */
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
    addLog(state, `没有可用的星系, ${player.name} 无法跃迁`, 'system');
    return;
  }

  const newPos = available[Math.floor(Math.random() * available.length)];

  // 处理原星系上的建设牌: 弃掉所有场上牌
  if (player.faceUpCards.length > 0) {
    addLog(state, `${player.name} 放弃了所有设施,带着能量逃离`, 'action');
    state.discardPile.push(...player.faceUpCards);
    player.faceUpCards = [];
  }

  player.position = newPos;
  addLog(state, `${player.name} 使用光速飞船跃迁至星系 ${newPos}! (保留 ${player.energy} 点能量)`, 'action');
}
