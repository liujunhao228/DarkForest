// ============================
// API: 离开指定的匹配队列
// ============================
// POST /api/match/queue/leave - 离开指定的匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { leaveSpecificQueue } from '@/lib/matchmaking';
import { requireAuth } from '@/lib/auth-middleware';

export async function POST(request: NextRequest) {
  return requireAuth(async (request, auth) => {
    try {
      const body = await request.json();
      const { queueId } = body;

      if (!queueId) {
        return NextResponse.json(
          { error: '缺少必要参数：queueId' },
          { status: 400 }
        );
      }

      // 使用 token 中的 playerId
      const playerId = auth.playerId;

      const result = await leaveSpecificQueue(playerId, queueId);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: '已离开指定的匹配队列',
      });
    } catch (error) {
      console.error('离开指定匹配队列 API 错误:', error);
      return NextResponse.json(
        { error: '服务器错误' },
        { status: 500 }
      );
    }
  })(request);
}
