// ============================
// API: 离开指定的匹配队列
// ============================
// POST /api/match/queue/leave - 离开指定的匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { leaveSpecificQueue } from '@/lib/matchmaking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId, queueId } = body;

    if (!playerId || !queueId) {
      return NextResponse.json(
        { error: '缺少必要参数：playerId 和 queueId' },
        { status: 400 }
      );
    }

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
}
