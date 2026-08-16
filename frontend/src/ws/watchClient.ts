import type { ViewState } from '@/lib/game/viewState';

export interface WatchConnection {
  close: () => void;
}

export interface WatchHandlers {
  onFullSync: (view: ViewState, version: number) => void;
  onError: (message: string) => void;
  onDisconnect: () => void;
}

/**
 * 建立一条只读旁观 WS 连接（/ws?watch=<sid>）。
 * 后端把被观察玩家的私有 ViewState 以 game:fullSync 推送过来。
 * 观察者只读，不能发送 game/match 动作（后端强制）。
 */
export function connectWatch(sid: string, handlers: WatchHandlers): WatchConnection {
  const envUrl = import.meta.env.VITE_WS_URL;
  let url: string;
  if (envUrl) {
    url = envUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    url = `${protocol}//${window.location.host}/ws`;
  }
  const sep = url.includes('?') ? '&' : '?';
  url = `${url}${sep}watch=${encodeURIComponent(sid)}`;

  const ws = new WebSocket(url);
  let closed = false;

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data as string) as {
        type: string;
        payload?: { state?: unknown; version?: number; message?: string };
      };
      if (message.type === 'game:fullSync' && message.payload?.state) {
        const raw = message.payload.state as Record<string, unknown>;
        // 与 onlineGameStore 的归一化一致：基于 _viewMeta 存在性补 kind 字段
        const normalized = { ...(raw as unknown as ViewState), kind: 'view' as const };
        handlers.onFullSync(normalized, message.payload.version ?? 0);
      } else if (message.type === 'game:error') {
        handlers.onError(message.payload?.message ?? '未知错误');
      }
    } catch (e) {
      console.error('[watch] 消息解析失败:', e);
    }
  };

  ws.onerror = () => handlers.onError('连接出错');
  ws.onclose = () => {
    if (!closed) handlers.onDisconnect();
  };

  return {
    close: () => {
      closed = true;
      ws.close(1000);
    },
  };
}