// ============================
// API: 获取当前玩家所在的匹配队列
// ============================
// GET /api/match/my-queue?playerId=xxx - 查询玩家当前所在队列
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');

    if (!playerId) {
      return NextResponse.json(
        { error: '缺少必要参数：playerId' },
        { status: 400 }
      );
    }

    // 查询玩家是否在自定义队列中
    const queuePlayer = await db.customMatchQueuePlayer.findUnique({
      where: {
        queueId_playerId: {
          playerId,
          queueId: '', // 需要先找到 queueId
        },
      },
    });

    // 由于复合主键，需要先找到玩家所在的队列
    const playerInQueues = await db.customMatchQueuePlayer.findMany({
      where: { playerId },
      include: {
        queue: {
          include: {
            players: {
              include: {
                player: true,
              },
              orderBy: { joinedAt: 'asc' },
            },
            creator: true,
          },
        },
      },
    });

    if (playerInQueues.length === 0) {
      return NextResponse.json({
        success: false,
        inQueue: false,
      });
    }

    // 取第一个队列（玩家通常只在一个队列中）
    const queuePlayerRecord = playerInQueues[0];
    const queue = queuePlayerRecord.queue;

    return NextResponse.json({
      success: true,
      inQueue: true,
      queue: {
        queueId: queue.queueId,
        queueName: queue.queueName,
        creatorId: queue.creatorId,
        creatorName: queue.creator.displayName,
        minPlayers: queue.minPlayers,
        maxPlayers: queue.maxPlayers,
        status: queue.status,
        players: queue.players.map((p) => ({
          playerId: p.playerId,
          displayName: p.player.displayName,
          isReady: p.isReady,
          joinedAt: p.joinedAt,
        })),
      },
    });
  } catch (error) {
    console.error('查询玩家队列 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
