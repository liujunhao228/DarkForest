import type { GameState } from '@/lib/game/types';
import type { ActionType } from '@/lib/game/protocol';
import type { ViewState } from '@/lib/game/viewState';

export interface DisconnectedPlayer {
  playerId: string;
  displayName: string;
  reason: 'timeout' | 'network_error' | 'client_closed';
  canReconnect: boolean;
  reconnectTimeout?: number;
  disconnectedAt: number;
}

export interface OnlineGameStore {
  isConnected: boolean;
  roomId: string | null;
  roomCode: string | null;
  hasInitializedListeners: boolean;
  roomPlayers: Array<{
    playerId: string;
    displayName: string;
    isHost: boolean;
    playerNumber: number;
    position: number;
    ready: boolean;
    connected: boolean;
  }>;
  disconnectedPlayers: DisconnectedPlayer[];
  gameState: GameState | ViewState | null;
  gameVersion: number;
  pendingAction: ActionType | null;
  isProcessing: boolean;
  error: string | null;
  _actionTimeout: ReturnType<typeof setTimeout> | null;

  connect: (roomId: string, roomCode: string) => void;
  disconnect: () => void;
  sendAction: (action: ActionType, payload?: Record<string, unknown>) => void;
  requestSync: () => void;
  ackState: (version: number) => void;
  handleFullSync: (state: GameState | ViewState, version: number, stateHash?: string) => Promise<void>;
  handleDeltaSync: (changes: Array<{ path: string; value: unknown; type: string }>, version: number) => void;
  handleGameEvent: (event: string, payload: Record<string, unknown>) => void;
  handleError: (message: string) => void;
  clearError: () => void;
}

export const initialState: Omit<OnlineGameStore,
  'connect' | 'disconnect' | 'sendAction' | 'requestSync' |
  'ackState' | 'handleFullSync' | 'handleDeltaSync' |
  'handleGameEvent' | 'handleError' | 'clearError'
> = {
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
  _actionTimeout: null,
};
