import type { GameState } from '@/lib/game/types';
import type { ViewState } from '@/lib/game/viewState';
import { createViewState } from '@/lib/game/viewState';
import type { Replay } from '@/api/replay';

export interface ReplayPlayerState {
  isLoading: boolean;
  isPlaying: boolean;
  currentStateIndex: number;
  totalStates: number;
  playbackSpeed: number;
  currentViewState: ViewState | null;
  error: string | null;
  winner: string | null;
  /** 当前观察者视角的玩家 id；空字符串表示全知观察者模式 */
  viewerPlayerId: string;
}

type StateChangeCallback = (state: ReplayPlayerState) => void;

export class ReplayPlayerEngine {
  private replay: Replay | null = null;
  private states: GameState[] = [];
  private viewerPlayerId: string = '';
  private currentStateIndex: number = 0;
  private isPlaying: boolean = false;
  private playbackSpeed: number = 1;
  private playInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<StateChangeCallback> = new Set();

  async loadReplay(replayData: Replay): Promise<void> {
    // 重新加载前停止既有播放循环（直接停止，避免 pause() 触发基于旧数据的 stale 通知）
    this.isPlaying = false;
    this.stopPlaybackLoop();

    this.replay = replayData;
    this.states = replayData.states || [];
    this.currentStateIndex = 0;

    // 默认进入全知观察者模式（空字符串不匹配任何真实玩家 id）
    this.viewerPlayerId = '';

    this.notifyListeners();
  }

  play(): void {
    if (this.isPlaying || this.currentStateIndex >= this.totalStates - 1) return;

    this.isPlaying = true;
    this.startPlaybackLoop();
    this.notifyListeners();
  }

  pause(): void {
    this.isPlaying = false;
    this.stopPlaybackLoop();
    this.notifyListeners();
  }

  togglePlay(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  seekToState(index: number): void {
    if (index < 0 || index >= this.totalStates) return;

    this.currentStateIndex = index;
    if (this.currentStateIndex >= this.totalStates - 1) {
      this.pause();
    }
    this.notifyListeners();
  }

  nextState(): void {
    if (this.currentStateIndex < this.totalStates - 1) {
      this.seekToState(this.currentStateIndex + 1);
    }
  }

  prevState(): void {
    if (this.currentStateIndex > 0) {
      this.seekToState(this.currentStateIndex - 1);
    }
  }

  setSpeed(speed: number): void {
    this.playbackSpeed = speed;

    if (this.isPlaying) {
      this.stopPlaybackLoop();
      this.startPlaybackLoop();
    }

    this.notifyListeners();
  }

  setViewerPlayer(playerId: string): void {
    this.viewerPlayerId = playerId;
    this.notifyListeners();
  }

  getState(): ReplayPlayerState {
    const currentState = this.states[this.currentStateIndex];
    let currentViewState: ViewState | null = null;

    if (currentState) {
      currentViewState = createViewState(currentState, {
        role: 'REPLAY',
        playerId: this.viewerPlayerId,
      });
    }

    return {
      isLoading: !this.replay,
      isPlaying: this.isPlaying,
      currentStateIndex: this.currentStateIndex,
      totalStates: this.totalStates,
      playbackSpeed: this.playbackSpeed,
      currentViewState,
      error: null,
      winner: this.replay?.winner || null,
      viewerPlayerId: this.viewerPlayerId,
    };
  }

  get totalStates(): number {
    return this.states.length;
  }

  get hasNextState(): boolean {
    return this.currentStateIndex < this.totalStates - 1;
  }

  get hasPrevState(): boolean {
    return this.currentStateIndex > 0;
  }

  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  destroy(): void {
    this.stopPlaybackLoop();
    this.listeners.clear();
    this.replay = null;
    this.states = [];
  }

  private startPlaybackLoop(): void {
    this.stopPlaybackLoop();

    const intervalMs = 1000 / this.playbackSpeed;
    this.playInterval = setInterval(() => {
      if (this.currentStateIndex < this.totalStates - 1) {
        this.currentStateIndex++;
        this.notifyListeners();
      } else {
        this.pause();
      }
    }, intervalMs);
  }

  private stopPlaybackLoop(): void {
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }
}
