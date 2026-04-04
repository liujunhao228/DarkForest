// ============================
// 匹配系统模块
// ============================
// 负责管理匹配队列、房间创建、AI 填充
// ============================

import { db } from './db';
import { generateId } from './game/utils';

// ============================
// 类型定义
// ============================

export interface MatchmakingOptions {
  playerId: string;
  mode: 'casual' | 'ranked';
  playerCount: number;  // 3-5
  timeout?: number;     // 匹配超时 (ms)
}

export interface MatchResult {
  success: boolean;
  match?: {
    id: string;
    roomCode: string;
    hostId: string;
    players: MatchPlayerInfo[];
  };
  error?: string;
}

export interface MatchPlayerInfo {
  playerId: string;
  displayName: string;
  isAI: boolean;
  isHost: boolean;
  playerNumber: number;
  position: number;
}

// ============================
// AI 名称池
// ============================

const AI_NAMES = [
  '三体文明',
  '歌者文明',
  '归零者',
  '魔戒文明',
  '边缘者',
  '清洁工',
  '观察员',
  '狩猎者',
];

// ============================
// 匹配队列管理
// ============================

/**
 * 加入匹配队列
 */
export async function joinQueue(options: MatchmakingOptions): Promise<{ success: boolean; error?: string }> {
  try {
    // 检查玩家是否已在队列中
    const existingQueue = await db.matchmakingQueue.findUnique({
      where: { playerId: options.playerId },
    });

    if (existingQueue) {
      return { success: false, error: '已在匹配队列中' };
    }

    // 创建队列记录
    await db.matchmakingQueue.create({
      data: {
        playerId: options.playerId,
        preferredMode: options.mode,
        preferredCount: options.playerCount,
        timeout: options.timeout ?? 30000,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('加入匹配队列失败:', error);
    return { success: false, error: '系统错误' };
  }
}

/**
 * 取消匹配队列
 */
export async function cancelQueue(playerId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 先检查记录是否存在
    const existing = await db.matchmakingQueue.findUnique({
      where: { playerId },
    });

    if (!existing) {
      return { success: false, error: '不在匹配队列中' };
    }

    await db.matchmakingQueue.delete({
      where: { playerId },
    });
    return { success: true };
  } catch (error) {
    console.error('取消匹配队列失败:', error);
    return { success: false, error: '系统错误' };
  }
}

/**
 * 检查匹配状态
 */
export async function getQueueStatus(playerId: string): Promise<{
  inQueue: boolean;
  position?: number;
  estimatedTime?: number;
} | null> {
  try {
    const queue = await db.matchmakingQueue.findUnique({
      where: { playerId },
    });

    if (!queue) {
      return { inQueue: false };
    }

    // 计算队列位置（基于加入时间）
    const allQueues = await db.matchmakingQueue.findMany({
      orderBy: { joinedAt: 'asc' },
    });

    const position = allQueues.findIndex(q => q.playerId === playerId) + 1;
    const estimatedTime = Math.max(0, 30 - Math.floor((Date.now() - queue.joinedAt.getTime()) / 1000));

    return {
      inQueue: true,
      position,
      estimatedTime,
    };
  } catch (error) {
    console.error('查询匹配状态失败:', error);
    return null;
  }
}

// ============================
// 匹配逻辑
// ============================

/**
 * 尝试匹配玩家
 * 返回匹配成功的玩家列表
 */
export async function findMatches(): Promise<{
  matches: string[][];  // 每组匹配的玩家 ID 列表
} | null> {
  try {
    // 获取所有队列中的玩家
    const queues = await db.matchmakingQueue.findMany({
      include: {
        player: true,
      },
      orderBy: { joinedAt: 'asc' },
    });

    if (queues.length < 2) {
      return { matches: [] };
    }

    const matches: string[][] = [];
    const usedPlayerIds = new Set<string>();

    // 按期望玩家数分组
    const queuesByCount = new Map<number, typeof queues>();
    for (const queue of queues) {
      const count = queue.preferredCount;
      if (!queuesByCount.has(count)) {
        queuesByCount.set(count, []);
      }
      queuesByCount.get(count)!.push(queue);
    }

    // 尝试为每个玩家数创建房间
    for (const [count, queueList] of queuesByCount.entries()) {
      const availableQueues = queueList.filter(q => !usedPlayerIds.has(q.playerId));
      
      // 如果队列中玩家数足够，创建一个房间
      if (availableQueues.length >= count) {
        const matchPlayers = availableQueues.slice(0, count).map(q => q.playerId);
        matches.push(matchPlayers);
        matchPlayers.forEach(id => usedPlayerIds.add(id));
      }
    }

    // 处理剩余玩家（混合不同玩家数偏好）
    const remainingQueues = queues.filter(q => !usedPlayerIds.has(q.playerId));
    if (remainingQueues.length >= 3) {
      // 尝试创建 3-5 人房间
      const targetCount = Math.min(5, remainingQueues.length);
      const matchPlayers = remainingQueues.slice(0, targetCount).map(q => q.playerId);
      matches.push(matchPlayers);
    }

    return { matches };
  } catch (error) {
    console.error('匹配失败:', error);
    return null;
  }
}

// ============================
// 房间管理
// ============================

/**
 * 生成房间号
 */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * 创建对局房间
 */
export async function createMatchRoom(
  playerIds: string[],
  mode: 'casual' | 'ranked',
  aiCount: number = 0
): Promise<MatchResult> {
  try {
    const roomCode = generateRoomCode();
    const hostId = playerIds[0];

    // 生成不重复的星系位置
    const positions = shuffleArray([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, playerIds.length + aiCount);

    // 创建对局记录
    const match = await db.match.create({
      data: {
        roomCode,
        hostId,
        status: 'waiting',  // 创建时为 waiting，所有玩家加入后才开始
        mode,
        playerCount: playerIds.length + aiCount,
        aiCount,
      },
    });

    // 添加玩家记录
    const matchPlayers: MatchPlayerInfo[] = [];

    // 添加真人玩家
    for (let i = 0; i < playerIds.length; i++) {
      const playerId = playerIds[i];
      const player = await db.player.findUnique({
        where: { id: playerId },
      });

      if (!player) continue;

      await db.matchPlayer.create({
        data: {
          matchId: match.id,
          playerId,
          playerNumber: i,
          isHost: i === 0,
          isAI: false,
          position: positions[i],
        },
      });

      matchPlayers.push({
        playerId,
        displayName: player.displayName,
        isAI: false,
        isHost: i === 0,
        playerNumber: i,
        position: positions[i],
      });
    }

    // 添加 AI 玩家
    for (let i = 0; i < aiCount; i++) {
      const playerNumber = playerIds.length + i;
      const aiName = AI_NAMES[i % AI_NAMES.length];
      // 创建临时 AI 玩家记录以满足外键约束
      const aiPlayerId = `ai_${match.id}_${i}`;

      // 先在 Player 表中创建临时 AI 玩家记录
      await db.player.create({
        data: {
          id: aiPlayerId,
          userId: aiPlayerId,
          displayName: aiName,
          role: 'ai',
        },
      });

      await db.matchPlayer.create({
        data: {
          matchId: match.id,
          playerId: aiPlayerId,
          playerNumber,
          isHost: false,
          isAI: true,
          aiName,
          position: positions[playerNumber],
        },
      });

      matchPlayers.push({
        playerId: aiPlayerId,
        displayName: aiName,
        isAI: true,
        isHost: false,
        playerNumber,
        position: positions[playerNumber],
      });
    }

    return {
      success: true,
      match: {
        id: match.id,
        roomCode: match.roomCode,
        hostId: match.hostId,
        players: matchPlayers,
      },
    };
  } catch (error) {
    console.error('创建房间失败:', error);
    return {
      success: false,
      error: '创建房间失败',
    };
  }
}

/**
 * 获取房间信息
 */
export async function getMatchRoom(roomCode: string): Promise<{
  match: {
    id: string;
    roomCode: string;
    hostId: string;
    status: string;
    mode: string;
    playerCount: number;
    players: MatchPlayerInfo[];
  };
} | null> {
  try {
    const match = await db.match.findUnique({
      where: { roomCode },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
    });

    if (!match) {
      return null;
    }

    const players: MatchPlayerInfo[] = match.players.map(mp => ({
      playerId: mp.playerId,
      displayName: mp.isAI ? (mp.aiName ?? 'AI') : mp.player.displayName,
      isAI: mp.isAI,
      isHost: mp.isHost,
      playerNumber: mp.playerNumber,
      position: mp.position,
    }));

    return {
      match: {
        id: match.id,
        roomCode: match.roomCode,
        hostId: match.hostId,
        status: match.status,
        mode: match.mode,
        playerCount: match.playerCount,
        players,
      },
    };
  } catch (error) {
    console.error('获取房间信息失败:', error);
    return null;
  }
}

/**
 * 更新对局状态
 */
export async function updateMatchStatus(
  matchId: string,
  status: 'waiting' | 'playing' | 'finished',
  updates?: {
    winnerId?: string;
    winnerType?: 'human' | 'ai';
    totalTurns?: number;
    duration?: number;
  }
): Promise<boolean> {
  try {
    const data: Record<string, unknown> = { status };

    if (status === 'playing') {
      data.startedAt = new Date();
    }

    if (status === 'finished') {
      data.finishedAt = new Date();
      if (updates?.winnerId) data.winnerId = updates.winnerId;
      if (updates?.winnerType) data.winnerType = updates.winnerType;
      if (updates?.totalTurns) data.totalTurns = updates.totalTurns;
      if (updates?.duration) data.duration = updates.duration;
    }

    await db.match.update({
      where: { id: matchId },
      data,
    });

    return true;
  } catch (error) {
    console.error('更新对局状态失败:', error);
    return false;
  }
}

/**
 * 添加对局日志
 */
export async function addMatchLog(matchId: string, logEntry: Record<string, unknown>): Promise<boolean> {
  try {
    const match = await db.match.findUnique({
      where: { id: matchId },
    });

    if (!match) return false;

    const currentLog = match.gameLog ? JSON.parse(match.gameLog) : [];
    currentLog.push({
      ...logEntry,
      timestamp: new Date().toISOString(),
    });

    await db.match.update({
      where: { id: matchId },
      data: {
        gameLog: JSON.stringify(currentLog),
      },
    });

    return true;
  } catch (error) {
    console.error('添加对局日志失败:', error);
    return false;
  }
}

// ============================
// 玩家统计
// ============================

/**
 * 更新玩家统计
 */
export async function updatePlayerStats(
  playerId: string,
  result: 'win' | 'loss' | 'draw'
): Promise<boolean> {
  try {
    const player = await db.player.findUnique({
      where: { id: playerId },
    });

    if (!player) return false;

    const updates: Record<string, number> = {
      totalMatches: player.totalMatches + 1,
    };

    if (result === 'win') {
      updates.wins = player.wins + 1;
      updates.experience = player.experience + 100;
      updates.rating = player.rating + 25;
    } else if (result === 'loss') {
      updates.losses = player.losses + 1;
      updates.experience = player.experience + 25;
      updates.rating = Math.max(0, player.rating - 15);
    } else {
      updates.draws = player.draws + 1;
      updates.experience = player.experience + 50;
    }

    // 计算等级
    const level = Math.floor(updates.experience / 1000) + 1;
    updates.level = level;

    await db.player.update({
      where: { id: playerId },
      data: updates,
    });

    return true;
  } catch (error) {
    console.error('更新玩家统计失败:', error);
    return false;
  }
}

/**
 * 获取玩家信息
 */
export async function getPlayerInfo(playerId: string): Promise<{
  id: string;
  displayName: string;
  level: number;
  experience: number;
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  rating: number;
} | null> {
  try {
    const player = await db.player.findUnique({
      where: { id: playerId },
    });

    if (!player) return null;

    return {
      id: player.id,
      displayName: player.displayName,
      level: player.level,
      experience: player.experience,
      wins: player.wins,
      losses: player.losses,
      draws: player.draws,
      totalMatches: player.totalMatches,
      rating: player.rating,
    };
  } catch (error) {
    console.error('获取玩家信息失败:', error);
    return null;
  }
}

/**
 * 创建或获取玩家
 */
export async function getOrCreatePlayer(userId: string, displayName: string): Promise<{
  id: string;
  displayName: string;
} | null> {
  try {
    // 尝试获取现有玩家
    let player = await db.player.findUnique({
      where: { userId },
    });

    if (player) {
      return {
        id: player.id,
        displayName: player.displayName,
      };
    }

    // 创建新玩家
    player = await db.player.create({
      data: {
        userId,
        displayName,
      },
    });

    return {
      id: player.id,
      displayName: player.displayName,
    };
  } catch (error) {
    console.error('创建玩家失败:', error);
    return null;
  }
}

// ============================
// 工具函数
// ============================

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
