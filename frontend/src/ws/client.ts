import { getToken } from '../store/authStore';
import type { Message, ClientEvent, ServerEvent } from './protocol';

interface EventHandler {
  (payload: unknown): void;
}

type InternalEvents = 'connect' | 'disconnect' | 'connect_error';
type AllEvents = ServerEvent | InternalEvents;
type EventMap = Record<string, Set<EventHandler>>;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private eventHandlers: EventMap = {} as EventMap;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private sendQueue: Message[] = [];
  private pingInterval: number | null = null;
  private pingTimeout: number | null = null;
  private isReconnecting = false;

  constructor() {
    this.url = '/ws';
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] 已连接，复用现有连接');
      return;
    }

    if (this.isConnecting) {
      console.log('[WebSocket] 正在连接中');
      return;
    }

    this.isConnecting = true;
    if (!this.isReconnecting) {
      this.reconnectAttempts = 0;
    }

    const token = getToken();
    const url = token ? `${this.url}?token=${encodeURIComponent(token)}` : this.url;

    console.log(`[WebSocket] 连接到: ${url}`);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[WebSocket] 连接成功');
      this.isConnecting = false;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      this.startPing();
      this.flushSendQueue();
      this.emit('connect', undefined);
    };

    this.ws.onmessage = (event) => {
      try {
        const message: Message = JSON.parse(event.data);
        if (message.type === 'pong') {
          this.resetPingTimeout();
          return;
        }
        this.handleMessage(message);
      } catch (error) {
        console.error('[WebSocket] 消息解析失败:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocket] 连接错误:', error);
      this.isConnecting = false;
      this.emit('connect_error', error);
    };

    this.ws.onclose = (event) => {
      console.log('[WebSocket] 连接关闭:', event.code, event.reason);
      this.isConnecting = false;
      this.stopPing();
      this.emit('disconnect', event);

      if (event.code !== 1000) {
        this.attemptReconnect();
      } else {
        this.isReconnecting = false;
      }
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] 达到最大重连次数，停止尝试');
      this.isReconnecting = false;
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`[WebSocket] 尝试重连 ${this.reconnectAttempts}/${this.maxReconnectAttempts}，延迟 ${delay}ms`);

    setTimeout(() => {
      if (this.isReconnecting) {
        this.connect();
      }
    }, delay);
  }

  disconnect(): void {
    this.isReconnecting = false;
    if (this.ws) {
      console.log('[WebSocket] 主动断开连接');
      this.ws.close(1000, 'Client requested disconnect');
      this.ws = null;
    }
    this.stopPing();
    this.sendQueue = [];
  }

  send(type: ClientEvent, payload?: unknown, roomId?: string): void {
    const message: Message = { type, payload, roomId };

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('[WebSocket] 连接未就绪，加入发送队列');
      this.sendQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[WebSocket] 发送失败:', error);
      this.sendQueue.push(message);
    }
  }

  private flushSendQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    while (this.sendQueue.length > 0) {
      const message = this.sendQueue.shift()!;
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('[WebSocket] 队列消息发送失败:', error);
        this.sendQueue.unshift(message);
        break;
      }
    }
  }

  on<T extends AllEvents>(event: T, handler: (payload: unknown) => void): void {
    if (!this.eventHandlers[event as string]) {
      this.eventHandlers[event as string] = new Set();
    }
    this.eventHandlers[event as string].add(handler);
  }

  off<T extends AllEvents>(event: T, handler: (payload: unknown) => void): void {
    const handlers = this.eventHandlers[event as string];
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        delete this.eventHandlers[event as string];
      }
    }
  }

  private emit(event: string, payload: unknown): void {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      Array.from(handlers).forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error('[WebSocket] 事件处理器执行失败:', error);
        }
      });
    }
  }

  private handleMessage(message: Message): void {
    const handlers = this.eventHandlers[message.type as string];
    if (handlers) {
      Array.from(handlers).forEach(handler => {
        try {
          handler(message.payload);
        } catch (error) {
          console.error('[WebSocket] 事件处理器执行失败:', error);
        }
      });
    } else {
      console.log('[WebSocket] 未处理的消息:', message.type);
    }
  }

  private startPing(): void {
    this.stopPing();

    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
        this.pingTimeout = window.setTimeout(() => {
          console.error('[WebSocket] Ping 超时，断开连接');
          this.ws?.close(1006, 'Ping timeout');
        }, 5000);
      }
    }, 60000);
  }

  private resetPingTimeout(): void {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  private stopPing(): void {
    this.resetPingTimeout();
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}

export const wsClient = new WebSocketClient();

export type { ClientEvent, ServerEvent };