import { NextResponse } from "next/server";

/**
 * 健康检查端点 - 优化：返回详细状态
 * 用途：Docker HEALTHCHECK、负载均衡器、部署验证
 */
export async function GET() {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "unknown",
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    },
    env: process.env.NODE_ENV,
  };

  return NextResponse.json(health, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
