// ============================
// API: 创建自定义匹配队列
// ============================
// POST /api/match/queue/create - 创建自定义匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { createCustomQueue } from '@/lib/matchmaking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { creatorId, queueName, minPlayers, maxPlayers } = body;

    if (!creatorId || !queueName) {
      return NextResponse.json(
        { error: '缺少必要参数：creatorId 和 queueName' },
        { status: 400 }
      );
    }

    // 验证玩家数范围
    if (minPlayers !== undefined && (minPlayers < 3 || minPlayers > 5)) {
      return NextResponse.json(
        { error: '最小玩家数必须在 3-5 之间' },
        { status: 400 }
      );
    }

    if (maxPlayers !== undefined && (maxPlayers < 3 || maxPlayers > 5)) {
      return NextResponse.json(
        { error: '最大玩家数必须在 3-5 之间' },
        { status: 400 }
      );
    }

    const result = await createCustomQueue(creatorId, queueName, {
      minPlayers,
      maxPlayers,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '已创建自定义匹配队列',
      queueId: result.queueId,
    });
  } catch (error) {
    console.error('创建自定义匹配队列 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
