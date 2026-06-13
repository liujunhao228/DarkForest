import { get, del } from './http';

// ============================
// 类型定义 - 与Go后端响应一致
// ============================

/**
 * 回放数据
 */
export interface Replay {
  id: string;
  matchId: string;
  players: Array<{
    playerId: string;
    displayName: string;
  }>;
  actions: unknown[];
  finalState: unknown;
  createdAt: string;
}

/**
 * 回放列表响应
 */
export interface ListReplaysResponse {
  replays: Replay[];
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