// E2E 测试运行时暴露的接口类型声明
// 仅在 VITE_E2E=true 构建时由 main.tsx 注入 window.__e2e
import type { wsClient } from '@/ws/client';
import type { useOnlineGameStore } from '@/store/onlineGameStore';

declare global {
  interface Window {
    __e2e?: {
      wsClient: typeof wsClient;
      gameStore: typeof useOnlineGameStore;
    };
  }
}
