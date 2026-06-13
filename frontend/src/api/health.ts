/**
 * 健康检查 API - 与Go后端响应一致
 */

import { get } from './http';

/**
 * 健康检查响应数据类型
 */
export interface HealthResponse {
  status: string;  // "ok"
  version: string;
  timestamp: string;
  uptime: number;
  memory: {
    rss: string;
    heapUsed: string;
  };
  env: string;
}

/**
 * 调用健康检查接口
 * @returns 健康检查响应数据
 */
export async function checkHealth(): Promise<HealthResponse> {
  return get<HealthResponse>('/api/health');
}