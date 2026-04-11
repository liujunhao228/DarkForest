// ============================
// 黑暗森林 - 在线游戏事件处理
// ============================
// 处理游戏事件和操作发送
// ============================

import type { Socket } from 'socket.io-client';
import type { GameState } from '@/lib/game/types';
import type { ActionType } from '@/server/protocol';
import type { ViewState } from '@/types/viewState';
import type { OnlineGameStore } from './index';

/**
 * 发送操作请求
 */
export function sendAction(
  action: ActionType,
  payload: Record<string, unknown> | undefined,
  get: () => OnlineGameStore,
  set: (partial: Partial<OnlineGameStore>) => void
): void {
  const { isConnected, roomId, socket, gameState } = get();

  if (!isConnected || !roomId || !socket) {
    set({ error: '未连接到服务器' });
    return;
  }

  if (!gameState) {
    set({ error: '游戏尚未开始，请等待房主开始游戏' });
    return;
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  set({
    pendingAction: action,
    isProcessing: true,
    error: null,
  });

  // 设置超时处理（10 秒）
  const timeoutId = setTimeout(() => {
    const current = get();
    if (current.isProcessing && current.pendingAction === action) {
      set({
        isProcessing: false,
        pendingAction: null,
        error: '服务器响应超时，请重试',
      });
      console.warn('[OnlineGame] ⏰ 请求超时:', { requestId, action });

      const socketRef = current.socket as Socket & { _actionTimeout?: ReturnType<typeof setTimeout> };
      socketRef.emit?.('game:cancelAction', { requestId, action });
    }
  }, 10000);

  socket.emit('game:action', {
    roomId,
    action,
    payload: {
      ...payload,
      requestId,
    },
  });

  const socketRef = socket as Socket & { _actionTimeout?: ReturnType<typeof setTimeout> };
  socketRef._actionTimeout = timeoutId;
}

/**
 * 处理游戏事件
 */
export function handleGameEvent(
  event: string,
  payload: Record<string, unknown>,
  get: () => OnlineGameStore,
  set: (partial: Partial<OnlineGameStore> | ((state: OnlineGameStore) => Partial<OnlineGameStore>)) => void
): void {
  console.log(`[OnlineGame] 游戏事件: ${event}`, payload);

  const { gameState } = get();
  if (!gameState) return;

  switch (event) {
    case 'phaseChange': {
      const newPhase = payload.newPhase as string;
      if (newPhase) {
        set((state: OnlineGameStore) => ({
          gameState: state.gameState ? produce(state.gameState, (draft: GameState) => {
            draft.turnPhase = newPhase as GameState['turnPhase'];
          }) : null,
        }));
        console.log(`[OnlineGame] 本地状态已更新: turnPhase -> ${newPhase}`);
      }
      break;
    }
    case 'turnStart': {
      const currentPlayerId = payload.currentPlayerId as string;
      const phase = payload.phase as string;
      set((state: OnlineGameStore) => ({
        gameState: state.gameState ? produce(state.gameState, (draft: GameState) => {
          if (phase) {
            draft.turnPhase = phase as GameState['turnPhase'];
          }
        }) : null,
      }));
      break;
    }
    case 'turnEnd':
      break;
    case 'broadcastRequest':
      break;
    case 'strikeMoveRequest':
      break;
    case 'gameOver':
      break;
  }
}

// 需要动态导入 produce
let produce: any;
import('immer').then(mod => {
  produce = mod.produce;
});
