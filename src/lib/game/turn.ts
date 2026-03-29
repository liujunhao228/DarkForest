// ============================
// 游戏引擎 - 回合流程
// ============================
import { GameState, Player } from './types';
import { shuffle, addLog, getCurrentPlayer } from './utils';
import { drawCard } from './deck';
import { settlementPhase } from './settlement';
import { aiMoveStrike, aiAction } from './ai';
import { ADJACENCY } from './starmap';
import { discardHandCards } from './cards-actions';

/**
 * 开始新回合
 * 回合结构：
 * 1. 回合开始：获得基础能量 + 设施能量产出
 * 2. 打击移动：玩家操作飞行中的打击牌
 * 3. 摸牌阶段：摸 4 张牌
 * 4. 行动阶段：打牌
 */
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

  // 阶段 1: 获得基础能量（每回合 1 点）
  player.energy += 1;
  addLog(state, `${player.name} 获得 1 点基础能量（当前能量：${player.energy}）`, 'info');

  // 阶段 2: 设施能量产出
  settlementPhase(state);

  // 阶段 2: 打击移动 - 检查是否有飞行打击需要移动
  const playerStrikes = state.flyingStrikes.filter(s => s.ownerId === player.id && s.position !== s.targetSystem);
  if (playerStrikes.length > 0) {
    state.turnPhase = 'strikeMovement';
    if (player.isAI) {
      // AI 自动移动打击牌
      for (const strike of playerStrikes) {
        aiMoveStrike(state, strike);
      }
      // AI 移动完后进入摸牌阶段
      drawPhase(state);
    } else {
      // 等待玩家操作 - 一次移动一个
      const strike = playerStrikes[0];
      const validMoves = ADJACENCY[strike.position] ?? [];
      state.pendingAction = {
        type: 'strikeMove',
        strikeUid: strike.uid,
        validMoves,
      };
      // 玩家移动后在 moveStrike 函数中继续流程
      return; // 等待玩家操作
    }
  } else {
    // 没有打击需要移动，直接进入摸牌阶段
    drawPhase(state);
  }
}

/**
 * 阶段 2: 摸牌
 * 规则：补充手牌至 4 张
 */
export function drawPhase(state: GameState): void {
  const player = getCurrentPlayer(state)!;
  state.turnPhase = 'draw';

  // 计算需要补的牌数（补充至 4 张）
  const cardsNeeded = 4 - player.hand.length;
  const cardsToDraw = Math.max(0, cardsNeeded);

  const drawn = drawCard(state, cardsToDraw);
  player.hand.push(...drawn);
  addLog(state, `${player.name} 补充了 ${drawn.length} 张牌（手牌：${player.hand.length} 张）`, 'info');

  // 阶段 3: 行动
  actionPhase(state);
}

/**
 * 阶段 3: 行动
 */
export function actionPhase(state: GameState): void {
  const player = getCurrentPlayer(state)!;
  state.turnPhase = 'action';

  if (player.isAI) {
    // AI 行动
    aiAction(state, player);
  }
  // 玩家等待操作 - 不设置 pendingAction，让 UI 自由选择
}

/**
 * 结束回合
 * @param state 游戏状态
 * @param discardCardUids 可选：要弃掉的手牌 UID 列表
 */
export function endTurn(state: GameState, discardCardUids: string[] = []): void {
  const player = getCurrentPlayer(state)!;
  
  // 如果有弃牌，先弃牌
  if (discardCardUids.length > 0) {
    discardHandCards(state, player.id, discardCardUids);
  }
  
  addLog(state, `${player.name} 结束了回合。`, 'info');
  advanceToNextPlayer(state);
}

/**
 * 前进到下一个存活玩家
 */
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

  // 开始新回合
  startTurn(state);
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
    addLog(state, `没有可用的星系，${player.name} 无法跃迁`, 'system');
    return;
  }

  const newPos = available[Math.floor(Math.random() * available.length)];

  // 处理原星系上的建设牌：弃掉所有场上牌
  if (player.faceUpCards.length > 0) {
    addLog(state, `${player.name} 放弃了所有设施，带着能量逃离`, 'action');
    state.discardPile.push(...player.faceUpCards);
    player.faceUpCards = [];
  }

  player.position = newPos;
  addLog(state, `${player.name} 使用光速飞船跃迁至星系 ${newPos}！（保留 ${player.energy} 点能量）`, 'action');
}
