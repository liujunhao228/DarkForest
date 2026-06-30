import { get, del } from './http';
import type { GameState } from '@/lib/game/types';

/**
 * 动作记录
 */
export interface ActionRecord {
  playerId: string;
  action: string;
  data: Record<string, unknown>;
  turn: number;
  timestamp: number;
}

// ============================
// 类型定义 - 与Go后端响应一致
// ============================

/**
 * 回放数据
 */
export interface Replay {
  id: string;
  matchId: string;
  playerIds: string[];
  playerNames: string[];
  actions: ActionRecord[];
  states: GameState[];
  winner?: string;
  totalTurns?: number;
  createdAt: number;
}

/**
 * 回放列表项（列表接口不返回 states，减少数据传输）
 */
export interface ReplayListItem {
  id: string;
  matchId: string;
  playerIds: string[];
  playerNames: string[];
  actionCount: number;
  winner?: string;
  totalTurns?: number;
  createdAt: number;
}

/**
 * 回放列表响应
 */
export interface ListReplaysResponse {
  replays: ReplayListItem[];
}

// ============================
// API 函数 - 与Go后端路由一致
// ============================

/**
 * 获取回放列表
 * @param limit 每页数量，默认20
 * @param offset 偏移量，默认0
 */
export async function listReplays(limit: number = 20, offset: number = 0): Promise<ListReplaysResponse> {
  return get<ListReplaysResponse>('/api/replay/list', { 
    limit: String(limit), 
    offset: String(offset) 
  });
}

/**
 * 根据ID获取回放
 */
export async function getReplay(id: string): Promise<Replay> {
  return get<Replay>(`/api/replay/${id}`);
}

/**
 * 根据比赛ID获取回放
 */
export async function getReplayByMatchId(matchId: string): Promise<Replay> {
  return get<Replay>(`/api/replay/match/${matchId}`);
}

/**
 * 获取玩家的回放列表
 */
export async function listReplaysByPlayer(playerId: string, limit: number = 20, offset: number = 0): Promise<ListReplaysResponse> {
  return get<ListReplaysResponse>(`/api/replay/player/${playerId}`, { 
    limit: String(limit), 
    offset: String(offset) 
  });
}

/**
 * 删除回放
 */
export async function deleteReplay(id: string): Promise<void> {
  return del<void>(`/api/replay/${id}`);
}