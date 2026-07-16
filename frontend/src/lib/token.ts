// 内部辅助：解码 base64url 无填充编码的 JWT payload 段，返回解析后的对象
// 处理两件事：
//   1. base64url → base64（JWT 规范 RFC 7519 使用 base64url：- 替代 +，_ 替代 /，无 = 填充）
//   2. atob 输出按 UTF-8 解码（atob 默认按 Latin-1 解码，中文会乱码）
function decodeJwtPayload<T>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const base64 = parts[1]
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  // 补齐 base64 填充（长度必须是 4 的倍数）
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

  try {
    const binary = atob(padded);
    // atob 返回 Latin-1 字符串，按字节还原后用 UTF-8 解码
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const json = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

interface JwtPayload {
  exp?: number;
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload<JwtPayload>(token);
  if (!payload || typeof payload.exp !== 'number') {
    return true;
  }
  return payload.exp * 1000 < Date.now();
}
