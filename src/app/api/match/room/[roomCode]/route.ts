// ============================
// API: 获取房间信息
// ============================
// GET /api/match/room/:roomCode - 获取房间信息
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { getMatchRoom } from '@/lib/matchmaking';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  try {
    const { roomCode } = await params;
    
    const result = await getMatchRoom(roomCode);

    if (!result) {
      return NextResponse.json(
        { error: '房间不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      match: result.match,
    });
  } catch (error) {
    console.error('获取房间信息 API 错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
