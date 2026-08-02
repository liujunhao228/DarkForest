import { test, expect } from './fixtures';
import {
  registerViaUI,
  loginViaUI,
  logoutViaUI,
  expectLoggedIn,
  expectOnAuthPage,
} from './helpers/auth';

/**
 * Auth 流程 E2E 测试
 *
 * 覆盖设计文档 Intent 列出的 7 个场景：
 *   1. 注册成功 → 跳转首页
 *   2. 注册失败 - 无效邀请码
 *   3. 注册失败 - 已存在用户
 *   4. 登录成功 → 跳转首页（含 token 持久化：reload 后仍登录）
 *   5. 登录失败 - 错误密码
 *   6. 登录失败 - 不存在用户
 *   7. 登出后跳转 /auth 且已登录访问 /auth 自动跳转 /
 */

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  // 清 localStorage 保证每个测试隔离
  // about:blank 出于安全原因禁止访问 localStorage，需先导航到同源页面
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
});

test('1. 注册成功 → 跳转首页', async ({ page, uniqueUser, inviteCode }) => {
  await registerViaUI(page, uniqueUser.displayName, uniqueUser.password, inviteCode);
  await expectLoggedIn(page);
  await expect(page).toHaveURL(/\/$/);
});

test('2. 注册失败 - 无效邀请码', async ({ page, uniqueUser }) => {
  await page.goto('/auth');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByPlaceholder('你的名称').fill(uniqueUser.displayName);
  await page.getByPlaceholder('至少 6 位').fill(uniqueUser.password);
  await page.getByPlaceholder('6 位邀请码').fill('XXXXXX');
  await page.getByRole('button', { name: '进入黑暗森林' }).click();

  // 错误提示应出现（Auth.tsx 用 .text-red-400 容器 + AlertCircle icon）
  await expect(page.locator('.text-red-400')).toBeVisible();
  await expectOnAuthPage(page);
});

test('3. 注册失败 - 已存在用户', async ({ page, uniqueUser, inviteCode }) => {
  // 先注册一次（成功）
  await registerViaUI(page, uniqueUser.displayName, uniqueUser.password, inviteCode);
  await expectLoggedIn(page);

  // 登出后再用同名 + 有效邀请码注册
  await logoutViaUI(page);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByPlaceholder('你的名称').fill(uniqueUser.displayName);
  await page.getByPlaceholder('至少 6 位').fill(uniqueUser.password);
  // 此处需要一个新邀请码，但 inviteCode fixture 在同测试内只提供一次
  // 复用 globalSetup 的其他邀请码：直接从 process.env 取
  const codes = (process.env.E2E_INVITE_CODES || '').split(',').filter(Boolean);
  const secondCode = codes.find((c) => c !== inviteCode) || codes[0] || 'YYYYYY';
  await page.getByPlaceholder('6 位邀请码').fill(secondCode);
  await page.getByRole('button', { name: '进入黑暗森林' }).click();

  await expect(page.locator('.text-red-400')).toBeVisible();
  await expectOnAuthPage(page);
});

test('4. 登录成功 → 跳转首页（含 token 持久化）', async ({ page, uniqueUser, inviteCode }) => {
  // 先注册创建用户
  await registerViaUI(page, uniqueUser.displayName, uniqueUser.password, inviteCode);
  await logoutViaUI(page);

  // 登录
  await loginViaUI(page, uniqueUser.displayName, uniqueUser.password);
  await expectLoggedIn(page);

  // token 持久化：reload 后仍登录
  await page.reload();
  await expectLoggedIn(page);
});

test('5. 登录失败 - 错误密码', async ({ page, uniqueUser, inviteCode }) => {
  // 先注册创建用户
  await registerViaUI(page, uniqueUser.displayName, uniqueUser.password, inviteCode);
  await logoutViaUI(page);

  // 用错误密码登录
  await page.goto('/auth');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByPlaceholder('你的名称').fill(uniqueUser.displayName);
  await page.getByPlaceholder('你的密码').fill('WrongPassword123');
  await page.getByRole('button', { name: '进入黑暗森林' }).click();

  await expect(page.locator('.text-red-400')).toBeVisible();
  await expectOnAuthPage(page);
});

test('6. 登录失败 - 不存在用户', async ({ page, uniqueUser }) => {
  await page.goto('/auth');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByPlaceholder('你的名称').fill(uniqueUser.displayName);
  await page.getByPlaceholder('你的密码').fill(uniqueUser.password);
  await page.getByRole('button', { name: '进入黑暗森林' }).click();

  await expect(page.locator('.text-red-400')).toBeVisible();
  await expectOnAuthPage(page);
});

test('7. 登出后跳转 /auth 且刷新仍登出状态', async ({ page, uniqueUser, inviteCode }) => {
  // 注册并登录
  await registerViaUI(page, uniqueUser.displayName, uniqueUser.password, inviteCode);
  await expectLoggedIn(page);

  // 登出后应跳转 /auth
  await logoutViaUI(page);
  await expectOnAuthPage(page);

  // 刷新页面仍登出状态
  await page.reload();
  await expectOnAuthPage(page);

  // NOTE: 设计文档 Intent 原列"已登录用户访问 /auth 自动跳转 /"，
  // 但 main.tsx 路由配置与 Auth.tsx 均无此守卫逻辑。
  // 此发现作为 code-review 提出项，不在 E2E 中测试未实现的功能。
});
