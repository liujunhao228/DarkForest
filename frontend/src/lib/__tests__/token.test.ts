import { describe, it, expect } from 'vitest';
import { isTokenExpired } from '../token';

// 将字符串按 UTF-8 编码后转成 base64url 无填充（模拟后端 jwt.SignedString 输出）
// btoa 只接受 Latin-1 字符串，含中文/emoji 时必须先转 UTF-8 字节再编码
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// 构造一个 base64url 无填充的 JWT（模拟后端 jwt.SignedString 输出）
function makeJwt(payload: object): string {
  // 模拟 JWT 三段式：header.payload.signature
  // 这里只测 isTokenExpired 对 payload 的解析，header/signature 用占位
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('isTokenExpired', () => {
  it('未过期 token 返回 false（ASCII 用户名）', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, displayName: 'alice' });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('未过期 token 返回 false（含 "发" 的用户名，触发 base64url 的 - 字符）', () => {
    // "发" 的 UTF-8 编码会让 payload 含 "-"，原 atob 实现会失败
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, displayName: '发' });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('未过期 token 返回 false（含 emoji 的用户名）', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, displayName: '玩家🎮' });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('已过期 token 返回 true', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('缺少 exp 字段返回 true（防御性）', () => {
    const token = makeJwt({ displayName: 'alice' });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('exp 非数字返回 true', () => {
    const token = makeJwt({ exp: 'not-a-number' });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('畸形 token（非三段）返回 true', () => {
    expect(isTokenExpired('not-a-jwt')).toBe(true);
  });

  it('空字符串返回 true', () => {
    expect(isTokenExpired('')).toBe(true);
  });
});
