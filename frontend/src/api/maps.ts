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
 * 创建地图（admin only）。
 */
export async function createMap(data: MapMutationInput): Promise<MapData> {
  return post<MapData>('/api/maps', data);
}

/**
 * 更新地图（admin only）。
 */
export async function updateMap(id: string, data: MapMutationInput): Promise<MapData> {
  return put<MapData>(`/api/maps/${id}`, data);
}

/**
 * 删除地图（admin only）。
 */
export async function deleteMap(id: string): Promise<void> {
  await del<{ success: boolean }>(`/api/maps/${id}`);
}
