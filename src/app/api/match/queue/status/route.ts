// ============================
// API: 匹配状态
// ============================
// GET /api/match/queue/status?playerId=xxx - 查询匹配状态
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { getQueueStatus } from '@/lib/matchmaking';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const playerId = searchParams.get('playerId');

    if (!playerId) {
      return NextResponse.json(
        { error: '缺少 playerId' },
        { status: 400 }
      );
    }

    const status = await getQueueStatus(playerId);

    if (!status) {
      return NextResponse.json(
        { error: '查询失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('查询匹配状态 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
