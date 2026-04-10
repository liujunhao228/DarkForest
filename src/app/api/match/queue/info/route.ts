// ============================
// API: 获取指定匹配队列信息
// ============================
// GET /api/match/queue/info?queueId=xxx - 获取指定匹配队列信息
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { getSpecificQueueInfo } from '@/lib/matchmaking';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queueId = searchParams.get('queueId');

    if (!queueId) {
      return NextResponse.json(
        { error: '缺少必要参数：queueId' },
        { status: 400 }
      );
    }

    const result = await getSpecificQueueInfo(queueId);

    if (!result.success) {
      const statusCode = result.error === '队列不存在' ? 404 : 400;
      return NextResponse.json(
        { error: result.error },
        { status: statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      queue: result.queue,
    });
  } catch (error) {
    console.error('获取队列信息 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
