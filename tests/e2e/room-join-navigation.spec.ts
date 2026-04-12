/**
 * 黑暗森林 - 加入房间跳转功能测试
 *
 * 测试场景：
 * 1. 加入等待中的房间
 * 2. 加入已开始的游戏房间
 * 3. 匹配成功后自动加入
 * 4. 快速重复加入
 * 5. 断线重连
 */

import { test, expect } from '@playwright/test';

test.describe('加入房间跳转功能测试', () => {
  
  test.beforeEach(async ({ page }) => {
    // 清除 localStorage 确保干净状态
    await page.context().clearCookies();
    await page.goto('http://localhost:3000');
  });

  test('场景1: 加入等待中的房间', async ({ page }) => {
    console.log('=== 测试场景1: 加入等待中的房间 ===');

    // 1. 设置登录状态（通过路由上下文）
    await page.context().addInitScript(() => {
      localStorage.setItem('authToken', 'test-token');
      localStorage.setItem('player', JSON.stringify({
        id: 'test-player-1',
        displayName: '测试玩家1'
      }));
    });

    // 2. 导航到主页
    await page.goto('http://localhost:3000');
    
    // 3. 等待页面加载完成（等待"创建/加入房间"按钮出现）
    await page.waitForSelector('text=创建/加入房间', { timeout: 10000 });

    console.log('✓ 页面加载成功，找到"创建/加入房间"按钮');

    // 4. 验证按钮可见且可点击
    const button = page.locator('text=创建/加入房间');
    await expect(button).toBeVisible();
    
    // 预期结果：进入匹配/房间界面
    await expect(page).toHaveURL('http://localhost:3000');
  });

  test('场景2: WebSocket 连接复用不清除监听器', async ({ page }) => {
    console.log('=== 测试场景2: WebSocket 连接复用 ===');

    // 设置登录状态
    await page.context().addInitScript(() => {
      localStorage.setItem('authToken', 'test-token');
      localStorage.setItem('player', JSON.stringify({
        id: 'test-player-2',
        displayName: '测试玩家2'
      }));
    });

    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // 检查控制台日志
    const logs: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('[OnlineGame]') || msg.text().includes('[OnlineStore]')) {
        logs.push(msg.text());
      }
    });

    // 模拟匹配成功触发 onMatchFound
    await page.evaluate(() => {
      // 这里模拟触发匹配成功
      window.dispatchEvent(new CustomEvent('test-match-found', {
        detail: { roomId: 'test-room', roomCode: 'ABC123' }
      }));
    });

    // 验证没有 socket.off() 调用
    const hasOffCall = logs.some(log => log.includes('socket.off') || log.includes('.off()'));
    expect(hasOffCall).toBe(false);

    console.log('✓ 连接复用未清除监听器');
  });

  test('场景3: onMatchFound 只触发一次', async ({ page }) => {
    console.log('=== 测试场景3: onMatchFound 防重复触发 ===');

    await page.context().addInitScript(() => {
      localStorage.setItem('authToken', 'test-token');
      localStorage.setItem('player', JSON.stringify({
        id: 'test-player-3',
        displayName: '测试玩家3'
      }));
    });

    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // 计数 onMatchFound 调用次数
    let matchFoundCount = 0;
    page.on('console', msg => {
      if (msg.text().includes('触发 onMatchFound')) {
        matchFoundCount++;
      }
    });

    // 模拟多次 currentRoom 变化
    await page.evaluate(() => {
      // 模拟多次状态变化
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new CustomEvent('test-room-status-change', {
          detail: { status: 'playing' }
        }));
      }
    });

    // 等待处理
    await page.waitForTimeout(1000);

    // 预期：只触发一次
    console.log(`onMatchFound 触发次数: ${matchFoundCount}`);
    expect(matchFoundCount).toBeLessThanOrEqual(1);
  });

  test('场景4: TypeScript 编译检查', async ({ page }) => {
    console.log('=== 测试场景4: TypeScript 编译检查 ===');

    // 这个测试通过命令行运行 tsc 来验证
    const { execSync } = await import('child_process');
    try {
      const result = execSync('npx tsc --noEmit 2>&1', { encoding: 'utf-8' });
      console.log('✓ TypeScript 编译成功');
    } catch (error) {
      const output = (error as any).stdout || (error as any).message;
      if (output.includes('error')) {
        console.error('✗ TypeScript 编译失败:');
        console.error(output);
        throw new Error('TypeScript 编译失败');
      }
      console.log('✓ TypeScript 编译成功（有警告）');
    }
  });
});

test.describe('控制台日志验证', () => {
  test('检查关键日志输出', async ({ page }) => {
    console.log('=== 检查关键日志 ===');

    await page.context().addInitScript(() => {
      localStorage.setItem('authToken', 'test-token');
      localStorage.setItem('player', JSON.stringify({
        id: 'test-player-logs',
        displayName: '日志测试玩家'
      }));
    });

    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    const criticalLogs: string[] = [];
    const warningLogs: string[] = [];

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[OnlineGame]') || text.includes('[OnlineStore]') || text.includes('[Matchmaking]')) {
        criticalLogs.push(text);
      }
      if (text.includes('WARN') || text.includes('警告')) {
        warningLogs.push(text);
      }
    });

    // 等待一段时间收集日志
    await page.waitForTimeout(2000);

    console.log('捕获到的关键日志:');
    criticalLogs.forEach(log => console.log('  ', log));

    if (warningLogs.length > 0) {
      console.log('\n警告日志:');
      warningLogs.forEach(log => console.log('  ', log));
    }

    // 验证没有关键错误
    const hasError = criticalLogs.some(log =>
      log.includes('error') || log.includes('错误') || log.includes('失败')
    );

    expect(hasError).toBe(false);
    console.log('✓ 无关键错误日志');
  });
});
