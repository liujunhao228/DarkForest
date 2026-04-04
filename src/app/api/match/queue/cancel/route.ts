// ============================
// API: 取消匹配队列
// ============================
// POST /api/match/queue/cancel - 取消匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { cancelQueue } from '@/lib/matchmaking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId } = body;

    if (!playerId) {
      return NextResponse.json(
        { error: '缺少 playerId' },
        { status: 400 }
      );
    }

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
}
