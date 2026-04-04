import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyToken, generateInviteCode } from "@/lib/auth";

/**
 * POST /api/auth/invite
 * 生成邀请码 (仅管理员)
 */
export async function POST(req: NextRequest) {
  try {
    // 验证管理员权限
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "未授权" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    const payload = verifyToken(token);

    if (!payload || payload.role !== "admin") {
      return NextResponse.json(
        { error: "需要管理员权限" },
        { status: 403 }
      );
    }

    // 生成邀请码
    const code = generateInviteCode();

    const invitation = await db.invitationCode.create({
      data: {
        code,
        createdBy: payload.playerId,
      },
    });

    return NextResponse.json({
      success: true,
      invitation,
    });
  } catch (error) {
    console.error("[Generate Invite Error]", error);
    return NextResponse.json(
      { error: "服务器错误" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/invite
 * 获取邀请码列表 (仅管理员)
 */
export async function GET(req: NextRequest) {
  try {
    // 验证管理员权限
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "未授权" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    const payload = verifyToken(token);

    if (!payload || payload.role !== "admin") {
      return NextResponse.json(
        { error: "需要管理员权限" },
        { status: 403 }
      );
    }

    // 获取所有邀请码
    const invitations = await db.invitationCode.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            displayName: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      invitations,
    });
  } catch (error) {
    console.error("[Get Invites Error]", error);
    return NextResponse.json(
      { error: "服务器错误" },
      { status: 500 }
    );
  }
}
