import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vitest 独立配置
 *
 * vitest 4.x 优先读取 vitest.config.ts，不自动合并 vite.config.ts，
 * 故需在此重复必要的 plugins 与 resolve.alias。
 *
 * 排除 e2e/ 目录（Playwright 测试由 playwright.config.ts 管理，不归 vitest）。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
