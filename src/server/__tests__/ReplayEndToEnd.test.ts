// ============================
// 回放端到端测试
// ============================
// 测试完整的回放流程
// ============================

import { replayStorageService } from '../ReplayStorageService';
import { ReplayData } from '@/lib/game/types';

describe('Replay End-to-End Tests', () => {
  let testReplayData: ReplayData;
  let testReplayId: string;

  beforeAll(() => {
    // 创建测试数据
    testReplayData = {
      metadata: {
        id: `test_replay_${Date.now()}`,
        gameId: `game_${Date.now()}`,
        startTime: Date.now(),
        endTime: Date.now() + 120000, // 2分钟
        duration: 120,
        playerCount: 3,
        players: [
          { id: 'player_a', name: 'Player A', color: 'red' },
          { id: 'player_b', name: 'Player B', color: 'blue' },
          { id: 'player_c', name: 'Player C', color: 'green' }
        ],
        winner: 'player_a',
        version: '1.0.0'
      },
      snapshots: [
        {
          timestamp: Date.now(),
          version: 1,
          state: {
            phase: 'setup',
            totalTurn: 0,
            playerCount: 3,
            players: [
              { id: 'player_a', name: 'Player A', color: 'red', position: 1, energy: 10, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] },
              { id: 'player_b', name: 'Player B', color: 'blue', position: 2, energy: 10, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] },
              { id: 'player_c', name: 'Player C', color: 'green', position: 3, energy: 10, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] }
            ],
            currentPlayerIndex: 0,
            currentPlayerId: 'player_a',
            localPlayerId: 'player_a',
            drawPile: [],
            discardPile: [],
            flyingStrikes: [],
            broadcast: null,
            turnPhase: 'turnBegin',
            pendingAction: null,
            logs: [],
            destroyedStars: [],
            winner: null,
            isProcessing: false,
            version: 1,
            replayTimestamp: Date.now()
          },
          hash: 'test_hash_1'
        },
        {
          timestamp: Date.now() + 30000,
          version: 10,
          state: {
            phase: 'playing',
            totalTurn: 1,
            playerCount: 3,
            players: [
              { id: 'player_a', name: 'Player A', color: 'red', position: 1, energy: 15, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] },
              { id: 'player_b', name: 'Player B', color: 'blue', position: 2, energy: 12, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] },
              { id: 'player_c', name: 'Player C', color: 'green', position: 3, energy: 10, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] }
            ],
            currentPlayerIndex: 1,
            currentPlayerId: 'player_b',
            localPlayerId: 'player_a',
            drawPile: [],
            discardPile: [],
            flyingStrikes: [],
            broadcast: null,
            turnPhase: 'actionPhase',
            pendingAction: null,
            logs: [],
            destroyedStars: [],
            winner: null,
            isProcessing: false,
            version: 10,
            replayTimestamp: Date.now() + 30000
          },
          hash: 'test_hash_2'
        }
      ],
      deltas: [
        {
          timestamp: Date.now() + 10000,
          version: 2,
          changes: [
            { path: 'players.0.energy', value: 11, type: 'set' }
          ]
        },
        {
          timestamp: Date.now() + 20000,
          version: 5,
          changes: [
            { path: 'players.0.energy', value: 13, type: 'set' },
            { path: 'players.1.energy', value: 11, type: 'set' }
          ]
        }
      ],
      checkpoints: [1, 10]
    };
  });

  afterAll(() => {
    // 清理测试数据
    if (testReplayId) {
      replayStorageService.deleteReplay(testReplayId);
    }
  });

  test('should complete full replay lifecycle', async () => {
    // 1. 保存回放
    testReplayId = await replayStorageService.saveReplay(testReplayData);
    expect(testReplayId).toBeTruthy();

    // 2. 获取回放列表
    const replayList = replayStorageService.getReplayList();
    expect(Array.isArray(replayList)).toBe(true);
    const savedReplay = replayList.find(r => r.id === testReplayId);
    expect(savedReplay).toBeTruthy();

    // 3. 检查权限
    const hasAccess = replayStorageService.hasAccess(testReplayId, 'player_a');
    expect(hasAccess).toBe(true);

    const noAccess = replayStorageService.hasAccess(testReplayId, 'player_d');
    expect(noAccess).toBe(false);

    // 4. 加载完整回放
    const fullReplay = await replayStorageService.loadReplay(testReplayId);
    expect(fullReplay).toBeTruthy();
    expect(fullReplay.metadata.id).toBe(testReplayId);
    expect(fullReplay.snapshots.length).toBe(2);
    expect(fullReplay.deltas.length).toBe(2);

    // 5. 加载元数据
    const metadata = await replayStorageService.loadReplayMetadata(testReplayId);
    expect(metadata).toBeTruthy();
    expect(metadata.playerCount).toBe(3);

    // 6. 加载快照
    const snapshots = await replayStorageService.loadReplaySnapshots(testReplayId);
    expect(Array.isArray(snapshots)).toBe(true);
    expect(snapshots.length).toBe(2);

    // 7. 加载增量数据
    const deltas = await replayStorageService.loadReplayDeltas(testReplayId, 1, 10);
    expect(Array.isArray(deltas)).toBe(true);
    expect(deltas.length).toBe(2);

    // 8. 获取存储统计信息
    const stats = replayStorageService.getStorageStats();
    expect(stats.totalReplays).toBeGreaterThan(0);

    // 9. 手动清理
    const cleanupResult = replayStorageService.manualCleanup();
    expect(cleanupResult).toHaveProperty('oldReplaysDeleted');
    expect(cleanupResult).toHaveProperty('sizeReplaysDeleted');

    // 10. 删除回放
    const deleteResult = replayStorageService.deleteReplay(testReplayId);
    expect(deleteResult).toBe(true);

    // 11. 验证回放已删除
    await expect(replayStorageService.loadReplay(testReplayId)).rejects.toThrow();
  });

  test('should handle storage configuration', () => {
    // 设置配置
    const testConfig = {
      maxAgeDays: 7,
      maxStorageSizeMB: 100,
      cleanupIntervalHours: 12
    };

    replayStorageService.setConfig(testConfig);

    // 验证配置
    const config = replayStorageService.getConfig();
    expect(config.maxAgeDays).toBe(7);
    expect(config.maxStorageSizeMB).toBe(100);
    expect(config.cleanupIntervalHours).toBe(12);

    // 恢复默认配置
    replayStorageService.setConfig({
      maxAgeDays: 30,
      maxStorageSizeMB: 500,
      cleanupIntervalHours: 24
    });
  });

  test('should handle edge cases', async () => {
    // 测试不存在的回放
    await expect(replayStorageService.loadReplay('non_existent_replay')).rejects.toThrow();

    // 测试空的可访问回放列表
    const emptyAccessList = replayStorageService.getAccessibleReplays('non_existent_player');
    expect(Array.isArray(emptyAccessList)).toBe(true);
    expect(emptyAccessList.length).toBe(0);

    // 测试权限检查不存在的回放
    const noReplayAccess = replayStorageService.hasAccess('non_existent_replay', 'player_a');
    expect(noReplayAccess).toBe(false);
  });
});
