// ============================
// 认证中间件
// ============================
// 为 API 路由提供 JWT 认证验证
// ============================

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, type JwtPayload } from "@/lib/auth";

export interface AuthenticatedRequest extends NextRequest {
  auth?: JwtPayload;
}

/**
 * 验证请求的 JWT Token
 * @returns 验证成功返回 JwtPayload，失败返回 null
 */
export function getAuthFromRequest(request: NextRequest): JwtPayload | null {
  // 从 Authorization header 获取 token
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    return verifyToken(token);
  }

  // 从 cookie 获取 token（备选方案）
  const cookie = request.headers.get("cookie");
  if (cookie) {
    const tokenMatch = cookie.match(/(?:^|;\s*)token=([^;]*)/);
    if (tokenMatch) {
      return verifyToken(tokenMatch[1]);
    }
  }

  return null;
}

/**
 * 要求认证的中间件
 * 如果未提供有效 token，返回 401 错误
 * 如果提供有效 token，将 auth 信息附加到请求中
 */
export function requireAuth(
  handler: (
    request: NextRequest,
    auth: JwtPayload
  ) => Promise<NextResponse> | NextResponse
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const auth = getAuthFromRequest(request);

    if (!auth) {
      return NextResponse.json(
        { error: "未授权访问：请提供有效的 JWT Token" },
        { status: 401 }
      );
    }

    return handler(request, auth);
  };
}

/**
 * 可选认证中间件
 * 如果有有效 token，附加 auth 信息；否则继续执行（auth 为 null）
 */
export function optionalAuth(
  handler: (
    request: NextRequest,
    auth: JwtPayload | null
  ) => Promise<NextResponse> | NextResponse
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const auth = getAuthFromRequest(request);
    return handler(request, auth);
  };
}
