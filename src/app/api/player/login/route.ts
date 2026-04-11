// ============================
// API: 玩家登录/注册
// ============================
// POST /api/player/login - 玩家登录/创建
// ============================

import { NextRequest, NextResponse } from 'next/server';
import { getOrCreatePlayer } from '@/lib/matchmaking';
import { z } from 'zod';

// 输入验证 schema
const LoginSchema = z.object({
  userId: z.string().min(1).max(100),
  displayName: z
    .string()
    .min(1)
    .max(50)
    // 防止 XSS：过滤 HTML 标签
    .regex(/^[^<>{}]*$/, 'displayName 不能包含 HTML 标签'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 验证输入
    const validation = LoginSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: '输入验证失败', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { userId, displayName } = validation.data;

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
