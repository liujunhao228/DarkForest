// ============================
// 回放存储服务测试
// ============================

import { replayStorageService } from '../ReplayStorageService';
import { ReplayData, ReplayMetadata } from '@/lib/game/types';

describe('ReplayStorageService', () => {
  let testReplayData: ReplayData;

  beforeAll(() => {
    // 创建测试数据
    testReplayData = {
      metadata: {
        id: 'test_replay_123',
        gameId: 'game_123',
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        duration: 60,
        playerCount: 4,
        players: [
          { id: 'player1', name: 'Player 1', color: 'red' },
          { id: 'player2', name: 'Player 2', color: 'blue' },
          { id: 'player3', name: 'Player 3', color: 'green' },
          { id: 'player4', name: 'Player 4', color: 'purple' }
        ],
        winner: 'player1',
        version: '1.0.0'
      },
      snapshots: [
        {
          timestamp: Date.now(),
          version: 1,
          state: {
            phase: 'setup',
            totalTurn: 0,
            playerCount: 4,
            players: [
              { id: 'player1', name: 'Player 1', color: 'red', position: 1, energy: 10, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] },
              { id: 'player2', name: 'Player 2', color: 'blue', position: 2, energy: 10, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] },
              { id: 'player3', name: 'Player 3', color: 'green', position: 3, energy: 10, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] },
              { id: 'player4', name: 'Player 4', color: 'purple', position: 4, energy: 10, hand: [], faceUpCards: [], eliminated: false, broadcastHistory: [] }
            ],
            currentPlayerIndex: 0,
            currentPlayerId: 'player1',
            localPlayerId: 'player1',
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
        }
      ],
      deltas: [],
      checkpoints: [1]
    };
  });

  test('should save and load replay data', async () => {
    // 保存回放
    const replayId = await replayStorageService.saveReplay(testReplayData);
    expect(replayId).toBeTruthy();

    // 加载回放
    const loadedReplay = await replayStorageService.loadReplay(replayId);
    expect(loadedReplay).toBeTruthy();
    expect(loadedReplay.metadata.id).toBe(replayId);
    expect(loadedReplay.metadata.gameId).toBe(testReplayData.metadata.gameId);
    expect(loadedReplay.snapshots.length).toBe(testReplayData.snapshots.length);

    // 清理测试数据
    replayStorageService.deleteReplay(replayId);
  });

  test('should get replay list', async () => {
    // 保存测试回放
    const replayId = await replayStorageService.saveReplay(testReplayData);

    // 获取回放列表
    const replays = replayStorageService.getReplayList();
    expect(Array.isArray(replays)).toBe(true);

    // 清理测试数据
    replayStorageService.deleteReplay(replayId);
  });

  test('should delete replay', async () => {
    // 保存测试回放
    const replayId = await replayStorageService.saveReplay(testReplayData);

    // 删除回放
    const result = replayStorageService.deleteReplay(replayId);
    expect(result).toBe(true);

    // 尝试加载已删除的回放
    await expect(replayStorageService.loadReplay(replayId)).rejects.toThrow();
  });

  test('should get storage stats', () => {
    const stats = replayStorageService.getStorageStats();
    expect(stats).toHaveProperty('totalReplays');
    expect(stats).toHaveProperty('totalSize');
    expect(stats).toHaveProperty('oldestReplay');
    expect(stats).toHaveProperty('newestReplay');
  });

  test('should cleanup old replays', () => {
    const deletedCount = replayStorageService.cleanupOldReplays(0); // 清理所有回放
    expect(typeof deletedCount).toBe('number');
  });

  test('should handle empty replay data', async () => {
    const emptyReplayData: ReplayData = {
      metadata: {
        id: 'test_empty_replay',
        gameId: 'game_empty',
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 0,
        playerCount: 0,
        players: [],
        winner: null,
        version: '1.0.0'
      },
      snapshots: [],
      deltas: [],
      checkpoints: []
    };

    // 保存空回放
    const replayId = await replayStorageService.saveReplay(emptyReplayData);
    expect(replayId).toBeTruthy();

    // 加载空回放
    const loadedReplay = await replayStorageService.loadReplay(replayId);
    expect(loadedReplay).toBeTruthy();
    expect(loadedReplay.snapshots.length).toBe(0);
    expect(loadedReplay.deltas.length).toBe(0);

    // 清理测试数据
    replayStorageService.deleteReplay(replayId);
  });

  test('should check access permissions', async () => {
    // 保存测试回放
    const replayId = await replayStorageService.saveReplay(testReplayData);

    // 测试有权限的玩家
    const hasAccess = replayStorageService.hasAccess(replayId, 'player1');
    expect(hasAccess).toBe(true);

    // 测试无权限的玩家
    const noAccess = replayStorageService.hasAccess(replayId, 'player5');
    expect(noAccess).toBe(false);

    // 测试不存在的回放
    const noReplayAccess = replayStorageService.hasAccess('non_existent_replay', 'player1');
    expect(noReplayAccess).toBe(false);

    // 清理测试数据
    replayStorageService.deleteReplay(replayId);
  });

  test('should get accessible replays', async () => {
    // 保存测试回放
    const replayId = await replayStorageService.saveReplay(testReplayData);

    // 获取可访问的回放
    const accessibleReplays = replayStorageService.getAccessibleReplays('player1');
    expect(Array.isArray(accessibleReplays)).toBe(true);

    // 清理测试数据
    replayStorageService.deleteReplay(replayId);
  });

  test('should load replay metadata', async () => {
    // 保存测试回放
    const replayId = await replayStorageService.saveReplay(testReplayData);

    // 加载元数据
    const metadata = await replayStorageService.loadReplayMetadata(replayId);
    expect(metadata).toBeTruthy();
    expect(metadata.id).toBe(replayId);

    // 清理测试数据
    replayStorageService.deleteReplay(replayId);
  });

  test('should load replay snapshots', async () => {
    // 保存测试回放
    const replayId = await replayStorageService.saveReplay(testReplayData);

    // 加载快照
    const snapshots = await replayStorageService.loadReplaySnapshots(replayId);
    expect(Array.isArray(snapshots)).toBe(true);
    expect(snapshots.length).toBeGreaterThan(0);

    // 清理测试数据
    replayStorageService.deleteReplay(replayId);
  });

  test('should handle storage limits', () => {
    // 设置存储配置
    replayStorageService.setConfig({
      maxAgeDays: 30,
      maxStorageSizeMB: 1, // 1MB 限制
      cleanupIntervalHours: 24
    });

    // 获取配置
    const config = replayStorageService.getConfig();
    expect(config.maxStorageSizeMB).toBe(1);
  });

  test('should perform manual cleanup', async () => {
    // 保存测试回放
    const replayId = await replayStorageService.saveReplay(testReplayData);

    // 手动清理
    const cleanupResult = replayStorageService.manualCleanup();
    expect(cleanupResult).toHaveProperty('oldReplaysDeleted');
    expect(cleanupResult).toHaveProperty('sizeReplaysDeleted');

    // 清理测试数据
    replayStorageService.deleteReplay(replayId);
  });
});
