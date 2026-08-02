import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { loginOnlinePlayer } from './helpers/game';

/**
 * E2E fixtures（D5 决策）
 *
 * - uniqueUser：每测试生成 `e2e_<timestamp>_<rand>` 唯一显示名 + 随机密码
 * - inviteCode：从 globalSetup 预生成的 process.env.E2E_INVITE_CODES 取一个未用值
 *               模块级 Set 标记已用，避免单次 run 内重复消费
 * - gameTest.players：3 个独立 BrowserContext 的已登录玩家，用于游戏流程测试
 */
export interface UniqueUser {
  displayName: string;
  password: string;
}

/** 游戏测试中的单个玩家 */
export interface GamePlayer {
  page: Page;
  user: UniqueUser;
  token: string;
  playerId: string;
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

// ===== 游戏流程测试 fixture =====

const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8080';
const GAME_PLAYER_COUNT = 3;

/**
 * gameTest：为每个测试创建 3 个独立 BrowserContext 的已登录玩家。
 *
 * 每个玩家：
 *   1. 消费一个邀请码
 *   2. 通过 API 注册（fetch POST /api/auth/register）
 *   3. 创建独立 BrowserContext + page
 *   4. 注入 auth-storage localStorage（zustand persist 格式）
 *   5. 导航到 '/' 激活路由
 *   6. 等待 WS 连接并通过 WS 发送 player:login
 *
 * 测试结束后自动关闭所有 context。
 */
export const gameTest = base.extend<{ players: GamePlayer[] }>({
  players: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];

    try {
      // 阶段 1：串行注册 3 个用户（避免 user_id 毫秒级时间戳并发冲突）
      // 后端 Register 用 time.Now().UnixNano()/1e6（毫秒）生成 user_id，
      // 并发注册会产生相同 user_id 触发 UNIQUE 约束 → 500。
      // 串行注册每个 ~700ms，3 个共 ~2.1s，对总耗时影响小。
      const registrations: Array<{
        user: UniqueUser;
        token: string;
        playerId: string;
        player: { id: string; displayName: string; role: string };
      }> = [];

      for (let i = 0; i < GAME_PLAYER_COUNT; i++) {
        const inviteCode = consumeInviteCode();
        const user: UniqueUser = {
          displayName: `e2e_game_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
          password: 'Pass' + Math.random().toString(36).slice(2, 10),
        };

        const resp = await fetch(`${E2E_BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: user.displayName,
            password: user.password,
            inviteCode,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`注册失败 [${resp.status}]: ${text}`);
        }
        const data = (await resp.json()) as {
          token: string;
          player: { id: string; displayName: string; role: string };
        };

        registrations.push({
          user,
          token: data.token,
          playerId: data.player.id,
          player: data.player,
        });
      }

      // 阶段 2：并行创建 BrowserContext + 页面导航 + WS 登录
      // 每个用户需 ~15s（WS 连接 + login），并行后总耗时 ~15-20s。
      const setupPlayer = async (
        reg: typeof registrations[number],
      ): Promise<GamePlayer> => {
        const context = await browser.newContext();
        contexts.push(context);
        const page = await context.newPage();

        await context.addInitScript(
          (authData) => {
            localStorage.setItem('auth-storage', JSON.stringify({
              state: {
                token: authData.token,
                player: authData.player,
                isAuthenticated: true,
              },
              version: 0,
            }));
          },
          { token: reg.token, player: reg.player },
        );

        await page.goto(E2E_BASE_URL);
        await loginOnlinePlayer(page, reg.user.displayName);

        return {
          page,
          user: reg.user,
          token: reg.token,
          playerId: reg.playerId,
        };
      };

      const players = await Promise.all(registrations.map((reg) => setupPlayer(reg)));

      await use(players);
    } finally {
      // 清理：关闭所有 context（page 随 context 一起关闭）
      for (const ctx of contexts) {
        await ctx.close().catch(() => {});
      }
    }
  },
});

export { expect };
