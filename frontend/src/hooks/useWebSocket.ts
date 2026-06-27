import { useRef, useEffect, useCallback } from 'react';
import { wsClient, type ClientEvent, type ServerEvent } from '../ws/client';

export function useWebSocket() {
  const registeredHandlers = useRef<Map<ServerEvent, Set<(payload: unknown) => void>>>(new Map());

  const send = useCallback((type: ClientEvent, payload?: unknown, roomId?: string) => {
    wsClient.send(type, payload, roomId);
  }, []);

  const off = (event: ServerEvent, handler: (payload: unknown) => void) => {
    wsClient.off(event, handler);
    const handlers = registeredHandlers.current.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        registeredHandlers.current.delete(event);
      }
    }
  };

  const on = <T extends ServerEvent>(event: T, handler: (payload: unknown) => void) => {
    wsClient.on(event, handler);
    if (!registeredHandlers.current.has(event)) {
      registeredHandlers.current.set(event, new Set());
    }
    registeredHandlers.current.get(event)!.add(handler);
    return () => {
      off(event, handler);
    };
  };

  useEffect(() => {
    const handlers = registeredHandlers.current;
    return () => {
      handlers.forEach((handlersSet, event) => {
        handlersSet.forEach(handler => {
          wsClient.off(event, handler);
        });
      });
      handlers.clear();
    };
  }, []);

  return { send, on, off };
}