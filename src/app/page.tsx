'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { GameSetup } from '@/components/game/GameSetup';
import { GameBoard } from '@/components/game/GameBoard';
import { GameOverScreen } from '@/components/game/GameOver';
import { useGameStore } from '@/store/gameStore';

export default function Home() {
  const [gameStarted, setGameStarted] = useState(false);
  const initGame = useGameStore(s => s.initGame);
  const phase = useGameStore(s => s.phase);
  const players = useGameStore(s => s.players);
  const currentPlayerIndex = useGameStore(s => s.currentPlayerIndex);
  const humanPlayerId = useGameStore(s => s.humanPlayerId);
  const pendingAction = useGameStore(s => s.pendingAction);

  const handleStart = useCallback((playerCount: number, playerName: string) => {
    setGameStarted(true);
    // Small delay for setup animation
    setTimeout(() => {
      initGame({ playerCount, humanName: playerName || '地球文明' });
    }, 300);
  }, [initGame]);

  const handleRestart = useCallback(() => {
    setGameStarted(false);
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

  if (!gameStarted || phase === 'setup') {
    return <GameSetup onStart={handleStart} />;
  }

  return (
    <>
      <GameBoard />
      {phase === 'gameOver' && <GameOverScreen onRestart={handleRestart} />}
    </>
  );
}
