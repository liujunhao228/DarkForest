// ============================
// API: 玩家信息
// ============================
// GET /api/player/:id - 获取玩家信息
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { getPlayerInfo } from '@/lib/matchmaking';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const player = await getPlayerInfo(id);

    if (!player) {
      return NextResponse.json(
        { error: '玩家不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      player,
    });
  } catch (error) {
    console.error('获取玩家信息 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
