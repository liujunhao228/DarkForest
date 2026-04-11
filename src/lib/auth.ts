import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";

// 生产环境必须设置环境变量，否则抛出错误
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required. Please set it in your .env file."
  );
}

if (!ADMIN_SECRET_KEY) {
  throw new Error(
    "ADMIN_SECRET_KEY environment variable is required. Please set it in your .env file."
  );
}

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = "24h"; // Token 24 小时过期（降低风险）

export interface JwtPayload {
  playerId: string;
  userId: string;
  role: string;
  displayName: string;
}

/**
 * 生成 JWT Token
 */
export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * 验证 JWT Token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 密码加密
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * 验证密码
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

/**
 * 验证管理员密钥
 */
export function verifyAdminSecret(secret: string): boolean {
  return secret === ADMIN_SECRET_KEY;
}

/**
 * 生成 6 位邀请码（使用密码学安全的随机数）
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 排除易混淆字符
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}
