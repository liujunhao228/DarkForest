import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { LOADING_TEXT } from '@/constants/gameText';
import { useAuthStore } from '../store/authStore';
import { useOnlineStore } from '../store/onlineStore';
import { MainMenu } from '../components/online/MainMenu';
import { Matchmaking } from '../components/online/Matchmaking';
import { QuickMatchmaking } from '../components/online/QuickMatchmaking';
import { useOnlineGameStore } from '../store/onlineGameStore';
import { isTokenExpired } from '../lib/token';
import { isTrustAuthenticated } from '../lib/trust';

// P1-A1: OnlineBoard 含 framer-motion + react-rnd + radix-ui 等重组件，懒加载到进入 online 模式时才下载
const OnlineBoard = lazy(() =>
  import('../components/online/OnlineBoard').then((m) => ({ default: m.OnlineBoard }))
);

type AppPhase = 'menu' | 'matchmaking' | 'quickmatching' | 'online';

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AppPhase>('menu');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // 基本类型字段，单字段 selector 订阅天然稳定，无需 useShallow
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const gameConnect = useOnlineGameStore(s => s.connect);
  const gameDisconnect = useOnlineGameStore(s => s.disconnect);

  // trust 模式：无 JWT 会话，后端已在 WS 握手按 ?qq= 注入身份，视为已认证
  const isTrustAuth = isTrustAuthenticated();

  useEffect(() => {
    if (isTrustAuth) {
      setIsCheckingAuth(false);
      return;
    }

    if (token && isTokenExpired(token)) {
      logout();
      navigate('/auth', { replace: true });
      return;
    }

    if (!isAuthenticated) {
      navigate('/auth', { replace: true });
      return;
    }

    // 鉴权检查完成，同步标记状态，属于合法的 effect 状态同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsCheckingAuth(false);
  }, [isAuthenticated, token, logout, navigate, isTrustAuth]);

  const handlePlayOnline = useCallback(() => { setMode('matchmaking'); }, []);
  const handleQuickMatch = useCallback(() => { setMode('quickmatching'); }, []);
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
  // 主动重连：先发送 room:rejoin，再建立 onlineGameStore 连接（注册游戏事件监听 + game:requestSync）
  const handleRejoinGame = useCallback((rid: string, code: string) => {
    useOnlineStore.getState().rejoinRoom(rid);
    gameConnect(rid, code);
    setRoomId(rid);
    setRoomCode(code);
    setMode('online');
  }, [gameConnect]);

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">{LOADING_TEXT.default}</p>
        </div>
      </div>
    );
  }

  switch (mode) {
    case 'menu':
      return <MainMenu onPlayOnline={handlePlayOnline} onQuickMatch={handleQuickMatch} onRejoinGame={handleRejoinGame} />;

    case 'matchmaking':
      return <Matchmaking onCancel={handleCancelMatchmaking} onMatchFound={handleMatchFound} />;

    case 'quickmatching':
      return <QuickMatchmaking onCancel={handleCancelMatchmaking} onMatchFound={handleMatchFound} />;

    case 'online':
      if (!roomId || !roomCode) {
        return <div className="min-h-screen flex items-center justify-center">{LOADING_TEXT.room}</div>;
      }
      return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">{LOADING_TEXT.game}</div>}>
          <OnlineBoard roomId={roomId} roomCode={roomCode} onLeave={handleLeaveRoom} />
        </Suspense>
      );

    default:
      return <div className="min-h-screen flex items-center justify-center">{LOADING_TEXT.unknownMode}</div>;
  }
}
