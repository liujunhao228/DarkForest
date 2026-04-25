// ============================
// 匹配系统模块
// ============================
// 负责管理匹配队列、房间创建、AI 填充
// ============================

import { db } from './db';
import { randomBytes } from 'crypto';

// ============================
// 类型定义
// ============================

export interface MatchmakingOptions {
  playerId: string;
  playerCount: number;  // 3-5
  timeout?: number;     // 匹配超时 (ms)
}

export interface SpecificQueueOptions {
  playerId: string;
  queueId: string;      // 指定的队列ID
  playerCount?: number; // 3-5，可选
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

export interface SpecificQueueResult {
  success: boolean;
  queueId?: string;
  queueName?: string;
  position?: number;
  totalInQueue?: number;
  error?: string;
}

export interface MatchPlayerInfo {
  playerId: string;
  displayName: string;
  isHost: boolean;
  playerNumber: number;
  position: number;
}

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
    // 使用 deleteMany 避免记录不存在时抛出错误
    const result = await db.matchmakingQueue.deleteMany({
      where: { playerId },
    });

    if (result.count === 0) {
      // 记录不存在，但目标状态已达到，视为成功
      console.log(`[Matchmaking] 取消队列时记录不存在（可能已被移除）: ${playerId}`);
    }

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
 * 生成房间号（使用密码学安全的随机数）
 */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * 创建对局房间
 */
export async function createMatchRoom(
  playerIds: string[]
): Promise<MatchResult> {
  try {
    const roomCode = generateRoomCode();
    const hostId = playerIds[0];

    // 生成不重复的星系位置
    const positions = shuffleArray([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, playerIds.length);

    // 创建对局记录
    const match = await db.match.create({
      data: {
        roomCode,
        hostId,
        status: 'waiting',  // 创建时为 waiting，所有玩家加入后才开始
        playerCount: playerIds.length,
        aiCount: 0,
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
          position: positions[i],
        },
      });

      matchPlayers.push({
        playerId,
        displayName: player.displayName,
        isHost: i === 0,
        playerNumber: i,
        position: positions[i],
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
      displayName: mp.player.displayName,
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
    } else if (result === 'loss') {
      updates.losses = player.losses + 1;
    } else {
      updates.draws = player.draws + 1;
    }

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
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
} | null> {
  try {
    const player = await db.player.findUnique({
      where: { id: playerId },
    });

    if (!player) return null;

    return {
      id: player.id,
      displayName: player.displayName,
      wins: player.wins,
      losses: player.losses,
      draws: player.draws,
      totalMatches: player.totalMatches,
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

// ============================
// 指定队列管理
// ============================

/**
 * 生成队列ID（使用密码学安全的随机数）
 */
function generateQueueId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(8);
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

/**
 * 创建自定义匹配队列
 */
export async function createCustomQueue(
  creatorId: string,
  queueName: string,
  options?: {
    minPlayers?: number;
    maxPlayers?: number;
  }
): Promise<{
  success: boolean;
  queueId?: string;
  error?: string;
}> {
  try {
    const minPlayers = options?.minPlayers ?? 3;
    const maxPlayers = options?.maxPlayers ?? 4;

    if (minPlayers < 3 || maxPlayers > 5 || minPlayers > maxPlayers) {
      return { success: false, error: '玩家数必须在 3-5 之间，且最小值不能大于最大值' };
    }

    const creator = await db.player.findUnique({
      where: { id: creatorId },
    });
    
    if (!creator) {
      return { success: false, error: '创建者玩家不存在' };
    }

    const queueId = generateQueueId();

    const queue = await db.customMatchQueue.create({
      data: {
        queueId,
        queueName,
        creatorId,
        minPlayers,
        maxPlayers,
        status: 'waiting',
      },
    });

    const playerCheck = await db.player.findUnique({
      where: { id: creatorId },
    });
    
    if (!playerCheck) {
      return { success: false, error: '玩家不存在' };
    }
    
    await db.customMatchQueuePlayer.create({
      data: {
        queueId,
        playerId: creatorId,
        isReady: true,
      },
    });

    return { success: true, queueId };
  } catch (error) {
    console.error('创建自定义队列失败:', error);
    return { success: false, error: '系统错误' };
  }
}

/**
 * 加入指定的匹配队列
 */
export async function joinSpecificQueue(
  options: SpecificQueueOptions
): Promise<SpecificQueueResult> {
  try {
    const { playerId, queueId, playerCount } = options;

    // 检查队列是否存在
    const queue = await db.customMatchQueue.findUnique({
      where: { queueId },
      include: {
        players: {
          include: {
            player: true,
          },
        },
        creator: true,
      },
    });

    if (!queue) {
      return { success: false, error: '队列不存在' };
    }

    // 检查队列状态
    if (queue.status === 'full' || queue.status === 'started') {
      return { success: false, error: '队列已满或已开始' };
    }

    // 检查玩家是否已在该队列中
    const existingPlayer = await db.customMatchQueuePlayer.findUnique({
      where: {
        queueId_playerId: {
          queueId,
          playerId,
        },
      },
    });

    if (existingPlayer) {
      return { success: false, error: '已在该队列中' };
    }

    // 检查队列是否已满
    if (queue.players.length >= queue.maxPlayers) {
      await db.customMatchQueue.update({
        where: { queueId },
        data: { status: 'full' },
      });
      return { success: false, error: '队列已满' };
    }

    // 添加玩家到队列
    await db.customMatchQueuePlayer.create({
      data: {
        queueId,
        playerId,
        isReady: true,
      },
    });

    // 更新队列状态
    const updatedPlayers = await db.customMatchQueuePlayer.findMany({
      where: { queueId },
    });

    let newStatus = queue.status;
    if (updatedPlayers.length >= queue.maxPlayers) {
      newStatus = 'full';
    } else if (updatedPlayers.length >= queue.minPlayers) {
      newStatus = 'matching';
    }

    await db.customMatchQueue.update({
      where: { queueId },
      data: { status: newStatus },
    });

    // 计算玩家在队列中的位置
    const position = updatedPlayers.findIndex(p => p.playerId === playerId) + 1;

    return {
      success: true,
      queueId,
      queueName: queue.queueName,
      position,
      totalInQueue: updatedPlayers.length,
    };
  } catch (error) {
    console.error('加入指定队列失败:', error);
    return { success: false, error: '系统错误' };
  }
}

/**
 * 获取指定队列信息
 */
export async function getSpecificQueueInfo(
  queueId: string
): Promise<{
  success: boolean;
  queue?: {
    queueId: string;
    queueName: string;
    creatorId: string;
    creatorName: string;
    minPlayers: number;
    maxPlayers: number;
    status: string;
    players: Array<{
      playerId: string;
      displayName: string;
      isReady: boolean;
      joinedAt: Date;
    }>;
  };
  error?: string;
}> {
  try {
    const queue = await db.customMatchQueue.findUnique({
      where: { queueId },
      include: {
        players: {
          include: {
            player: true,
          },
          orderBy: { joinedAt: 'asc' },
        },
        creator: true,
      },
    });

    if (!queue) {
      return { success: false, error: '队列不存在' };
    }

    return {
      success: true,
      queue: {
        queueId: queue.queueId,
        queueName: queue.queueName,
        creatorId: queue.creatorId,
        creatorName: queue.creator.displayName,
        minPlayers: queue.minPlayers,
        maxPlayers: queue.maxPlayers,
        status: queue.status,
        players: queue.players.map(p => ({
          playerId: p.playerId,
          displayName: p.player.displayName,
          isReady: p.isReady,
          joinedAt: p.joinedAt,
        })),
      },
    };
  } catch (error) {
    console.error('获取队列信息失败:', error);
    return { success: false, error: '系统错误' };
  }
}

/**
 * 离开指定的匹配队列
 */
export async function leaveSpecificQueue(
  playerId: string,
  queueId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 删除玩家记录
    const result = await db.customMatchQueuePlayer.deleteMany({
      where: {
        queueId,
        playerId,
      },
    });

    if (result.count === 0) {
      return { success: false, error: '不在该队列中' };
    }

    // 更新队列状态
    const remainingPlayers = await db.customMatchQueuePlayer.findMany({
      where: { queueId },
    });

    const queue = await db.customMatchQueue.findUnique({
      where: { queueId },
    });

    if (queue && remainingPlayers.length === 0) {
      // 如果队列为空，删除队列
      await db.customMatchQueue.delete({
        where: { queueId },
      });
    } else if (queue) {
      // 更新状态
      let newStatus = queue.status;
      if (remainingPlayers.length < queue.minPlayers) {
        newStatus = 'waiting';
      } else if (remainingPlayers.length >= queue.maxPlayers) {
        newStatus = 'full';
      } else {
        newStatus = 'matching';
      }

      await db.customMatchQueue.update({
        where: { queueId },
        data: { status: newStatus },
      });
    }

    return { success: true };
  } catch (error) {
    console.error('离开指定队列失败:', error);
    return { success: false, error: '系统错误' };
  }
}

/**
 * 获取所有已满的自定义队列
 * 用于定时器定期检查
 */
export async function getFullCustomQueues(): Promise<Array<{
  queueId: string;
  queueName: string;
  minPlayers: number;
  maxPlayers: number;
  players: Array<{
    playerId: string;
    displayName: string;
  }>;
}>> {
  try {
    const queues = await db.customMatchQueue.findMany({
      where: {
        status: 'full',
      },
      include: {
        players: {
          include: {
            player: true,
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    return queues.map(queue => ({
      queueId: queue.queueId,
      queueName: queue.queueName,
      minPlayers: queue.minPlayers,
      maxPlayers: queue.maxPlayers,
      players: queue.players.map(p => ({
        playerId: p.playerId,
        displayName: p.player.displayName,
      })),
    }));
  } catch (error) {
    console.error('获取已满自定义队列失败:', error);
    return [];
  }
}

/**
 * 获取指定自定义队列的详细信息
 */
export async function getCustomQueueInfo(queueId: string): Promise<{
  queueId: string;
  queueName: string;
  status: string;
  minPlayers: number;
  maxPlayers: number;
  players: Array<{
    playerId: string;
    displayName: string;
  }>;
} | null> {
  try {
    const queue = await db.customMatchQueue.findUnique({
      where: { queueId },
      include: {
        players: {
          include: {
            player: true,
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!queue) return null;

    return {
      queueId: queue.queueId,
      queueName: queue.queueName,
      status: queue.status,
      minPlayers: queue.minPlayers,
      maxPlayers: queue.maxPlayers,
      players: queue.players.map(p => ({
        playerId: p.playerId,
        displayName: p.player.displayName,
      })),
    };
  } catch (error) {
    console.error('获取自定义队列信息失败:', error);
    return null;
  }
}

/**
 * 获取玩家所在的所有自定义队列
 */
export async function getPlayerQueues(playerId: string): Promise<Array<{
  queueId: string;
  queueName: string;
  status: string;
  minPlayers: number;
  maxPlayers: number;
  players: Array<{
    playerId: string;
    displayName: string;
  }>;
}>> {
  try {
    const queuePlayers = await db.customMatchQueuePlayer.findMany({
      where: { playerId },
      include: {
        queue: {
          include: {
            players: {
              include: {
                player: true,
              },
              orderBy: { joinedAt: 'asc' },
            },
          },
        },
      },
    });

    return queuePlayers.map(qp => ({
      queueId: qp.queue.queueId,
      queueName: qp.queue.queueName,
      status: qp.queue.status,
      minPlayers: qp.queue.minPlayers,
      maxPlayers: qp.queue.maxPlayers,
      players: qp.queue.players.map(p => ({
        playerId: p.playerId,
        displayName: p.player.displayName,
      })),
    }));
  } catch (error) {
    console.error('获取玩家队列失败:', error);
    return [];
  }
}
