// ============================
// WebSocket 连接 Hook
// ============================

import { useEffect, useState, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { wsManager } from '@/lib/websocket';

export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socketInstance = wsManager.connect();
    socketRef.current = socketInstance;

    const handleConnect = () => {
      setSocket(socketRef.current);
    };

    const handleDisconnect = () => {
      setSocket(null);
    };

    socketInstance.on('connect', handleConnect);
    socketInstance.on('disconnect', handleDisconnect);

    return () => {
      socketInstance.off('connect', handleConnect);
      socketInstance.off('disconnect', handleDisconnect);
    };
  }, []);

  return socket;
}
