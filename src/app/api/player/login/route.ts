// ============================
// API: 玩家登录/注册
// ============================
// POST /api/player/login - 玩家登录/创建
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { getOrCreatePlayer } from '@/lib/matchmaking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, displayName } = body;

    if (!userId || !displayName) {
      return NextResponse.json(
        { error: '缺少 userId 或 displayName' },
        { status: 400 }
      );
    }

    const player = await getOrCreatePlayer(userId, displayName);

    if (!player) {
      return NextResponse.json(
        { error: '创建玩家失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      player: {
        id: player.id,
        displayName: player.displayName,
      },
    });
  } catch (error) {
    console.error('玩家登录 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
