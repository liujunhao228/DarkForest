// ============================
// API: 加入房间
// ============================
// POST /api/match/room/join - 加入房间
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { getMatchRoom } from '@/lib/matchmaking';

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

    const result = await getMatchRoom(roomCode);

    if (!result) {
      return NextResponse.json(
        { error: '房间不存在' },
        { status: 404 }
      );
    }

    // 检查房间是否已满
    const maxPlayers = result.match.playerCount;
    const currentPlayers = result.match.players.length;

    if (currentPlayers >= maxPlayers) {
      return NextResponse.json(
        { error: '房间已满' },
        { status: 400 }
      );
    }

    // 检查玩家是否已在房间中
    const alreadyInRoom = result.match.players.some(p => p.playerId === playerId);
    if (alreadyInRoom) {
      return NextResponse.json(
        { error: '已在房间中' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      match: result.match,
    });
  } catch (error) {
    console.error('加入房间 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
