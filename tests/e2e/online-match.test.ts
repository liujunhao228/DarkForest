// ============================
// 在线匹配 E2E 测试
// ============================
// 使用 Playwright 进行端到端测试
// ============================

import { test, expect, type Page } from '@playwright/test';

// 测试配置
const TEST_PLAYER_NAME = `E2E_Player_${Date.now()}`;
const TEST_ROOM_CODE = 'E2ETEST';

/**
 * 等待并检查元素可见
 */
async function waitForVisible(page: Page, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

/**
 * 等待文本出现
 */
async function waitForText(page: Page, selector: string, text: string, timeout = 5000) {
  await page.waitForSelector(`${selector}:has-text("${text}")`, { timeout });
}

test.describe('在线匹配功能 E2E 测试', () => {
  test.beforeEach(async ({ page }) => {
    // 访问主页
    await page.goto('http://localhost:3000');
  });

  test.describe('主菜单', () => {
    test('应该显示主菜单', async ({ page }) => {
      // 等待标题出现
      await waitForVisible(page, 'h1:has-text("黑暗森林")');
      
      // 检查连接状态
      await expect(page.locator('text=未连接').first()).toBeVisible();
      
      // 检查输入框
      await expect(page.locator('input[placeholder*="文明名称"]').first()).toBeVisible();
      
      // 检查按钮
      await expect(page.locator('button:has-text("进入黑暗森林")').first()).toBeVisible();
      await expect(page.locator('button:has-text("与 AI 对战")').first()).toBeVisible();
    });

    test('应该允许输入文明名称', async ({ page }) => {
      const input = page.locator('input[placeholder*="文明名称"]').first();
      await input.fill(TEST_PLAYER_NAME);
      await expect(input).toHaveValue(TEST_PLAYER_NAME);
    });
  });

  test.describe('玩家登录', () => {
    test('应该成功登录玩家', async ({ page }) => {
      // 输入名称
      await page.locator('input[placeholder*="文明名称"]').first().fill(TEST_PLAYER_NAME);
      
      // 点击登录按钮
      await page.locator('button:has-text("进入黑暗森林")').first().click();
      
      // 等待连接状态变化
      await waitForVisible(page, 'text=已连接', 10000);
      
      // 检查玩家信息显示
      await expect(page.locator(`text=${TEST_PLAYER_NAME}`).first()).toBeVisible();
    });

    test('应该显示玩家统计', async ({ page }) => {
      // 登录
      await page.locator('input[placeholder*="文明名称"]').first().fill(TEST_PLAYER_NAME);
      await page.locator('button:has-text("进入黑暗森林")').first().click();
      
      await waitForVisible(page, 'text=已连接', 10000);
      
      // 检查统计信息
      await expect(page.locator('text=胜率').first()).toBeVisible();
      await expect(page.locator('text=对局').first()).toBeVisible();
      await expect(page.locator('text=评分').first()).toBeVisible();
    });
  });

  test.describe('匹配队列', () => {
    test('应该允许加入匹配队列', async ({ page }) => {
      // 登录
      await page.locator('input[placeholder*="文明名称"]').first().fill(TEST_PLAYER_NAME);
      await page.locator('button:has-text("进入黑暗森林")').first().click();
      
      await waitForVisible(page, 'text=已连接', 10000);
      
      // 选择模式
      await page.locator('[role="combobox"]').first().click();
      await page.locator('text=休闲模式').first().click();
      
      // 选择玩家数
      const triggers = page.locator('[role="combobox"]');
      await triggers.nth(1).click();
      await page.locator('text=4 名玩家').first().click();
      
      // 点击开始匹配
      await page.locator('button:has-text("开始匹配")').first().click();
      
      // 等待进入匹配界面
      await waitForVisible(page, 'text=匹配中', 5000);
    });

    test('应该允许取消匹配', async ({ page }) => {
      // 登录
      await page.locator('input[placeholder*="文明名称"]').first().fill(`${TEST_PLAYER_NAME}_cancel`);
      await page.locator('button:has-text("进入黑暗森林")').first().click();
      
      await waitForVisible(page, 'text=已连接', 10000);
      
      // 开始匹配
      await page.locator('button:has-text("开始匹配")').first().click();
      await waitForVisible(page, 'text=匹配中', 5000);
      
      // 取消匹配
      await page.locator('button:has-text("取消匹配")').first().click();
      
      // 应该返回主菜单
      await waitForVisible(page, 'text=在线对战', 5000);
    });
  });

  test.describe('离线模式', () => {
    test('应该进入离线游戏', async ({ page }) => {
      // 点击离线模式
      await page.locator('button:has-text("与 AI 对战")').first().click();
      
      // 等待游戏设置界面
      await waitForVisible(page, 'text=开始游戏', 5000);
      
      // 检查游戏设置
      await expect(page.locator('text=文明名称').first()).toBeVisible();
      await expect(page.locator('text=玩家人数').first()).toBeVisible();
    });
  });
});

test.describe('游戏流程 E2E 测试', () => {
  test('应该完成完整的匹配到游戏流程', async ({ page }) => {
    // 由于需要多个玩家才能完成匹配，这里只测试到进入匹配队列
    const testName = `E2E_Flow_${Date.now()}`;
    
    // 访问主页
    await page.goto('http://localhost:3000');
    
    // 登录
    await page.locator('input[placeholder*="文明名称"]').first().fill(testName);
    await page.locator('button:has-text("进入黑暗森林")').first().click();
    
    await waitForVisible(page, 'text=已连接', 10000);
    
    // 开始匹配
    await page.locator('button:has-text("开始匹配")').first().click();
    
    // 验证进入匹配界面
    await expect(page.locator('text=匹配中').first()).toBeVisible();
    await expect(page.locator('text=正在寻找其他文明').first()).toBeVisible();
    
    // 取消匹配
    await page.locator('button:has-text("取消匹配")').first().click();
    
    // 验证返回主菜单
    await expect(page.locator('text=在线对战').first()).toBeVisible();
  });
});

test.describe('响应式设计测试', () => {
  test('应该在移动设备上正常显示', async ({ page }) => {
    // 设置为移动设备视口
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('http://localhost:3000');
    
    // 检查主菜单可见
    await waitForVisible(page, 'h1:has-text("黑暗森林")');
    
    // 检查输入框可见
    await expect(page.locator('input[placeholder*="文明名称"]').first()).toBeVisible();
  });

  test('应该在桌面设备上正常显示', async ({ page }) => {
    // 设置为桌面设备视口
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    await page.goto('http://localhost:3000');
    
    // 检查主菜单可见
    await waitForVisible(page, 'h1:has-text("黑暗森林")');
    
    // 检查所有元素布局
    await expect(page.locator('text=在线对战').first()).toBeVisible();
    await expect(page.locator('text=单人模式').first()).toBeVisible();
  });
});

test.describe('错误处理 E2E 测试', () => {
  test('应该处理 WebSocket 连接失败', async ({ page }) => {
    // 拦截 WebSocket 连接模拟失败
    await page.route('**/*', route => {
      if (route.request().url().includes('socket.io')) {
        route.abort('connectionfailed');
      } else {
        route.continue();
      }
    });
    
    await page.goto('http://localhost:3000');
    
    // 等待连接错误显示
    await waitForVisible(page, 'text=未连接', 5000);
  });
});
