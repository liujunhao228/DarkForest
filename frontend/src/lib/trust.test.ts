import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { isTrustMode, getTrustIdentity, setTrustIdentity, clearTrustIdentity } from '@/lib/trust';

describe('trust 模式工具', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('未设 VITE_TRUST_MODE 时 isTrustMode 为 false', () => {
    vi.stubEnv('VITE_TRUST_MODE', '');
    expect(isTrustMode()).toBe(false);
  });

  it('VITE_TRUST_MODE=1 时 isTrustMode 为 true', () => {
    vi.stubEnv('VITE_TRUST_MODE', '1');
    expect(isTrustMode()).toBe(true);
  });

  it('set/get 本地身份可回读', () => {
    setTrustIdentity({ qq: '10001', name: '本地玩家' });
    expect(getTrustIdentity()).toEqual({ qq: '10001', name: '本地玩家' });
  });

  it('无身份时 getTrustIdentity 返回 null', () => {
    expect(getTrustIdentity()).toBeNull();
  });

  it('clear 后身份清空', () => {
    setTrustIdentity({ qq: '10001', name: '本地玩家' });
    clearTrustIdentity();
    expect(getTrustIdentity()).toBeNull();
  });
});