// ============================
// WebSocket 连接管理器
// ============================
// 统一管理 WebSocket 连接，避免多个 store 创建重复连接
// ============================

import { io, Socket } from 'socket.io-client';

// ============================
// 连接管理器
// ============================

class WebSocketManager {
  private static instance: WebSocketManager;
  private socket: Socket | null = null;
  private isConnecting: boolean = false;

  private constructor() {}

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  // ============================
  // 获取 WebSocket URL
  // ============================

  private getWebSocketUrl(): string {
    const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
    const params = new URLSearchParams();

    if (token) {
      params.set('token', token);
    }

    const port = process.env.NEXT_PUBLIC_WEBSOCKET_PORT || '3003';
    const queryString = params.toString();

    if (process.env.NODE_ENV === 'development') {
      return queryString
        ? `http://localhost:${port}?${queryString}`
        : `http://localhost:${port}`;
    }

    return queryString ? `/?${queryString}` : `/`;
  }

  // ============================
  // 连接管理
  // ============================

  connect(): Socket {
    // 如果已有连接，直接返回
    if (this.socket && this.socket.connected) {
      console.log('[WebSocket] 复用已有连接');
      return this.socket;
    }

    // 如果正在连接中，返回现有 socket
    if (this.isConnecting && this.socket) {
      console.log('[WebSocket] 正在连接中，返回现有 socket');
      return this.socket;
    }

    this.isConnecting = true;

    const url = this.getWebSocketUrl();
    console.log(`[WebSocket] 正在连接到: ${url}`);

    // 创建新连接
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    // 基础事件监听
    this.socket.on('connect', () => {
      this.isConnecting = false;
      console.log('[WebSocket] 连接成功, socket ID:', this.socket?.id);
    });

    this.socket.on('disconnect', () => {
      console.log('[WebSocket] 连接断开');
    });

    this.socket.on('connect_error', (error) => {
      this.isConnecting = false;
      console.error('[WebSocket] 连接失败:', error.message);
    });

    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      console.log('[WebSocket] 主动断开连接');
      this.socket.disconnect();
      this.socket = null;
      this.isConnecting = false;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  isConnectingState(): boolean {
    return this.isConnecting;
  }

  // ============================
  // 重置（用于测试或重新认证）
  // ============================

  reset(): void {
    this.disconnect();
  }
}

// ============================
// 导出单例
// ============================

export const wsManager = WebSocketManager.getInstance();
