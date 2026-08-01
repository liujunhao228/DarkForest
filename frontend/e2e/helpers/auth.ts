import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Auth UI helpers —— 封装选择器与等待逻辑，降低 spec 重复
 *
 * 选择器依据 frontend/src/pages/Auth.tsx：
 *   - tab 按钮：'登录' / '注册'（含 icon，用 exact 匹配避免与提交按钮冲突）
 *   - 用户名输入框：placeholder '你的名称'（login/register tab 共用，当前 tab 仅渲染一个）
 *   - 登录密码框：placeholder '你的密码'
 *   - 注册密码框：placeholder '至少 6 位'
 *   - 邀请码框：placeholder '6 位邀请码'
 *   - 提交按钮：'进入黑暗森林'（loading 时变 '登录中...' / '注册中...'）
 */

/** 通过 UI 注册：切到 register tab → 填表 → 提交 → 等待跳转首页 */
export async function registerViaUI(
  page: Page,
  name: string,
  password: string,
  inviteCode: string,
): Promise<void> {
  await page.goto('/auth');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByPlaceholder('你的名称').fill(name);
  await page.getByPlaceholder('至少 6 位').fill(password);
  await page.getByPlaceholder('6 位邀请码').fill(inviteCode);
  await page.getByRole('button', { name: '进入黑暗森林' }).click();
  await page.waitForURL('**/');
}

/** 通过 UI 登录：确保 login tab → 填表 → 提交 → 等待跳转首页 */
export async function loginViaUI(
  page: Page,
  name: string,
  password: string,
): Promise<void> {
  await page.goto('/auth');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByPlaceholder('你的名称').fill(name);
  await page.getByPlaceholder('你的密码').fill(password);
  await page.getByRole('button', { name: '进入黑暗森林' }).click();
  await page.waitForURL('**/');
}

/**
 * 通过 UI 登出（D11 决策）
 *
 * 项目当前无登出 UI 按钮（Home.tsx 仅在 token 过期时自动 logout，
 * authStore.logout 未绑定到任何 visible 按钮）。
 * 回退方案：清 localStorage 的 auth-storage + reload，
 * 触发 Home.tsx 的 useEffect 检测 !isAuthenticated → navigate('/auth')。
 * helper 顶部注释说明回退原因；若后续新增登出 UI 按钮应改回 UI 触发。
 */
export async function logoutViaUI(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.removeItem('auth-storage'));
  await page.reload();
  await page.waitForURL('**/auth', { timeout: 10_000 });
}

/** 断言已登录：URL 非 /auth 且 localStorage 有 auth-storage */
export async function expectLoggedIn(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/\/auth/);
  const stored = await page.evaluate(() => localStorage.getItem('auth-storage'));
  expect(stored).not.toBeNull();
}

/** 断言在 /auth 页面 */
export async function expectOnAuthPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/auth/);
}
