// ============================
// API: 取消匹配队列
// ============================
// POST /api/match/queue/cancel - 取消匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { cancelQueue } from '@/lib/matchmaking';
import { requireAuth } from '@/lib/auth-middleware';

export async function POST(request: NextRequest) {
  return requireAuth(async (request, auth) => {
    try {
      // 使用 token 中的 playerId
      const playerId = auth.playerId;

      const result = await cancelQueue(playerId);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: '已取消匹配',
      });
    } catch (error) {
      console.error('取消匹配队列 API 错误:', error);
      return NextResponse.json(
        { error: '服务器错误' },
        { status: 500 }
      );
    }
  })(request);
}
