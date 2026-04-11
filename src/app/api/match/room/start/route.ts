// ============================
// API: 开始游戏
// ============================
// POST /api/match/room/start - 房主开始游戏
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { getMatchRoom, updateMatchStatus } from '@/lib/matchmaking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomCode, playerId } = body;

    if (!roomCode || !playerId) {
      return NextResponse.json(
        { error: '缺少 roomCode 或 playerId' },
        { status: 400 }
      );
    }

    // 获取房间信息
    const result = await getMatchRoom(roomCode);

    if (!result) {
      return NextResponse.json(
        { error: '房间不存在' },
        { status: 404 }
      );
    }

    // 检查房主权限
    const isHost = result.match.hostId === playerId;
    if (!isHost) {
      return NextResponse.json(
        { error: '只有房主可以开始游戏' },
        { status: 403 }
      );
    }

    // 检查房间状态
    if (result.match.status !== 'waiting') {
      return NextResponse.json(
        { error: `房间状态为 ${result.match.status}，无法开始游戏` },
        { status: 400 }
      );
    }

    // 检查玩家数量 (至少2人)
    if (result.match.players.length < 2) {
      return NextResponse.json(
        { error: '至少需要2名玩家才能开始游戏' },
        { status: 400 }
      );
    }

    // 更新房间状态
    const success = await updateMatchStatus(result.match.id, 'playing');

    if (!success) {
      return NextResponse.json(
        { error: '更新房间状态失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '游戏已开始',
      match: {
        ...result.match,
        status: 'playing',
      },
    });
  } catch (error) {
    console.error('开始游戏 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
