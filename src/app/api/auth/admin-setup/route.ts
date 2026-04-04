import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, generateToken, verifyAdminSecret } from "@/lib/auth";

/**
 * POST /api/auth/admin-setup
 * 创建管理员账号
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { displayName, password, secret } = body;

    // 验证必填字段
    if (!displayName || !password || !secret) {
      return NextResponse.json(
        { error: "缺少必填字段" },
        { status: 400 }
      );
    }

    // 验证管理员密钥
    if (!verifyAdminSecret(secret)) {
      return NextResponse.json(
        { error: "管理员密钥错误" },
        { status: 403 }
      );
    }

    // 检查是否已存在管理员
    const existingAdmin = await db.player.findFirst({
      where: { role: "admin" },
    });

    if (existingAdmin) {
      return NextResponse.json(
        { error: "管理员账号已存在" },
        { status: 400 }
      );
    }

    // 密码加密
    const hashedPassword = await hashPassword(password);

    // 创建管理员账号
    const admin = await db.player.create({
      data: {
        userId: `admin_${Date.now()}`,
        displayName,
        role: "admin",
        password: hashedPassword,
      },
    });

    // 生成 Token
    const token = generateToken({
      playerId: admin.id,
      userId: admin.userId,
      role: admin.role,
      displayName: admin.displayName,
    });

    return NextResponse.json({
      success: true,
      player: {
        id: admin.id,
        displayName: admin.displayName,
        role: admin.role,
      },
      token,
    });
  } catch (error) {
    console.error("[Admin Setup Error]", error);
    return NextResponse.json(
      { error: "服务器错误" },
      { status: 500 }
    );
  }
}
