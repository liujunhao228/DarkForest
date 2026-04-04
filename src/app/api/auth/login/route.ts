import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, generateToken } from "@/lib/auth";

/**
 * POST /api/auth/login
 * 玩家登录
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { displayName, password } = body;

    // 验证必填字段
    if (!displayName || !password) {
      return NextResponse.json(
        { error: "缺少必填字段" },
        { status: 400 }
      );
    }

    // 查找玩家
    const player = await db.player.findFirst({
      where: {
        displayName: displayName,
        password: {
          not: null, // 必须有密码
        },
      },
    });

    if (!player || !player.password) {
      return NextResponse.json(
        { error: "账号或密码错误" },
        { status: 401 }
      );
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(password, player.password);

    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "账号或密码错误" },
        { status: 401 }
      );
    }

    // 生成 Token
    const token = generateToken({
      playerId: player.id,
      userId: player.userId,
      role: player.role,
      displayName: player.displayName,
    });

    return NextResponse.json({
      success: true,
      player: {
        id: player.id,
        displayName: player.displayName,
        role: player.role,
      },
      token,
    });
  } catch (error) {
    console.error("[Login Error]", error);
    return NextResponse.json(
      { error: "服务器错误" },
      { status: 500 }
    );
  }
}
