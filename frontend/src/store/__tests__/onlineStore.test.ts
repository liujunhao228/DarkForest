import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOnlineStore } from '../onlineStore';
import { wsClient } from '../../ws/client';
import type { ActiveGameInfo } from '../../ws/protocol';

// Mock wsClient 避免真实连接（onlineStore 模块加载时不会立即触发连接，但 listener 注册会引用 wsClient）
vi.mock('../../ws/client', () => ({
  wsClient: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

// Mock authStore 与 token 依赖，避免模块加载时持久化读取或 token 校验副作用
vi.mock('../authStore', () => ({
  useAuthStore: { getState: () => ({ player: null }) },
  getToken: () => null,
}));
vi.mock('../../lib/token', () => ({ isTokenExpired: () => false }));

const fullActiveGame: ActiveGameInfo = {
  roomId: 'room-x',
  roomCode: 'room-x',
  gameMode: 'classic',
  playerCount: 3,
  activePlayers: 2,
  totalTurn: 1,
  startedAt: 1,
};

describe('onlineStore activeGame 重连横幅', () => {
  beforeEach(() => {
    // 重置 store 状态，避免测试间互相污染
    useOnlineStore.setState({ activeGame: null, isLoggedIn: true });
    vi.mocked(wsClient.send).mockClear();
  });

  it('setState 写入 activeGame 后可被 getState 读取', () => {
    useOnlineStore.setState({ activeGame: fullActiveGame });
    expect(useOnlineStore.getState().activeGame).toEqual(fullActiveGame);
  });

  it('clearActiveGame 清除 activeGame 状态', () => {
    useOnlineStore.setState({ activeGame: fullActiveGame });
    useOnlineStore.getState().clearActiveGame();
    expect(useOnlineStore.getState().activeGame).toBeNull();
  });

  it('rejoinRoom 发送 room:rejoin 事件并清除 activeGame', () => {
    useOnlineStore.setState({ activeGame: fullActiveGame });
    useOnlineStore.getState().rejoinRoom('room-x');
    expect(wsClient.send).toHaveBeenCalledWith('room:rejoin', { roomId: 'room-x' });
    expect(useOnlineStore.getState().activeGame).toBeNull();
  });

  it('disconnect 重置 activeGame 状态', () => {
    useOnlineStore.setState({ activeGame: fullActiveGame });
    useOnlineStore.getState().disconnect();
    expect(useOnlineStore.getState().activeGame).toBeNull();
  });
});
