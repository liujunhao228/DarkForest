// ============================
// API: 加入匹配队列
// ============================
// POST /api/match/queue/join - 加入匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { joinQueue } from '@/lib/matchmaking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId, playerCount, timeout } = body;

    if (!playerId || !playerCount) {
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
}
