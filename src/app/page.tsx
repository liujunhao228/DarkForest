'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Matchmaking } from '@/components/online/Matchmaking';
import { MainMenu } from '@/components/online/MainMenu';
import { OnlineBoard } from '@/components/online/OnlineBoard';
import { useOnlineGameStore } from '@/store/onlineGameStore';

type GameMode = 'menu' | 'matchmaking' | 'online';

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<GameMode>('menu');
  const [checkingAuth, setCheckingAuth] = useState(() => {
    if (typeof window === 'undefined') return true;
    const token = localStorage.getItem('authToken');
    const player = localStorage.getItem('player');
    return !(token && player);
  });

  // 在线游戏状态
  const { connect, disconnect, roomId, roomCode } = useOnlineGameStore();

  // 检查登录状态
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const player = localStorage.getItem('player');

    if (!token || !player) {
      // 未登录，跳转到登录页
      router.push('/auth');
    }
  }, [router]);

  // 安全超时：如果5秒后还在检查认证，强制结束
  useEffect(() => {
    const timeout = setTimeout(() => {
      setCheckingAuth(false);
    }, 5000);
    return () => clearTimeout(timeout);
  }, []);

  // 返回主菜单
  const handleBackToMenu = useCallback(() => {
    setMode('menu');
    disconnect();
  }, [disconnect]);

  // 匹配成功
  const handleMatchFound = useCallback((roomId: string, roomCode: string, _players: unknown[]) => {
    console.log('[Page] 匹配成功，准备进入游戏:', { roomId, roomCode });
    // 连接到在线游戏
    connect(roomId, roomCode);
    setMode('online');
    console.log('[Page] 已切换到 online 模式');
  }, [connect]);

  // 离开在线房间
  const handleLeaveRoom = useCallback(() => {
    disconnect();
    setMode('menu');
  }, [disconnect]);

  // 加载中
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

  // 渲染不同模式
  switch (mode) {
    case 'menu':
      return <MainMenu onPlayOnline={() => setMode('matchmaking')} />;

    case 'matchmaking':
      return (
        <Matchmaking
          onCancel={handleBackToMenu}
          onMatchFound={handleMatchFound}
        />
      );

    case 'online':
      if (!roomId || !roomCode) {
        return <MainMenu onPlayOnline={() => setMode('matchmaking')} />;
      }
      return (
        <OnlineBoard
          roomId={roomId}
          roomCode={roomCode}
          onLeave={handleLeaveRoom}
        />
      );

    default:
      return <MainMenu onPlayOnline={() => setMode('matchmaking')} />;
  }
}
