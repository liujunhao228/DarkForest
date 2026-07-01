import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { MainMenu } from '../components/online/MainMenu';
import { Matchmaking } from '../components/online/Matchmaking';
import { OnlineBoard } from '../components/online/OnlineBoard';
import { useOnlineGameStore } from '../store/onlineGameStore';
import { isTokenExpired } from '../lib/token';

type GameMode = 'menu' | 'matchmaking' | 'online';

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<GameMode>('menu');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const { isAuthenticated, token, logout } = useAuthStore();
  const gameConnect = useOnlineGameStore(s => s.connect);
  const gameDisconnect = useOnlineGameStore(s => s.disconnect);

  useEffect(() => {
    if (token && isTokenExpired(token)) {
      logout();
      navigate('/auth', { replace: true });
      return;
    }

    if (!isAuthenticated) {
      navigate('/auth', { replace: true });
      return;
    }

    setIsCheckingAuth(false);
  }, [isAuthenticated, token, logout, navigate]);

  const handlePlayOnline = useCallback(() => { setMode('matchmaking'); }, []);
  const handleCancelMatchmaking = useCallback(() => { setMode('menu'); }, []);
  const handleMatchFound = useCallback((rid: string, code: string, players: unknown[]) => {
    void players;
    gameConnect(rid, code);
    setRoomId(rid);
    setRoomCode(code);
    setMode('online');
  }, [gameConnect]);
  const handleLeaveRoom = useCallback(() => {
    gameDisconnect();
    setRoomId(null);
    setRoomCode(null);
    setMode('menu');
  }, [gameDisconnect]);

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  switch (mode) {
    case 'menu':
      return <MainMenu onPlayOnline={handlePlayOnline} />;

    case 'matchmaking':
      return <Matchmaking onCancel={handleCancelMatchmaking} onMatchFound={handleMatchFound} />;

    case 'online':
      if (!roomId || !roomCode) {
        return <div className="min-h-screen flex items-center justify-center">加载房间...</div>;
      }
      return <OnlineBoard roomId={roomId} roomCode={roomCode} onLeave={handleLeaveRoom} />;

    default:
      return <div className="min-h-screen flex items-center justify-center">未知模式</div>;
  }
}
