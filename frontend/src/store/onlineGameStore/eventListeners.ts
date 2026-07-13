import { wsClient } from '@/ws/client';
import type { OnlineGameStore, DisconnectedPlayer } from './types';
import { clearActionTimeout } from './events';
import type { ActionType } from '@/lib/game/protocol';
import type { GameState } from '@/lib/game/types';
import type { ViewState } from '@/lib/game/viewState';

export function registerGameEventListeners(
  set: (partial: Partial<OnlineGameStore> | ((state: OnlineGameStore) => Partial<OnlineGameStore>)) => void,
  get: () => OnlineGameStore
): Array<() => void> {
  const unsubs: Array<() => void> = [];

  const onConnect = () => {
    set({ isConnected: true, error: null });
    const { roomId } = get();
    if (roomId) {
      wsClient.send('game:requestSync', { roomId });
    }
  };
  wsClient.on('connect', onConnect);
  unsubs.push(() => wsClient.off('connect', onConnect));

  const onDisconnect = () => {
    set({ isConnected: false });
  };
  wsClient.on('disconnect', onDisconnect);
  unsubs.push(() => wsClient.off('disconnect', onDisconnect));

  const onConnectError = (error: unknown) => {
    // 原生 WebSocket onerror 传入的是 Event 而非 Error，没有 message 字段
    const err = error as { message?: string; type?: string } | undefined;
    const reason = err?.message || err?.type || '未知错误';
    set({
      isConnected: false,
      error: `连接失败：${reason}`,
    });
  };
  wsClient.on('connect_error', onConnectError);
  unsubs.push(() => wsClient.off('connect_error', onConnectError));

  const onGameFullSync = (payload: unknown) => {
    const data = payload as Record<string, unknown>;
    // 入口集中归一化：基于 _viewMeta 存在性判定（唯一可靠的结构判别），为联合类型补 kind 字段
    const rawState = data.state as GameState | ViewState;
    const normalized: GameState | ViewState =
      rawState && typeof rawState === 'object' && '_viewMeta' in rawState
        ? { ...(rawState as ViewState), kind: 'view' }
        : { ...(rawState as GameState), kind: 'game' };
    get().handleFullSync(normalized, data.version as number, data.stateHash as string | undefined);
  };
  wsClient.on('game:fullSync', onGameFullSync);
  unsubs.push(() => wsClient.off('game:fullSync', onGameFullSync));

  const onGameDeltaSync = (payload: unknown) => {
    const data = payload as Record<string, unknown>;
    get().handleDeltaSync(
      data.changes as Array<{ path: string; value: unknown; type: string }>,
      data.version as number
    );
  };
  wsClient.on('game:deltaSync', onGameDeltaSync);
  unsubs.push(() => wsClient.off('game:deltaSync', onGameDeltaSync));

  const onGameActionResult = (payload: unknown) => {
    const result = payload as {
      success: boolean;
      error?: string;
      errorCode?: string;
      action?: ActionType;
    };

    clearActionTimeout(get, set);

    if (!result.success) {
      const errorMessage = result.errorCode
        ? `${result.error} [${result.errorCode}]`
        : result.error ?? '操作失败';
      get().handleError(errorMessage);
    }
    set({ pendingAction: null, isProcessing: false });
  };
  wsClient.on('game:actionResult', onGameActionResult);
  unsubs.push(() => wsClient.off('game:actionResult', onGameActionResult));

  const onGameTurnStart = (payload: unknown) => {
    get().handleGameEvent('turnStart', payload as Record<string, unknown>);
  };
  wsClient.on('game:turnStart', onGameTurnStart);
  unsubs.push(() => wsClient.off('game:turnStart', onGameTurnStart));

  const onGameTurnEnd = (payload: unknown) => {
    get().handleGameEvent('turnEnd', payload as Record<string, unknown>);
  };
  wsClient.on('game:turnEnd', onGameTurnEnd);
  unsubs.push(() => wsClient.off('game:turnEnd', onGameTurnEnd));

  const onGamePhaseChange = (payload: unknown) => {
    get().handleGameEvent('phaseChange', payload as Record<string, unknown>);
  };
  wsClient.on('game:phaseChange', onGamePhaseChange);
  unsubs.push(() => wsClient.off('game:phaseChange', onGamePhaseChange));

  const onGameBroadcastRequest = (payload: unknown) => {
    get().handleGameEvent('broadcastRequest', payload as Record<string, unknown>);
  };
  wsClient.on('game:broadcastRequest', onGameBroadcastRequest);
  unsubs.push(() => wsClient.off('game:broadcastRequest', onGameBroadcastRequest));

  const onGameStrikeMoveRequest = (payload: unknown) => {
    get().handleGameEvent('strikeMoveRequest', payload as Record<string, unknown>);
  };
  wsClient.on('game:strikeMoveRequest', onGameStrikeMoveRequest);
  unsubs.push(() => wsClient.off('game:strikeMoveRequest', onGameStrikeMoveRequest));

  const onGameGameOver = (payload: unknown) => {
    get().handleGameEvent('gameOver', payload as Record<string, unknown>);
  };
  wsClient.on('game:gameOver', onGameGameOver);
  unsubs.push(() => wsClient.off('game:gameOver', onGameGameOver));

  const onRoomPlayerJoined = (payload: unknown) => {
    const data = payload as { players: OnlineGameStore['roomPlayers'] };
    set({ roomPlayers: data.players });
  };
  wsClient.on('room:playerJoined', onRoomPlayerJoined);
  unsubs.push(() => wsClient.off('room:playerJoined', onRoomPlayerJoined));

  const onRoomPlayerLeft = (payload: unknown) => {
    const data = payload as { players: OnlineGameStore['roomPlayers'] };
    set({ roomPlayers: data.players });
  };
  wsClient.on('room:playerLeft', onRoomPlayerLeft);
  unsubs.push(() => wsClient.off('room:playerLeft', onRoomPlayerLeft));

  const onRoomPlayerReady = (payload: unknown) => {
    const data = payload as { players: OnlineGameStore['roomPlayers'] };
    set({ roomPlayers: data.players });
  };
  wsClient.on('room:playerReady', onRoomPlayerReady);
  unsubs.push(() => wsClient.off('room:playerReady', onRoomPlayerReady));

  const onRoomPlayerDisconnected = (payload: unknown) => {
    const data = payload as Record<string, unknown>;

    set({ roomPlayers: data.players as OnlineGameStore['roomPlayers'] });

    const disconnectedPlayer: DisconnectedPlayer = {
      playerId: data.disconnectedPlayerId as string,
      displayName: data.disconnectedPlayerName as string,
      reason: data.reason as DisconnectedPlayer['reason'],
      canReconnect: data.canReconnect as boolean,
      reconnectTimeout: data.reconnectTimeout as number,
      disconnectedAt: Date.now(),
    };

    // 去重：同 playerId 旧记录先过滤掉，避免多次断线累积
    set((state) => ({
      disconnectedPlayers: [
        ...state.disconnectedPlayers.filter(p => p.playerId !== disconnectedPlayer.playerId),
        disconnectedPlayer,
      ],
    }));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('playerDisconnected', { detail: disconnectedPlayer }));
    }
  };
  wsClient.on('room:playerDisconnected', onRoomPlayerDisconnected);
  unsubs.push(() => wsClient.off('room:playerDisconnected', onRoomPlayerDisconnected));

  const onRoomPlayerReconnected = (payload: unknown) => {
    const data = payload as { players: OnlineGameStore['roomPlayers']; reconnectedPlayerId?: string };

    set({ roomPlayers: data.players });

    if (data.reconnectedPlayerId) {
      // 从 disconnectedPlayers 中移除该玩家
      set((state) => ({
        disconnectedPlayers: state.disconnectedPlayers.filter(p => p.playerId !== data.reconnectedPlayerId),
      }));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('playerReconnected', { detail: { playerId: data.reconnectedPlayerId } }));
      }
    }
  };
  wsClient.on('room:playerReconnected', onRoomPlayerReconnected);
  unsubs.push(() => wsClient.off('room:playerReconnected', onRoomPlayerReconnected));

  const onRoomGameStarting = () => {
    set({ error: null });
  };
  wsClient.on('room:gameStarting', onRoomGameStarting);
  unsubs.push(() => wsClient.off('room:gameStarting', onRoomGameStarting));

  // 游戏真正启动后才拉取状态：match:found 时房间和游戏尚未创建，
  // connect() 内的 game:requestSync 会因 ErrRoomNotFound/ErrGameNotStarted 失败。
  // room:gameStarted 在 StartGameInRoomWithMatchInfo 成功后广播，此时拉取必定成功。
  const onRoomGameStarted = () => {
    set({ error: null });
    const { roomId } = get();
    if (roomId) {
      wsClient.send('game:requestSync', { roomId });
    }
  };
  wsClient.on('room:gameStarted', onRoomGameStarted);
  unsubs.push(() => wsClient.off('room:gameStarted', onRoomGameStarted));

  const onRoomHostChanged = (payload: unknown) => {
    const data = payload as { players: OnlineGameStore['roomPlayers'] };
    set({ roomPlayers: data.players });
  };
  wsClient.on('room:hostChanged', onRoomHostChanged);
  unsubs.push(() => wsClient.off('room:hostChanged', onRoomHostChanged));

  const onGameError = (payload: unknown) => {
    const data = payload as { message: string };
    get().handleError(data.message);
  };
  wsClient.on('game:error', onGameError);
  unsubs.push(() => wsClient.off('game:error', onGameError));

  return unsubs;
}
