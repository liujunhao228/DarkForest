import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplayPlayerEngine } from '@/lib/replay/playerEngine';
import type { GameState } from '@/lib/game/types';

function createMockState(turn: number): GameState {
  return {
    kind: 'game',
    totalTurn: turn,
    turnPhase: 'actionPhase' as const,
    currentPlayerIndex: 0,
    currentPlayerId: 'player1',
    players: [],
    playerCount: 2,
    drawPile: [],
    discardPile: [],
    flyingStrikes: [],
    broadcast: null,
    logs: [],
    destroyedStars: [],
    winner: null,
    isProcessing: false,
    phase: 'playing' as const,
    localPlayerId: 'player1',
    pendingAction: null,
  };
}

const mockReplay = {
  id: 'replay1',
  matchId: 'match1',
  playerIds: ['player1', 'player2'],
  playerNames: ['Alice', 'Bob'],
  actions: [],
  states: [createMockState(1), createMockState(2), createMockState(3)],
  winner: 'player1',
  totalTurns: 3,
  createdAt: Date.now(),
};

describe('ReplayPlayerEngine', () => {
  let engine: ReplayPlayerEngine;

  beforeEach(() => {
    engine = new ReplayPlayerEngine();
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  it('should initialize with default state', () => {
    const state = engine.getState();
    expect(state.isLoading).toBe(true);
    expect(state.isPlaying).toBe(false);
    expect(state.currentStateIndex).toBe(0);
    expect(state.totalStates).toBe(0);
    expect(state.playbackSpeed).toBe(1);
    expect(state.currentViewState).toBeNull();
    expect(state.viewerPlayerId).toBe('');
  });

  it('should load replay data', async () => {
    await engine.loadReplay(mockReplay);
    const state = engine.getState();
    expect(state.isLoading).toBe(false);
    expect(state.totalStates).toBe(3);
    expect(state.currentStateIndex).toBe(0);
    expect(state.winner).toBe('player1');
    // 默认进入全知观察者模式
    expect(state.viewerPlayerId).toBe('');
  });

  it('should default to observer mode after loading', async () => {
    await engine.loadReplay(mockReplay);
    expect(engine.getState().viewerPlayerId).toBe('');
    expect(engine.getState().currentViewState).toBeDefined();
    expect(engine.getState().currentViewState?._viewMeta.viewerId).toBe('');
  });

  it('should seek to a specific state index', async () => {
    await engine.loadReplay(mockReplay);
    engine.seekToState(2);
    expect(engine.getState().currentStateIndex).toBe(2);
  });

  it('should not seek below 0', async () => {
    await engine.loadReplay(mockReplay);
    engine.seekToState(-1);
    expect(engine.getState().currentStateIndex).toBe(0);
  });

  it('should not seek above total states', async () => {
    await engine.loadReplay(mockReplay);
    engine.seekToState(10);
    expect(engine.getState().currentStateIndex).toBe(0);
  });

  it('should navigate to next state', async () => {
    await engine.loadReplay(mockReplay);
    engine.nextState();
    expect(engine.getState().currentStateIndex).toBe(1);
  });

  it('should navigate to previous state', async () => {
    await engine.loadReplay(mockReplay);
    engine.seekToState(2);
    engine.prevState();
    expect(engine.getState().currentStateIndex).toBe(1);
  });

  it('should have correct hasNextState and hasPrevState', async () => {
    await engine.loadReplay(mockReplay);
    expect(engine.hasPrevState).toBe(false);
    expect(engine.hasNextState).toBe(true);

    engine.seekToState(2);
    expect(engine.hasPrevState).toBe(true);
    expect(engine.hasNextState).toBe(false);
  });

  it('should set playback speed', async () => {
    await engine.loadReplay(mockReplay);
    engine.setSpeed(2);
    expect(engine.getState().playbackSpeed).toBe(2);
  });

  it('should set viewer player', async () => {
    await engine.loadReplay(mockReplay);
    engine.setViewerPlayer('player2');
    const state = engine.getState();
    expect(state.currentViewState).toBeDefined();
    expect(state.viewerPlayerId).toBe('player2');
    expect(state.currentViewState?._viewMeta.viewerId).toBe('player2');
  });

  it('should notify state change listeners', async () => {
    const listener = vi.fn();
    engine.onStateChange(listener);

    await engine.loadReplay(mockReplay);
    expect(listener).toHaveBeenCalled();

    const callCount = listener.mock.calls.length;
    engine.nextState();
    expect(listener).toHaveBeenCalledTimes(callCount + 1);
  });

  it('should unsubscribe from state change', async () => {
    const listener = vi.fn();
    const unsubscribe = engine.onStateChange(listener);

    await engine.loadReplay(mockReplay);
    const callCount = listener.mock.calls.length;

    unsubscribe();
    engine.nextState();
    expect(listener).toHaveBeenCalledTimes(callCount);
  });

  it('should pause automatically at last state', async () => {
    vi.useFakeTimers();
    await engine.loadReplay(mockReplay);
    engine.seekToState(1);
    engine.play();

    vi.advanceTimersByTime(2000);
    const state = engine.getState();
    expect(state.isPlaying).toBe(false);
  });

  it('should toggle play/pause', async () => {
    vi.useFakeTimers();
    await engine.loadReplay(mockReplay);

    engine.togglePlay();
    expect(engine.getState().isPlaying).toBe(true);

    engine.togglePlay();
    expect(engine.getState().isPlaying).toBe(false);
  });

  it('should clean up on destroy', async () => {
    const listener = vi.fn();
    engine.onStateChange(listener);

    await engine.loadReplay(mockReplay);
    engine.play();
    engine.destroy();

    expect(engine.totalStates).toBe(0);
  });
});
