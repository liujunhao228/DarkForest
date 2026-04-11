// ============================
// API: 加入匹配队列
// ============================
// POST /api/match/queue/join - 加入匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { joinQueue } from '@/lib/matchmaking';
import { requireAuth } from '@/lib/auth-middleware';

export async function POST(request: NextRequest) {
  return requireAuth(async (request, auth) => {
    try {
      const body = await request.json();
      const { playerCount, timeout } = body;

      if (!playerCount) {
        return NextResponse.json(
          { error: '缺少必要参数' },
          { status: 400 }
        );
      }

      if (playerCount < 3 || playerCount > 5) {
        return NextResponse.json(
          { error: '玩家数必须在 3-5 之间' },
          { status: 400 }
        );
      }

      // 验证 playerId 与 token 中的一致
      const playerId = auth.playerId;

      const result = await joinQueue({
        playerId,
        playerCount,
        timeout,
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: '已加入匹配队列',
      });
    } catch (error) {
      console.error('加入匹配队列 API 错误:', error);
      return NextResponse.json(
        { error: '服务器错误' },
        { status: 500 }
      );
    }
  })(request);
}
