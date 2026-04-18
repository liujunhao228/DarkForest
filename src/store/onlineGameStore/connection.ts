// ============================
// 黑暗森林 - 在线游戏连接管理
// ============================
// 处理 WebSocket 连接和房间事件
// ============================

import type { Socket } from 'socket.io-client';
import type { GameState } from '@/lib/game/types';
import type { ViewState } from '@/types/viewState';
import type { ActionType } from '@/server/protocol';

// ============================
// 类型定义
// ============================

export interface OnlineGameState {
  // 连接状态
  socket: Socket | null;
  isConnected: boolean;
  roomId: string | null;
  roomCode: string | null;

  // 事件监听器初始化标志（防止重复注册）
  hasInitializedListeners: boolean;

  // 房间信息
  roomPlayers: Array<{
    playerId: string;
    displayName: string;
    isHost: boolean;
    playerNumber: number;
    position: number;
    ready: boolean;
    connected: boolean;
  }>;

  // 断线玩家信息
  disconnectedPlayers: Array<{
    playerId: string;
    displayName: string;
    reason: 'timeout' | 'network_error' | 'client_closed';
    canReconnect: boolean;
    reconnectTimeout?: number;
    disconnectedAt: number;
  }>;

  // 游戏状态
  gameState: GameState | ViewState | null;
  gameVersion: number;

  // 操作状态
  pendingAction: ActionType | null;
  isProcessing: boolean;

  // 错误
  error: string | null;
}

// ============================
// Store 基础状态
// ============================

const initialState: OnlineGameState = {
  socket: null,
  isConnected: false,
  roomId: null,
  roomCode: null,
  hasInitializedListeners: false,
  roomPlayers: [],
  disconnectedPlayers: [],
  gameState: null,
  gameVersion: 0,
  pendingAction: null,
  isProcessing: false,
  error: null,
};

export { initialState };
