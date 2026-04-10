// ============================
// API: 加入指定的匹配队列
// ============================
// POST /api/match/queue/join-specific - 通过队列ID加入指定的匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { joinSpecificQueue } from '@/lib/matchmaking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId, queueId, playerCount } = body;

    if (!playerId || !queueId) {
      return NextResponse.json(
        { error: '缺少必要参数：playerId 和 queueId' },
        { status: 400 }
      );
    }

    // playerCount 可选，如果提供则验证范围
    if (playerCount !== undefined && (playerCount < 3 || playerCount > 5)) {
      return NextResponse.json(
        { error: '玩家数必须在 3-5 之间' },
        { status: 400 }
      );
    }

    const result = await joinSpecificQueue({
      playerId,
      queueId,
      playerCount: playerCount ?? 4, // 默认4人
    });

    if (!result.success) {
      const statusCode = result.error === '队列不存在' ? 404 : 400;
      return NextResponse.json(
        { error: result.error },
        { status: statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      message: '已加入指定的匹配队列',
      queueId: result.queueId,
      queueName: result.queueName,
      position: result.position,
      totalInQueue: result.totalInQueue,
    });
  } catch (error) {
    console.error('加入指定匹配队列 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
