// trust 模式工具：本地信任模式（LOCAL_TRUST_MODE=1）下，前端不再走 JWT，
// 而是以本地玩家身份（qq:<id> + 昵称）通过 X-Trust-User 头 / WS 查询参数接入。
// 仅在 VITE_TRUST_MODE=1 的构建下生效；生产构建不设置该变量。

const IDENTITY_KEY = 'df-trust-identity';

export interface TrustIdentity {
  /** 本地玩家数字 id（后端按 qq:<id> get-or-create player） */
  qq: string;
  /** 显示昵称 */
  name: string;
}

export function isTrustMode(): boolean {
  return import.meta.env.VITE_TRUST_MODE === '1';
}

/**
 * trust 模式下的"已认证"判定：开启 trust 且已录入本地身份。
 * 用于替代 JWT 的 isAuthenticated 判据（trust 模式无 JWT 会话，
 * 后端已在 WS 握手时按 ?qq= 完成身份注入）。
 */
export function isTrustAuthenticated(): boolean {
  return isTrustMode() && getTrustIdentity() != null;
}

export function getTrustIdentity(): TrustIdentity | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TrustIdentity;
    if (typeof parsed.qq !== 'string' || typeof parsed.name !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setTrustIdentity(identity: TrustIdentity): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export function clearTrustIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY);
}