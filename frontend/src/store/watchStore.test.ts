import { describe, it, expect, beforeEach } from 'vitest';
import { useWatchStore } from '@/store/watchStore';
import type { ViewState } from '@/lib/game/viewState';

function makeView(handCount: number): ViewState {
  return {
    kind: 'view',
    _viewMeta: { role: 'PLAYER', viewerId: 'p1', timestamp: 1 },
    players: [{ id: 'p1', handCount, hand: [], eliminated: false }],
  } as unknown as ViewState;
}

describe('watchStore', () => {
  beforeEach(() => {
    useWatchStore.getState().reset();
  });

  it('setViewState 更新被观察玩家的私有视图', () => {
    const view = makeView(3);
    useWatchStore.getState().setViewState(view);
    expect(useWatchStore.getState().viewState?.players[0].handCount).toBe(3);
  });

  it('setConnected / setError 更新连接状态', () => {
    useWatchStore.getState().setConnected(true);
    expect(useWatchStore.getState().connected).toBe(true);

    useWatchStore.getState().setError('连接出错');
    expect(useWatchStore.getState().error).toBe('连接出错');
  });

  it('reset 清空状态', () => {
    useWatchStore.getState().setViewState(makeView(1));
    useWatchStore.getState().setConnected(true);
    useWatchStore.getState().reset();
    expect(useWatchStore.getState().viewState).toBeNull();
    expect(useWatchStore.getState().connected).toBe(false);
  });
});