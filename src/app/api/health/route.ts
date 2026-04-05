/**
 * 健康检查端点
 * GET /api/health
 * 
 * 返回服务的健康状态，用于 Docker HEALTHCHECK 和负载均衡
 */
import { NextResponse } from 'next/server';

export async function GET() {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
  };

  return NextResponse.json(healthCheck, { status: 200 });
}
