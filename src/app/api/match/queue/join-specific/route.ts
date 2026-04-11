// ============================
// API: 加入指定的匹配队列
// ============================
// POST /api/match/queue/join-specific - 通过队列ID加入指定的匹配队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { joinSpecificQueue } from '@/lib/matchmaking';
import { requireAuth } from '@/lib/auth-middleware';

// 注意：不能在这里导入 gameServer，否则会在 Next.js 处理 API route 时
// 启动 WebSocket 服务器，导致端口冲突和重复初始化
// WebSocket 服务器会通过自己的轮询机制检测到队列变化

export async function POST(request: NextRequest) {
  return requireAuth(async (request, auth) => {
    try {
      const body = await request.json();
      const { queueId, playerCount } = body;

      if (!queueId) {
        return NextResponse.json(
          { error: '缺少必要参数：queueId' },
          { status: 400 }
        );
      }

      // 使用 token 中的 playerId
      const playerId = auth.playerId;

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

      // 队列加入成功后，WebSocket 服务器会通过轮询自动检测到队列变化
      // 不需要手动触发匹配检查

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
  })(request);
}
