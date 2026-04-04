import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, generateToken } from "@/lib/auth";

/**
 * POST /api/auth/register
 * 玩家注册账号
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { displayName, password, inviteCode } = body;

    // 验证必填字段
    if (!displayName || !password || !inviteCode) {
      return NextResponse.json(
        { error: "缺少必填字段" },
        { status: 400 }
      );
    }

    // 验证邀请码
    const invitation = await db.invitationCode.findUnique({
      where: { code: inviteCode.toUpperCase() },
    });

    if (!invitation) {
      return NextResponse.json(
        { error: "邀请码无效" },
        { status: 400 }
      );
    }

    if (invitation.isUsed) {
      return NextResponse.json(
        { error: "邀请码已被使用" },
        { status: 400 }
      );
    }

    // 密码加密
    const hashedPassword = await hashPassword(password);

    // 创建玩家账号
    const player = await db.player.create({
      data: {
        userId: `player_${Date.now()}`,
        displayName,
        role: "player",
        password: hashedPassword,
      },
    });

    // 更新邀请码状态
    await db.invitationCode.update({
      where: { id: invitation.id },
      data: {
        isUsed: true,
        usedBy: player.id,
        usedAt: new Date(),
      },
    });

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
    console.error("[Register Error]", error);
    return NextResponse.json(
      { error: "服务器错误" },
      { status: 500 }
    );
  }
}
