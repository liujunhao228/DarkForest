import { get, post, put, del } from './http';
import type { StarNode, StarEdge } from '@/lib/game/types';

/**
 * 地图布局快照（与后端 MapLayoutSnapshot / DB layout_json schema 一致）。
 */
export interface MapLayoutSnapshot {
  nodes: StarNode[];
  edges: StarEdge[];
}

/**
 * 地图数据（与后端 mapResponse 一致）。
 */
export interface MapData {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  isOfficial: boolean;
  createdBy?: string | null;
  version: number;
  layoutJson: MapLayoutSnapshot;
  createdAt: number;
  updatedAt: number;
}

/**
 * 创建/更新地图的请求体。
 */
export interface MapMutationInput {
  name: string;
  description?: string;
  slug?: string;
  layoutJson: MapLayoutSnapshot;
}

// ============================
// API 函数 - 与 Go 后端路由一致
// ============================

/**
 * 列出所有官方地图（公开，无需鉴权）。
 */
export async function listMaps(): Promise<MapData[]> {
  return get<MapData[]>('/api/maps');
}

/**
 * 按 ID 获取单张地图（公开）。
 */
export async function getMap(id: string): Promise<MapData> {
  return get<MapData>(`/api/maps/${id}`);
}

/**
 * 创建地图（admin 创建官方地图，普通用户创建个人地图，受 10 张/用户配额约束）。
 * - admin：is_official=true，可设 slug，无配额，仍走敏感词校验
 * - 普通用户：is_official=false，slug 强制 NULL（即使传值也会被忽略），受 10 张/用户配额约束
 * - name/description 命中敏感词返回 400；超额返回 429
 */
export async function createMap(data: MapMutationInput): Promise<MapData> {
  return post<MapData>('/api/maps', data);
}

/**
 * 更新地图（仅创建者或 admin）。
 * - 所有权校验：仅创建者或 admin 可修改，否则返回 403
 * - name/description 走敏感词校验，命中返回 400
 */
export async function updateMap(id: string, data: MapMutationInput): Promise<MapData> {
  return put<MapData>(`/api/maps/${id}`, data);
}

/**
 * 删除地图（仅创建者或 admin；waiting 房间引用时返回 409）。
 * - 所有权校验：仅创建者或 admin 可删除，否则返回 403
 * - waiting 阻止：被 status='waiting' 的 custom_match_queues 引用时返回 409
 * - playing/finished 房间引用的地图可删，对局靠 MapSnapshot 不受影响
 */
export async function deleteMap(id: string): Promise<void> {
  await del<{ success: boolean }>(`/api/maps/${id}`);
}
