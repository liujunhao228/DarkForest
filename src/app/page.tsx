'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GameSetup } from '@/components/game/GameSetup';
import { GameBoard } from '@/components/game/GameBoard';
import { GameOverScreen } from '@/components/game/GameOver';
import { MainMenu } from '@/components/online/MainMenu';
import { Matchmaking } from '@/components/online/Matchmaking';
import { OnlineBoard } from '@/components/online/OnlineBoard';
import { useGameStore } from '@/store/gameStore';
import { useOnlineStore } from '@/store/onlineStore';
import { useOnlineGameStore } from '@/store/onlineGameStore';

type GameMode = 'menu' | 'offline' | 'matchmaking' | 'online' | 'gameOver';

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<GameMode>('menu');
  const [checkingAuth, setCheckingAuth] = useState(true);

  // 单机游戏状态
  const initGame = useGameStore(s => s.initGame);
  const phase = useGameStore(s => s.phase);

  // 在线游戏状态
  const { matchInfo, clearError } = useOnlineStore();
  const { connect, disconnect, gameState, roomId, roomCode } = useOnlineGameStore();

  // 检查登录状态
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const player = localStorage.getItem('player');

    if (!token || !player) {
      // 未登录，跳转到登录页
      router.push('/auth');
    } else {
      setCheckingAuth(false);
    }
  }, [router]);

  // 开始单机游戏
  const handleStartOffline = useCallback((playerCount: number, playerName: string) => {
    setMode('offline');
    setTimeout(() => {
      initGame({ playerCount, humanName: playerName || '地球文明' });
    }, 300);
  }, [initGame]);

  // 返回主菜单
  const handleBackToMenu = useCallback(() => {
    setMode('menu');
    disconnect();
  }, [disconnect]);

  // 单机游戏结束重启
  const handleRestartOffline = useCallback(() => {
    setMode('menu');
    useGameStore.setState({
      phase: 'setup',
      totalTurn: 0,
      players: [],
      drawPile: [],
      discardPile: [],
      flyingStrikes: [],
      broadcast: null,
      logs: [],
      winner: null,
    });
  }, []);

  // 匹配成功
  const handleMatchFound = useCallback((roomId: string, roomCode: string, players: unknown[]) => {
    // 连接到在线游戏
    connect(roomId, roomCode);
    setMode('online');
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
      return <MainMenu onPlayOffline={() => setMode('offline')} onPlayOnline={() => {}} />;

    case 'matchmaking':
      return (
        <Matchmaking
          onCancel={handleBackToMenu}
          onMatchFound={handleMatchFound}
        />
      );

    case 'online':
      if (!roomId || !roomCode) {
        return <MainMenu onPlayOffline={() => setMode('offline')} onPlayOnline={() => {}} />;
      }
      return (
        <OnlineBoard
          roomId={roomId}
          roomCode={roomCode}
          onLeave={handleLeaveRoom}
        />
      );

    case 'offline':
    case 'gameOver':
      if (phase === 'setup') {
        return <GameSetup onStart={handleStartOffline} />;
      }
      return (
        <>
          <GameBoard />
          {phase === 'gameOver' && <GameOverScreen onRestart={handleRestartOffline} />}
        </>
      );

    default:
      return <MainMenu onPlayOffline={() => setMode('offline')} onPlayOnline={() => {}} />;
  }
}
