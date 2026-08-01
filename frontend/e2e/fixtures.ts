import { test as base, expect } from '@playwright/test';

/**
 * E2E fixtures（D5 决策）
 *
 * - uniqueUser：每测试生成 `e2e_<timestamp>_<rand>` 唯一显示名 + 随机密码
 * - inviteCode：从 globalSetup 预生成的 process.env.E2E_INVITE_CODES 取一个未用值
 *               模块级 Set 标记已用，避免单次 run 内重复消费
 */
export interface UniqueUser {
  displayName: string;
  password: string;
}

// 模块级 Set 记录已用邀请码（仅单次 run 内有效）
const usedCodes = new Set<string>();

function consumeInviteCode(): string {
  const codes = (process.env.E2E_INVITE_CODES || '').split(',').filter(Boolean);
  for (const code of codes) {
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }
  throw new Error('E2E: 无可用邀请码（process.env.E2E_INVITE_CODES 为空或已耗尽）');
}

export const test = base.extend<{ uniqueUser: UniqueUser; inviteCode: string }>({
  uniqueUser: async ({}, use) => {
    const user: UniqueUser = {
      displayName: `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      password: 'Pass' + Math.random().toString(36).slice(2, 10),
    };
    await use(user);
  },
  inviteCode: async ({}, use) => {
    await use(consumeInviteCode());
  },
});

export { expect };
