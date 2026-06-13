import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useWebSocket } from '../hooks/useWebSocket';
import { wsClient } from '../ws/client';
import type { MatchFoundResponse } from '../ws/protocol';

type GameMode = 'menu' | 'matchmaking' | 'online';

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<GameMode>('menu');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);

  const { isAuthenticated } = useAuthStore();
  const { send, on, off } = useWebSocket();

  const matchFoundHandler = useRef((payload: unknown) => {
    const data = payload as MatchFoundResponse;
    console.log('[Home] 匹配成功:', data);
    setRoomId(data.roomId);
    setRoomCode(data.roomCode);
    setMode('online');
  });

  const queueErrorHandler = useRef((payload: unknown) => {
    console.error('[Home] 匹配错误:', payload);
  });

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/auth');
      return;
    }
    setCheckingAuth(false);
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    on('match:found', matchFoundHandler.current);
    on('match:queueError', queueErrorHandler.current);
    return () => {
      off('match:found', matchFoundHandler.current);
      off('match:queueError', queueErrorHandler.current);
    };
  }, [on, off]);

  const handlePlayOnline = useCallback(() => {
    wsClient.connect();
    send('match:joinQueue', { preferredCount: 4 });
    setMode('matchmaking');
  }, [send]);

  const handleCancelMatchmaking = useCallback(() => {
    send('match:cancelQueue');
    wsClient.disconnect();
    setMode('menu');
  }, [send]);

  const handleLeaveRoom = useCallback(() => {
    send('room:leave');
    wsClient.disconnect();
    setRoomId(null);
    setRoomCode(null);
    setMode('menu');
  }, [send]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  switch (mode) {
    case 'menu':
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent mb-4">
              黑暗森林
            </h1>
            <p className="text-slate-400">多人策略卡牌游戏</p>
          </div>
          
          <div className="space-y-4 w-full max-w-xs">
            <button
              onClick={handlePlayOnline}
              className="w-full py-4 px-6 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 rounded-lg text-white font-semibold text-lg transition-all"
            >
              开始游戏
            </button>
            
            <button
              onClick={() => navigate('/replay')}
              className="w-full py-4 px-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-white font-semibold text-lg transition-all border border-slate-700"
            >
              查看回放
            </button>
            
            <button
              onClick={() => navigate('/admin')}
              className="w-full py-3 px-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 font-medium transition-all border border-slate-700"
            >
              管理控制台
            </button>
          </div>
        </div>
      );

    case 'matchmaking':
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-8">匹配中...</h2>
            
            <div className="relative w-24 h-24 mx-auto mb-8">
              <div className="absolute inset-0 border-4 border-primary/20 rounded-full"></div>
              <div className="absolute inset-2 border-4 border-primary/30 rounded-full animate-ping"></div>
              <div className="absolute inset-4 border-4 border-primary/50 rounded-full animate-pulse"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl">👾</span>
              </div>
            </div>

            <p className="text-slate-400 mb-4">正在寻找其他玩家...</p>
            
            <button
              onClick={handleCancelMatchmaking}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-all"
            >
              取消匹配
            </button>
          </div>
        </div>
      );

    case 'online':
      if (!roomId || !roomCode) {
        return <div className="min-h-screen flex items-center justify-center">加载房间...</div>;
      }
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-4">游戏进行中</h2>
            <p className="text-slate-400 mb-2">房间 ID: {roomId}</p>
            <p className="text-slate-400 mb-8">房间码: {roomCode}</p>
            
            <button
              onClick={handleLeaveRoom}
              className="px-6 py-3 bg-destructive hover:bg-destructive/80 rounded-lg text-white transition-all"
            >
              离开房间
            </button>
          </div>
        </div>
      );

    default:
      return <div className="min-h-screen flex items-center justify-center">未知模式</div>;
  }
}