import { wsClient } from '@/ws/client';
import type { OnlineGameStore } from './types';
import type { ActionType } from '@/lib/game/protocol';

export function sendAction(
  action: ActionType,
  payload: Record<string, unknown> | undefined,
  get: () => OnlineGameStore,
  set: (partial: Partial<OnlineGameStore>) => void
): void {
  const { isConnected, roomId, gameState } = get();

  if (!isConnected || !roomId) {
    set({ error: '未连接到服务器' });
    return;
  }

  if (!gameState) {
    set({ error: '游戏尚未开始，请等待房主开始游戏' });
    return;
  }

  // 先清掉上一次的 timeout（统一通过 clearActionTimeout 操作 store，避免 closure 持有旧值导致漏清）
  clearActionTimeout(get, set);

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  set({
    pendingAction: action,
    isProcessing: true,
    error: null,
  });

  const timeoutId = setTimeout(() => {
    const current = get();
    if (current.isProcessing && current.pendingAction === action) {
      set({
        isProcessing: false,
        pendingAction: null,
        _actionTimeout: null,
        error: '服务器响应超时，请重试',
      });
      wsClient.send('game:cancelAction', { roomId, requestId, action });
    }
  }, 10000);

  set({ _actionTimeout: timeoutId });

  wsClient.send('game:action', {
    roomId,
    action,
    payload: {
      ...payload,
      requestId,
    },
  });
}

export function handleGameEvent(
  event: string,
  payload: Record<string, unknown>,
  get: () => OnlineGameStore,
  set: (partial: Partial<OnlineGameStore> | ((state: OnlineGameStore) => Partial<OnlineGameStore>)) => void
): void {
  const { gameState } = get();
  if (!gameState) return;

  switch (event) {
    case 'phaseChange': {
      const newPhase = payload.newPhase as string;
      if (newPhase) {
        set((state: OnlineGameStore) => ({
          // GameState.turnPhase 为 TurnPhase；ViewState.turnPhase 为 string；均为字符串字面量，可直接展开
          gameState: state.gameState ? { ...state.gameState, turnPhase: newPhase } as OnlineGameStore['gameState'] : null,
        }));
      }
      break;
    }
    case 'turnStart': {
      const phase = payload.phase as string;
      set((state: OnlineGameStore) => ({
        gameState: state.gameState
          ? (phase ? ({ ...state.gameState, turnPhase: phase } as OnlineGameStore['gameState']) : state.gameState)
          : null,
      }));
      break;
    }
    case 'turnEnd':
      break;
    case 'strikeMoveRequest':
      break;
    case 'gameOver':
      break;
  }
}

export function clearActionTimeout(get: () => OnlineGameStore, set: (partial: Partial<OnlineGameStore>) => void): void {
  const { _actionTimeout } = get();
  if (_actionTimeout) {
    clearTimeout(_actionTimeout);
    set({ _actionTimeout: null });
  }
}
