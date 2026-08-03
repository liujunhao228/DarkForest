import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock onlineGameStore 提供 roomId
vi.mock('@/store/onlineGameStore', () => ({
  useOnlineGameStore: vi.fn((selector) =>
    selector({ roomId: 'test-room' }),
  ),
}));

// 在每个测试之前重置模块，避免 useStarMapMarkers 模块级缓存（markersCache）跨测试污染
async function loadFreshModule() {
  vi.resetModules();
  return (await import('../useStarMapMarkers')).useStarMapMarkers;
}

describe('useStarMapMarkers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('addPin 不传 note 时 PinMarker.note 为 undefined', async () => {
    const useStarMapMarkers = await loadFreshModule();
    const { result } = renderHook(() => useStarMapMarkers());

    act(() => {
      result.current.addPin(7, 'player-1', '#ef4444');
    });

    expect(result.current.pins).toHaveLength(1);
    expect(result.current.pins[0].note).toBeUndefined();
  });

  it('updateNote 给图钉写入 note 字段', async () => {
    const useStarMapMarkers = await loadFreshModule();
    const { result } = renderHook(() => useStarMapMarkers());

    act(() => {
      result.current.addPin(7, 'player-1', '#ef4444');
    });
    const pinId = result.current.pins[0].id;

    act(() => {
      result.current.updateNote(pinId, '玩家可能藏身于此');
    });

    expect(result.current.pins[0].note).toBe('玩家可能藏身于此');
  });

  it('updateNote 覆盖区域已有 note 字段', async () => {
    const useStarMapMarkers = await loadFreshModule();
    const { result } = renderHook(() => useStarMapMarkers());

    act(() => {
      result.current.addRegion([1, 2, 3], '#3b82f6', '初始注释');
    });
    const regionId = result.current.regions[0].id;

    act(() => {
      result.current.updateNote(regionId, '修改后的注释');
    });

    expect(result.current.regions[0].note).toBe('修改后的注释');
  });

  it('updateNote 对未知 id 静默 no-op', async () => {
    const useStarMapMarkers = await loadFreshModule();
    const { result } = renderHook(() => useStarMapMarkers());

    act(() => {
      result.current.addPin(7, 'player-1', '#ef4444');
      result.current.updateNote('non-existent-id', '不应生效');
    });

    expect(result.current.pins).toHaveLength(1);
    expect(result.current.pins[0].note).toBeUndefined();
    // 不应抛错
  });

  it('updateNote 用 String() 兜底非字符串输入', async () => {
    const useStarMapMarkers = await loadFreshModule();
    const { result } = renderHook(() => useStarMapMarkers());

    act(() => {
      result.current.addPin(7, 'player-1', '#ef4444');
    });
    const pinId = result.current.pins[0].id;

    // 模拟用户手改 localStorage 或异常输入
    act(() => {
      // @ts-expect-error 测试非字符串输入的兜底逻辑
      result.current.updateNote(pinId, 12345);
    });

    expect(result.current.pins[0].note).toBe('12345');
  });

  it('旧 localStorage 数据(无 note 字段)加载不报错', async () => {
    // 模拟旧版本写入的 localStorage 数据（PinMarker 无 note，RegionMarker.note 字段存在）
    const legacyData = {
      pins: [
        {
          kind: 'pin',
          id: 'legacy-pin-1',
          systemId: 5,
          playerId: 'legacy-player',
          color: '#10b981',
          createdAt: 1700000000000,
          // 故意缺失 note 字段
        },
      ],
      regions: [
        {
          kind: 'region',
          id: 'legacy-region-1',
          systemIds: [1, 2],
          color: '#f59e0b',
          note: '旧区域注释',
          createdAt: 1700000000000,
        },
      ],
    };
    localStorage.setItem('df_markers_test-room', JSON.stringify(legacyData));

    const useStarMapMarkers = await loadFreshModule();
    const { result } = renderHook(() => useStarMapMarkers());

    expect(result.current.pins).toHaveLength(1);
    expect(result.current.pins[0].id).toBe('legacy-pin-1');
    expect(result.current.pins[0].note).toBeUndefined();
    expect(result.current.regions).toHaveLength(1);
    expect(result.current.regions[0].note).toBe('旧区域注释');
  });
});
