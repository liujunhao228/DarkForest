import { useCallback, useRef, useEffect } from 'react';
import { wsClient, type ClientEvent, type ServerEvent } from '../ws/client';

export function useWebSocket() {
  // 使用 ref 存储所有注册的事件监听器，用于组件卸载时清理
  const registeredHandlers = useRef<Map<ServerEvent, Set<(payload: unknown) => void>>>(new Map());

  const send = useCallback((type: ClientEvent, payload?: unknown, roomId?: string) => {
    wsClient.send(type, payload, roomId);
  }, []);

  const on = useCallback(<T extends ServerEvent>(event: T, handler: (payload: unknown) => void) => {
    wsClient.on(event, handler);
    
    // 存储已注册的处理器
    if (!registeredHandlers.current.has(event)) {
      registeredHandlers.current.set(event, new Set());
    }
    registeredHandlers.current.get(event)!.add(handler);
    
    return () => {
      off(event, handler);
    };
  }, []);

  const off = useCallback(<T extends ServerEvent>(event: T, handler: (payload: unknown) => void) => {
    wsClient.off(event, handler);
    
    // 从存储中移除处理器
    const handlers = registeredHandlers.current.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        registeredHandlers.current.delete(event);
      }
    }
  }, []);

  // 组件卸载时自动清理所有注册的事件监听器
  useEffect(() => {
    return () => {
      registeredHandlers.current.forEach((handlers, event) => {
        handlers.forEach(handler => {
          wsClient.off(event, handler);
        });
      });
      registeredHandlers.current.clear();
    };
  }, []);

  return {
    send,
    on,
    off,
  };
}